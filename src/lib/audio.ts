// Audio math that preview and export share: which clips sound, and each
// clip's gain over time (volume x track volume x fades x keyframes). Pure,
// so the envelope that Web Audio plays is the one the tests check.

import { paramAt } from "./keyframes";
import { isTimed } from "./project/ops";
import type { AudioClip, Id, Project, Track, VideoClip } from "./project/types";
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
      if (!isTimed(clip) || clip.disabled || clip.muted || clip.freeze) continue;
      if (!hasAudio(clip.assetId)) continue;
      out.push({ clip, track });
    }
  }
  return out;
}

/** Click guard: every clip edge ramps over at least this long. */
export const EDGE_RAMP = 0.004;

/** Seconds a clip's sound runs before its start and past its end. */
export interface Overlap {
  pre: number;
  post: number;
}
export const NO_OVERLAP: Overlap = { pre: 0, post: 0 };

/**
 * Sound under video transitions: the two clips' own sound overlaps across
 * the cut by half the transition each way, as far as both sources have
 * handles, and crossfades at constant power (Premiere's default audio
 * transition). A hard cut under a dissolve popped. Clips with retimed
 * sound (speed, curves, reverse) or a freeze keep the hard cut;
 * ponytail: extend the retimer's window to cover them too.
 */
export function soundOverlaps(p: Project): Map<Id, Overlap> {
  const out = new Map<Id, Overlap>();
  const plain = (c: VideoClip) => c.speed === 1 && !c.speedCurve && !c.reverse && !c.freeze;
  for (const t of p.tracks) {
    const clips = [...t.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < clips.length; i++) {
      const a = clips[i], b = clips[i + 1];
      if (a.type !== "video" || b.type !== "video" || !a.transitionOut || a.start + a.duration !== b.start || !plain(a) || !plain(b)) continue;
      const src = p.assets.find((x) => x.id === a.assetId)?.duration ?? 0;
      const tail = src > 0 ? src - (a.in + framesToSeconds(a.duration, p.fps)) : 0;
      const h = Math.min(framesToSeconds(a.transitionOut.duration, p.fps) / 2, tail, b.in);
      if (h < 0.001) continue;
      out.set(a.id, { pre: out.get(a.id)?.pre ?? 0, post: h });
      out.set(b.id, { pre: h, post: out.get(b.id)?.post ?? 0 });
    }
  }
  return out;
}

/**
 * Gain of a clip at timeline second `t` (absolute). Fades are linear in
 * amplitude, as CapCut's are; keyframed volume interpolates by its curve.
 * A side that overlaps its neighbor (soundOverlaps) crossfades instead of
 * fading: sin over the whole overlap, so the two sides' powers sum to one.
 */
export function clipGainAt(c: VideoClip | AudioClip, track: Track, fps: Project["fps"], t: number, o: Overlap = NO_OVERLAP): number {
  const start = framesToSeconds(c.start, fps);
  const end = framesToSeconds(c.start + c.duration, fps);
  if (t < start - o.pre || t >= end + o.post) return 0;
  const rel = t - start;
  const r = Math.min(Math.max(Math.floor(rel * (fps.num / fps.den) + 1e-6), 0), c.duration - 1);
  let g = paramAt(c, "volume", r) * track.volume;
  if (o.pre > 0) {
    if (t < start + o.pre) g *= Math.sin((Math.PI / 2) * ((t - start + o.pre) / (2 * o.pre)));
  } else {
    const fadeIn = Math.max(framesToSeconds(c.fadeIn, fps), EDGE_RAMP);
    if (rel < fadeIn) g *= rel / fadeIn;
  }
  if (o.post > 0) {
    if (t > end - o.post) g *= Math.sin((Math.PI / 2) * ((end + o.post - t) / (2 * o.post)));
  } else {
    const fadeOut = Math.max(framesToSeconds(c.fadeOut, fps), EDGE_RAMP);
    if (end - t < fadeOut) g *= (end - t) / fadeOut;
  }
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
  o: Overlap = NO_OVERLAP,
): Float32Array {
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(from + i / rate, to - 1e-6);
    out[i] = clipGainAt(c, track, fps, t, o);
  }
  return out;
}

/** Linear gain to decibels for meters and the inspector. */
export const toDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const fromDb = (db: number) => 10 ** (db / 20);
