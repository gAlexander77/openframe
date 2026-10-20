// A song cut at its bars and joined without a click (ADR-104). A butt
// splice in a song (cut_ranges) played each side's 4 ms click guard into
// the other: an 8 ms hole in the middle of a bar's last beat, which the
// film test could not hear and nothing reported. cut_music takes bars out
// of a song on its grid (set_music_grid), the jump an exact number of bars
// so the beat runs on, and joins the pieces with a short equal-power
// crossfade that ends on the downbeat; set_crossfade puts one on any join
// of two audio clips.

import { cutRanges } from "./project/cut";
import { clipEnd, findClip, updateClip } from "./project/ops";
import type { AudioClip, Clip, Id, Project } from "./project/types";
import { framesToSeconds } from "./time";

/** The crossfade a song cut gets unless asked: 30 ms, enough that no
 * sample steps and nothing dips, short enough to stay inside the last
 * sixteenth before the downbeat (125 ms at 120 BPM). */
export const MUSIC_CROSSFADE = 0.03;
/** The longest crossfade a join takes, seconds. */
export const MAX_CROSSFADE = 2;

export class MusicCutError extends Error {}

/** The next clip on `clipId`'s track, when it starts where this one ends. */
function nextOf(p: Project, clipId: Id): { clip: AudioClip; next: Clip | undefined } {
  const loc = findClip(p, clipId);
  if (!loc) throw new MusicCutError(`no clip with id ${clipId}`);
  if (loc.clip.type !== "audio") throw new MusicCutError(`${loc.clip.type} clips do not crossfade here: give the audio clip whose end meets the next`);
  const end = clipEnd(loc.clip);
  return { clip: loc.clip, next: loc.track.clips.find((c) => c.start === end) };
}

/**
 * set_crossfade: the join after an audio clip crossfades into the next
 * clip on its track over `seconds` (0: a butt cut again). The next clip
 * must start where it ends, play at its own speed, and have that much of
 * its file before its in-point (its sound rises before the cut).
 */
export function setCrossfade(p: Project, clipId: Id, seconds: number): Project {
  const { clip, next } = nextOf(p, clipId);
  if (!(seconds >= 0 && seconds <= MAX_CROSSFADE)) throw new MusicCutError(`seconds is 0 to ${MAX_CROSSFADE}`);
  if (seconds === 0) return clip.crossfade ? updateClip(p, clip.id, (c) => withoutCrossfade(c as AudioClip)) : p;
  if (!next) throw new MusicCutError(`nothing starts where ${clip.id} ends on its track: a crossfade joins two clips that meet`);
  if (next.type !== "audio") throw new MusicCutError(`${next.id} is a ${next.type} clip; a crossfade joins two audio clips`);
  for (const c of [clip, next]) if (c.speed !== 1 || c.speedCurve || c.reverse || c.freeze || c.tapeStop) throw new MusicCutError(`${c.id} is retimed (speed, curve, reverse, freeze or tape stop): a crossfade needs both at their own speed`);
  if (next.assetId === clip.assetId && Math.abs(clip.in + framesToSeconds(clip.duration, p.fps) - next.in) < 1e-3) throw new MusicCutError(`${next.id} goes on in the same file where ${clip.id} stops: there is no splice to crossfade`);
  const most = Math.min(next.in, framesToSeconds(clip.duration, p.fps) / 2, framesToSeconds(next.duration, p.fps) / 2);
  if (seconds > most + 1e-9) throw new MusicCutError(`at most ${+most.toFixed(3)} s here: ${next.in < seconds ? `${next.id} has ${+next.in.toFixed(3)} s of its file before its in-point to rise over` : "a crossfade is at most half of either clip"}`);
  return updateClip(p, clip.id, (c) => ({ ...c, crossfade: +seconds.toFixed(4) }) as Clip);
}

function withoutCrossfade(c: AudioClip): Clip {
  const { crossfade: _, ...rest } = c;
  return rest as Clip;
}

/** The bar (or beat) line of a grid nearest a file second. */
export function nearestLine(grid: { bpm: number; firstDownbeat: number }, t: number, every: "bar" | "beat"): number {
  const step = (60 / grid.bpm) * (every === "bar" ? 4 : 1);
  return +(grid.firstDownbeat + Math.round((t - grid.firstDownbeat) / step) * step).toFixed(6);
}

export interface MusicCut {
  clip_id: Id;
  /** File seconds to cut from and to, snapped to the grid. */
  from: number;
  to: number;
  snap?: "bar" | "beat" | "none";
  /** Seconds of crossfade at the join (default MUSIC_CROSSFADE). */
  crossfade?: number;
}

