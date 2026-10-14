// Beat detection for "Beat markers": spectral-flux onset strength, tempo by
// autocorrelation with a prior around 120 BPM, and Ellis's dynamic
// programming beat tracker (D. P. W. Ellis, "Beat Tracking by Dynamic
// Programming", J. New Music Research 36(1), 2007), as librosa's
// `beat_track` implements it. Our own code from the papers and librosa's
// documented behavior; no beat library (aubio is GPL, Essentia AGPL,
// madmom's models non-commercial: research/AI and automation.md §2.6).
//
// Pure: mono PCM in, beat times in seconds and a tempo out.
//
// ponytail: one global tempo per clip and no downbeats. Songs that change
// tempo get beats that drift between tempo changes; Beat This! (MIT, ONNX)
// is the upgrade for downbeats and tempo changes.

// ---- FFT ---------------------------------------------------------------------

/** In-place radix-2 complex FFT. `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

// ---- onset strength ------------------------------------------------------------

export interface OnsetEnvelope {
  /** Onset strength per frame, >= 0. */
  env: Float32Array;
  /** Frames per second. */
  fps: number;
  /** Seconds to add to frame i / fps to get the time of the onset it marks. */
  offset: number;
}

/** Band edges in Hz, evenly spaced on the mel scale: low frequencies get
 * as many bands as the crowded highs, like librosa's mel spectrogram. */
export function melEdges(bands: number, fMin: number, fMax: number): number[] {
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const [a, b] = [mel(fMin), mel(fMax)];
  return Array.from({ length: bands + 1 }, (_, i) => hz(a + ((b - a) * i) / bands));
}

/**
 * Spectral flux: frame the audio with a Hann window (centered frames, one
 * every 1/fps seconds), sum the magnitudes into mel-spaced bands, compress
 * with a log, and add up the increases from the previous frame. An attack
 * raises energy across the bands at once, so it stands out; a held note
 * does not. Mel bands keep a kick drum from being outvoted by the hundreds
 * of linear bins a hi-hat's noise spreads over.
 */
export function onsetEnvelope(pcm: Float32Array, rate: number, fps = 100, fftSize = 1024, bands = 64): OnsetEnvelope {
  const hop = rate / fps;
  const frames = Math.max(0, Math.floor(pcm.length / hop) + 1);
  const half = fftSize >> 1;
  const win = new Float64Array(fftSize);
  let winSum = 0;
  for (let i = 0; i < fftSize; i++) winSum += win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
  // Bin range of each band; a band narrower than a bin takes its nearest bin.
  const edges = melEdges(bands, 30, Math.min(11000, rate / 2));
  const binOf = (f: number) => (f * fftSize) / rate;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let b = 0; b < bands; b++) {
    let from = Math.ceil(binOf(edges[b]));
    let to = Math.ceil(binOf(edges[b + 1]));
    if (to <= from) [from, to] = [Math.round(binOf((edges[b] + edges[b + 1]) / 2)), 0];
    from = Math.min(half - 1, Math.max(1, from));
    lo.push(from);
    hi.push(Math.max(from + 1, Math.min(half, to)));
  }
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let prev = new Float64Array(bands);
  let cur = new Float64Array(bands);
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const center = Math.round(f * hop);
    for (let i = 0; i < fftSize; i++) {
      const s = center - half + i;
      re[i] = s >= 0 && s < pcm.length ? pcm[s] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let b = 0; b < bands; b++) {
      let sum = 0;
      for (let k = lo[b]; k < hi[b]; k++) sum += Math.hypot(re[k], im[k]);
      // Mean magnitude in amplitude units (a full-scale sine reads about
      // 1), then log compression so quiet attacks count too.
      cur[b] = Math.log1p((100 * 2 * sum) / (hi[b] - lo[b]) / winSum);
      if (f > 0 && cur[b] > prev[b]) flux += cur[b] - prev[b];
    }
    env[f] = flux / bands;
    [prev, cur] = [cur, prev];
  }
  // A centered window starts to see an attack before its center reaches
  // it, so the flux peaks early: by 8 ms on average with these settings,
  // measured on the click tracks in beats.test.ts (1024-point window at
  // 22.05 kHz, 100 fps).
  return { env, fps, offset: ONSET_LAG };
}

