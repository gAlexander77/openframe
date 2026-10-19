// The score generator's instruments, synthesized from oscillators, noise
// and filters (no samples, so every note is original and free of anyone's
// license). Each renders one event into a stem: the drums as the 808 and
// trailer libraries build them (pitched sines, band-passed noise, metal
// partials), the synths as a subtractive synth does (PolyBLEP saws through
// a moving filter), the keys by FM (a Rhodes), the piano and bells by
// additive partials, the plucked guitar by Karplus-Strong. Every voice
// starts and ends on a ramp, so no note clicks.

import { midiToHz } from "./theory";
import { biquad, blep, filter, Svf } from "./dsp";
import { Rng, hashSeed, type NoteEvent } from "./arrange";
import type { Part, StyleId } from "./styles";

/** Where a voice writes: a stem's two sides and its reverb send. */
export interface Out {
  L: Float32Array;
  R: Float32Array;
  send: Float32Array;
}

export interface VoiceCtx {
  rate: number;
  style: StyleId;
  beat: number;
  out: Out;
  /** The part's level, reverb send and pan (-1..1). */
  gain: number;
  send: number;
  pan: number;
  /** The pad's low-pass at a time (seconds), from the plan's automation. */
  cutoffAt: (t: number) => number;
  /** The song's seed, for each event's own noise. */
  seed: number;
}

const TAU = 2 * Math.PI;

/** Add `l` (and `r`, else `l` again) at sample `at` with the part's gain,
 * an equal-power pan and its send. */
function put(ctx: VoiceCtx, at: number, l: Float32Array, r: Float32Array = l, gain = 1) {
  const { L, R, send } = ctx.out;
  const th = ((ctx.pan + 1) * Math.PI) / 4;
  const gl = ctx.gain * gain * Math.SQRT2 * Math.cos(th);
  const gr = ctx.gain * gain * Math.SQRT2 * Math.sin(th);
  const gs = ctx.gain * gain * ctx.send * 0.5;
  const n = Math.min(l.length, L.length - at);
  for (let i = Math.max(0, -at); i < n; i++) {
    const a = l[i], b = r[i];
    L[at + i] += a * gl;
    R[at + i] += b * gr;
    send[at + i] += (a + b) * gs;
  }
}

/** Seeded white noise, -1..1. */
function noise(n: number, seed: number): Float32Array {
  const r = new Rng(seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.next() * 2 - 1;
  return out;
}

/** A short fade at the end so a cut note never clicks. */
function tail(x: Float32Array, ms: number, rate: number) {
  const f = Math.min(x.length, Math.round((ms / 1000) * rate));
  for (let i = 0; i < f; i++) x[x.length - 1 - i] *= i / f;
}

const len = (s: number, rate: number) => Math.max(8, Math.round(s * rate));
const env = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));

// ---- drums ------------------------------------------------------------------------------

/** One-shot sounds by key, made once a render (velocity scales them). */
type Cache = Map<string, [Float32Array, Float32Array]>;

interface Kick {
  hi: number;
  lo: number;
  sweep: number;
  hold: number;
  decay: number;
  click: number;
  drive: number;
  seconds: number;
}

const KICKS: Partial<Record<StyleId, Kick>> = {
  launch: { hi: 170, lo: 48, sweep: 0.03, hold: 0.03, decay: 0.16, click: 0.3, drive: 1.8, seconds: 0.5 },
  corporate: { hi: 160, lo: 55, sweep: 0.025, hold: 0.02, decay: 0.12, click: 0.35, drive: 1.5, seconds: 0.4 },
  lofi: { hi: 120, lo: 50, sweep: 0.035, hold: 0.02, decay: 0.2, click: 0.12, drive: 1.3, seconds: 0.5 },
  ambient: { hi: 90, lo: 44, sweep: 0.05, hold: 0.02, decay: 0.28, click: 0, drive: 1.1, seconds: 0.7 },
};

function makeKick(k: Kick, rate: number, thin: boolean, seed: number): Float32Array {
  const n = len(k.seconds, rate);
  const x = new Float32Array(n);
  let ph = 0;
  const norm = Math.tanh(k.drive);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = k.lo + (k.hi - k.lo) * Math.exp(-t / k.sweep) + 300 * Math.exp(-t / 0.002);
    ph += (TAU * f) / rate;
    const e = (t < k.hold ? 1 : Math.exp(-(t - k.hold) / k.decay)) * (1 - Math.exp(-t / 0.0006));
    x[i] = Math.tanh(k.drive * Math.sin(ph) * e) / norm;
  }
  if (k.click > 0) {
    const c = noise(Math.round(0.008 * rate), seed);
    filter(c, biquad("bandpass", 3500, rate, 0.8));
    for (let i = 0; i < c.length; i++) x[i] += k.click * c[i] * Math.exp(-i / rate / 0.0015) * 3;
  }
  // A build's kick loses what is under 100 Hz (the drop gets it back).
  filter(x, biquad("highpass", thin ? 110 : 30, rate));
  if (thin) filter(x, biquad("highpass", 110, rate));
  tail(x, 30, rate);
  return x;
}

function makeSnare(rate: number, tone: number, noiseDecay: number, bright: number, seed: number): Float32Array {
  const n = len(0.4, rate);
  const nz = noise(n, seed);
  filter(nz, biquad("highpass", 1200, rate));
  filter(nz, biquad("lowpass", 2500 + 7000 * bright, rate));
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    ph += (TAU * tone * (1 + 0.35 * Math.exp(-t / 0.01))) / rate;
    const a = 1 - Math.exp(-t / 0.0004);
    x[i] = (0.55 * Math.sin(ph) * Math.exp(-t / 0.05) + 0.9 * nz[i] * Math.exp(-t / noiseDecay)) * a;
  }
  filter(x, biquad("highpass", 140, rate));
  tail(x, 40, rate);
  return x;
}

