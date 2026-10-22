// A song's beat grid for a person (ADR-119): what the Audio tab's Beat
// grid section edits, what the clip draws, and the bars the clip menu's
// Cut bars takes out. Every change goes through the agent's own commands
// (set_music_grid, cut_music, ADR-101 and ADR-104); this file only turns
// what a person does (a tap, the playhead, the in and out marks) into
// their arguments.

import { BEATS_PER_BAR } from "./analysis/beats";
import { assetRole, assetsOf, trackRole } from "./audioRoles";
import { gridStructure } from "./analysis/musicMap";
import { exportRange } from "./export";
import { nearestLine } from "./musicCut";
import { findClip, framesForSource, getAsset, sourceOffset, type TimedClip } from "./project/ops";
import type { Id, MusicGrid, MusicPart, Project } from "./project/types";
import { framesToSeconds, type Rational } from "./time";

/** Is this clip a song, which the Beat grid section and Cut bars offer
 * to? An audio clip whose file has a grid, or is music by its file or its
 * track (a plain audio track is music, lib/audioRoles). */
export function isSong(p: Project, clipId: Id): boolean {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "audio") return false;
  const asset = getAsset(p, loc.clip.assetId);
  return !!asset && (!!asset.musicGrid || (assetRole(asset) ?? trackRole(loc.track, assetsOf(p))) === "music");
}

/** Seconds of a bar at `bpm`, four beats. */
export const barSeconds = (bpm: number) => (60 / bpm) * BEATS_PER_BAR;

/** The grid's first bar line in the file (at or after 0): the downbeat a
 * person reads. The grid keeps whichever bar line it was given, so a tempo
 * change turns about the downbeat the person set. */
export function firstBar(g: MusicGrid): number {
  const bar = barSeconds(g.bpm);
  return +(g.firstDownbeat - Math.floor(g.firstDownbeat / bar + 1e-9) * bar).toFixed(4);
}

/** set_music_grid's arguments for a grid. */
export function gridArgs(clipId: Id, g: MusicGrid): Record<string, unknown> {
  return { clip_id: clipId, bpm: +g.bpm.toFixed(4), first_downbeat: +Math.max(0, g.firstDownbeat).toFixed(4), ...(g.sections?.length ? { sections: g.sections } : {}) };
}

/** The parts with one starting at `at` (file seconds): a part within a
 * twentieth of a second of it is relabeled instead of doubled. */
export function withPart(sections: MusicGrid["sections"], at: number, label: MusicPart): NonNullable<MusicGrid["sections"]> {
  const rest = (sections ?? []).filter((s) => Math.abs(s.at - at) > 0.05);
  return [...rest, { at: +Math.max(0, at).toFixed(4), label }].sort((a, b) => a.at - b.at);
}

/** The file second a timed clip plays at timeline frame `f` (exact, not the
 * frame's start): where "Set downbeat here" puts a bar line. Null off the clip. */
export function sourceAtFrame(c: TimedClip, f: number, fps: Rational): number | null {
  if (f < c.start || f >= c.start + c.duration || c.freeze) return null;
  const off = sourceOffset(c, f - c.start, fps);
  return +(c.reverse ? c.in - off : c.in + off).toFixed(4);
}

/**
 * One tempo and a bar's first beat for a song's tracked beats (analysis,
 * file seconds): the straight line through them by least squares, each
 * beat numbered from the one before it (a missed beat counts two, and a
 * tempo read 0.5% off cannot lose count over a long song), and the bar
 * phase most downbeats take on that line. A tracker's tempo read as 127.4
 * for a 128 BPM song drifts 0.3 s a minute as a grid; the line does not.
 */
export function fitGrid(beats: number[], downbeats: number[], bpm: number): { bpm: number; firstDownbeat: number } {
  const step0 = 60 / bpm;
  if (beats.length < 8) return { bpm: +bpm.toFixed(2), firstDownbeat: +(downbeats[0] ?? beats[0] ?? 0).toFixed(4) };
  const k = [0];
  for (let i = 1; i < beats.length; i++) k.push(k[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) / step0)));
  const n = beats.length, mk = k.reduce((s, x) => s + x, 0) / n, mt = beats.reduce((s, x) => s + x, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (k[i] - mk) * (beats[i] - mt);
    den += (k[i] - mk) ** 2;
  }
  const step = num / den, a = mt - step * mk;
  // The phase (beat of four) most downbeats sit on.
  const votes = [0, 0, 0, 0];
  for (const d of downbeats) votes[(((Math.round((d - a) / step)) % 4) + 4) % 4]++;
  let first = a + votes.indexOf(Math.max(...votes)) * step;
  while (first - 4 * step >= -1e-6) first -= 4 * step;
  while (first < -1e-6) first += 4 * step;
  return { bpm: +(60 / step).toFixed(2), firstDownbeat: +Math.max(0, first).toFixed(4) };
}

// ---- tap tempo -------------------------------------------------------------------

/** A pause this long (ms) starts a new run of taps. */
export const TAP_RESET_MS = 2000;
/** Taps a tempo needs: three intervals. */
export const TAP_MIN = 4;

