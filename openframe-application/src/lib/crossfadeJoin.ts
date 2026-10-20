// The join an audio clip can crossfade into (ADR-109): what the timeline
// draws, the clip menu offers and the Audio tab's Crossfade row edits. It
// reads set_crossfade's rules (lib/musicCut.ts) and what the mix plays
// (lib/audio.ts audioCrossfade), so the three never disagree with the sound.

import { audioCrossfade } from "./audio";
import { MAX_CROSSFADE } from "./musicCut";
import { clipEnd, findClip } from "./project/ops";
import type { AudioClip, Id, Project } from "./project/types";
import { framesToSeconds } from "./time";

export interface CrossfadeJoin {
  /** The audio clip that starts where this one ends. */
  next: AudioClip;
  /** The longest crossfade set_crossfade takes at this join, seconds (0: none fits). */
  most: number;
  /** The seconds the mix plays now (0: a butt cut). */
  plays: number;
  /** Why no crossfade fits, when `most` is 0: what to change. */
  why?: string;
}

const retimed = (c: AudioClip) => c.speed !== 1 || !!c.speedCurve || !!c.reverse || !!c.freeze || !!c.tapeStop;

/** The join after audio clip `clipId`, or null when no audio clip on its
 * track starts where it ends. */
export function crossfadeJoin(p: Project, clipId: Id): CrossfadeJoin | null {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "audio") return null;
  const a = loc.clip;
  const end = clipEnd(a);
  const next = loc.track.clips.find((c) => c.start === end);
  if (next?.type !== "audio") return null;
  const why =
    retimed(a) || retimed(next)
      ? "A crossfade needs both clips at their own speed (no speed change, curve, reverse or freeze)."
      : next.assetId === a.assetId && Math.abs(a.in + framesToSeconds(a.duration, p.fps) - next.in) < 1e-3
        ? "The next clip plays on in the same file: there is no splice to crossfade."
        : next.in < 0.001
          ? "The next clip starts at the very start of its file: trim its start so its sound can rise before the cut."
          : undefined;
  const most = why ? 0 : Math.min(MAX_CROSSFADE, next.in, framesToSeconds(a.duration, p.fps) / 2, framesToSeconds(next.duration, p.fps) / 2);
  return { next, most, plays: audioCrossfade(a, next, p.fps), ...(why ? { why } : {}) };
}

/** A new crossfade's length: the transitions preference, as far as the join allows. */
export const newCrossfade = (join: CrossfadeJoin, preferred: number) => +Math.min(preferred, join.most).toFixed(4);
