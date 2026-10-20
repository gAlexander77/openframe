// Ambience beds made on this computer (ADR-098): continuous natural sound
// under a documentary's pictures (wind, a stream, a waterfall, surf, rain,
// a rocket's rumble, a city, room tone), with no recordings and no one's
// license. Each is a few layers of shaped noise and of physically modelled
// events (Minnaert bubbles for water, Van den Doel's rising chirp; drop
// ticks for rain; cars passing with their Doppler fall; waves that swell,
// break and wash back), every one moving slowly and at random, so the bed
// breathes rather than hisses. Seeded: the same seed is the same sound on
// every machine. Rendered in blocks through streaming layers, so memory is
// only the file itself; the file loops without a seam (its tail is
// crossfaded into its head), so a longer bed tiles it.
//
// Measured, not listened to: ambience.test.ts holds each bed's spectrum,
// slow movement, seam and clicks to what recordings of the kind show.

import { biquad, Svf, type Coeffs } from "./music/dsp";
import { hashSeed, Rng } from "./music/arrange";
import { LoudnessMeter } from "./analysis/loudness";
import { roleTrack } from "./audioRoles";
import { clipForAsset } from "./project/defaults";
import { addClip } from "./project/ops";
import type { Asset, Clip, Id, Project } from "./project/types";
import { secondsToFrames } from "./time";

export interface Bed {
  label: string;
  /** What it is, for the catalog and the tool's help. */
  blurb: string;
  /** Integrated loudness the file is made at, LUFS: a level that sits
   * under a voice at -16 with the clip's volume at 1. */
  lufs: number;
  layers: [make: (rng: Rng, rate: number) => Layer, db: number][];
}

/** A streaming sound source: `fill` writes the next `len` samples into
 * L and R (overwriting) and moves on. */
interface Layer {
  fill(L: Float32Array, R: Float32Array, len: number): void;
}

/** The longest file a bed is made as; a longer bed repeats it end to end,
 * which its seamless loop makes inaudible as a join. */
export const BED_MAX_SECONDS = 300;
/** Seconds of the tail crossfaded into the head, so the file loops. */
const LOOP_FADE = 3;
const BLOCK = 4096;
/** Seconds of each layer measured to set its level. */
const CALIBRATE = 20;

// ---- sources --------------------------------------------------------------------

/** Pink noise (Paul Kellet's filter): equal power per octave. */
class Pink {
  private b = new Float64Array(7);
  constructor(private rng: Rng) {}
  next(): number {
    const w = this.rng.next() * 2 - 1, b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }
}

/** Brown (red) noise: -6 dB an octave, leaky so it never wanders off. */
class Brown {
  private y = 0;
  constructor(private rng: Rng) {}
  next(): number {
    this.y = (this.y + 0.02 * (this.rng.next() * 2 - 1)) / 1.02;
    return this.y * 3.5;
  }
}

/** A slow random movement, 0..1: a new target every `step` seconds (give
 * or take `jitter` of it), eased there (smoothstep), so it never jumps.
 * `rate` is how often `next` is called: a sample rate, or a control rate
 * (the sample rate / CONTROL) for movements read every CONTROL samples. */
class Drift {
  private a: number;
  private b: number;
  private k = 0;
  private len = 1;
  constructor(private rng: Rng, private rate: number, private step: number, private jitter = 0.5, private shape = 1) {
    this.a = rng.next() ** shape;
    this.b = rng.next() ** shape;
    this.len = this.span();
  }
  private span() {
    return Math.max(1, Math.round(this.rate * this.step * (1 + this.jitter * (this.rng.next() * 2 - 1))));
  }
  next(): number {
    if (this.k >= this.len) {
      this.a = this.b;
      this.b = this.rng.next() ** this.shape;
      this.len = this.span();
      this.k = 0;
    }
    const u = this.k / this.len;
    const x = this.a + (this.b - this.a) * u * u * (3 - 2 * u);
    this.k++;
    return x;
  }
  /** Move on `n` samples without reading (a channel that lags another). */
  skip(n: number) {
    for (let i = 0; i < n; i++) this.next();
  }
}

