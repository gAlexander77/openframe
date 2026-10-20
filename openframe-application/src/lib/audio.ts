// Audio math that preview and export share: which clips sound, and each
// clip's gain over time (volume x track volume x fades x keyframes). Pure,
// so the envelope that Web Audio plays is the one the tests check.

import { paramAt } from "./keyframes";
import { findCompound, isTimed } from "./project/ops";
import { fxTail } from "./soundFx";
import type { AudioClip, Clip, CompoundClip, Id, Keyframe, Project, Sound, Track, VideoClip } from "./project/types";
import { framesToSeconds, type Rational } from "./time";

/** A clip that makes sound, in the frames of the timeline being mixed. */
export interface SoundingClip {
  /** Inside a compound clip, moved to the outer timeline through it: its
   * start and length may then be fractional frames, and a sped-up compound
   * clip speeds it up too (ADR-037). */
  clip: VideoClip | AudioClip;
  track: Track;
  /** Under a transition, how far its sound runs past its edges
   * (soundOverlaps), in seconds of the timeline being mixed. */
  overlap?: Overlap;
  /** Compound clips it plays through, innermost first, in the same frames:
   * their volume, fades and tracks scale it, and it is silent outside them. */
  via?: { clip: CompoundClip; track: Track }[];
}

/** Compound clips nest at most this deep (plan.ts has the same bound). */
const MAX_DEPTH = 16;

/** Clips that produce sound: audio clips, and video clips whose own sound is
 * not muted or extracted, on unmuted tracks; while any track of a timeline
 * is soloed, on its soloed tracks only. Through compound clips, the clips
 * of their nested timelines, by the same rules. */
export function soundingClips(p: Project, hasAudio: (assetId: string) => boolean): SoundingClip[] {
  return collect(p, p.tracks, hasAudio, 0);
}

function collect(p: Project, tracks: Track[], hasAudio: (assetId: string) => boolean, depth: number): SoundingClip[] {
  const out: SoundingClip[] = [];
  const solo = tracks.some((t) => t.solo);
  const overlaps = soundOverlaps({ ...p, tracks });
  for (const track of tracks) {
    if (track.muted || (solo && !track.solo)) continue;
    for (const clip of track.clips) {
      if (!isTimed(clip) || clip.disabled || clip.muted || clip.freeze) continue;
      if (clip.type === "compound") {
        const k = findCompound(p, clip.compoundId);
        if (!k || depth >= MAX_DEPTH) continue;
        for (const s of collect(p, k.tracks, hasAudio, depth + 1)) {
          const moved = throughCompound(s.clip, clip, p.fps);
          out.push({
            clip: moved,
            track: s.track,
            ...(s.overlap ? { overlap: { ...s.overlap, pre: s.overlap.pre / clip.speed, post: s.overlap.post / clip.speed, ...(s.overlap.fall ? { fall: s.overlap.fall / clip.speed } : {}) } } : {}),
            via: [...(s.via ?? []).map((v) => ({ ...v, clip: throughCompound(v.clip, clip, p.fps) })), { clip, track }],
          });
        }
        continue;
      }
      if (!hasAudio(clip.assetId)) continue;
      const o = overlaps.get(clip.id);
      out.push({ clip, track, ...(o ? { overlap: o } : {}) });
    }
  }
  return out;
}

/**
 * A clip of a nested timeline in the outer timeline's frames, through the
 * compound clip `k` that plays it at constant speed s: inner frame u shows
 * at outer frame k.start + (u - k.in in frames) / s. Lengths, fades,
 * keyframes and speed-curve points scale by 1/s, the rate by s, so the
 * clip reads the same source at the same moments the picture shows it.
 * ponytail: through a sped-up compound clip, its pitch follows the
 * compound clip's Change pitch, not its own.
 */
