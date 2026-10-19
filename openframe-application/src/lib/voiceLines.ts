// The lines of a voiceover on the timeline: which clips are voice lines,
// the caption that goes with each, and a line replaced by a new take in
// place (retake_voiceover), its caption following and, when asked, the
// lines and captions after it moving by the difference (ADR-083).

import { usedAssets } from "./project/mediaOrganization";
import { clipEnd, findClip } from "./project/ops";
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
}

/**
 * Put a new take in a voice line's place: the clip keeps its id, start and
 * settings and plays the new file from its start; the caption takes the
 * new words and length; the old file leaves the library when nothing else
 * plays it. Without ripple a longer take must fit before the next clip on
 * its track (an error says by how much it does not).
 */
export function retakeLine(p: Project, r: Retake): { project: Project; shift: number; captionId?: Id } {
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