function makeClap(rate: number, seed: number): [Float32Array, Float32Array] {
  const n = len(0.4, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const nz = [noise(n, seed), noise(n, seed + 1)];
  [0, 0.009, 0.0175, 0.027].forEach((o, k) => {
    const s = Math.round(o * rate);
    const dec = k < 3 ? 0.004 : 0.075;
    for (let i = s; i < n; i++) {
      const t = (i - s) / rate;
      const e = (1 - Math.exp(-t / 0.0003)) * Math.exp(-t / dec) * (k < 3 ? 0.8 : 1);
      out[0][i] += (0.7 * nz[0][i] + 0.3 * nz[1][i]) * e;
      out[1][i] += (0.3 * nz[0][i] + 0.7 * nz[1][i]) * e;
    }
  });
  for (const x of out) {
    filter(x, biquad("bandpass", 1500, rate, 0.7));
    filter(x, biquad("peak", 1200, rate, 1, 3));
    tail(x, 40, rate);
  }
  return out;
}

/** Hats: noise and six square-ish metal partials (the 808's six
 * oscillators), high-passed, with a tight envelope. */
function makeHat(rate: number, open: boolean, dark: boolean, seed: number): Float32Array {
  const n = len(open ? 0.5 : 0.12, rate);
  const nz = noise(n, seed);
  const x = new Float32Array(n);
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => f * 8.1);
  const dec = open ? (dark ? 0.16 : 0.12) : dark ? 0.03 : 0.022;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let m = 0;
    for (const f of freqs) m += Math.sin(TAU * f * t) > 0 ? 1 : -1;
    x[i] = (nz[i] + 0.12 * m) * (1 - Math.exp(-t / 0.0004)) * Math.exp(-t / dec);
  }
  filter(x, biquad("highpass", 6800, rate));
  filter(x, biquad("highpass", 6800, rate));
  filter(x, biquad("lowpass", dark ? 8000 : 14500, rate));
  tail(x, 10, rate);
  return x;
}

function makeShaker(rate: number, seed: number): Float32Array {
  const n = len(0.12, rate);
  const x = noise(n, seed);
  filter(x, biquad("bandpass", 7500, rate, 0.8));
  for (let i = 0; i < n; i++) x[i] *= env(i / rate, 0.005, 0.03);
  tail(x, 10, rate);
  return x;
}

function makeRim(rate: number, seed: number): Float32Array {
  const n = len(0.12, rate);
  const nz = noise(n, seed);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    x[i] = (Math.sin(TAU * 1700 * t) * Math.exp(-t / 0.012) + 0.5 * Math.sin(TAU * 820 * t) * Math.exp(-t / 0.02) + 0.4 * nz[i] * Math.exp(-t / 0.003)) * (1 - Math.exp(-t / 0.0003));
  }
  filter(x, biquad("highpass", 300, rate));
  tail(x, 10, rate);
  return x;
}

/** A tom or a taiko: a sine falling to its pitch, a skin's noise, saturated. */
function makeDrum(rate: number, hz: number, decay: number, skin: number, seconds: number, seed: number): Float32Array {
  const n = len(seconds, rate);
  const nz = noise(n, seed);
  filter(nz, biquad("lowpass", 2500, rate));
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    ph += (TAU * hz * (1 + 0.5 * Math.exp(-t / 0.04))) / rate;
    x[i] = Math.tanh(1.4 * (Math.sin(ph) * Math.exp(-t / decay) + skin * nz[i] * Math.exp(-t / 0.03)) * (1 - Math.exp(-t / 0.0006)));
  }
  filter(x, biquad("highpass", 35, rate));
  tail(x, 50, rate);
  return x;
}

/** A crash: bright decorrelated noise with a shimmer of metal partials. */
function makeCrash(rate: number, seconds: number, decay: number, seed: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const r = new Rng(seed);
  const partials = Array.from({ length: 24 }, () => [r.range(3000, 9000), r.range(0.3, 1), r.range(0, TAU)]);
  const shimmer = new Float32Array(n);
  for (const [f, a, p] of partials) {
    const w = (TAU * f) / rate;
    for (let i = 0; i < n; i++) shimmer[i] += a * Math.sin(w * i + p);
  }
  const out: [Float32Array, Float32Array] = [noise(n, seed + 1), noise(n, seed + 2)];
  for (const x of out) {
    filter(x, biquad("highpass", 3600, rate));
    filter(x, biquad("highpass", 3600, rate));
    filter(x, biquad("lowpass", 12500, rate));
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const e = (1 - Math.exp(-t / 0.0015)) * (Math.exp(-t / decay) + 0.6 * Math.exp(-t / 0.025));
      x[i] = x[i] * e + 0.035 * shimmer[i] * Math.exp(-t / (decay * 0.5)) * (1 - Math.exp(-t / 0.002));
    }
    tail(x, 300, rate);
  }
  return out;
}

// ---- risers, hits and textures ----------------------------------------------------------

/** Noise through a band-pass sweeping up, and a rising sine cluster,
 * swelling to its peak at the very end (where the drop or the breath is). */