export function throughCompound<T extends Clip & { speed: number }>(c: T, k: CompoundClip, fps: Rational): T {
  const s = k.speed;
  const inFrames = (k.in * fps.num) / fps.den;
  const moved = { ...c, start: k.start + (c.start - inFrames) / s } as T;
  if (s === 1) return moved;
  const scaleKeys = (keys: Record<string, Keyframe[]>) =>
    Object.fromEntries(Object.entries(keys).map(([path, list]) => [path, list.map((x) => ({ ...x, f: x.f / s }))]));
  const out = moved as T & Partial<Sound> & { speedCurve?: VideoClip["speedCurve"]; changePitch?: boolean };
  out.duration = c.duration / s;
  out.speed = c.speed * s;
  if (out.fadeIn !== undefined) out.fadeIn /= s;
  if (out.fadeOut !== undefined) out.fadeOut /= s;
  if (c.keyframes) out.keyframes = scaleKeys(c.keyframes);
  if (out.speedCurve) out.speedCurve = { ...out.speedCurve, points: out.speedCurve.points.map((x) => ({ f: x.f / s, speed: x.speed * s })) };
  if (k.changePitch) out.changePitch = true;
  else delete out.changePitch;
  return out;
}

/** The equalizer's bands (CapCut's and Premiere's simple EQ): a low and a
 * high shelf with a broad presence bell between, as Web Audio biquads, the
 * same in preview and export. */
export const EQ_BANDS = [
  { key: "low", label: "Low", type: "lowshelf", frequency: 120 },
  { key: "mid", label: "Mid", type: "peaking", frequency: 1000, q: 0.8 },
  { key: "high", label: "High", type: "highshelf", frequency: 8000 },
] as const;

/** Click guard: every clip edge ramps over at least this long. */
export const EDGE_RAMP = 0.004;

/** Seconds a clip's sound runs before its start and past its end. */
export interface Overlap {
  pre: number;
  post: number;
  /** An audio crossfade, which ends at the cut instead of centering on
   * it: the outgoing clip falls over its last `fall` seconds, and the
   * incoming one (`rise`) rises over the `pre` seconds before its start. */
  fall?: number;
  rise?: boolean;
}
export const NO_OVERLAP: Overlap = { pre: 0, post: 0 };

/**
 * Sound under video transitions: the two clips' own sound overlaps across
 * the cut by half the transition each way, as far as both sources have
 * handles, and crossfades at constant power (Premiere's default audio
 * transition). A hard cut under a dissolve popped. Clips with retimed
 * sound (speed, curves, reverse) or a freeze keep the hard cut;
 * ponytail: extend the retimer's window to cover them too. So do compound
 * clips (their sound is many clips, cut where the compound clip is).
 */
