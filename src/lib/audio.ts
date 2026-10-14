// Audio math that preview and export share: which clips sound, and each
// clip's gain over time (volume x track volume x fades x keyframes). Pure,
// so the envelope that Web Audio plays is the one the tests check.

import { paramAt } from "./keyframes";
import { isTimed } from "./project/ops";
import type { AudioClip, Project, Track, VideoClip } from "./project/types";
import { framesToSeconds } from "./time";

export interface SoundingClip {
  clip: VideoClip | AudioClip;
  track: Track;
}

/** Clips that produce sound: audio clips, and video clips whose own sound is
 * not muted or extracted, on unmuted tracks.
 * ponytail: no track solo yet; add it with the mixer panel. */
export function soundingClips(p: Project, hasAudio: (assetId: string) => boolean): SoundingClip[] {
  const out: SoundingClip[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!isTimed(clip) || clip.type === "compound" || clip.disabled || clip.muted || clip.freeze) continue;
      if (!hasAudio(clip.assetId)) continue;
      out.push({ clip, track });
    }
  }
  return out;
}

/** Click guard: every clip edge ramps over at least this long. */
export const EDGE_RAMP = 0.004;

/**
 * Gain of a clip at timeline second `t` (absolute). Fades are linear in
 * amplitude, as CapCut's are; keyframed volume interpolates by its curve.
 */
export function clipGainAt(c: VideoClip | AudioClip, track: Track, fps: Project["fps"], t: number): number {
  const start = framesToSeconds(c.start, fps);
  const end = framesToSeconds(c.start + c.duration, fps);
  if (t < start || t >= end) return 0;
  const rel = t - start;
  const r = Math.floor(rel * (fps.num / fps.den) + 1e-6);
  let g = paramAt(c, "volume", r) * track.volume;
  const fadeIn = Math.max(framesToSeconds(c.fadeIn, fps), EDGE_RAMP);
  const fadeOut = Math.max(framesToSeconds(c.fadeOut, fps), EDGE_RAMP);
  if (rel < fadeIn) g *= rel / fadeIn;
  if (end - t < fadeOut) g *= (end - t) / fadeOut;
  return Math.max(0, g);
}

/** The envelope sampled at `rate` points per second over [from, to), for
 * Web Audio's setValueCurveAtTime. Always at least two points. */
export function gainEnvelope(
  c: VideoClip | AudioClip,
  track: Track,
  fps: Project["fps"],
  from: number,
  to: number,
  rate = 200,
): Float32Array {
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(from + i / rate, to - 1e-6);
    out[i] = clipGainAt(c, track, fps, t);
  }
  return out;
}

/** Linear gain to decibels for meters and the inspector. */
export const toDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const fromDb = (db: number) => 10 ** (db / 20);