/**
 * cut_music: take [from, to) of the song's file out of its clip, each end
 * on the nearest bar line of the song's grid (or beat), the gap closed and
 * the two pieces joined with a crossfade. The piece after the cut plays
 * its file from exactly `to - from` seconds after where the first piece
 * stops, so the beat runs on whatever the frames round to.
 */
export function cutMusic(p: Project, o: MusicCut): { project: Project; from: number; to: number; join?: { at: number; clips: [Id, Id]; crossfade: number } } {
  const loc = findClip(p, o.clip_id);
  if (!loc) throw new MusicCutError(`no clip with id ${o.clip_id}`);
  const c = loc.clip;
  if (c.type !== "audio") throw new MusicCutError(`${c.type} clips are not songs here: give the music's audio clip`);
  if (loc.track.locked) throw new MusicCutError(`track ${loc.track.name} is locked`);
  if (c.speed !== 1 || c.speedCurve || c.reverse || c.freeze) throw new MusicCutError("cut_music needs the song at its own speed, forward");
  const asset = p.assets.find((a) => a.id === c.assetId);
  const snap = o.snap ?? "bar";
  if (snap !== "none" && !asset?.musicGrid) throw new MusicCutError("the song has no grid to cut on: set_music_grid first (bpm and a bar's first beat, in the file's seconds; analyze_music reads them), or snap none");
  const line = (t: number) => (snap === "none" ? t : nearestLine(asset!.musicGrid!, t, snap));
  const out = c.in + framesToSeconds(c.duration, p.fps);
  const from = Math.max(c.in, line(o.from)), to = Math.min(out, line(o.to));
  if (!(to - from > 0.01)) throw new MusicCutError(`nothing to cut: ${o.from}-${o.to} s snaps to ${+from.toFixed(3)}-${+to.toFixed(3)} s of the file, which the clip plays ${+c.in.toFixed(3)}-${+out.toFixed(3)}`);
  const crossfade = o.crossfade ?? MUSIC_CROSSFADE;
  if (!(crossfade >= 0 && crossfade <= MAX_CROSSFADE)) throw new MusicCutError(`crossfade is 0 to ${MAX_CROSSFADE} seconds`);
  const ids = new Set(loc.track.clips.map((x) => x.id));
  // The first piece stops on the frame at or before the bar line (rounded
  // to the nearer frame it could stop after it, and play the next
  // downbeat's attack as it falls), and the piece after starts as far
  // before its own downbeat (below), so that downbeat plays whole.
  const rate = p.fps.num / p.fps.den;
  const stopAt = c.in + Math.floor((from - c.in) * rate + 1e-6) / rate;
  let q = cutRanges(p, c.id, [{ start: stopAt, end: to }], true).project;
  const track = q.tracks.find((t) => t.id === loc.track.id)!;
  const pieces = track.clips.filter((x): x is AudioClip => x.type === "audio" && x.assetId === c.assetId && (x.id === c.id || !ids.has(x.id)));
  const a = pieces.find((x) => x.in < stopAt - 1e-6), b = pieces.find((x) => x.in >= stopAt - 1e-6 && x.start === (a ? clipEnd(a) : c.start));
  const fit = (x: AudioClip, inB: number): Clip => ({ ...x, in: +inB.toFixed(6), ...(framesToSeconds(x.duration, p.fps) > (asset?.duration ?? Infinity) - inB ? { duration: Math.max(1, x.duration - 1) } : {}) }) as Clip;
  // Cut at the head: the song now starts on the bar line, not the frame after it.
  if (!a && b) return { project: updateClip(q, b.id, (x) => fit(x as AudioClip, to)), from, to };
  if (!a || !b) return { project: q, from, to };
  // The jump is exactly to - from: the piece after plays on from there.
  const stop = a.in + framesToSeconds(a.duration, p.fps);
  const inB = stop + (to - from);
  q = updateClip(q, b.id, (x) => fit(x as AudioClip, inB));
  if (crossfade > 0) q = setCrossfade(q, a.id, Math.min(crossfade, inB, framesToSeconds(a.duration, p.fps) / 2, framesToSeconds(b.duration, p.fps) / 2));
  const x = (findClip(q, a.id)!.clip as AudioClip).crossfade ?? 0;
  return { project: q, from, to, join: { at: framesToSeconds(clipEnd(a), p.fps), clips: [a.id, b.id], crossfade: x } };
}