/** A biquad run sample by sample (transposed direct form II). */
class Bq {
  private z1 = 0;
  private z2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  constructor(c: Coeffs) {
    [this.b0, this.b1, this.b2, this.a1, this.a2] = c;
  }
  step(v: number): number {
    const y = this.b0 * v + this.z1;
    this.z1 = this.b1 * v - this.a1 * y + this.z2;
    this.z2 = this.b2 * v - this.a2 * y;
    return y;
  }
}
const chain = (cs: Coeffs[]): ((v: number) => number) => {
  const fs = cs.map((c) => new Bq(c));
  if (fs.length === 1) return (v) => fs[0].step(v);
  return (v) => {
    for (let k = 0; k < fs.length; k++) v = fs[k].step(v);
    return v;
  };
};

/** Samples between readings of a slow movement (gains, filter cutoffs). */
const CONTROL = 32;

/** Equal-power pan, -1..1, as [left, right] gains. */
const panGains = (pan: number): [number, number] => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];

/** Two decorrelated noise beds through the same shaping, with a share of
 * one common to both sides (`width` 1: unrelated sides; 0: mono). */
function noiseBed(rng: Rng, rate: number, kind: "pink" | "brown" | "white", shape: Coeffs[], opts: { width?: number; drift?: { step: number; db: number }; flutter?: { step: number; db: number } } = {}): Layer {
  const src = (r: Rng) => (kind === "pink" ? new Pink(r) : kind === "brown" ? new Brown(r) : { next: () => r.next() * 2 - 1 });
  const [a, b, c] = [src(new Rng(rng.int(2 ** 31))), src(new Rng(rng.int(2 ** 31))), src(new Rng(rng.int(2 ** 31)))];
  const [fa, fb] = [chain(shape), chain(shape)];
  const w = opts.width ?? 0.8;
  const side = Math.sqrt(w), mid = Math.sqrt(1 - w);
  const slow = opts.drift && new Drift(new Rng(rng.int(2 ** 31)), rate / CONTROL, opts.drift.step, 0.5);
  const fast = opts.flutter && new Drift(new Rng(rng.int(2 ** 31)), rate / CONTROL, opts.flutter.step, 0.6);
  let g = 1, k = 0;
  return {
    fill(L, R, len) {
      for (let i = 0; i < len; i++) {
        if (k++ % CONTROL === 0) {
          g = 1;
          if (slow) g *= 10 ** (((slow.next() - 0.5) * opts.drift!.db) / 20);
          if (fast) g *= 10 ** (((fast.next() - 0.5) * opts.flutter!.db) / 20);
        }
        const m = c.next() * mid;
        L[i] = fa(a.next() * side + m) * g;
        R[i] = fb(b.next() * side + m) * g;
      }
    },
  };
}

// ---- events ------------------------------------------------------------------------

interface Voice {
  /** Samples into the block it starts at (only its first block). */
  at: number;
  /** Writes into L and R from `at` to `len`; false when finished. */
  play(L: Float32Array, R: Float32Array, at: number, len: number): boolean;
}

/** Events at random times, each sounding through its own voice,
 * overlapping: a Poisson process at `perSecond` (read at each event), or
 * `gap` seconds apart when the events come more evenly (waves). */
function events(rng: Rng, rate: number, perSecond: () => number, voice: (rng: Rng) => (L: Float32Array, R: Float32Array, at: number, len: number) => boolean, gap?: () => number): Layer {
  const active: Voice[] = [];
  let pos = 0;
  const after = () => Math.max(1, (gap ? gap() : -Math.log(1 - rng.next()) / Math.max(1e-3, perSecond())) * rate);
  // Evenly spaced events (waves) begin within a second and a half, so a
  // short bed never opens on a long lull.
  let next = gap ? rng.next() * Math.min(after(), 1.5 * rate) : after();
  return {
    fill(L, R, len) {
      L.fill(0, 0, len);
      R.fill(0, 0, len);
      while (next < pos + len) {
        active.push({ at: Math.max(0, Math.floor(next - pos)), play: voice(rng) });
        next += after();
      }
      for (let i = active.length - 1; i >= 0; i--) {
        const v = active[i];
        if (!v.play(L, R, v.at, len)) active.splice(i, 1);
        else v.at = 0;
      }
      pos += len;
    },
  };
}

