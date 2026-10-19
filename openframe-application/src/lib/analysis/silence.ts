// Silence detection for "Remove silences": the RMS level of short windows,
// compared with a threshold set relative to the clip's own noise floor, so
// a hissy phone recording and a clean studio take both work without a knob
// (docs/AI tools.md, research/AI and automation.md §2.3).
//
// Pure: mono PCM in, silent ranges in seconds out. The engine decodes the
// clip (src/engine/analyze.ts); the app turns ranges into one cut_ranges
// edit (src/state/ai.ts).
//
// ponytail: energy only. Music or traffic under a pause reads as "speech";
// a voice activity model (Silero VAD, see docs/AI tools.md) can replace
// step 1 of detectSilences without touching the range logic after it.

/** Seconds, [start, end). */
export interface Range {
  start: number;
  end: number;
}

export interface SilenceOptions {
  /** RMS window length, seconds. */
  window: number;
  /** A fixed threshold in dBFS. When absent the threshold is automatic:
   * noise floor + marginDb, clamped to [minDb, maxDb], plus biasDb. */
  thresholdDb?: number;
  /** How far above the measured noise floor the automatic threshold sits. */
  marginDb: number;
  /** Bounds for the automatic threshold, dBFS. The floor of digital silence
   * is -inf, and a clip that is all speech has a "floor" that is speech. */
  minDb: number;
  maxDb: number;
  /** Shifts the automatic threshold; the UI's sensitivity slider. */
  biasDb: number;
  /** Which percentile of window levels counts as the noise floor. */
  floorPercentile: number;
  /** Speech must drop this far below the threshold before a silence
   * starts, so a level hovering at the threshold does not chatter. */
  hysteresisDb: number;
  /** Shortest pause worth removing, seconds, measured before padding. */
  minSilence: number;
  /** Kept on each side of speech so words keep their breath and attack. */
  padding: number;
  /** Loud runs shorter than this (clicks, taps) do not split a silence. */
  minSpeech: number;
}

export const SILENCE_DEFAULTS: SilenceOptions = {
  window: 0.02,
  marginDb: 8,
  minDb: -50,
  maxDb: -30,
  biasDb: 0,
  floorPercentile: 10,
  hysteresisDb: 3,
  minSilence: 0.4,
  padding: 0.1,
  minSpeech: 0.1,
};

/** Quietest level we report; digital silence would otherwise be -Infinity. */
export const DB_FLOOR = -120;

export const toDb = (rms: number) => (rms > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(rms)) : DB_FLOOR);

/** RMS level of each `window`-second slice of `pcm`, in dBFS. The last
 * window may be shorter than the rest. */
export function levelsDb(pcm: Float32Array, rate: number, window: number): Float32Array {
  const size = Math.max(1, Math.round(window * rate));
  const n = Math.ceil(pcm.length / size);
  const out = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    const from = w * size;
    const to = Math.min(pcm.length, from + size);
    let sum = 0;
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    out[w] = toDb(Math.sqrt(sum / (to - from)));
  }
  return out;
}

/** The `p`th percentile (0..100) of the levels: the clip's noise floor. */
export function percentile(levels: ArrayLike<number>, p: number): number {
  if (!levels.length) return DB_FLOOR;
  const sorted = Float32Array.from(levels).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))];
}

export interface SilenceResult {
  /** Removable ranges, seconds from the start of the PCM, padding applied. */
  ranges: Range[];
  /** The threshold actually used, dBFS. */
  thresholdDb: number;
  /** The measured noise floor, dBFS. */
  floorDb: number;
}

/** Silent ranges from per-window levels. `duration` is the audio's length
 * in seconds (the last window may be partial). */
export function detectSilences(levels: Float32Array, window: number, duration: number, options: Partial<SilenceOptions> = {}): SilenceResult {
  const o = { ...SILENCE_DEFAULTS, ...options };
  const floorDb = percentile(levels, o.floorPercentile);
  const thresholdDb = o.thresholdDb ?? clamp(floorDb + o.marginDb, o.minDb, o.maxDb) + o.biasDb;

  // 1. Each window silent or not, with hysteresis: a silence starts below
  //    threshold - hysteresis and ends at the threshold.
  const silent = new Uint8Array(levels.length);
  let quiet = levels.length > 0 && levels[0] < thresholdDb;
  for (let i = 0; i < levels.length; i++) {
    if (quiet && levels[i] >= thresholdDb) quiet = false;
    else if (!quiet && levels[i] < thresholdDb - o.hysteresisDb) quiet = true;
    silent[i] = quiet ? 1 : 0;
  }

  // 2. Runs of windows -> ranges in seconds.
  const runs: { quiet: boolean; start: number; end: number }[] = [];
  for (let i = 0; i < levels.length; ) {
    let j = i;
    while (j < levels.length && silent[j] === silent[i]) j++;
    runs.push({ quiet: silent[i] === 1, start: i * window, end: Math.min(duration, j * window) });
    i = j;
  }

  // 3. A blip of sound too short to be speech joins the silence around it.
  for (const r of runs) if (!r.quiet && r.end - r.start < o.minSpeech - EPS) r.quiet = true;
  const merged: typeof runs = [];
  for (const r of runs) {
    const last = merged.at(-1);
    if (last && last.quiet === r.quiet) last.end = r.end;
    else merged.push({ ...r });
  }

  // 4. Long enough pauses, shrunk by the padding on each side that touches
  //    speech (the file's own start and end keep no padding).
  const ranges: Range[] = [];
  for (const r of merged) {
    if (!r.quiet || r.end - r.start < o.minSilence - EPS) continue;
    const start = r.start <= 0 ? 0 : r.start + o.padding;
    const end = r.end >= duration ? duration : r.end - o.padding;
    if (end - start > EPS) ranges.push({ start: round(start), end: round(end) });
  }
  return { ranges, thresholdDb, floorDb };
}

/** Convenience: silences straight from mono PCM. */
export function findSilences(pcm: Float32Array, rate: number, options: Partial<SilenceOptions> = {}): SilenceResult {
  const window = options.window ?? SILENCE_DEFAULTS.window;
  return detectSilences(levelsDb(pcm, rate, window), window, pcm.length / rate, options);
}

/** Total seconds the ranges cover. */
export const totalLength = (ranges: Range[]) => ranges.reduce((s, r) => s + (r.end - r.start), 0);

/** Window edges are multiples of a float; compare lengths with slack. */
const EPS = 1e-9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (s: number) => Math.round(s * 1e6) / 1e6;
