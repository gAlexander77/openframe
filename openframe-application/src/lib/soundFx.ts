// Sound design on a clip (ADR-060): a sweepable low-pass and high-pass
// filter, a reverb, an echo and a tape stop, the trailer moves (the
// "muffled build that opens on the drop", a voice in a hall, a slap of
// echo on a hit, the track dying at the end). The pure parts live here:
// ranges and presets, the reverb's impulse response, the tape stop's time
// warp, keyframe curves. src/engine/soundFx.ts builds the nodes, once, for
// playback, export and loudness measurement alike.
//
// Its own module with no imports but types and pure helpers, so the
// project loader can use it without a cycle through ops.

import { getPath, interpolate } from "./keyframes";
import type { AudioFilter, Clip, Echo, Reverb, Sound, TapeStop } from "./project/types";
import type { Retimer } from "./stretch";

export type FilterKind = "lowpass" | "highpass";
export type ReverbPreset = "room" | "hall" | "cathedral";

/** A new filter: a low-pass at 500 Hz sounds as if through a wall, a
 * high-pass at 300 Hz as if on a phone. Resonance 0 is a smooth slope. */
export const FILTER_DEFAULTS: Record<FilterKind, AudioFilter> = {
  lowpass: { cutoff: 500, resonance: 0 },
  highpass: { cutoff: 300, resonance: 0 },
};

export const REVERB_PRESETS: Record<ReverbPreset, Reverb> = {
  room: { size: 0.3, decay: 0.8, mix: 0.2 },
  hall: { size: 0.6, decay: 2.5, mix: 0.3 },
  cathedral: { size: 0.9, decay: 6, mix: 0.4 },
};

export const ECHO_DEFAULT: Echo = { time: 0.35, feedback: 0.4, mix: 0.3 };
export const TAPE_STOP_DEFAULT: TapeStop = { duration: 1 };

interface Fx {
  lowpass: AudioFilter;
  highpass: AudioFilter;
  reverb: Reverb;
  echo: Echo;
  tapeStop: TapeStop;
}
export type FxKey = keyof Fx;

/** Every number's range, as the commands, the loader and the inspector
 * accept it. */
export const FX_RANGES: { [K in FxKey]: Record<keyof Fx[K], [number, number]> } = {
  lowpass: { cutoff: [20, 20000], resonance: [0, 24], makeup: [-24, 24] },
  highpass: { cutoff: [20, 20000], resonance: [0, 24], makeup: [-24, 24] },
  reverb: { size: [0, 1], decay: [0.1, 10], mix: [0, 1] },
  echo: { time: [0.01, 2], feedback: [0, 0.9], mix: [0, 1] },
  tapeStop: { duration: [0.05, 10] },
};
export const FX_KEYS = Object.keys(FX_RANGES) as FxKey[];

const FX_DEFAULTS: Fx = { ...FILTER_DEFAULTS, reverb: REVERB_PRESETS.hall, echo: ECHO_DEFAULT, tapeStop: TAPE_STOP_DEFAULT };

/** The parameters keyframes can animate (add_keyframe, set_param with at). */
export const FX_KEYED_PATHS = ["lowpass.cutoff", "highpass.cutoff", "reverb.mix", "echo.mix"] as const;

/**
 * One effect from untrusted JSON or a partial edit: every number in range,
 * missing ones from `base` (else the effect's default). Not an object
 * gives none.
 */
export function cleanFx<K extends FxKey>(key: K, raw: unknown, base?: Fx[K]): Fx[K] | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out = { ...(base ?? FX_DEFAULTS[key]) } as Record<string, number>;
  for (const [k, [lo, hi]] of Object.entries(FX_RANGES[key]) as [string, [number, number]][]) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(lo, Math.min(hi, v));
  }
  return out as unknown as Fx[K];
}

