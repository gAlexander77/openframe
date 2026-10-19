// Beat detection for "Beat markers": spectral-flux onset strength, tempo by
// autocorrelation with a prior around 120 BPM, and Ellis's dynamic
// programming beat tracker (D. P. W. Ellis, "Beat Tracking by Dynamic
// Programming", J. New Music Research 36(1), 2007), as librosa's
// `beat_track` implements it. Our own code from the papers and librosa's
// documented behavior; no beat library (aubio is GPL, Essentia AGPL,
// madmom's models non-commercial: research/AI and automation.md §2.6).
//
// Pure: mono PCM in, beat times in seconds and a tempo out. musicStructure
// (at the end) adds bars, phrases, sections and the drop on top.
//
// ponytail: one global tempo per clip, and downbeats from accents in 4/4
// only. Songs that change tempo get beats that drift between tempo
// changes; Beat This! (MIT, ONNX) is the upgrade for downbeats and tempo
// changes.

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

// ---- music structure (analyze_music) ---------------------------------------------
// Final Cut's beat grid is the model: song parts, bars, beats. The beats
// above are grouped into bars of four by where the accents fall (a louder
// onset, more bass, the sound changing), bars into phrases of four, and
// the song into sections where its sound changes for good (Foote's
// novelty idea, measured as the change between the two bars before a bar
// line and the two after it). Sections are named by loudness: what is
// within a few dB of the loudest part is a drop, a quiet part before one
// an intro or build, a quiet part after one a breakdown. The drop agents
// want is the biggest rise into a loud section.

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;

export type SectionLabel = "intro" | "verse" | "build" | "drop" | "breakdown" | "outro";

export interface MusicSection {
  /** Seconds. */
  start: number;
  end: number;
  label: SectionLabel;
  /** Mean loudness of its beats, 0..1: 1 is the loudest beat of the song,
   * 0 is 24 dB or more below it. */
  energy: number;
}

export interface MusicStructure {
  bpm: number;
  /** Seconds. */
  beats: number[];
  /** Each bar's first beat, seconds. */
  downbeats: number[];
  /** Every fourth bar line, starting where the sections change. */
  phrases: number[];
  /** Loudness of each beat, 0..1 as MusicSection.energy. */
  energy: number[];
  /** Strong onsets, on or off the beat (drum hits, stabs): cut points. */
  hits: number[];
  sections: MusicSection[];
  /** Start of the biggest rise (3 dB or more) into a loud section, or null. */
  drop: number | null;
  /** Every qualifying rise into a loud section, chronological seconds. */
  drops: number[];
}

/** dB the bars on each side of a bar line must differ by to start a section. */
export const SECTION_CHANGE_DB = 3;
/** Loudness span energy is measured over: 0 is this far below the loudest beat. */
const ENERGY_RANGE_DB = 24;

const round4 = (t: number) => Math.round(t * 1e4) / 1e4;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const mean = (xs: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return xs.length ? s / xs.length : 0;
};

/** RMS of pcm[a, b) seconds, dB re full scale. */
function rmsDb(pcm: Float32Array, rate: number, a: number, b: number): number {
  const from = Math.max(0, Math.floor(a * rate));
  const to = Math.min(pcm.length, Math.max(from + 1, Math.floor(b * rate)));
  let s = 0;
  for (let i = from; i < to; i++) s += pcm[i] * pcm[i];
  return 10 * Math.log10(s / Math.max(1, to - from) + 1e-12);
}

/** A meter of power in `bands` mel bands (40 Hz to 11 kHz) through one
 * Hann window of `fftSize` samples centered where it is asked. */