function riser(rate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const nz = [noise(n, seed), noise(n, seed + 7)];
  const f = [new Svf(rate), new Svf(rate)];
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    if (i % 32 === 0) for (const s of f) s.set(350 * (8500 / 350) ** (x ** 1.3), 2.2);
    const amp = 10 ** ((-36 + 36 * x ** 2.2) / 20);
    const m = (nz[0][i] + nz[1][i]) * 0.5;
    ph += (TAU * midiToHz(52 + 24 * x ** 1.6)) / rate;
    const up = (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.3 * Math.sin(1.5 * ph)) * 0.25;
    for (let c = 0; c < 2; c++) {
      f[c].step(0.6 * m + 0.8 * nz[c][i]);
      out[c][i] = (f[c].band * 1.6 + up) * amp;
    }
  }
  for (const x of out) {
    for (let i = 0; i < Math.min(n, 64); i++) x[i] *= i / 64;
    tail(x, 3, rate);
  }
  return out;
}

/** A hit: a sine dropping from 120 Hz to 36 Hz under a burst of low noise
 * and a short crack. */
function impact(rate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const nz = [noise(n, seed), noise(n, seed + 3)];
  const lo = [new Svf(rate), new Svf(rate)];
  lo.forEach((s) => s.set(900, 0.7));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    ph += (TAU * (36 + 84 * Math.exp(-t / 0.3))) / rate;
    const sub = 0.6 * Math.sin(ph) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.85);
    for (let c = 0; c < 2; c++) {
      const body = lo[c].step(nz[c][i]) * (1 - Math.exp(-t / 0.003)) * Math.exp(-t / 0.3);
      const crack = lo[c].high * (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / 0.04);
      out[c][i] = sub + 0.5 * body + 0.18 * crack;
    }
  }
  for (const x of out) tail(x, 200, rate);
  return out;
}

/** A crash played backwards: it swells and stops dead on the downbeat. */
function reverseCymbal(rate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const [a, b] = makeCrash(rate, seconds + 0.3, 0.9, seed);
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const w = (i / n) ** 2;
    out[0][i] = a[n - 1 - i] * w;
    out[1][i] = b[n - 1 - i] * w;
  }
  for (const x of out) tail(x, 4, rate);
  return out;
}

/** Noise through a band-pass falling from 5 kHz, fading: the air going out. */
function downlifter(rate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [noise(n, seed), noise(n, seed + 5)];
  for (const x of out) {
    const f = new Svf(rate);
    for (let i = 0; i < n; i++) {
      if (i % 32 === 0) f.set(5000 * (250 / 5000) ** (i / n), 1.6);
      f.step(x[i]);
      x[i] = f.band * Math.exp((-i / n) * 3.5) * (1 - Math.exp(-i / rate / 0.01));
    }
    tail(x, 100, rate);
  }
  return out;
}

/** The trailer horn: detuned low saws through a filter that opens with the
 * swell and closes as it fades, saturated. */
function braam(rate: number, hz: number, seconds: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const det = [-0.012, -0.004, 0.004, 0.012];
  const ph = det.map(() => 0);
  const f = [new Svf(rate), new Svf(rate)];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    if (i % 32 === 0) f.forEach((s) => s.set(120 + 1600 * (1 - Math.exp(-t / 0.08)) * Math.exp(-t / 0.7), 1.4));
    let l = 0, r = 0;
    det.forEach((d, k) => {
      const fr = hz * (1 + d) * (k % 2 ? 1 : 0.5);
      const dt = fr / rate;
      ph[k] = (ph[k] + dt) % 1;
      const s = 2 * ph[k] - 1 - blep(ph[k], dt);
      if (k < 2) l += s;
      else r += s;
    });
    const e = (1 - Math.exp(-t / 0.05)) * Math.exp(-t / (seconds * 0.45));
    out[0][i] = Math.tanh(1.8 * f[0].step(l) * e) * 0.7;
    out[1][i] = Math.tanh(1.8 * f[1].step(r) * e) * 0.7;
  }
  for (const x of out) tail(x, 200, rate);
  return out;
}

/** Vinyl: sparse crackles and a faint hiss and rumble, the record's noise. */
function vinyl(rate: number, seconds: number, seed: number): [Float32Array, Float32Array] {
  const n = len(seconds, rate);
  const out: [Float32Array, Float32Array] = [noise(n, seed), noise(n, seed + 1)];
  const r = new Rng(seed + 2);
  for (const x of out) {
    filter(x, biquad("bandpass", 3000, rate, 0.5));
    for (let i = 0; i < n; i++) x[i] *= 0.05;
    // About ten crackles a second, each a decaying click of random size.
    for (let i = 0; i < n; i += Math.round(r.range(0.01, 0.19) * rate)) {
      const a = r.range(0.2, 1) ** 2 * (r.chance(0.5) ? 1 : -1);
      for (let k = 0; k < 48 && i + k < n; k++) x[i + k] += a * Math.exp(-k / 6) * (k % 2 ? -0.6 : 1);
    }
    filter(x, biquad("highpass", 700, rate));
    filter(x, biquad("lowpass", 9000, rate));
    for (let i = 0; i < Math.min(n, 4800); i++) x[i] *= i / 4800;
    tail(x, 100, rate);
  }
  return out;
}

// ---- bass ---------------------------------------------------------------------------------

/** A sine, a touch saturated so small speakers hear its second harmonic. */
function sub(rate: number, hz: number, seconds: number, decay = 0): Float32Array {
  const rel = 0.04;
  const n = len(seconds + rel, rate);
  const x = new Float32Array(n);
  const w = (TAU * hz) / rate;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = Math.min(1, t / 0.005) * (decay ? Math.exp(-t / decay) : 1) * (t > seconds ? Math.max(0, 1 - (t - seconds) / rel) : 1);
    const s = Math.sin(w * i);
    x[i] = (s + 0.12 * s * s - 0.06) * e;
  }
  filter(x, biquad("highpass", 25, rate));
  return x;
}