/**
 * Bubbles in water (Van den Doel's model of liquid sound): a bubble of
 * radius r rings at Minnaert's frequency, about 3.26/r Hz, damped by
 * 0.043 f + 0.0014 f^1.5 a second, its pitch rising as it nears the
 * surface. Sizes follow a power law: many small, a few large.
 */
function bubbles(rng: Rng, rate: number, o: { perSecond: number; vary?: number; step?: number; rmin: number; rmax: number; rise: [number, number]; pan?: number; size?: number }): Layer {
  const busy = new Drift(new Rng(rng.int(2 ** 31)), rate / BLOCK, o.step ?? 1.5, 0.6);
  let density = 1;
  const layer = events(rng, rate, () => o.perSecond * density, (r) => {
    const radius = o.rmin * (o.rmax / o.rmin) ** (r.next() ** 2.2);
    const f0 = 3.26 / radius;
    const d = 0.043 * f0 + 0.0014 * f0 ** 1.5;
    const xi = r.range(o.rise[0], o.rise[1]);
    const amp = (radius / o.rmax) ** (o.size ?? 0.9) * r.range(0.35, 1);
    const [gl, gr] = panGains(r.range(-(o.pan ?? 0.8), o.pan ?? 0.8));
    const decay = Math.exp(-d / rate);
    const end = Math.min(rate * 0.3, (5.5 / d) * rate);
    // A few samples of attack: a bubble's start is fast but not a step.
    const attack = Math.max(4, Math.round(rate * 0.0004));
    let t = 0, ph = 0, env = amp;
    return (L, R, at, len) => {
      for (let i = at; i < len; i++, t++) {
        if (t >= end) return false;
        ph += (2 * Math.PI * f0 * (1 + xi * d * (t / rate))) / rate;
        const v = Math.sin(ph) * env * (t < attack ? t / attack : 1);
        env *= decay;
        L[i] += v * gl;
        R[i] += v * gr;
      }
      return true;
    };
  });
  return {
    fill(L, R, len) {
      // The flow's busyness drifts (a gurgle, then calmer water).
      density = 1 + (o.vary ?? 0.6) * (busy.next() * 2 - 1);
      layer.fill(L, R, len);
    },
  };
}

/** Raindrops striking: a short decaying tick of a few kilohertz each,
 * loud ones rare (amplitudes heavy-tailed), panned anywhere. */
function drops(rng: Rng, rate: number, perSecond: number): Layer {
  const heavy = new Drift(new Rng(rng.int(2 ** 31)), rate / BLOCK, 6, 0.5);
  let k = 1;
  const layer = events(rng, rate, () => perSecond * k, (r) => {
    const f = r.range(1800, 7500);
    const d = r.range(900, 2600);
    const amp = 0.15 + r.next() ** 3 * 0.85;
    const [gl, gr] = panGains(r.range(-0.95, 0.95));
    const decay = Math.exp(-d / rate), w = (2 * Math.PI * f) / rate;
    const end = (6 / d) * rate;
    let t = 0, env = amp;
    const ph0 = r.next() * Math.PI * 2;
    return (L, R, at, len) => {
      for (let i = at; i < len; i++, t++) {
        if (t >= end) return false;
        const v = Math.sin(ph0 + w * t) * env * (t < 12 ? t / 12 : 1);
        env *= decay;
        L[i] += v * gl;
        R[i] += v * gr;
      }
      return true;
    };
  });
  return {
    fill(L, R, len) {
      k = 0.6 + 0.8 * heavy.next();
      layer.fill(L, R, len);
    },
  };
}

/**
 * Cars passing on a street: tire roar (pink noise through a band near
 * 900 Hz) and engine (brown noise under 150 Hz), louder as 1/distance
 * toward the closest point, the band falling through it (Doppler), panned
 * across. Some near, most farther (quieter and duller).
 */