/** The loader's pass over a clip with sound: each effect cleaned, or gone. */
export function cleanSoundFx(c: Record<string, unknown>): void {
  for (const k of FX_KEYS) {
    const v = cleanFx(k, c[k]);
    if (v) c[k] = v;
    else delete c[k];
  }
}

/** A clip's sound design for describe_project (snake_case, as its other
 * keys): only what is on. */
export function soundFxSummary(c: Clip): Record<string, object> {
  const s = c as Partial<Sound>;
  return Object.fromEntries(FX_KEYS.filter((k) => s[k]).map((k) => [k === "tapeStop" ? "tape_stop" : k, s[k]!]));
}

// ---- keyframes -------------------------------------------------------------------

/**
 * `path` of `c` sampled `rate` times a second over timeline seconds
 * [from, to), for setValueCurveAtTime; null when it has no keyframes (its
 * static value holds). `start` is the clip's first timeline second and
 * `fpsRate` the timeline's frames per second. A cutoff moves between its
 * keys on a log scale, the same number of octaves each second, as a
 * filter knob turns: in Hz, 300 to 20000 over 5 s passes 2.4 kHz half way,
 * not 10 kHz. `map` turns each value into the parameter's (a mix into a
 * gain).
 */
export function fxCurve(c: Clip, path: string, start: number, fpsRate: number, from: number, to: number, rate = 100, map: (v: number) => number = (v) => v): Float32Array | null {
  const keys = c.keyframes?.[path];
  if (!keys?.length) return null;
  const log = path.endsWith(".cutoff");
  const k = log ? keys.map((x) => ({ ...x, v: Math.log(Math.max(1, x.v)) })) : keys;
  const n = Math.max(2, Math.ceil((to - from) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = Math.min(from + i / rate, to - 1e-6);
    const v = interpolate(k, (t - start) * fpsRate);
    out[i] = map(log ? Math.exp(v) : v);
  }
  return out;
}

/** A parameter's value at clip frame `f`, keyframes first (log for a
 * cutoff, as fxCurve plays it), for the inspector. */
export function fxParamAt(c: Clip, path: string, f: number): number {
  const keys = c.keyframes?.[path];
  if (!keys?.length) return getPath(c, path) ?? 0;
  if (!path.endsWith(".cutoff")) return interpolate(keys, f);
  return Math.exp(interpolate(keys.map((x) => ({ ...x, v: Math.log(Math.max(1, x.v)) })), f));
}

/** Dry and wet gains for a mix of 0..1 at equal power, so a reverb or an
 * echo leaves the clip as loud as it was (the two are uncorrelated). */
export function mixGains(mix: number): [number, number] {
  const m = Math.max(0, Math.min(1, mix));
  return [Math.cos((m * Math.PI) / 2), Math.sin((m * Math.PI) / 2)];
}

// ---- reverb -------------------------------------------------------------------

/** Seconds before the first reflection: 5 ms in a small room, 50 ms in a
 * cathedral. */
export const preDelay = (r: Reverb) => 0.005 + 0.045 * r.size;

/**
 * The reverb's impulse response at `rate`, two decorrelated channels:
 * noise that falls 60 dB over `decay` seconds (RT60) after the pre-delay,
 * building up over a time that grows with `size`, its highs dying faster
 * than its lows as walls and air absorb them. Scaled to unit energy per
 * channel, so the wet sound is as loud as the dry; seeded, so every render
 * (each export window, each measurement) hears the same room.
 */
export function reverbImpulse(rate: number, r: Reverb): Float32Array[] {
  const pre = Math.round(preDelay(r) * rate);
  const len = pre + Math.ceil(r.decay * rate);
  const build = 0.002 + 0.03 * r.size;
  return [0x9e3779b9, 0x85ebca6b].map((seed) => {
    const h = new Float32Array(len);
    // mulberry32: independent streams per seed. (A Lehmer generator seeded
    // with s and 2s gives the same stream doubled: the sides correlated 0.5.)
    let s = seed >>> 0;
    const random = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let z = Math.imul(s ^ (s >>> 15), 1 | s);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    let lp = 0;
    let energy = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const noise = random() * 2 - 1;
      // A one-pole low-pass whose corner falls with time (bright onset,
      // dark tail), its loss made up so the level follows the envelope.
      const a = 0.2 + 0.8 * Math.exp((-3 * t) / r.decay);
      lp += a * (noise - lp);
      const v = lp * Math.sqrt((2 - a) / a) * Math.exp((-6.9078 * t) / r.decay) * (1 - Math.exp(-t / build));
      h[i] = v;
      energy += v * v;
    }
    const k = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = pre; i < len; i++) h[i] *= k;
    return h;
  });
}