/** Synth basses: saws and squares through a low-pass with an envelope. */
function synthBass(rate: number, style: StyleId, hz: number, seconds: number, vel: number): Float32Array {
  const rel = style === "lofi" ? 0.06 : 0.025;
  const n = len(seconds + rel, rate);
  const x = new Float32Array(n);
  const f = new Svf(rate);
  let p1 = 0, p2 = 0;
  const dt = hz / rate;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = Math.min(1, t / (style === "lofi" ? 0.008 : 0.003)) * (t > seconds ? Math.max(0, 1 - (t - seconds) / rel) : 1);
    let v: number;
    if (style === "lofi") {
      // Round and warm: a sine with a little third harmonic, like a
      // finger-picked upright through a small amp.
      p1 += dt;
      v = Math.sin(TAU * p1) + 0.18 * Math.sin(3 * TAU * p1) + 0.1 * Math.sin(2 * TAU * p1);
      x[i] = v * e * Math.exp(-t / 1.2) * 0.8;
      continue;
    }
    p1 = (p1 + dt) % 1;
    p2 = (p2 + dt * 1.003) % 1;
    const saw = 2 * p1 - 1 - blep(p1, dt);
    let sq = p2 < 0.5 ? 1 : -1;
    sq += blep(p2, dt * 1.003) - blep((p2 + 0.5) % 1, dt * 1.003);
    if (i % 16 === 0) f.set(style === "launch" ? 240 + 1500 * vel * Math.exp(-t / 0.05) : 500 + 1400 * vel * Math.exp(-t / 0.08), 1.1);
    v = f.step(0.65 * saw + 0.35 * sq);
    // The corporate bass gets a sine under it for weight.
    if (style === "corporate") v += 0.45 * Math.sin(TAU * hz * t);
    x[i] = v * e * (style === "launch" ? Math.exp(-t / 0.18) : Math.exp(-t / 0.5));
  }
  filter(x, biquad("highpass", style === "launch" ? 90 : 30, rate));
  return x;
}

// ---- harmony --------------------------------------------------------------------------------

/**
 * Detuned saws through the pad's moving low-pass, split between the sides:
 * the supersaw (launch), a warm pad (ambient), string sections (strings,
 * ostinato), horns (brass). `attack` and `release` in seconds.
 */
function saws(ctx: VoiceCtx, e: NoteEvent, o: { detune: number[]; attack: number; release: number; q: number; cutoff: (t: number, u: number) => number; vibrato?: number; decay?: number; drive?: number }): [Float32Array, Float32Array] {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const n = len(e.dur + o.release, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const r = new Rng(hashSeed(ctx.seed, e.part, e.pitch ?? 0, Math.round(e.t * 1000)));
  const ph = o.detune.map(() => r.next());
  const f = [new Svf(rate), new Svf(rate)];
  const dts = o.detune.map((c) => (hz * 2 ** (c / 1200)) / rate);
  // Alternate voices lean left and right; the middle one sits in both.
  const sides = dts.map((_, k) => (k === (dts.length - 1) / 2 ? 0.5 : k % 2 ? 0.8 : 0.2));
  const dk = o.decay ? Math.exp(-1 / (o.decay * rate)) : 1;
  let de = 1, vib = 1;
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    if (i % 64 === 0) {
      const c = o.cutoff(e.t + u, u);
      f[0].set(c, o.q);
      f[1].set(c, o.q);
    }
    if (o.vibrato && i % 16 === 0) vib = 1 + o.vibrato * Math.min(1, Math.max(0, (u - 0.25) / 0.4)) * Math.sin(TAU * 5.3 * u);
    let l = 0, rr = 0;
    for (let k = 0; k < dts.length; k++) {
      const dt = dts[k] * vib;
      let p = ph[k] + dt;
      if (p >= 1) p -= 1;
      ph[k] = p;
      const s = 2 * p - 1 - blep(p, dt);
      l += s * (1 - sides[k]);
      rr += s * sides[k];
    }
    let a = u < o.attack ? (1 - Math.cos((Math.PI * u) / o.attack)) / 2 : 1;
    if (o.decay && u > o.attack) {
      a *= de;
      de *= dk;
    }
    if (u > e.dur) a *= Math.max(0, 1 - (u - e.dur) / o.release) ** 2;
    let yl = f[0].step(l) * a, yr = f[1].step(rr) * a;
    if (o.drive) [yl, yr] = [Math.tanh(yl * o.drive) / o.drive, Math.tanh(yr * o.drive) / o.drive];
    out[0][i] = yl;
    out[1][i] = yr;
  }
  const norm = 1 / Math.sqrt(dts.length);
  for (const x of out) for (let i = 0; i < n; i++) x[i] *= norm;
  return out;
}