function cars(rng: Rng, rate: number, every: number): Layer {
  return events(rng, rate, () => 1 / every, (r) => {
    const seconds = r.range(4.5, 9);
    const n = Math.round(seconds * rate), tc = n / 2;
    const w = r.range(0.45, 1.3) * rate;
    const near = r.next() ** 1.2;
    const gain = 0.25 + 0.75 * near;
    const dir = r.chance(0.5) ? 1 : -1;
    const tire = new Pink(new Rng(r.int(2 ** 31))), engine = new Brown(new Rng(r.int(2 ** 31)));
    const band = new Svf(rate), dull = new Bq(biquad("lowpass", 1800 + 5000 * near, rate));
    const low = chain([biquad("lowpass", 140, rate)]);
    const c0 = r.range(650, 1100);
    let t = 0;
    return (L, R, at, len) => {
      for (let i = at; i < len; i++, t++) {
        if (t >= n) return false;
        const x = (t - tc) / w;
        if ((t & 31) === 0) band.set(c0 * (1 - 0.07 * Math.tanh(x)), 0.8);
        const amp = (gain / Math.sqrt(1 + x * x)) * Math.sin((Math.PI * t) / n) ** 2;
        // Tire roar: the band around c0 over its low side; the engine under it.
        const below = band.step(tire.next());
        const v = (dull.step(band.band + below * 0.5) + low(engine.next()) * 0.8) * amp;
        const [gl, gr] = panGains(dir * (2 / Math.PI) * Math.atan(x * 0.8) * 0.9);
        L[i] += v * gl;
        R[i] += v * gr;
      }
      return true;
    };
  });
}

/**
 * Waves on a beach: each swells (a low roar rising), breaks (a burst whose
 * brightness opens to several kilohertz in a fraction of a second) and
 * washes back (a hiss closing down over seconds, with foam's crackle).
 * Sets arrive every 6.5 to 13 seconds, never on a beat.
 */
function waves(rng: Rng, rate: number): Layer {
  return events(rng, rate, () => 1 / 9.5, (r) => {
    const swell = r.range(1.6, 3) * rate, wash = r.range(5.5, 9) * rate;
    const n = Math.round(swell + wash);
    const strength = r.range(0.55, 1);
    const bright = r.range(4500, 9000);
    const [nl, nr, nc] = [new Pink(new Rng(r.int(2 ** 31))), new Pink(new Rng(r.int(2 ** 31))), new Pink(new Rng(r.int(2 ** 31)))];
    const [fl, fr] = [new Svf(rate), new Svf(rate)];
    const [zl, zr] = [new Rng(r.int(2 ** 31)), new Rng(r.int(2 ** 31))];
    const [hl, hr] = [chain([biquad("highpass", 2000, rate), biquad("lowpass", 7000, rate)]), chain([biquad("highpass", 2000, rate), biquad("lowpass", 7000, rate)])];
    const foam = new Drift(new Rng(r.int(2 ** 31)), rate, 0.03, 0.8, 2);
    const pan = r.range(-0.35, 0.35);
    const [gl, gr] = panGains(pan);
    const tau = r.range(1.4, 2.6) * rate;
    let t = 0;
    return (L, R, at, len) => {
      for (let i = at; i < len; i++, t++) {
        if (t >= n) return false;
        let amp: number, cut: number, hit = 0;
        if (t < swell) {
          const p = t / swell;
          amp = 0.35 * p * p;
          cut = 250 + 900 * p * p;
        } else {
          const u = t - swell;
          hit = Math.min(1, u / (0.35 * rate));
          amp = (0.35 + 0.65 * hit) * Math.exp(-u / tau);
          // From the swell's 1150 Hz, open to `bright` on the break, then close.
          cut = 700 + (450 + (bright - 1150) * hit) * Math.exp(-u / (0.7 * tau));
        }
        // The last second fades to nothing, whatever is left.
        const tail = Math.min(1, (n - t) / rate);
        amp *= strength * tail;
        if ((t & 31) === 0) {
          fl.set(cut, 0.6);
          fr.set(cut * 1.04, 0.6);
        }
        const fz = t > swell ? Math.exp(-(t - swell) / (1.2 * tau)) * foam.next() * 0.12 * tail * hit : 0;
        const c = nc.next() * 0.6;
        L[i] += (fl.step(nl.next() * 0.8 + c) * amp + hl(zl.next() * 2 - 1) * fz * strength) * gl * 1.2;
        R[i] += (fr.step(nr.next() * 0.8 + c) * amp + hr(zr.next() * 2 - 1) * fz * strength) * gr * 1.2;
      }
      return true;
    };
  }, () => rng.range(6.5, 13));
}