/** Seconds from a frame's center to the attack its flux peak marks. */
export const ONSET_LAG = 0.008;

// ---- tempo ---------------------------------------------------------------------

export interface TempoOptions {
  minBpm: number;
  maxBpm: number;
  /** Center of the log-normal tempo prior (librosa's start_bpm). */
  priorBpm: number;
  /** Width of the prior, octaves. */
  priorOctaves: number;
}

export const TEMPO_DEFAULTS: TempoOptions = { minBpm: 40, maxBpm: 240, priorBpm: 120, priorOctaves: 1 };

/** The beat period, from the autocorrelation of the onset envelope
 * weighted toward 120 BPM so the tracker prefers the tempo people tap over
 * its double or half. Sub-frame accurate by parabolic interpolation. */
export function estimateTempo(env: Float32Array, fps: number, options: Partial<TempoOptions> = {}): { bpm: number; period: number } {
  const o = { ...TEMPO_DEFAULTS, ...options };
  const n = env.length;
  // Smooth first (Gaussian, sigma 20 ms): onsets land on a frame grid, so a
  // period of 46.9 frames shows up as gaps of 46 and 47, which splits the
  // autocorrelation peak at the period but not at twice the period, and
  // the tempo would come out halved.
  const x = gaussianSmooth(env, 0.02 * fps);
  let mean = 0;
  for (const v of x) mean += v / n;
  for (let i = 0; i < n; i++) x[i] -= mean;
  const lo = Math.max(1, Math.floor((60 * fps) / o.maxBpm));
  const hi = Math.min(n - 2, Math.ceil((60 * fps) / o.minBpm));
  if (hi <= lo) return { bpm: 0, period: 0 };
  const acf = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    acf[lag] = s / (n - lag);
  }
  let best = lo;
  let bestScore = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / o.priorBpm) / o.priorOctaves) ** 2);
    const score = acf[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  const [a, b, c] = [acf[best - 1], acf[best], acf[best + 1]];
  const denom = a - 2 * b + c;
  const period = best + (denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0);
  return { bpm: (60 * fps) / period, period };
}

function gaussianSmooth(env: ArrayLike<number>, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const out = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) if (i + j >= 0 && i + j < env.length) s += env[i + j] * k[j + r];
    out[i] = s;
  }
  return out;
}

// ---- beat tracking ---------------------------------------------------------------

export interface BeatOptions extends TempoOptions {
  /** How strongly beats keep to the tempo (librosa's default 100). */
  tightness: number;
  /** Drop weak beats at the start and end (silence, fade-out). */
  trim: boolean;
}

export const BEAT_DEFAULTS: BeatOptions = { ...TEMPO_DEFAULTS, tightness: 100, trim: true };

/** Ellis's DP: the best chain of beats that both lands on strong onsets and
 * keeps the spacing close to `period`. Returns beat frames. */