/** A choir's "ah": a pulse through vowel formants, two voices apart. */
function choir(ctx: VoiceCtx, e: NoteEvent): [Float32Array, Float32Array] {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const rel = 0.8;
  const n = len(e.dur + rel, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const decay = e.tag === "final" ? 2.5 : 0;
  for (let c = 0; c < 2; c++) {
    const f1 = new Svf(rate), f2 = new Svf(rate);
    f1.set(700 * (c ? 1.04 : 0.97), 6);
    f2.set(1150 * (c ? 1.04 : 0.97), 7);
    let ph = c * 0.37;
    const det = c ? 1.004 : 0.996;
    const vr = 4.8 + c * 0.6;
    const o = out[c];
    for (let i = 0; i < n; i++) {
      const u = i / rate;
      const dt = (hz * det * (1 + 0.004 * Math.sin(TAU * vr * u))) / rate;
      ph += dt;
      if (ph >= 1) ph -= 1;
      const src = 2 * ph - 1 - blep(ph, dt);
      f1.step(src);
      f2.step(src);
      let a = u < 0.6 ? (1 - Math.cos((Math.PI * u) / 0.6)) / 2 : 1;
      if (decay) a *= Math.exp(-u / decay);
      if (u > e.dur) a *= Math.max(0, 1 - (u - e.dur) / rel) ** 2;
      o[i] = (f1.band + 0.6 * f2.band) * a;
    }
  }
  return out;
}

/** A Rhodes by FM: a sine modulated by itself at 1:1 (the tone bar) and a
 * fast-fading 14:1 partial (the tine's bell), brighter the harder it is
 * struck; a slow tremolo pans it. */
function rhodes(ctx: VoiceCtx, e: NoteEvent): [Float32Array, Float32Array] {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const rel = 0.18;
  const n = len(e.dur + rel, rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const decay = 2.2 * (261 / hz) ** 0.35;
  const w = (TAU * hz) / rate;
  const idx = 0.8 + 2.2 * e.vel;
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    const mod = Math.sin(w * i) * (idx * Math.exp(-u / 0.35) + 0.35);
    const tine = Math.sin(14 * w * i) * 0.6 * e.vel * Math.exp(-u / 0.03);
    let y = Math.sin(w * i + mod + tine) * Math.min(1, u / 0.002) * Math.exp(-u / decay);
    y += 0.25 * Math.sin(2 * w * i) * Math.exp(-u / (decay * 0.4));
    if (u > e.dur) y *= Math.max(0, 1 - (u - e.dur) / rel);
    const pan = 0.5 + 0.22 * Math.sin(TAU * 4.2 * (e.t + u));
    out[0][i] = y * (1 - pan) * 1.4;
    out[1][i] = y * pan * 1.4;
  }
  return out;
}

/** A piano by additive partials: two slightly detuned strings per note,
 * stretched (inharmonic) overtones that fade faster the higher they are,
 * a felt hammer's thump; `soft` is the felt piano of film scores. */
function piano(ctx: VoiceCtx, e: NoteEvent, soft: boolean): Float32Array {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const rel = 0.12;
  const n = len(e.dur + rel, rate);
  const x = new Float32Array(n);
  const B = 0.0004;
  const tau1 = 3.2 * (261 / hz) ** 0.6;
  const K = Math.max(1, Math.min(soft ? 6 : 10, Math.floor(16000 / hz)));
  for (let k = 1; k <= K; k++) {
    const fk = k * hz * Math.sqrt(1 + B * k * k);
    const ak = (soft ? 1 / k ** 2.2 : 1 / k ** 1.3) * (k === 1 ? 1 : 0.35 + 0.65 * e.vel);
    const tk = tau1 / (1 + 0.6 * (k - 1));
    for (const d of [-0.0008, 0.0008]) {
      // A recursive sine: two multiplies a sample.
      const w = (TAU * fk * (1 + d)) / rate;
      const c2 = 2 * Math.cos(w);
      let y1 = Math.sin(-w), y2 = Math.sin(-2 * w);
      const dk = Math.exp(-1 / (tk * rate));
      let g = ak * 0.5;
      for (let i = 0; i < n; i++) {
        const y0 = c2 * y1 - y2;
        y2 = y1;
        y1 = y0;
        x[i] += y0 * g;
        g *= dk;
      }
    }
  }
  const hammer = noise(len(0.02, rate), hashSeed(ctx.seed, "hammer", e.pitch ?? 0));
  filter(hammer, biquad("lowpass", soft ? 900 : 2500, rate));
  for (let i = 0; i < hammer.length && i < n; i++) x[i] += hammer[i] * 0.3 * e.vel * Math.exp(-i / rate / 0.004);
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    let a = Math.min(1, u / (soft ? 0.006 : 0.002));
    if (u > e.dur) a *= Math.max(0, 1 - (u - e.dur) / rel);
    x[i] *= a;
  }
  if (soft) filter(x, biquad("lowpass", 2400, rate));
  return x;
}

/** A plucked string by Karplus-Strong: a burst of filtered noise in a
 * delay line the length of one period, averaged a little each pass (an
 * all-pass tunes the fraction of a sample the line cannot hold). */
function karplus(ctx: VoiceCtx, e: NoteEvent): Float32Array {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const n = len(Math.min(e.dur, 1.2) + 0.05, rate);
  // The loop delays N samples, half a sample in the averager and `frac`
  // in the all-pass: one period in all.
  const period = rate / hz - 0.5;
  const N = Math.max(2, Math.floor(period));
  const frac = period - N;
  const ap = (1 - frac) / (1 + frac);
  const line = noise(N, hashSeed(ctx.seed, "ks", e.pitch ?? 0, Math.round(e.t * 100)));
  filter(line, biquad("lowpass", 2500 + 4000 * e.vel, rate));
  const x = new Float32Array(n);
  let idx = 0, apx = 0, apy = 0;
  const loss = 0.996;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const avg = loss * 0.5 * (cur + line[(idx + 1) % N]);
    const y = ap * avg + apx - ap * apy;
    apx = avg;
    apy = y;
    line[idx] = y;
    idx = (idx + 1) % N;
    x[i] = cur;
  }
  const u0 = Math.min(e.dur, 1.2);
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    x[i] *= Math.min(1, u / 0.001) * (u > u0 ? Math.max(0, 1 - (u - u0) / 0.05) : 1);
  }
  filter(x, biquad("highpass", 80, rate));
  return x;
}