/**
 * A rocket's crackle: shock waves heard as sharp, mostly positive spikes
 * (their skew is what separates rocket noise from a roar), at a busy,
 * drifting rate, filtered by distance.
 */
function crackle(rng: Rng, rate: number, perSecond: number): Layer {
  const busy = new Drift(new Rng(rng.int(2 ** 31)), rate / BLOCK, 0.4, 0.7);
  let k = 1;
  const [hl, hr] = [chain([biquad("highpass", 180, rate), biquad("lowpass", 5000, rate)]), chain([biquad("highpass", 180, rate), biquad("lowpass", 5000, rate)])];
  const layer = events(rng, rate, () => perSecond * k, (r) => {
    const amp = 0.3 + Math.abs(r.gauss()) ** 2 * 0.5;
    const rise = Math.max(6, Math.round(r.range(0.00012, 0.0004) * rate));
    const fall = r.range(0.0004, 0.0015) * rate;
    const n = Math.round(rise + 6 * fall);
    const [gl, gr] = panGains(r.range(-0.5, 0.5));
    let t = 0;
    return (L, R, at, len) => {
      for (let i = at; i < len; i++, t++) {
        if (t >= n) return false;
        // A steep rise and a slower fall below zero: the shock's N-wave.
        const v = amp * (t < rise ? t / rise : Math.exp(-(t - rise) / fall) * (1 - 1.6 * ((t - rise) / (6 * fall))));
        L[i] += v * gl;
        R[i] += v * gr;
      }
      return true;
    };
  });
  return {
    fill(L, R, len) {
      k = 0.5 + busy.next();
      layer.fill(L, R, len);
      for (let i = 0; i < len; i++) {
        L[i] = hl(L[i]);
        R[i] = hr(R[i]);
      }
    },
  };
}

/** Wind: noise through a band that rises and opens with each gust, the
 * gusts reaching one side a moment before the other, a low buffeting
 * under it and a faint whistle only when it blows hard. */
function wind(rng: Rng, rate: number): Layer {
  const seed = rng.int(2 ** 31);
  const cr = rate / CONTROL;
  const [gustL, gustR] = [new Drift(new Rng(seed), cr, 3.2, 0.7, 1.4), new Drift(new Rng(seed), cr, 3.2, 0.7, 1.4)];
  gustL.skip(Math.round(cr * 0.35));
  const flutter = new Drift(new Rng(rng.int(2 ** 31)), cr, 0.35, 0.8);
  const [nl, nr] = [new Pink(new Rng(rng.int(2 ** 31))), new Pink(new Rng(rng.int(2 ** 31)))];
  const [bl, br] = [new Svf(rate), new Svf(rate)];
  const [rl, rr] = [new Brown(new Rng(rng.int(2 ** 31))), new Brown(new Rng(rng.int(2 ** 31)))];
  const [ll, lr] = [chain([biquad("lowpass", 170, rate)]), chain([biquad("lowpass", 170, rate)])];
  const whistle = new Svf(rate);
  const white = new Rng(rng.int(2 ** 31));
  let i0 = 0, bodyL = 0, bodyR = 0, lowL = 0, lowR = 0, blow = 0;
  return {
    fill(L, R, len) {
      for (let i = 0; i < len; i++, i0++) {
        if (i0 % CONTROL === 0) {
          const gl = gustL.next(), gr = gustR.next(), fl = flutter.next();
          const sl = 0.2 + 0.8 * gl, sr = 0.2 + 0.8 * gr;
          bl.set(170 + 700 * sl * (0.85 + 0.3 * fl), 0.8);
          br.set(170 + 700 * sr * (0.85 + 0.3 * fl), 0.8);
          whistle.set(850 + 900 * (gl + gr) * 0.5, 14);
          blow = Math.max(0, (gl + gr) * 0.5 - 0.6);
          const buffet = 0.9 * (0.7 + 0.6 * fl);
          [bodyL, bodyR, lowL, lowR] = [sl ** 1.5, sr ** 1.5, sl ** 1.8 * buffet, sr ** 1.8 * buffet];
        }
        // Svf.step returns the low-pass; its band output is what blows.
        whistle.step(white.next() * 2 - 1);
        const wh = (whistle.band / 14) * blow * 0.5;
        bl.step(nl.next());
        br.step(nr.next());
        const a = bl.band * bodyL + ll(rl.next()) * lowL + wh;
        const b = br.band * bodyR + lr(rr.next()) * lowR + wh * 0.8;
        L[i] = a + 0.15 * b;
        R[i] = b + 0.15 * a;
      }
    },
  };
}

