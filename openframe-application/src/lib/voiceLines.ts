// The lines of a voiceover on the timeline: which clips are voice lines,
// the caption that goes with each, and a line replaced by a new take in
// place (retake_voiceover), its caption following and, when asked, the
// lines and captions after it moving by the difference (ADR-083).

import { usedAssets } from "./project/mediaOrganization";
import { addClip, clipEnd, findClip } from "./project/ops";
import { uid } from "./project/defaults";
import { secondsToFrames } from "./time";
import type { Caption } from "./captions";
import type { Asset, Clip, Id, Project, TextClip } from "./project/types";
import { isDialog } from "./analysis/balance";

export type VoiceClip = Extract<Clip, { type: "audio" }>;

/** Voice lines: audio clips whose file was spoken from a script, and any
 * audio clip on a Voiceover track (a recorded read), in timeline order. */
export function voiceClips(p: Project): VoiceClip[] {
  const spoken = new Set(p.assets.filter((a) => a.speech).map((a) => a.id));
  return p.tracks
    .flatMap((t) => t.clips.filter((c): c is VoiceClip => c.type === "audio" && (spoken.has(c.assetId) || isDialog(t, p))))
    .sort((a, b) => a.start - b.start);
}

/** The caption shown with a voice line: the caption clip that overlaps the
 * line most (at least half of the caption), the nearest start on a tie. */
export function captionFor(p: Project, voice: Clip): TextClip | undefined {
  let best: TextClip | undefined, most = 0;
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.type !== "text" || !c.caption) continue;
      const overlap = Math.min(clipEnd(c), clipEnd(voice)) - Math.max(c.start, voice.start);
      if (overlap < c.duration / 2 || overlap <= 0) continue;
      if (overlap > most || (overlap === most && best && Math.abs(c.start - voice.start) < Math.abs(best.start - voice.start))) [best, most] = [c, overlap];
    }
  }
  return best;
}

export interface Retake {
  clipId: Id;
  /** The new take's file, already probed; added to the project here. */
  asset: Asset;
  /** The new take's length, frames. */
  frames: number;
  /** The caption's new words (default: as it is). */
  caption?: string;
  /** Move what follows on the voice's track and the caption tracks by the
   * difference in length. */
  ripple?: boolean;
  /** The new take's captions a few words at a time (seconds from its
   * start, ADR-115): every caption of the line gives way to these, styled,
   * placed and animated as its first one was. */
  chunks?: Caption[];
}

/** Every caption shown with a voice line: the caption clips at least half
 * inside it (a line captioned a few words at a time has several). */
export function captionsOf(p: Project, voice: Clip): TextClip[] {
  return p.tracks
    .flatMap((t) => t.clips.filter((c): c is TextClip => c.type === "text" && !!c.caption && Math.min(clipEnd(c), clipEnd(voice)) - Math.max(c.start, voice.start) >= c.duration / 2))
    .sort((a, b) => a.start - b.start);
}

/**
 * Put a new take in a voice line's place: the clip keeps its id, start and
 * settings and plays the new file from its start; the caption takes the
 * new words and length; the old file leaves the library when nothing else
 * plays it. Without ripple a longer take must fit before the next clip on
 * its track (an error says by how much it does not).
 */
export function retakeLine(p: Project, r: Retake): { project: Project; shift: number; captionId?: Id; captionIds?: Id[] } {
  if (r.chunks) return retakeChunked(p, r);
  const loc = findClip(p, r.clipId);
  if (!loc || loc.clip.type !== "audio") throw new Error(`No voice line ${r.clipId}: describe_project lists the Voiceover track's clips`);
  const clip = loc.clip;
  const oldEnd = clipEnd(clip);
  const speed = clip.speed || 1;
  const frames = Math.max(1, Math.round(r.frames / speed));
  const shift = frames - clip.duration;
  const caption = captionFor(p, clip);
  if (!r.ripple && shift > 0) {
    const next = loc.track.clips.filter((c) => c.start >= oldEnd).sort((a, b) => a.start - b.start)[0];
    if (next && clip.start + frames > next.start) {
      const over = (clip.start + frames - next.start) / (p.fps.num / p.fps.den);
      throw new Error(`The new take is ${over.toFixed(2)} s too long to fit before the next line (${next.id}); retake with ripple true to move the lines after it, or shorten the text.`);
    }
  }
  const later = (c: Clip, onVoiceTrack: boolean) => r.ripple && shift !== 0 && c.id !== clip.id && c.start >= oldEnd && (onVoiceTrack || (c.type === "text" && !!c.caption));
  const tracks = p.tracks.map((t) => {
    const onVoice = t.id === loc.track.id;
    if (!onVoice && !t.clips.some((c) => c.id === caption?.id || later(c, false))) return t;
    const clips = t.clips.map((c): Clip => {
      if (c.id === clip.id) return { ...c, assetId: r.asset.id, in: 0, duration: frames } as Clip;
      if (c.id === caption?.id) {
        // Without ripple the caption stops where the next caption starts.
        const next = t.clips.filter((x) => x.start > c.start && x.id !== c.id).sort((a, b) => a.start - b.start)[0];
        const duration = Math.max(1, Math.min(clip.start + frames - c.start, r.ripple || !next ? Infinity : next.start - c.start));
        return { ...c, duration, ...(r.caption !== undefined ? { text: r.caption, wordTimes: undefined } : {}) } as Clip;
      }
      return later(c, onVoice) ? ({ ...c, start: c.start + shift } as Clip) : c;
    });
    return { ...t, clips: clips.sort((a, b) => a.start - b.start) };
  });
  let project: Project = { ...p, tracks, assets: [...p.assets, r.asset] };
  // The old take goes with the edit; undo brings it back.
  if (!usedAssets(project).has(clip.assetId)) project = { ...project, assets: project.assets.filter((a) => a.id !== clip.assetId) };
  return { project, shift, captionId: caption?.id };
}

/**
 * retakeLine for a line captioned a few words at a time (ADR-115): its
 * captions are taken out, the take goes in as any retake's does (ripple
 * included), and the new take's chunks go where the old ones were, each a
 * copy of the line's first caption (its style, place, animations) with its
 * own words and their times.
 */
function retakeChunked(p: Project, r: Retake): { project: Project; shift: number; captionIds: Id[] } {
  const voice = findClip(p, r.clipId)?.clip;
  const old = voice ? captionsOf(p, voice) : [];
  const gone = new Set(old.map((c) => c.id));
  const bare: Project = { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => gone.has(c.id)) ? { ...t, clips: t.clips.filter((c) => !gone.has(c.id)) } : t)) };
  const done = retakeLine(bare, { ...r, chunks: undefined, caption: undefined });
  const template = old[0];
  const track = template && p.tracks.find((t) => t.clips.some((c) => c.id === template.id));
  const start = findClip(done.project, r.clipId)?.clip.start;
  if (!template || !track || start === undefined) return { project: done.project, shift: done.shift, captionIds: [] };
  const fps = p.fps;
  let project = done.project;
  const captionIds: Id[] = [];
  for (const c of r.chunks!) {
    const from = start + secondsToFrames(c.start, fps);
    const to = Math.max(from + 1, start + secondsToFrames(c.end, fps));
    const clip: TextClip = { ...template, id: uid("c"), start: from, duration: to - from, text: c.text, wordTimes: c.words?.map((s) => Math.max(0, start + secondsToFrames(s, fps) - from)) };
    if (!clip.wordTimes) delete clip.wordTimes;
    project = addClip(project, track.id, clip);
    captionIds.push(clip.id);
  }
  return { project, shift: done.shift, captionIds };
}