/** A synth pluck (arps, the launch's soft pluck): saw and square through a
 * low-pass whose envelope falls fast. */
function synthPluck(ctx: VoiceCtx, e: NoteEvent, soft: boolean): [Float32Array, Float32Array] {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const rel = soft ? 0.25 : 0.05;
  const n = len(e.dur + rel + (soft ? 0.3 : 0), rate);
  const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  const [fc0, fc1, ftau, atau] = soft ? [600, 2800, 0.14, 0.45] : [400, 6000, 0.05, 0.16];
  const fk = Math.exp(-16 / (ftau * rate)), ak = Math.exp(-1 / (atau * rate));
  for (let c = 0; c < 2; c++) {
    const f = new Svf(rate);
    const dt = (hz * (c ? 1.004 : 0.996)) / rate;
    let p = c * 0.5, q = c * 0.25, fe = 1, ae = 1;
    const o = out[c];
    for (let i = 0; i < n; i++) {
      const u = i / rate;
      p += dt;
      if (p >= 1) p -= 1;
      q += dt;
      if (q >= 1) q -= 1;
      const saw = 2 * p - 1 - blep(p, dt);
      let sq = q < 0.5 ? 1 : -1;
      sq += blep(q, dt) - blep(q >= 0.5 ? q - 0.5 : q + 0.5, dt);
      if (i % 16 === 0) {
        f.set(fc0 + fc1 * e.vel * fe, 1.3);
        fe *= fk;
      }
      let a = (u < 0.002 ? u / 0.002 : 1) * ae;
      ae *= ak;
      if (u > e.dur) a *= Math.max(0, 1 - (u - e.dur) / rel);
      o[i] = f.step(soft ? 0.4 * saw + 0.6 * sq : 0.65 * saw + 0.35 * sq) * a;
    }
  }
  return out;
}

/** A soft mallet (ambient arps): a triangle-ish tone with a gentle decay. */
function mallet(ctx: VoiceCtx, e: NoteEvent): Float32Array {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 60);
  const n = len(e.dur + 0.6, rate);
  const x = new Float32Array(n);
  const w = (TAU * hz) / rate;
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    x[i] = (Math.sin(w * i) + 0.12 * Math.sin(3 * w * i) + 0.05 * Math.sin(5 * w * i)) * Math.min(1, u / 0.004) * Math.exp(-u / 0.5);
  }
  tail(x, 50, rate);
  return x;
}

/** Bells: the glockenspiel's bar partials (1, 2.76, 5.40, 8.93), or a
 * soft FM bell for ambient glass. */
function bell(ctx: VoiceCtx, e: NoteEvent): Float32Array {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 72);
  const glass = ctx.style === "ambient";
  const n = len(glass ? Math.min(e.dur, 3) + 2 : 1.6, rate);
  const x = new Float32Array(n);
  if (glass) {
    const w = (TAU * hz) / rate;
    for (let i = 0; i < n; i++) {
      const u = i / rate;
      const mod = Math.sin(2 * w * i) * 1.6 * Math.exp(-u / 0.6);
      x[i] = Math.sin(w * i + mod) * Math.min(1, u / 0.003) * Math.exp(-u / 1.6);
    }
  } else {
    for (const [m, a, d] of [[1, 1, 0.9], [2.76, 0.4, 0.4], [5.4, 0.2, 0.2], [8.93, 0.1, 0.12]]) {
      const w = (TAU * hz * m) / rate;
      if (hz * m > rate * 0.45) continue;
      for (let i = 0; i < n; i++) {
        const u = i / rate;
        x[i] += a * Math.sin(w * i) * Math.min(1, u / 0.001) * Math.exp(-u / d);
      }
    }
  }
  tail(x, 80, rate);
  return x;
}