/** Seconds the reverb keeps sounding after its input stops. */
export const reverbTail = (r: Reverb) => preDelay(r) + r.decay;

/** Seconds until the echo's repeats fall 60 dB under the first. */
export const echoTail = (e: Echo) => e.time * (e.feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(e.feedback)) : 1);

/** Seconds a clip's sound design rings past what feeds it: echo and reverb
 * tails (in series, they add), a few ms of filter state. A mixdown window
 * starts this early to carry them across its edge. */
export function fxTail(c: Partial<Sound>): number {
  return (c.echo ? echoTail(c.echo) : 0) + (c.reverb ? reverbTail(c.reverb) : 0) + (c.lowpass || c.highpass ? 0.05 : 0);
}

// ---- tape stop -------------------------------------------------------------------

export interface TapeStopMap {
  /** Clip-relative seconds the stop begins and how long it takes. */
  start: number;
  length: number;
  /** Clip-relative seconds the clip's own time map is read at, for clip
   * time `u`: as is before the stop, slowing to a standstill after. */
  warp(u: number): number;
  /** Playback rate at `u`, 1 down to 0. */
  rate(u: number): number;
  /** Level at `u`: full until half speed, then down with the speed to
   * silence (a record's output falls with its speed, and no click is
   * left at the end). */
  gain(u: number): number;
}

/**
 * The tape stop of a clip `seconds` long: over its last `t.duration`
 * seconds (all of it, if shorter) the speed falls linearly from 1 to 0, as
 * a turntable coasts to a stop, so the pitch falls with it; the source
 * read advances half the stop's length in that time.
 */
export function tapeStopMap(seconds: number, t: TapeStop): TapeStopMap {
  const n = Math.max(1e-3, Math.min(t.duration, seconds));
  const s = seconds - n;
  const rate = (u: number) => (u <= s ? 1 : Math.max(0, 1 - (u - s) / n));
  return {
    start: s,
    length: n,
    warp: (u) => (u <= s ? u : u >= s + n ? s + n / 2 : u - (u - s) ** 2 / (2 * n)),
    rate,
    gain: (u) => Math.min(1, 2 * rate(u)),
  };
}

/** Retimer `a` for output samples before `at`, `b` from it on: a clip
 * whose speed keeps its pitch (WSOLA) with a tape stop, which must not. */
export function switchAt(a: Retimer, b: Retimer, at: number): Retimer {
  return {
    inputSpan(n0, n1) {
      if (n1 <= at) return a.inputSpan(n0, n1);
      if (n0 >= at) return b.inputSpan(n0, n1);
      const [a0, a1] = a.inputSpan(n0, at);
      const [b0, b1] = b.inputSpan(at, n1);
      return [Math.min(a0, b0), Math.max(a1, b1)];
    },
    render(input, inStart, n0, out) {
      const len = out[0].length;
      const k = Math.max(0, Math.min(len, at - n0));
      if (k > 0) a.render(input, inStart, n0, out.map((o) => o.subarray(0, k)));
      if (k < len) b.render(input, inStart, n0 + k, out.map((o) => o.subarray(k)));
    },
  };
}