/**
 * The tempo of a run of taps (ms, as performance.now gives them): the run
 * after the last pause of TAP_RESET_MS, its last nine taps. Steady taps
 * (every interval within a quarter of the median) give the span's mean,
 * which a tap's jitter barely moves; one stray tap gives the median. Null
 * under TAP_MIN taps or outside 40-240 BPM. One decimal.
 */
export function tapTempo(taps: number[]): number | null {
  let i = taps.length - 1;
  while (i > 0 && taps[i] - taps[i - 1] <= TAP_RESET_MS && taps[i] > taps[i - 1]) i--;
  const run = taps.slice(i).slice(-9);
  if (run.length < TAP_MIN) return null;
  const gaps = run.slice(1).map((t, k) => t - run[k]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const steady = gaps.every((g) => Math.abs(g - mid) <= mid / 4);
  const beat = steady ? (run.at(-1)! - run[0]) / gaps.length : mid;
  const bpm = 60000 / beat;
  return bpm >= 40 && bpm <= 240 ? Math.round(bpm * 10) / 10 : null;
}

// ---- the grid drawn on the clip ------------------------------------------------------

/** Ticks closer than this (px) are thinned: beats, then bars, then every fourth bar. */
export const TICK_MIN_PX = 8;

/**
 * Where a clip draws its song's grid (CapCut's beat dots on the music
 * clip): px from the clip's left edge, inside [x0, x1], each a beat or a
 * bar's first beat. Beats while they are TICK_MIN_PX apart, else bars,
 * else every fourth bar, else none. Through the clip's in-point, speed (a
 * curve too) and direction, as its markers are placed.
 */
export function gridTicks(c: TimedClip, g: MusicGrid, duration: number, fps: Rational, zoom: number, x0: number, x1: number): { x: number; bar: boolean }[] {
  if (c.freeze || zoom <= 0) return [];
  const s = gridStructure(g, duration);
  const rate = fps.num / fps.den;
  // Px a beat takes on the timeline at the clip's mean speed.
  const [lo, hi] = [c.in, c.in + sourceOffset(c, c.duration, fps)];
  const speed = c.speedCurve ? Math.max(1e-6, (hi - lo) / framesToSeconds(c.duration, fps)) : c.speed;
  const beatPx = ((60 / g.bpm) / speed) * rate * zoom;
  const bars = new Set(s.downbeats);
  const every = beatPx >= TICK_MIN_PX ? s.beats : beatPx * BEATS_PER_BAR >= TICK_MIN_PX ? s.downbeats : beatPx * BEATS_PER_BAR * 4 >= TICK_MIN_PX ? s.downbeats.filter((_, i) => i % 4 === 0) : [];
  const w = c.duration * zoom;
  const out: { x: number; bar: boolean }[] = [];
  for (const t of every) {
    const f = c.reverse ? framesForSource(c, c.in - t, fps) : framesForSource(c, t - c.in, fps);
    const x = f * zoom;
    if (x < 0 || x > w || x < x0 - 1 || x > x1 + 1) continue;
    out.push({ x: +x.toFixed(2), bar: bars.has(t) });
  }
  return out;
}

// ---- Cut bars ------------------------------------------------------------------------

export interface BarCut {
  /** File seconds cut_music takes out, each on a bar line. */
  from: number;
  to: number;
  /** Whole bars between them. */
  bars: number;
}

/**
 * The bars Cut bars takes out of a music clip: the in and out marks (as
 * Extract reads them: one alone runs to the timeline's start or end), held
 * to the clip, each moved to the song's nearest bar line, as cut_music
 * moves them. Or, in a person's words, why it cannot.
 */
export function barCut(p: Project, clipId: Id, inPoint: number | null, outPoint: number | null): BarCut | { why: string } {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "audio") return { why: "Cut bars works on a song's audio clip." };
  const c = loc.clip;
  const g = getAsset(p, c.assetId)?.musicGrid;
  if (!g) return { why: "Give the song its beat grid first: Detect beat grid in the Audio tab." };
  if (loc.track.locked) return { why: "Its track is locked." };
  if (c.speed !== 1 || c.speedCurve || c.reverse || c.freeze) return { why: "Cut bars needs the song at its own speed, playing forward." };
  if (inPoint === null && outPoint === null) return { why: "Mark In and Out around the bars to cut first." };
  const r = exportRange(p, "inout", inPoint, outPoint);
  const a = Math.max(r.from, c.start), b = Math.min(r.to, c.start + c.duration);
  if (b <= a) return { why: "The In and Out marks are not over this clip." };
  const file = (f: number) => c.in + framesToSeconds(f - c.start, p.fps);
  const out = file(c.start + c.duration);
  const from = Math.max(c.in, nearestLine(g, file(a), "bar")), to = Math.min(out, nearestLine(g, file(b), "bar"));
  if (!(to - from > 0.01)) return { why: "Less than half a bar lies between In and Out: mark at least one bar." };
  return { from: +from.toFixed(4), to: +to.toFixed(4), bars: Math.round((to - from) / barSeconds(g.bpm)) };
}