/** The lead: each style's hook voice. */
function lead(ctx: VoiceCtx, e: NoteEvent): [Float32Array, Float32Array] {
  const rate = ctx.rate;
  const hz = midiToHz(e.pitch ?? 72);
  const s = ctx.style;
  if (s === "launch" || s === "corporate") {
    // Bright and detuned: three saw-and-square voices with a filter
    // envelope and a vibrato that comes in on long notes.
    const rel = 0.07;
    const n = len(e.dur + rel, rate);
    const out: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
    const voices = s === "launch" ? [[-9, 0.15], [0, 0.5], [9, 0.85]] : [[-5, 0.3], [5, 0.7]];
    const norm = 1 / Math.sqrt(voices.length);
    const track = (hz / 600) ** 0.3;
    const [fc0, fc1, ftau] = s === "launch" ? [3000, 5000, 0.12] : [2200, 4500, 0.08];
    const [a0, a1, atau] = s === "corporate" ? [0.55, 0.45, 0.25] : [0.75, 0.25, 0.16];
    const fk = Math.exp(-16 / (ftau * rate)), ak = Math.exp(-1 / (atau * rate));
    for (const [cents, pan] of voices) {
      const f = new Svf(rate);
      const base = (hz * 2 ** (cents / 1200)) / rate;
      let p = (cents + 10) / 37, q = 0, fe = 1, ae = 1, vib = 1;
      for (let i = 0; i < n; i++) {
        const u = i / rate;
        if (i % 16 === 0) {
          // Vibrato and the filter move slowly: set every 16 samples.
          vib = e.dur > 0.3 ? 1 + 0.006 * Math.min(1, Math.max(0, (u - 0.2) / 0.2)) * Math.sin(TAU * 5.3 * u) : 1;
          f.set((fc0 + fc1 * fe) * track, 1);
          fe *= fk;
        }
        const dt = base * vib;
        p += dt;
        if (p >= 1) p -= 1;
        q += dt;
        if (q >= 1) q -= 1;
        const saw = 2 * p - 1 - blep(p, dt);
        let sq = q < 0.5 ? 1 : -1;
        sq += blep(q, dt) - blep(q >= 0.5 ? q - 0.5 : q + 0.5, dt);
        let a = (a0 + a1 * ae) * (u < 0.004 ? u / 0.004 : 1);
        ae *= ak;
        if (u > e.dur) a *= Math.max(0, 1 - (u - e.dur) / rel) ** 2;
        const y = f.step(0.75 * saw + 0.25 * sq) * a * norm;
        out[0][i] += y * (1 - pan);
        out[1][i] += y * pan;
      }
    }
    return out;
  }
  if (s === "cinematic") {
    // A horn and strings line: detuned saws, a slow swell, vibrato, an
    // octave below for weight.
    return saws(ctx, e, { detune: [-7, 0, 7], attack: 0.12, release: 0.5, q: 0.8, vibrato: 0.006, cutoff: (_t, u) => 1500 + 1200 * Math.min(1, u / 0.4) });
  }
  // Lo-fi and ambient: a soft, breathy tone (a flute through tape).
  const rel = s === "ambient" ? 0.8 : 0.15;
  const n = len(e.dur + rel, rate);
  const x = new Float32Array(n);
  const nz = noise(n, hashSeed(ctx.seed, "breath", e.pitch ?? 0, Math.round(e.t * 100)));
  const f = new Svf(rate);
  f.set(hz * 2, 2);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const u = i / rate;
    const vib = 1 + 0.005 * Math.min(1, Math.max(0, (u - 0.15) / 0.3)) * Math.sin(TAU * 5 * u);
    p += (hz * vib) / rate;
    const tone = Math.sin(TAU * p) + 0.2 * Math.sin(2 * TAU * p) + 0.06 * Math.sin(3 * TAU * p);
    const breath = f.step(nz[i]) * 0.25;
    const att = s === "ambient" ? 0.12 : 0.03;
    x[i] = (tone + breath) * (u < att ? (1 - Math.cos((Math.PI * u) / att)) / 2 : 1) * (u > e.dur ? Math.max(0, 1 - (u - e.dur) / rel) ** 2 : 1);
  }
  return [x, x];
}

// ---- dispatch ---------------------------------------------------------------------------------

/**
 * Render `e` into ctx.out. Drums come from `cache` (made once per variant
 * and scaled by velocity); one-shots are cut short with a fade where the
 * plan shortened them (a breath, the end).
 */