// ---- the beds ----------------------------------------------------------------------

const lp = (f: number, rate: number, q?: number) => biquad("lowpass", f, rate, q);
const hp = (f: number, rate: number, q?: number) => biquad("highpass", f, rate, q);

export const AMBIENCE: Record<string, Bed> = {
  wind: {
    label: "Wind",
    blurb: "open-air wind in gusts, a low buffeting under it",
    lufs: -27,
    layers: [[(g, r) => wind(g, r), 0]],
  },
  stream: {
    label: "Stream",
    blurb: "a brook babbling over stones, close",
    lufs: -27,
    layers: [
      [(g, r) => bubbles(g, r, { perSecond: 180, rmin: 0.0006, rmax: 0.005, size: 0.5, rise: [0.06, 0.22] }), 0],
      [(g, r) => noiseBed(g, r, "pink", [hp(350, r), lp(6500, r)], { drift: { step: 2.5, db: 3 } }), -11],
    ],
  },
  waterfall: {
    label: "Waterfall",
    blurb: "a waterfall's steady roar, close enough to feel",
    lufs: -24,
    layers: [
      [(g, r) => noiseBed(g, r, "pink", [hp(50, r), lp(8500, r)], { width: 0.9, drift: { step: 7, db: 2.5 }, flutter: { step: 0.6, db: 1.2 } }), 0],
      [(g, r) => noiseBed(g, r, "brown", [lp(260, r)], { width: 0.7, drift: { step: 5, db: 3 } }), -5],
      [(g, r) => bubbles(g, r, { perSecond: 700, vary: 0.3, rmin: 0.0006, rmax: 0.004, rise: [0.05, 0.15] }), -9],
    ],
  },
  surf: {
    label: "Surf",
    blurb: "waves breaking on a beach and washing back, a distant roar between",
    lufs: -25,
    layers: [
      [(g, r) => waves(g, r), 0],
      [(g, r) => noiseBed(g, r, "pink", [lp(450, r), hp(40, r)], { width: 0.9, drift: { step: 6, db: 4 } }), -6],
      // Farther waves and foam along the beach: never quite silent up high.
      [(g, r) => noiseBed(g, r, "pink", [hp(900, r), lp(6000, r)], { width: 0.95, drift: { step: 4, db: 6 } }), -15],
    ],
  },
  rain: {
    label: "Rain",
    blurb: "steady rain on leaves and ground, drops near and far",
    lufs: -27,
    layers: [
      [(g, r) => noiseBed(g, r, "pink", [hp(900, r), lp(9000, r)], { width: 0.95, drift: { step: 9, db: 3 } }), 0],
      [(g, r) => drops(g, r, 1600), -1],
      [(g, r) => drops(g, r, 14), -7],
      [(g, r) => bubbles(g, r, { perSecond: 22, rmin: 0.0008, rmax: 0.0028, rise: [0.1, 0.3], pan: 0.95 }), -9],
      [(g, r) => noiseBed(g, r, "pink", [lp(380, r), hp(35, r)], { width: 0.8 }), -13],
    ],
  },
  rocket: {
    label: "Rocket rumble",
    blurb: "a rocket's launch heard from a distance: a deep roar with its crackle",
    lufs: -21,
    layers: [
      [(g, r) => noiseBed(g, r, "brown", [lp(95, r), hp(18, r)], { width: 0.6, drift: { step: 1.6, db: 3 }, flutter: { step: 0.12, db: 1.5 } }), 0],
      [(g, r) => noiseBed(g, r, "pink", [lp(650, r), lp(650, r), hp(120, r)], { width: 0.7, drift: { step: 1.3, db: 3.5 } }), -6],
      [(g, r) => crackle(g, r, 160), -4],
    ],
  },
  city: {
    label: "City traffic",
    blurb: "a city street: cars passing near and far over the city's low hum",
    lufs: -27,
    layers: [
      [(g, r) => cars(g, r, 4.2), 0],
      [(g, r) => noiseBed(g, r, "pink", [lp(500, r), hp(35, r)], { width: 0.85, drift: { step: 8, db: 3 } }), -5],
      [(g, r) => noiseBed(g, r, "pink", [biquad("bandpass", 1000, r, 0.6)], { width: 0.9, drift: { step: 5, db: 3 } }), -13],
    ],
  },
  roomTone: {
    label: "Room tone",
    blurb: "a quiet room's air: ventilation and the room itself, for under and between lines",
    lufs: -46,
    layers: [
      [(g, r) => noiseBed(g, r, "pink", [hp(40, r), lp(6000, r), biquad("peak", g.range(75, 130), r, 4, 4), biquad("peak", g.range(170, 260), r, 4, 3)], { width: 0.9, drift: { step: 14, db: 1 } }), 0],
      [(g, r) => noiseBed(g, r, "brown", [lp(150, r), hp(25, r)], { width: 0.6, drift: { step: 11, db: 2 } }), -4],
    ],
  },
};

