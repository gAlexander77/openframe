// Measurements of a rendered score, for its answer, the tests and the
// drive: what can be checked without listening (ADR-085). Spectral
// balance (the share of power below 250 Hz, to 4 kHz and above, and the
// slope of the octave bands, which commercial mixes hold near -4.5 dB an
// octave between 90 Hz and 4.5 kHz), crest factor, stereo correlation,
// DC offset and clipped samples.

import { biquad, Fft, filter } from "./dsp";

export interface Balance {
  /** Shares of the power, 0..1: below 250 Hz, 250 Hz-4 kHz, above 4 kHz. */
  low: number;
  mid: number;
  high: number;
  /** Octave band levels, dB relative to the loudest band, centers 31.5 Hz..16 kHz. */
  octaves: { hz: number; db: number }[];
  /** The fitted slope of the bands from 125 Hz to 4 kHz, dB per octave. */
  slope: number;
}

export const OCTAVES = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** The long-term spectrum of a stereo signal (both sides' power), by
 * Hann-windowed 8192-point frames hopping half a frame. */
export function balance(L: Float32Array, R: Float32Array, rate: number): Balance {
  const N = 8192;
  const fft = new Fft(N);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const psd = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let s = 0; s + N <= L.length; s += N / 2) {
    for (const x of [L, R]) {
      for (let i = 0; i < N; i++) {
        re[i] = x[s + i] * win[i];
        im[i] = 0;
      }
      fft.run(re, im);
      for (let k = 1; k < N / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
    }
  }
  const hz = (k: number) => (k * rate) / N;
  let low = 0, mid = 0, high = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = hz(k);
    if (f < 20) continue;
    if (f < 250) low += psd[k];
    else if (f < 4000) mid += psd[k];
    else high += psd[k];
  }
  const total = low + mid + high || 1;
  const bands = OCTAVES.map((c) => {
    let p = 0;
    for (let k = 1; k < N / 2; k++) {
      const f = hz(k);
      if (f >= c / Math.SQRT2 && f < c * Math.SQRT2) p += psd[k];
    }
    return 10 * Math.log10(p + 1e-20);
  });
  const top = Math.max(...bands);
  const octaves = OCTAVES.map((c, i) => ({ hz: c, db: +(bands[i] - top).toFixed(1) }));
  // Least squares through the 125 Hz..4 kHz bands against octaves.
  const pts = octaves.filter((o) => o.hz >= 125 && o.hz <= 4000).map((o) => [Math.log2(o.hz), o.db]);
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length, my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  const slope = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  return { low: +(low / total).toFixed(4), mid: +(mid / total).toFixed(4), high: +(high / total).toFixed(4), octaves, slope: +slope.toFixed(2) };
}

export interface Stats {
  /** Peak over RMS, dB, over the whole signal. */
  crest_db: number;
  /** The correlation of the two sides: 1 mono, 0 unrelated, below 0 out of phase. */
  correlation: number;
  /** Mean of each side (DC offset). */
  dc: [number, number];
  /** Samples at or over full scale. */
  clipped: number;
}

export function stats(L: Float32Array, R: Float32Array): Stats {
  let peak = 0, ss = 0, lr = 0, ll = 0, rr = 0, sl = 0, sr = 0, clipped = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i], b = R[i];
    peak = Math.max(peak, Math.abs(a), Math.abs(b));
    if (Math.abs(a) >= 1 || Math.abs(b) >= 1) clipped++;
    ss += a * a + b * b;
    lr += a * b;
    ll += a * a;
    rr += b * b;
    sl += a;
    sr += b;
  }
  const rms = Math.sqrt(ss / (2 * Math.max(1, L.length)));
  return {
    crest_db: +(20 * Math.log10(peak / Math.max(1e-12, rms))).toFixed(2),
    correlation: +(lr / Math.sqrt(Math.max(1e-24, ll * rr))).toFixed(3),
    dc: [sl / Math.max(1, L.length), sr / Math.max(1, R.length)],
    clipped,
  };
}

/** Both sides summed to mono and resampled to `to` Hz (a low-pass first, so
 * nothing folds back), as analyze_music decodes a clip. */
export function monoAt(L: Float32Array, R: Float32Array, rate: number, to: number): Float32Array {
  const x = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) x[i] = (L[i] + R[i]) / 2;
  if (to < rate) for (let k = 0; k < 2; k++) filter(x, biquad("lowpass", to * 0.45, rate));
  const n = Math.floor((L.length * to) / rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i * rate) / to;
    const j = Math.floor(p);
    const f = p - j;
    out[i] = x[j] * (1 - f) + (x[j + 1] ?? 0) * f;
  }
  return out;
}
