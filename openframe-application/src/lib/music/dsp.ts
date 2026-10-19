// Signal processing for the score generator: filters, band-limited
// oscillators, FFT convolution (the reverb), the delay and the master
// bus's compressor. Plain loops over Float32Arrays, so a render is the
// same on every machine and runs in a worker or a test alike (ADR-085).

import { kWeighting } from "../analysis/loudness";

/** RBJ biquad coefficients, normalized: [b0, b1, b2, a1, a2]. */
export type Coeffs = [number, number, number, number, number];

export type BiquadKind = "lowpass" | "highpass" | "bandpass" | "peak" | "lowshelf" | "highshelf";

/** The Audio EQ Cookbook's biquads (Bristow-Johnson). `q` is the filter's
 * Q, or the shelf slope S for shelves; `gainDb` for peaks and shelves. */
export function biquad(kind: BiquadKind, f: number, rate: number, q = Math.SQRT1_2, gainDb = 0): Coeffs {
  const w = (2 * Math.PI * Math.min(f, rate * 0.49)) / rate;
  const cos = Math.cos(w), sin = Math.sin(w);
  const A = 10 ** (gainDb / 40);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (kind === "lowshelf" || kind === "highshelf") {
    const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / q - 1) + 2);
    const s = 2 * Math.sqrt(A) * alpha;
    if (kind === "lowshelf") {
      [b0, b1, b2] = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
    } else {
      [b0, b1, b2] = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
      [a0, a1, a2] = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
    }
  } else {
    const alpha = sin / (2 * q);
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
    if (kind === "lowpass") [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    else if (kind === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    else if (kind === "bandpass") [b0, b1, b2] = [alpha, 0, -alpha];
    else [b0, b1, b2, a0, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, 1 - alpha / A];
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/** Run a biquad over x[from, to) in place (transposed direct form II). */
export function filter(x: Float32Array, c: Coeffs, from = 0, to = x.length): void {
  const [b0, b1, b2, a1, a2] = c;
  let z1 = 0, z2 = 0;
  for (let i = from; i < to; i++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
}

/** A chain of biquads over x, in place. */
export const filters = (x: Float32Array, cs: Coeffs[], from = 0, to = x.length) => cs.forEach((c) => filter(x, c, from, to));

/**
 * The PolyBLEP residual at phase `t` (0..1) for a step of `dt` a sample:
 * subtracted from a naive saw (or added at a square's edges), it rounds
 * the jump over two samples, so harmonics above Nyquist fold back 30-40 dB
 * quieter than a naive oscillator's.
 */
export function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/**
 * A topology-preserving state-variable filter (Zavalishin): stable while
 * its cutoff moves every sample, as a synth's filter envelope needs.
 * `step(x)` returns the low-pass; `band` and `high` hold the other outputs.
 */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  private g = 0;
  private k = 1.4;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  band = 0;
  high = 0;
  constructor(private readonly rate: number) {}
  /** Cutoff in Hz, resonance as Q (0.5..20). */
  set(cutoff: number, q = Math.SQRT1_2) {
    this.g = Math.tan((Math.PI * Math.min(cutoff, this.rate * 0.45)) / this.rate);
    this.k = 1 / q;
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  step(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.band = v1;
    this.high = x - this.k * v1 - v2;
    return v2;
  }
}

// ---- FFT and convolution ------------------------------------------------------------

/** A radix-2 complex FFT of one size, its twiddles computed once. */
export class Fft {
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  private readonly rev: Uint32Array;
  constructor(readonly n: number) {
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  /** In place; `inverse` conjugates the twiddles (no 1/n scaling). */
  run(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sgn = inverse ? -1 : 1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const stride = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * stride], wi = sgn * this.sin[k * stride];
          const a = i + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

/**
 * Convolve mono `x` with a stereo impulse response, adding `gain` times the
 * result into `outL` and `outR` (overlap-add, one FFT size for the whole
 * response). Both sides come out of one inverse transform: x's spectrum
 * times (L + iR) has the left response in its real part and the right in
 * its imaginary part, since both are real.
 */
export function convolveStereo(x: Float32Array, ir: [Float32Array, Float32Array], outL: Float32Array, outR: Float32Array, gain = 1): void {
  const m = Math.max(ir[0].length, ir[1].length);
  const n = pow2(2 * m);
  const block = n - m + 1;
  const fft = new Fft(n);
  const hr = new Float64Array(n), hi = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    hr[i] = ir[0][i] ?? 0;
    hi[i] = ir[1][i] ?? 0;
  }
  fft.run(hr, hi);
  const re = new Float64Array(n), im = new Float64Array(n);
  const k = gain / n;
  for (let start = 0; start < x.length; start += block) {
    const len = Math.min(block, x.length - start);
    let any = false;
    for (let i = 0; i < len; i++) if (x[start + i] !== 0) {
      any = true;
      break;
    }
    if (!any) continue;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < len; i++) re[i] = x[start + i];
    fft.run(re, im);
    for (let i = 0; i < n; i++) {
      const [a, b, c, d] = [re[i], im[i], hr[i], hi[i]];
      re[i] = a * c - b * d;
      im[i] = a * d + b * c;
    }
    fft.run(re, im, true);
    const end = Math.min(outL.length, start + n);
    for (let i = start; i < end; i++) {
      outL[i] += re[i - start] * k;
      outR[i] += im[i - start] * k;
    }
  }
}

/**
 * A ping-pong delay from mono `x` into the two sides: the first repeat on
 * the left after `time` seconds, then alternating, each `feedback` quieter
 * and darker (a one-pole low-pass at 5 kHz in the loop), added to `outL`
 * and `outR` at `gain`. One pass, two delay lines.
 */
export function pingPong(x: Float32Array, rate: number, time: number, feedback: number, gain: number, outL: Float32Array, outR: Float32Array): void {
  const d = Math.max(1, Math.round(time * rate));
  const bl = new Float32Array(d), br = new Float32Array(d);
  const a = 1 - Math.exp((-2 * Math.PI * 5000) / rate);
  let idx = 0, fl = 0, fr = 0;
  for (let i = 0; i < outL.length; i++) {
    const dl = bl[idx], dr = br[idx];
    outL[i] += dl * gain;
    outR[i] += dr * gain;
    fl += a * (dr * feedback - fl);
    fr += a * (dl * feedback - fr);
    bl[idx] = (x[i] ?? 0) + fl;
    br[idx] = fr;
    if (++idx === d) idx = 0;
  }
}

/**
 * convolveStereo at half the sample rate, for a send already low-passed
 * well under a quarter of `rate` (the reverb's is, at 9 kHz): the send is
 * decimated, convolved with `irHalf` (made at rate / 2), and interpolated
 * back through a sixth-order low-pass. Half the samples and half the
 * response: the hall costs a third of the time.
 */
export function convolveStereoHalf(x: Float32Array, rate: number, irHalf: [Float32Array, Float32Array], outL: Float32Array, outR: Float32Array, gain = 1): void {
  const lp = biquad("lowpass", Math.min(9500, rate * 0.2), rate);
  const src = Float32Array.from(x);
  filters(src, [lp, lp]);
  const h = Math.ceil(src.length / 2);
  const xd = new Float32Array(h);
  for (let i = 0; i < h; i++) xd[i] = src[2 * i];
  const yl = new Float32Array(h), yr = new Float32Array(h);
  convolveStereo(xd, irHalf, yl, yr, 2 * gain);
  for (const [y, out] of [[yl, outL], [yr, outR]] as const) {
    const up = new Float32Array(out.length);
    for (let i = 0; i < h && 2 * i < up.length; i++) up[2 * i] = y[i];
    filters(up, [lp, lp, lp]);
    for (let i = 0; i < out.length; i++) out[i] += up[i];
  }
}

/** A fade in over `a` samples and out over `b` at the ends of [from, to). */
export function edgeFades(buf: Float32Array, from: number, to: number, a: number, b: number): void {
  for (let i = 0; i < a && from + i < to; i++) buf[from + i] *= i / a;
  for (let i = 0; i < b && to - 1 - i >= from; i++) buf[to - 1 - i] *= i / b;
}

/** Tape-like saturation: tanh(g x) / g, unity for small signals, rounding
 * the peaks (and adding their odd harmonics) more as `drive` grows. */
export function saturate(x: Float32Array, drive: number): void {
  if (drive <= 0) return;
  const g = 1 + 3 * drive;
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g) / g;
}

/** BS.1770's K-weighting (a head shelf and a high-pass), in place. */
export function kFilters(x: Float32Array, rate: number): void {
  for (const c of kWeighting(rate)) filter(x, c);
}