export const AMBIENCE_IDS = Object.keys(AMBIENCE);

/** A bed's file name: "Wind 72s.wav" (seed 1), "Wind 72s 2.wav". */
export const bedFileName = (id: string, seconds: number, seed: number) => `${AMBIENCE[id].label} ${Math.round(seconds)}s${seed === 1 ? "" : ` ${seed}`}.wav`;

/**
 * Bed `id`, `seconds` long (at most BED_MAX_SECONDS), stereo at `rate`:
 * every layer at its level against the first (measured on its own first
 * seconds), the whole at the bed's loudness, the tail crossfaded into the
 * head so the file loops without a seam.
 */
export function makeBed(id: string, seconds: number, rate: number, seed = 1, onProgress?: (fraction: number) => void): [Float32Array, Float32Array] {
  const bed = AMBIENCE[id];
  if (!bed) throw new Error(`No ambience ${id}; there are ${AMBIENCE_IDS.join(", ")}`);
  const n = Math.round(Math.min(BED_MAX_SECONDS, Math.max(1, seconds)) * rate);
  const fade = Math.min(Math.round(LOOP_FADE * rate), Math.floor(n / 3));
  const total = n + fade;
  const L = new Float32Array(total), R = new Float32Array(total);
  const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK);
  const layerSeed = (k: number) => hashSeed("ambience", id, seed, k);
  // Each layer's level from its first 20 seconds (long enough for a few
  // cars or waves), run on a copy of itself.
  const gains = bed.layers.map(([make, db], k) => {
    const probe = make(new Rng(layerSeed(k)), rate);
    let ss = 0, m = 0;
    for (let done = 0; done < Math.min(CALIBRATE * rate, total); done += BLOCK) {
      probe.fill(bl, br, BLOCK);
      for (let i = 0; i < BLOCK; i++) ss += bl[i] * bl[i] + br[i] * br[i];
      m += 2 * BLOCK;
    }
    return 10 ** (db / 20) / Math.max(1e-9, Math.sqrt(ss / m));
  });
  bed.layers.forEach(([make], k) => {
    const layer = make(new Rng(layerSeed(k)), rate);
    for (let at = 0; at < total; at += BLOCK) {
      const len = Math.min(BLOCK, total - at);
      layer.fill(bl, br, len);
      const g = gains[k];
      for (let i = 0; i < len; i++) {
        L[at + i] += bl[i] * g;
        R[at + i] += br[i] * g;
      }
      onProgress?.((k + (at + len) / total) / bed.layers.length * 0.9);
    }
  });
  // Nothing under 18 Hz (a brown source drifts slowly): run over the whole
  // render, tail included, so the loop below stays continuous.
  for (const x of [L, R]) {
    const f = chain([biquad("highpass", 18, rate)]);
    for (let i = 0; i < total; i++) x[i] = f(x[i]);
  }
  // The loop: the head becomes the tail fading out under the head fading
  // in (equal power: the two are unrelated noise), so sample n - 1 runs on
  // into sample 0 as it ran into sample n.
  for (let i = 0; i < fade; i++) {
    const a = (Math.PI / 2) * (i / fade);
    const gin = Math.sin(a), gout = Math.cos(a);
    L[i] = L[i] * gin + L[n + i] * gout;
    R[i] = R[i] * gin + R[n + i] * gout;
  }
  const outL = L.subarray(0, n), outR = R.subarray(0, n);
  // At the bed's loudness, the peaks held under -1 dBFS.
  const meter = new LoudnessMeter(rate, 2);
  meter.push([outL, outR], n);
  const lufs = meter.integrated();
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const g = Math.min(Number.isFinite(lufs) ? 10 ** ((bed.lufs - lufs) / 20) : 1, 0.89 / Math.max(1e-9, peak));
  for (let i = 0; i < n; i++) {
    outL[i] *= g;
    outR[i] *= g;
  }
  onProgress?.(1);
  return [outL, outR];
}

