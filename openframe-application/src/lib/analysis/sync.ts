// Sync by waveform: where a separately recorded sound (a lav, a recorder)
// lines up with a camera's own sound of the same take. CapCut's "Sync video
// and audio", Resolve's Auto Sync Audio > Based on Waveform and PluralEyes
// do this.
//
// Two microphones in one room hear the same moments differently: another
// gain, another EQ (a lav is warm, a camera thin), other noise and room. So
// the samples are not compared; their onsets are. Each sound becomes a
// mel-band spectral flux envelope (beats.ts): per band log magnitudes, only
// the increases kept. A gain or a static EQ is a constant per band in the
// log, which the increases drop. The two envelopes are cross-correlated for
// every lag at once with one FFT, normalized over each lag's overlap, and
// the best peak is refined between frames with a parabola.
//
// Pure: mono PCM in, a lag and a confidence out.
//
// ponytail: one constant lag. Recorders whose clocks drift (a few ms a
// minute on cheap ones) slide out of sync over long takes; a drift fit from
// lags of several windows is the upgrade.

import { fft, onsetEnvelope } from "./beats";

/** The rate both sounds are decoded at for sync: onsets of speech, claps
 * and steps sit well under 2 kHz. */
export const SYNC_RATE = 4000;
/** Envelope frames per second: 10 ms, refined to about a millisecond. */
export const SYNC_FPS = 100;
/** A 64 ms window at SYNC_RATE: fine enough in time, enough bins for bands. */
const FFT_SIZE = 256;
const BANDS = 40;

export interface SyncOptions {
  /** Largest |lag| considered, seconds; default every lag with overlap. */
  maxLag?: number;
  /** Shortest overlap considered, seconds; default 1 s (or all of the
   * shorter sound, when it is shorter than that). */
  minOverlap?: number;
}

export interface SyncMatch {
  /** Seconds: the moment at time t in `ref` is at t + lag in `other`. */
  lag: number;
  /** 0..1: how far the match stands out, `score - runnerUp`. */
  confidence: number;
  /** 0..1: how alike the two sounds' onsets are at that lag (their
   * correlation over the overlap, scaled down when the overlap covers only
   * part of the shorter sound). */
  score: number;
  /** The best score at least RUNNER_GAP from the match. Every lag of two
   * unrelated sounds scores about the same, and so does every repeat of a
   * sound that repeats (a metronome, a steady beat): either way the best
   * one is a guess. */
  runnerUp: number;
}

/** Seconds a second-best match must be from the best one. */
export const RUNNER_GAP = 0.15;

/** Below this confidence the match is a guess. Measured (sync.test.ts and
 * the fixtures): one take through two different microphones 0.46-0.74, and
 * 0.32 with only a third of it overlapping; unrelated speech, music, tones
 * and noise 0.00-0.07. */
export const MIN_CONFIDENCE = 0.15;

/** The onset envelope sync compares: spectral flux at SYNC_FPS. The frames
 * whose window starts before the sound do not count: the window filling up
 * reads as an attack, and every sound would match at its first frame. */
export function syncEnvelope(pcm: Float32Array, rate: number): Float32Array {
  const fftSize = Math.max(64, 2 ** Math.round(Math.log2((FFT_SIZE * rate) / SYNC_RATE)));
  const { env } = onsetEnvelope(pcm, rate, SYNC_FPS, fftSize, BANDS);
  env.fill(0, 0, Math.min(env.length, Math.ceil(((fftSize / 2) * SYNC_FPS) / rate) + 1));
  return env;
}

/** Where `other` lines up with `ref` (both mono PCM at `rate`). */
export function findLag(ref: Float32Array, other: Float32Array, rate: number, opts: SyncOptions = {}): SyncMatch {
  return matchEnvelopes(syncEnvelope(ref, rate), syncEnvelope(other, rate), SYNC_FPS, opts);
}

/** The lag between two envelopes at `fps`, as findLag. */
export function matchEnvelopes(a: Float32Array, b: Float32Array, fps: number, opts: SyncOptions = {}): SyncMatch {
  const n = a.length, m = b.length;
  const none = { lag: 0, confidence: 0, score: 0, runnerUp: 0 };
  if (!n || !m) return none;
  const x = centered(a), y = centered(b);
  // c[k] = sum_i x[i] y[i + k] for k in -(n-1)..m-1, all at once:
  // ifft(conj(X) Y), zero-padded so nothing wraps.
  let size = 1;
  while (size < n + m) size <<= 1;
  const xr = new Float64Array(size), xi = new Float64Array(size);
  const yr = new Float64Array(size), yi = new Float64Array(size);
  xr.set(x);
  yr.set(y);
  fft(xr, xi);
  fft(yr, yi);
  // conj(X) Y, conjugated again so the forward FFT inverts it.
  for (let i = 0; i < size; i++) {
    const r = xr[i] * yr[i] + xi[i] * yi[i];
    const im = xr[i] * yi[i] - xi[i] * yr[i];
    xr[i] = r;
    xi[i] = -im;
  }
  fft(xr, xi);
  const corr = (k: number) => xr[k < 0 ? size + k : k] / size;
  // Energy of each signal inside each lag's overlap, from prefix sums.
  const px = prefixSquares(x), py = prefixSquares(y);
  const shorter = Math.min(n, m);
  const minOv = Math.min(shorter, Math.max(1, Math.round((opts.minOverlap ?? 1) * fps)));
  const maxK = opts.maxLag === undefined ? Infinity : Math.round(opts.maxLag * fps);
  const lo = Math.max(-(n - 1), -maxK), hi = Math.min(m - 1, maxK);
  const score = new Float64Array(hi - lo + 1);
  for (let k = lo; k <= hi; k++) {
    // Overlap: i in [i0, i1) of x against i + k in y.
    const i0 = Math.max(0, -k), i1 = Math.min(n, m - k);
    const ov = i1 - i0;
    if (ov < minOv) continue;
    const ex = px[i1] - px[i0], ey = py[i1 + k] - py[i0 + k];
    if (!(ex > 0 && ey > 0)) continue;
    score[k - lo] = (corr(k) / Math.sqrt(ex * ey)) * Math.sqrt(ov / shorter);
  }
  let best = -1;
  for (let j = 0; j < score.length; j++) if (best < 0 || score[j] > score[best]) best = j;
  if (best < 0 || !(score[best] > 0)) return none;
  const gap = Math.round(RUNNER_GAP * fps);
  let runnerUp = 0;
  for (let j = 0; j < score.length; j++) if (Math.abs(j - best) > gap) runnerUp = Math.max(runnerUp, score[j]);
  // Parabola through the peak and its neighbors.
  const [p, q, r] = [score[best - 1] ?? 0, score[best], score[best + 1] ?? 0];
  const denom = p - 2 * q + r;
  const frac = best > 0 && best < score.length - 1 && denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (p - r)) / denom)) : 0;
  return { lag: (best + lo + frac) / fps, confidence: Math.max(0, Math.min(1, q) - runnerUp), score: Math.min(1, q), runnerUp };
}

function centered(v: Float32Array): Float64Array {
  let mean = 0;
  for (const s of v) mean += s / v.length;
  return Float64Array.from(v, (s) => s - mean);
}

function prefixSquares(v: Float64Array): Float64Array {
  const out = new Float64Array(v.length + 1);
  for (let i = 0; i < v.length; i++) out[i + 1] = out[i] + v[i] * v[i];
  return out;
}