export function soundOverlaps(p: Project): Map<Id, Overlap> {
  const out = new Map<Id, Overlap>();
  const plain = (c: VideoClip | AudioClip) => c.speed === 1 && !c.speedCurve && !c.reverse && !c.freeze && !c.tapeStop;
  for (const t of p.tracks) {
    const clips = [...t.clips].sort((a, b) => a.start - b.start);
    for (let i = 0; i + 1 < clips.length; i++) {
      const a = clips[i], b = clips[i + 1];
      if (a.type === "audio" && b.type === "audio" && a.crossfade) {
        const x = audioCrossfade(a, b, p.fps);
        if (x > 0) {
          out.set(a.id, { ...(out.get(a.id) ?? NO_OVERLAP), fall: x });
          out.set(b.id, { pre: x, post: out.get(b.id)?.post ?? 0, rise: true });
        }
        continue;
      }
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
 * The seconds an audio clip's crossfade into the next one plays: its own
 * `crossfade`, no longer than the next clip's file holds before its
 * in-point (its sound rises over the seconds before its start) nor than
 * half of either clip; 0 when they do not meet at a cut, when one is
 * retimed (ponytail: the retimer's window would need to start early too),
 * or when the next clip goes on in the same file where this one stops (a
 * split, not a splice).
 */
export function audioCrossfade(a: AudioClip, b: AudioClip, fps: Rational): number {
  if (!a.crossfade || a.start + a.duration !== b.start) return 0;
  const plain = (c: AudioClip) => c.speed === 1 && !c.speedCurve && !c.reverse && !c.freeze && !c.tapeStop;
  if (!plain(a) || !plain(b)) return 0;
  if (a.assetId === b.assetId && Math.abs(a.in + framesToSeconds(a.duration, fps) - b.in) < 1e-3) return 0;
  const x = Math.min(a.crossfade, b.in, framesToSeconds(a.duration, fps) / 2, framesToSeconds(b.duration, fps) / 2);
  return x >= 0.001 ? x : 0;
}

/** What clipGainAt reads: a clip's sound settings and where it is. */
type Gained = Sound & { start: number; duration: number; keyframes?: Clip["keyframes"] };

/**
 * Gain of a clip at timeline second `t` (absolute). Fades are linear in
 * amplitude, as CapCut's are; keyframed volume interpolates by its curve.
 * A side that overlaps its neighbor (soundOverlaps) crossfades instead of
 * fading: sin over the whole overlap, so the two sides' powers sum to one;
 * an audio crossfade (`fall`, `rise`) does so over the seconds before the
 * cut, its own fades giving way to it.
 */
export function clipGainAt(c: Gained, track: Track, fps: Project["fps"], t: number, o: Overlap = NO_OVERLAP): number {
  const start = framesToSeconds(c.start, fps);
  const end = framesToSeconds(c.start + c.duration, fps);
  if (t < start - o.pre || t >= end + o.post) return 0;
  const rel = t - start;
  const r = Math.min(Math.max(Math.floor(rel * (fps.num / fps.den) + 1e-6), 0), c.duration - 1);
  let g = paramAt(c as Clip, "volume", r) * track.volume;
  if (o.pre > 0 && o.rise) {
    // An audio crossfade: risen by the cut, the clip plays on as it is.
    if (t < start) g *= Math.sin((Math.PI / 2) * ((t - start + o.pre) / o.pre));
  } else if (o.pre > 0) {
    if (t < start + o.pre) g *= Math.sin((Math.PI / 2) * ((t - start + o.pre) / (2 * o.pre)));
  } else {
    const fadeIn = Math.max(framesToSeconds(c.fadeIn, fps), EDGE_RAMP);
    if (rel < fadeIn) g *= rel / fadeIn;
  }
  if (o.fall) {
    // Falling as the next clip rises, their powers summing to one.
    if (t > end - o.fall) g *= Math.sin((Math.PI / 2) * ((end - t) / o.fall));
  } else if (o.post > 0) {
    if (t > end - o.post) g *= Math.sin((Math.PI / 2) * ((end + o.post - t) / (2 * o.post)));
  } else {
    const fadeOut = Math.max(framesToSeconds(c.fadeOut, fps), EDGE_RAMP);
    if (end - t < fadeOut) g *= (end - t) / fadeOut;
  }
  return Math.max(0, g);
}

/** A sounding clip's gain at timeline second `t`: its own, times every
 * compound clip's it plays through (or only the first `through` of them,
 * innermost first: the rest are applied by a bus, soundBuses). */
export function soundGainAt(s: SoundingClip, fps: Rational, t: number, through = Infinity): number {
  let g = clipGainAt(s.clip, s.track, fps, t, s.overlap);
  for (const v of (s.via ?? []).slice(0, through)) g *= clipGainAt(v.clip, v.track, fps, t);
  return g;
}

/** A compound clip's sound is mixed as a bus when it has an EQ or a
 * compressor: those act on its clips' sound together (ADR-100). */
export const isBus = (k: CompoundClip) => !!k.compressor || EQ_BANDS.some((b) => !!k.eq?.[b.key]);

/** One bus a sounding clip's sound passes through. */
export interface BusHop {
  /** The compound clip's path from the outer timeline, outermost last:
   * the same compound played twice is two buses. */
  key: string;
  /** The compound clip, in the outer timeline's frames, and its track. */
  clip: CompoundClip;
  /** The compound clips whose volume and fades the bus applies after its
   * EQ and compressor: itself and those out to the next bus. */
  gains: { clip: CompoundClip; track: Track }[];
}

/**
 * The buses a sounding clip's sound passes through, innermost first, and
 * how many of the compound clips it plays through (innermost first) its
 * own envelope still carries: those under the first bus. A compound clip's
 * volume and fades come after its compressor, as a clip's do after its
 * own, so its fade-out is not undone by the compressor.
 */
export function soundBuses(s: SoundingClip): { through: number; buses: BusHop[] } {
  const via = s.via ?? [];
  const at = via.flatMap((v, i) => (isBus(v.clip) ? [i] : []));
  return {
    through: at.length ? at[0] : via.length,
    buses: at.map((i, n) => ({
      key: via.slice(i).map((v) => v.clip.id).join("/"),
      clip: via[i].clip,
      gains: via.slice(i, at[n + 1] ?? via.length),
    })),
  };
}

/** Seconds a compressor runs before what it is heard on: its 6 ms
 * lookahead filled and its gain settled (a release is at most 1 s). */
export const COMPRESSOR_SETTLE = 1;

/** Seconds an offline render of a stretch starts early for this clip:
 * its echo and reverb tails, and for a compressor of its own or of a
 * compound clip it plays through, the compressor's settling. Started cold
 * at each 10 s export window, a compressor's empty lookahead cut 6 ms of
 * silence into the sound and its gain stepped. */
export function soundPreroll(s: SoundingClip): number {
  const compressed = [s.clip, ...(s.via ?? []).map((v) => v.clip)].some((c) => !!c.compressor);
  return Math.max(fxTail(s.clip), compressed ? COMPRESSOR_SETTLE : 0);
}

/** A bus's gain (its compound clips' volume and fades) over [from, to),
 * sampled as soundEnvelope samples a clip's. */
export function busEnvelope(hop: BusHop, fps: Rational, from: number, to: number, rate = 200): Float32Array {
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(from + i / rate, to - 1e-6);
    out[i] = hop.gains.reduce((g, v) => g * clipGainAt(v.clip, v.track, fps, t), 1);
  }
  return out;
}

/** Pan at timeline second t: the clip's own (keyframed) pan plus its
 * track's, and those of the compound clips it plays through and their
 * tracks, as panners in a row; within -1..1. */
export function soundPanAt(s: SoundingClip, fps: Rational, t: number): number {
  const at = (c: Gained, track: Track) => {
    const r = Math.min(Math.max(Math.floor((t - framesToSeconds(c.start, fps)) * (fps.num / fps.den) + 1e-6), 0), c.duration - 1);
    return paramAt(c as Clip, "pan", r) + (track.pan ?? 0);
  };
  let pan = at(s.clip, s.track);
  for (const v of s.via ?? []) pan += at(v.clip, v.track);
  return Math.max(-1, Math.min(1, pan));
}

/** Pan sampled over [from, to) for setValueCurveAtTime, or null when no
 * clip in the chain animates its pan (one value then holds). */
export function panEnvelope(s: SoundingClip, fps: Rational, from: number, to: number, rate = 50): Float32Array | null {
  if (![s.clip, ...(s.via ?? []).map((v) => v.clip)].some((c) => (c as Clip).keyframes?.pan?.length)) return null;
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = soundPanAt(s, fps, Math.min(from + i / rate, to - 1e-6));
  return out;
}

/** Timeline seconds a sounding clip can be heard in: its own span with its
 * overlaps, cut to the compound clips it plays through. Empty when lo >= hi. */
export function soundSpan(s: SoundingClip, fps: Rational): [number, number] {
  const o = s.overlap ?? NO_OVERLAP;
  let lo = framesToSeconds(s.clip.start, fps) - o.pre;
  let hi = framesToSeconds(s.clip.start + s.clip.duration, fps) + o.post;
  for (const v of s.via ?? []) {
    lo = Math.max(lo, framesToSeconds(v.clip.start, fps));
    hi = Math.min(hi, framesToSeconds(v.clip.start + v.clip.duration, fps));
  }
  return [lo, hi];
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
  return soundEnvelope({ clip: c, track, overlap: o }, fps, from, to, rate);
}

/** gainEnvelope for a sounding clip, through its compound clips too (the
 * first `through` of them; soundBuses). */
export function soundEnvelope(s: SoundingClip, fps: Project["fps"], from: number, to: number, rate = 200, through = Infinity): Float32Array {
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(from + i / rate, to - 1e-6);
    out[i] = soundGainAt(s, fps, t, through);
  }
  return out;
}

/** Linear gain to decibels for meters and the inspector. */
export const toDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
export const fromDb = (db: number) => 10 ** (db / 20);