export function trackBeats(env: Float32Array, period: number, tightness = 100, trim = true): number[] {
  const n = env.length;
  if (!n || !(period > 0)) return [];
  // Normalize, then smooth with a narrow Gaussian (sigma = period / 32).
  let mean = 0;
  for (const v of env) mean += v / n;
  let varSum = 0;
  for (const v of env) varSum += (v - mean) ** 2;
  const std = Math.sqrt(varSum / Math.max(1, n - 1));
  if (!(std > 0)) return [];
  const r = Math.round(period);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * (((i - r) * 32) / period) ** 2));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) if (i + k >= 0 && i + k < n) s += (env[i + k] / std) * kernel[k + r];
    local[i] = s;
  }
  let maxLocal = 0;
  for (const v of local) maxLocal = Math.max(maxLocal, v);

  // cum[i] = local[i] + best over predecessors j in [i - 2p, i - p/2] of
  // cum[j] - tightness * log((i - j) / p)^2.
  const dMin = Math.max(1, Math.round(period / 2));
  const dMax = Math.round(2 * period);
  const cost = new Float64Array(dMax + 1);
  for (let d = dMin; d <= dMax; d++) cost[d] = -tightness * Math.log(d / period) ** 2;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  let first = true;
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let from = -1;
    for (let d = dMin; d <= dMax; d++) {
      const j = i - d;
      const cand = (j >= 0 ? cum[j] : 0) + cost[d];
      if (cand > best) {
        best = cand;
        from = j;
      }
    }
    cum[i] = local[i] + best;
    // Nothing before the first real onset can be a beat.
    if (first && local[i] < 0.01 * maxLocal) back[i] = -1;
    else {
      back[i] = from;
      first = false;
    }
  }

  // The last beat: librosa takes the latest local maximum of cum that is at
  // least half the median local-maximum score. We then take the strongest
  // peak within one period before it, because two chains with the same
  // period (beats and off-beats) end within a period of each other, and the
  // later one is not the better one.
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? cum[i - 1] : -Infinity;
    const right = i + 1 < n ? cum[i + 1] : -Infinity;
    if (cum[i] > left && cum[i] >= right) peaks.push(i);
  }
  if (!peaks.length) return [];
  const sorted = peaks.map((i) => cum[i]).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let last = peaks[peaks.length - 1];
  for (let k = peaks.length - 1; k >= 0; k--) {
    if (2 * cum[peaks[k]] > median) {
      last = peaks[k];
      break;
    }
  }
  for (const i of peaks) if (i < last && i >= last - period && cum[i] > cum[last]) last = i;
  const beats: number[] = [];
  for (let b = last; b >= 0; b = back[b]) beats.push(b);
  beats.reverse();
  return trim ? trimWeak(beats, local) : beats;
}

/** Drop leading and trailing beats whose onset strength is below half the
 * RMS over all beats: count-ins, fade-outs, and the phantom beat the DP
 * places one period after the music stops. (librosa smooths the strengths
 * first, which lets that phantom through.) */
function trimWeak(beats: number[], local: Float64Array): number[] {
  if (beats.length < 3) return beats;
  const threshold = 0.5 * Math.sqrt(beats.reduce((a, b) => a + local[b] ** 2, 0) / beats.length);
  let a = 0;
  let b = beats.length;
  while (a < b && local[beats[a]] <= threshold) a++;
  while (b > a && local[beats[b - 1]] <= threshold) b--;
  return beats.slice(a, b);
}

// ---- all together ------------------------------------------------------------------

export interface BeatResult {
  /** Beat times, seconds from the start of the PCM. */
  beats: number[];
  /** Tempo from the tracked beats (least-squares slope), 0 when none. */
  bpm: number;
}

export function detectBeats(pcm: Float32Array, rate: number, options: Partial<BeatOptions> = {}): BeatResult {
  const o = { ...BEAT_DEFAULTS, ...options };
  const { env, fps, offset } = onsetEnvelope(pcm, rate);
  const { period } = estimateTempo(env, fps, o);
  const frames = trackBeats(env, period, o.tightness, o.trim);
  const beats = frames.map((f) => Math.max(0, Math.round((f / fps + offset) * 1e4) / 1e4));
  const bpm = beats.length < 2 ? 0 : tempoOf(beats, (60 * fps) / period);
  return { beats, bpm: Math.round(bpm * 10) / 10 };
}

/** Tempo of a beat list: 60 / the least-squares slope of time vs index,
 * which averages out each beat's frame quantization. */
export function tempoOf(beats: number[], fallback = 0): number {
  const n = beats.length;
  if (n < 4) return fallback;
  const mi = (n - 1) / 2;
  const mt = beats.reduce((a, t) => a + t, 0) / n;
  let num = 0;
  let den = 0;
  beats.forEach((t, i) => {
    num += (i - mi) * (t - mt);
    den += (i - mi) ** 2;
  });
  return num > 0 ? (60 * den) / num : fallback;
}