// ---- placing one ---------------------------------------------------------------------

export interface BedPlacement {
  /** Timeline seconds. */
  start: number;
  end: number;
  /** Seconds; default 1 in, 1.5 out. */
  fadeIn?: number;
  fadeOut?: number;
  volume?: number;
  /** An audio track of the caller's; default the ambience stem's. */
  trackId?: Id;
}

/** Whole frames of a bed file at `fps`: tiles must cut on its loop point. */
export const bedFrames = (seconds: number, p: Project) => Math.max(1, Math.floor(seconds * (p.fps.num / p.fps.den) + 1e-6));

/**
 * Lay bed file `asset` over [start, end): one clip, or the file again and
 * again end to end where the bed is longer than the file (its loop has no
 * seam), on the ambience stem's track (ADR-098) or `trackId`, faded in
 * and out. Pure: add_ambience's edit.
 */
export function placeBed(p: Project, asset: Asset, o: BedPlacement): { project: Project; clipIds: Id[]; trackId: Id } {
  const f0 = secondsToFrames(o.start, p.fps), f1 = Math.max(f0 + 1, secondsToFrames(o.end, p.fps));
  const r = roleTrack(p, "ambience", f0, f1 - f0, o.trackId);
  let q = r.project;
  const per = bedFrames(asset.duration, p);
  const clipIds: Id[] = [];
  const half = Math.floor((f1 - f0) / 2);
  const fadeIn = Math.min(half, secondsToFrames(o.fadeIn ?? 1, p.fps)), fadeOut = Math.min(half, secondsToFrames(o.fadeOut ?? 1.5, p.fps));
  // ponytail: past one file (BED_MAX_SECONDS) the repeats join under the
  // mixer's 4 ms click guard at each clip edge; a looping clip would join
  // them sample-exact.
  for (let at = f0; at < f1; at += per) {
    const len = Math.min(per, f1 - at);
    const first = at === f0, last = at + len >= f1;
    const clip = {
      ...clipForAsset(asset, at, p.fps),
      duration: len,
      ...(o.volume !== undefined ? { volume: o.volume } : {}),
      fadeIn: first ? fadeIn : 0,
      fadeOut: last ? fadeOut : 0,
    } as Clip;
    q = addClip(q, r.trackId, clip, "overwrite");
    clipIds.push(clip.id);
  }
  return { project: q, clipIds, trackId: r.trackId };
}