function bandMeter(pcm: Float32Array, rate: number, fftSize = 2048, bands = 12) {
  const half = fftSize >> 1;
  const win = Float64Array.from({ length: fftSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize));
  const edges = melEdges(bands, 40, Math.min(11000, rate / 2)).map((f) => Math.min(half, Math.max(1, Math.round((f * fftSize) / rate))));
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  return (seconds: number): number[] => {
    const center = Math.round(seconds * rate);
    for (let i = 0; i < fftSize; i++) {
      const k = center - half + i;
      re[i] = k >= 0 && k < pcm.length ? pcm[k] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    return Array.from({ length: bands }, (_, b) => {
      const lo = edges[b];
      const hi = Math.max(lo + 1, edges[b + 1]);
      let sum = 0;
      for (let k = lo; k < hi; k++) sum += re[k] * re[k] + im[k] * im[k];
      return sum / (hi - lo) / (fftSize * fftSize);
    });
  };
}

const toDb = (power: number) => 10 * Math.log10(power + 1e-12);

/** Strong onsets: peaks of the onset envelope two deviations above its
 * mean, at least 100 ms apart. */
function hitsOf(env: Float32Array, fps: number, offset: number): number[] {
  const m = mean(env);
  let v = 0;
  for (const x of env) v += (x - m) ** 2;
  const thr = m + 2 * Math.sqrt(v / Math.max(1, env.length));
  const gap = Math.round(0.1 * fps);
  const out: number[] = [];
  let last = -Infinity;
  for (let i = 0; i < env.length; i++) {
    if (env[i] < thr) continue;
    let peak = true;
    for (let j = Math.max(0, i - 5); j <= Math.min(env.length - 1, i + 5) && peak; j++) if (env[j] > env[i] || (env[j] === env[i] && j < i)) peak = false;
    if (!peak || i - last < gap) continue;
    out.push(round4(i / fps + offset));
    last = i;
  }
  return out;
}

/** RMS difference of two feature vectors, dB. */
const distance = (a: number[], b: number[]) => Math.sqrt(mean(a.map((x, i) => (x - b[i]) ** 2)));

/** Mean of feature rows [from, to). */
function meanRows(rows: number[][], from: number, to: number): number[] {
  const out = new Array(rows[0].length).fill(0);
  for (let i = from; i < to; i++) rows[i].forEach((v, k) => (out[k] += v / (to - from)));
  return out;
}

/**
 * The beat (0..3) bars start on: the phase whose beats are most accented,
 * by onset strength (a fifth stronger counts one point), bass (2 dB) and
 * how much the sound changes there (2 dB). Without a clear winner (a point
 * ahead of phase 0) the first beat starts the first bar: a steady loop's
 * beats differ only by rounding, and pure tones beat against each other in
 * patterns that repeat every few beats.
 */
function barPhase(accent: number[], bass: number[], change: number[]): number {
  const [ma, mb, mc] = [mean(accent), mean(bass), mean(change)];
  const at = (xs: number[], ph: number) => mean(xs.filter((_, i) => i % BEATS_PER_BAR === ph));
  const score = [0, 1, 2, 3].map((ph) => (at(accent, ph) / Math.max(1e-9, ma) - 1) / 0.2 + (at(bass, ph) - mb) / 2 + (at(change, ph) - mc) / 2);
  let best = 0;
  for (let ph = 1; ph < BEATS_PER_BAR; ph++) if (score[ph] > score[best]) best = ph;
  return score[best] - score[0] < 1 ? 0 : best;
}

/** Drop leading and trailing beats with next to no onset (the tracker's
 * own trim also drops a quiet intro's beats, which a song's parts need). */
function trimSilent(frames: number[], accent: (f: number) => number): number[] {
  if (frames.length < 3) return frames;
  const rms = Math.sqrt(mean(frames.map((f) => accent(f) ** 2)));
  let a = 0;
  let b = frames.length;
  while (a < b && accent(frames[a]) < 0.1 * rms) a++;
  while (b > a && accent(frames[b - 1]) < 0.1 * rms) b--;
  return frames.slice(a, b);
}

/** The music's beat grid and parts, from mono PCM; times are seconds from
 * the PCM's start. */
export function musicStructure(pcm: Float32Array, rate: number, options: Partial<TempoOptions & { tightness: number }> = {}): MusicStructure {
  const o = { ...BEAT_DEFAULTS, ...options };
  const duration = pcm.length / rate;
  const { env, fps, offset } = onsetEnvelope(pcm, rate);
  const { period } = estimateTempo(env, fps, o);
  const peakNear = (f: number) => {
    let m = 0;
    for (let j = Math.max(0, f - 3); j <= Math.min(env.length - 1, f + 3); j++) m = Math.max(m, env[j]);
    return m;
  };
  const frames = trimSilent(trackBeats(env, period, o.tightness, false), peakNear);
  const beats = frames.map((f) => Math.max(0, round4(f / fps + offset)));
  const n = beats.length;
  const hits = hitsOf(env, fps, offset);
  const bpm = n < 2 ? 0 : Math.round(tempoOf(beats, (60 * fps) / period) * 10) / 10;
  if (n < 2 * BEATS_PER_BAR) {
    return { bpm, beats, downbeats: beats.slice(0, 1), phrases: beats.slice(0, 1), energy: beats.map(() => 1), hits, sections: [{ start: 0, end: round4(duration), label: "verse", energy: 1 }], drop: null, drops: [] };
  }
  const beatLen = 60 / bpm;
  const ends = beats.map((t, i) => (i + 1 < n ? beats[i + 1] : Math.min(duration, t + beatLen)));
  const db = beats.map((t, i) => rmsDb(pcm, rate, t, ends[i]));
  const top = Math.max(...db);
  const energy = db.map((d) => Math.round(clamp01((d - (top - ENERGY_RANGE_DB)) / ENERGY_RANGE_DB) * 100) / 100);

  // Per beat: the spectral shape over the beat plus its loudness, the
  // power of windows half a window apart across the beat (not a frame
  // grid, nor a few spots: either misses a hat between them in some beats
  // and not others, and that pattern repeats every few beats, which reads
  // as accents). A window starting on the beat gives its bass.
  const meter = bandMeter(pcm, rate);
  const span = 2048 / rate;
  const power = beats.map((t, i) => {
    // Windows inside the beat: one reaching past its end would hear the
    // next beat's attack, and a part's first beat would leak into its last.
    const [a, b] = [t + span / 2, Math.max(t + span / 2, ends[i] - span / 2)];
    const k = Math.max(2, Math.ceil((b - a) / (span / 2)) + 1);
    const ws = Array.from({ length: k }, (_, j) => meter(a + ((b - a) * j) / (k - 1)));
    return [...ws[0].map((_, band) => mean(ws.map((w) => w[band]))), 10 ** (db[i] / 10)];
  });
  // Levels compare in dB, averaged as power and floored 60 dB under the
  // loudest, so a band that is silent somewhere (the cut-off last beat's
  // hat) moves a mean by what it lost, not by a hundred dB.
  const floor = Math.max(...power.flat().map(toDb)) - 60;
  const dbOf = (v: number[]) => v.map((x) => Math.max(floor, toDb(x)));
  const feat = power.map(dbOf);

  // Bars: accents (onset strength at the beat, bass at it, the sound changing).
  const accent = frames.map(peakNear);
  const bass = beats.map((t) => {
    const w = meter(t + span / 2);
    return toDb(w[0] + w[1]);
  });
  const change = feat.map((x, i) => (i ? distance(x, feat[i - 1]) : 0));
  // Novelty: how much the two bars after a beat differ from the two before.
  const w = 2 * BEATS_PER_BAR;
  const nov = beats.map((_, i) => (i < w || i > n - w ? 0 : distance(dbOf(meanRows(power, i, i + w)), dbOf(meanRows(power, i - w, i)))));
  const novelty = (i: number) => nov[i];
  // A song changes part on a bar line, which beats accents as a cue: the
  // peaks of novelty vote for the phase; accents decide only without them.
  const votes = [0, 0, 0, 0];
  nov.forEach((v, i) => {
    if (v >= SECTION_CHANGE_DB && nov.slice(Math.max(0, i - 2), i + 3).every((u) => u <= v)) votes[i % BEATS_PER_BAR] += v;
  });
  const voted = votes.indexOf(Math.max(...votes));
  const phase = votes[voted] > 0 ? voted : barPhase(accent, bass, change);
  const barStarts: number[] = [];
  for (let i = phase; i < n; i += BEATS_PER_BAR) barStarts.push(i);

  // Sections: bar lines where the two bars on either side differ most.
  // A two-bar average can peak a bar early during a build. Locate the
  // boundary with adjacent bars, retaining the longer window as evidence.
  const localNovelty = (i: number) => i < BEATS_PER_BAR || i + BEATS_PER_BAR > n ? 0
    : distance(dbOf(meanRows(power, i, i + BEATS_PER_BAR)), dbOf(meanRows(power, i - BEATS_PER_BAR, i)));
  const candidates = barStarts.map((i) => ({ i, nov: localNovelty(i) }))
    .filter((c) => c.nov >= SECTION_CHANGE_DB && novelty(c.i) >= SECTION_CHANGE_DB);
  const cuts: number[] = [];
  for (const c of [...candidates].sort((a, b) => b.nov - a.nov)) {
    if (cuts.every((j) => Math.abs(j - c.i) >= 2 * BEATS_PER_BAR)) cuts.push(c.i);
  }
  cuts.sort((a, b) => a - b);

  // Phrases start where the sections change (or else on the first bar).
  const phraseVotes = [0, 0, 0, 0];
  const barOf = (i: number) => (i - phase) / BEATS_PER_BAR;
  for (const i of cuts) phraseVotes[barOf(i) % BARS_PER_PHRASE] += novelty(i);
  let pp = 0;
  for (let k = 1; k < BARS_PER_PHRASE; k++) if (phraseVotes[k] > phraseVotes[pp]) pp = k;
  const phrases = barStarts.filter((i) => barOf(i) % BARS_PER_PHRASE === pp).map((i) => beats[i]);

  // A quieter timbral variation can matter on a phrase line even without
  // a large level jump. Require both scales to change, away from strong cuts.
  for (const i of barStarts) {
    if (barOf(i) % BARS_PER_PHRASE === pp && novelty(i) >= SECTION_CHANGE_DB / 3
      && localNovelty(i) >= 2 && cuts.every(j => Math.abs(j - i) >= w)) cuts.push(i);
  }
  cuts.sort((a, b) => a - b);

  // Name the sections by loudness.
  const bounds = [0, ...cuts, n];
  const parts = bounds.slice(0, -1).map((a, k) => {
    const b = bounds[k + 1];
    const e = mean(energy.slice(a, b));
    const head = mean(db.slice(a, Math.min(b, a + w)));
    const tail = mean(db.slice(Math.max(a, b - w), b));
    return { a, b, e, rising: tail - head >= SECTION_CHANGE_DB };
  });
  const loudest = Math.max(...parts.map((s) => s.e));
  const high = parts.map((s) => s.e >= loudest - 0.15);
  const label = (k: number): SectionLabel => {
    if (parts.length === 1) return "verse";
    if (high[k]) return "drop";
    const beforeDrop = k + 1 < parts.length && high[k + 1];
    if (beforeDrop && parts[k].rising) return "build";
    if (k === 0) return "intro";
    if (k === parts.length - 1 && parts[k].e < parts[k - 1].e) return "outro";
    if (high[k - 1]) return "breakdown";
    return beforeDrop ? "build" : "verse";
  };
  const sections: MusicSection[] = parts.map((s, k) => ({
    start: k === 0 ? 0 : beats[s.a],
    end: k === parts.length - 1 ? round4(duration) : beats[s.b],
    label: label(k),
    energy: Math.round(s.e * 100) / 100,
  }));

  // The drop: the biggest rise across a cut into a loud section.
  const drops: number[] = [];
  let drop: number | null = null;
  let rise = SECTION_CHANGE_DB;
  cuts.forEach((i, k) => {
    if (sections[k + 1].label !== "drop") return;
    const r = mean(db.slice(i, i + w)) - mean(db.slice(Math.max(0, i - w), i));
    if (r >= SECTION_CHANGE_DB) drops.push(beats[i]);
    if (r >= rise) [drop, rise] = [beats[i], r];
  });
  return { bpm, beats, downbeats: barStarts.map((i) => beats[i]), phrases, energy, hits, sections, drop, drops };
}