export function renderEvent(e: NoteEvent, ctx: VoiceCtx, cache: Cache): void {
  const rate = ctx.rate;
  const at = Math.round(e.t * rate);
  const vel = e.vel;
  const s = ctx.style;
  const shot = (key: string, make: () => [Float32Array, Float32Array] | Float32Array, gain = vel) => {
    let buf = cache.get(key);
    if (!buf) {
      const m = make();
      buf = Array.isArray(m) ? m : [m, m];
      cache.set(key, buf);
    }
    const n = Math.min(buf[0].length, len(e.dur, rate));
    if (n < buf[0].length) {
      const l = buf[0].slice(0, n), r = buf[1].slice(0, n);
      tail(l, 6, rate);
      tail(r, 6, rate);
      put(ctx, at, l, r, gain);
    } else put(ctx, at, buf[0], buf[1], gain);
  };
  const rr = (k: number) => (hashSeed(ctx.seed, e.part, Math.round(e.t * 1000)) % k);
  switch (e.part) {
    case "kick": {
      const k = KICKS[s] ?? KICKS.launch!;
      return shot(`kick${e.tag === "thin" ? "-thin" : ""}${e.tag === "final" ? "-final" : ""}`, () => makeKick(e.tag === "final" ? { ...k, decay: k.decay * 2, seconds: k.seconds * 2 } : k, rate, e.tag === "thin", 11));
    }
    case "snare":
    case "roll": {
      if (e.part === "roll") {
        const lv = Math.round(vel * 7);
        return shot(`roll${lv}-${rr(3)}`, () => makeSnare(rate, 175 + 90 * (lv / 7), 0.09 - 0.05 * (lv / 7), 0.6 + 0.4 * (lv / 7), 400 + rr(3)), 0.4 + 0.6 * vel);
      }
      const lofi = s === "lofi";
      return shot(`snare-${rr(3)}`, () => makeSnare(rate, lofi ? 185 : s === "cinematic" ? 160 : 200, lofi ? 0.12 : s === "cinematic" ? 0.18 : 0.1, lofi ? 0.35 : 0.8, 300 + rr(3)));
    }
    case "clap":
      return shot(`clap-${rr(3)}`, () => makeClap(rate, 100 + rr(3) * 7));
    case "rim":
      return shot("rim", () => makeRim(rate, 77));
    case "hat":
      return shot(`hat-${rr(4)}`, () => makeHat(rate, false, s === "lofi", 200 + rr(4)));
    case "openhat":
      return shot(`openhat-${rr(2)}`, () => makeHat(rate, true, s === "lofi", 250 + rr(2)));
    case "shaker":
      return shot(`shaker-${rr(3)}`, () => makeShaker(rate, 300 + rr(3)));
    case "tom": {
      const p = e.pitch ?? 47;
      return shot(`tom${p}`, () => makeDrum(rate, midiToHz(p) * (s === "cinematic" ? 0.5 : 1), 0.22, 0.25, 0.6, 600 + p));
    }
    case "taiko": {
      const p = e.pitch ?? 36;
      return shot(`taiko${p}${e.tag === "final" ? "f" : ""}`, () => makeDrum(rate, midiToHz(p), e.tag === "final" ? 0.9 : 0.45, 0.5, e.tag === "final" ? 2.5 : 1.2, 700 + p));
    }
    case "crash":
      return shot(`crash${e.tag === "final" ? "-final" : ""}`, () => makeCrash(rate, e.tag === "final" ? 5 : 3.4, e.tag === "final" ? 1.7 : 1.1, 800));
    case "riser": {
      const [l, r] = riser(rate, e.dur, hashSeed(ctx.seed, "riser", at));
      return put(ctx, at, l, r, vel);
    }
    case "impact": {
      const [l, r] = impact(rate, Math.max(0.3, Math.min(e.dur, 4)), hashSeed(ctx.seed, "impact"));
      return put(ctx, at, l, r, vel);
    }
    case "revcymbal": {
      const [l, r] = reverseCymbal(rate, e.dur, 820);
      return put(ctx, at, l, r, vel);
    }
    case "downlifter": {
      const [l, r] = downlifter(rate, e.dur, 840);
      return put(ctx, at, l, r, vel);
    }
    case "braam": {
      const [l, r] = braam(rate, midiToHz(e.pitch ?? 38), Math.max(0.5, e.dur));
      return put(ctx, at, l, r, vel);
    }
    case "vinyl": {
      const [l, r] = vinyl(rate, e.dur, 860);
      return put(ctx, at, l, r, vel);
    }
    case "sub":
      // Trailers boom on the downbeat and let it die (a held sine masks
      // the taiko); the other styles hold it.
      return put(ctx, at, sub(rate, midiToHz(e.pitch ?? 33), e.dur, s === "cinematic" ? 0.7 : 0), undefined, vel);
    case "bass":
      return put(ctx, at, synthBass(rate, s, midiToHz(e.pitch ?? 40), e.dur, vel), undefined, vel);
    case "pad": {
      const amb = s === "ambient";
      const [l, r] = saws(ctx, e, amb
        ? { detune: [-14, -5, 5, 14], attack: Math.min(0.6, e.dur * 0.5), release: 2, q: 0.9, cutoff: (t, u) => ctx.cutoffAt(t) * (1 + 0.25 * Math.sin(TAU * 0.11 * (e.t + u))) }
        : { detune: [-24, -11, 0, 11, 24], attack: e.tag === "final" ? 0.005 : 0.03, release: 0.25, q: 0.9, cutoff: (t) => ctx.cutoffAt(t), decay: e.tag === "final" ? 2.5 : undefined });
      return put(ctx, at, l, r, vel);
    }
    case "strings": {
      const [l, r] = saws(ctx, e, { detune: [-9, -3, 3, 9], attack: e.tag === "final" ? 0.03 : s === "cinematic" ? Math.min(0.45, e.dur * 0.3) : 0.25, release: 0.6, q: 0.7, vibrato: 0.004, cutoff: (t) => Math.min(6000, ctx.cutoffAt(t)), decay: e.tag === "final" ? 3 : undefined });
      return put(ctx, at, l, r, vel);
    }
    case "ostinato": {
      const [l, r] = saws(ctx, e, { detune: [-6, 6], attack: 0.004, release: 0.04, q: 0.8, decay: 0.12, cutoff: (_t, u) => 900 + 2600 * Math.exp(-u / 0.06) });
      return put(ctx, at, l, r, vel);
    }
    case "brass": {
      const [l, r] = saws(ctx, e, { detune: [-6, 0, 6], attack: e.tag === "final" ? 0.03 : 0.18, release: 0.4, q: 1, drive: 1.6, cutoff: (_t, u) => 300 + 2200 * Math.min(1, u / 0.3) * (0.7 + 0.3 * Math.exp(-u / 0.8)), decay: e.tag === "final" ? 2 : undefined });
      return put(ctx, at, l, r, vel);
    }
    case "choir": {
      const [l, r] = choir(ctx, e);
      return put(ctx, at, l, r, vel);
    }
    case "keys": {
      const [l, r] = rhodes(ctx, e);
      return put(ctx, at, l, r, vel);
    }
    case "piano":
      return put(ctx, at, piano(ctx, e, s === "cinematic" || s === "ambient"), undefined, vel);
    case "pluck": {
      if (s === "corporate") return put(ctx, at, karplus(ctx, e), undefined, vel);
      const [l, r] = synthPluck(ctx, e, true);
      return put(ctx, at, l, r, vel);
    }
    case "arp": {
      if (s === "ambient") return put(ctx, at, mallet(ctx, e), undefined, vel);
      const [l, r] = synthPluck(ctx, e, false);
      return put(ctx, at, l, r, vel);
    }
    case "lead":
    case "counter": {
      const [l, r] = lead(ctx, e);
      return put(ctx, at, l, r, vel);
    }
    case "bell":
      return put(ctx, at, bell(ctx, e), undefined, vel);
  }
}

/** Every part the dispatcher plays (the tests check none is missing). */
export const VOICED: Part[] = ["kick", "snare", "roll", "clap", "rim", "hat", "openhat", "shaker", "tom", "taiko", "crash", "riser", "impact", "revcymbal", "downlifter", "braam", "vinyl", "sub", "bass", "pad", "strings", "ostinato", "brass", "choir", "keys", "piano", "pluck", "arp", "lead", "counter", "bell"];
