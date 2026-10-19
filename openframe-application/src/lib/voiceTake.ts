// Finishing a spoken take so it sits like a recorded read (ADR-084): its
// pauses set to the length the script asks for, takes joined without a
// click, a gentle EQ (low cut, a little presence), every line matched to
// one loudness, a very quiet room tone under the pauses instead of digital
// silence, and short fades at the edges. Pure sample math, so each step
// is tested; the voice model and the files are the caller's.

import { LoudnessMeter, normalizeGain, type Biquad } from "./analysis/loudness";
import { trimSpeech } from "./tts";

export type FinishId = "natural" | "clean" | "raw";

export interface Finish {
  /** Low cut at 80 Hz and +2 dB of presence around 3.5 kHz. */
  eq: boolean;
  /** Every take brought to this integrated loudness (LUFS), its peak held
   * under -1 dBFS; null leaves the level as the model made it. */
  loudness: number | null;
  /** Pink room tone under the whole take at this RMS (dBFS); null: none. */
  roomDb: number | null;
  /** The shortest pause the voice may make at a comma (or colon, dash)
   * and at a sentence's end inside a line, seconds; 0 leaves its own. */
  commaPause: number;
  sentencePause: number;
  /** A touch of short room reverb on the clip (set_reverb). */
  reverb: boolean;
}

/** natural: what a recorded read sounds like (the default); clean: one
 * level and no clicks, nothing added; raw: the model's read, trimmed. */
export const FINISHES: Record<FinishId, Finish> = {
  natural: { eq: true, loudness: -23, roomDb: -72, commaPause: 0.28, sentencePause: 0.55, reverb: true },
  clean: { eq: false, loudness: -23, roomDb: null, commaPause: 0, sentencePause: 0, reverb: false },
  raw: { eq: false, loudness: null, roomDb: null, commaPause: 0, sentencePause: 0, reverb: false },
};

/** The clip reverb natural puts on a voice: a small, dry room. */
export const NATURAL_REVERB = { size: 0.1, decay: 0.35, mix: 0.06 };

/** Kept before the first word and after the last, seconds: a breath's
 * lead-in and the word's own decay. */
export const TAKE_PRE = 0.06;
export const TAKE_POST = 0.2;
/** Raised-cosine fades at a take's edges and at every join, seconds. */
export const FADE_IN = 0.012;
export const FADE_OUT = 0.03;

// ---- filters ----------------------------------------------------------------------

/** RBJ cookbook high-pass, as [b0, b1, b2, a1, a2] with a0 = 1. */
export function highpass(f: number, rate: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * f) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
  return [(1 + cos) / 2 / a0, -(1 + cos) / a0, (1 + cos) / 2 / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

/** RBJ cookbook peaking EQ. */
export function peaking(f: number, rate: number, gainDb: number, q: number): Biquad {
  const A = Math.pow(10, gainDb / 40), w = (2 * Math.PI * f) / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha / A;
  return [(1 + alpha * A) / a0, (-2 * cos) / a0, (1 - alpha * A) / a0, (-2 * cos) / a0, (1 - alpha / A) / a0];
}

/** `x` through a biquad (transposed direct form II), as a new array. */
export function runBiquad(x: Float32Array, [b0, b1, b2, a1, a2]: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let z1 = 0, z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + z1;
    z1 = b1 * x[i] - a1 * v + z2;
    z2 = b2 * x[i] - a2 * v;
    y[i] = v;
  }
  return y;
}

/** The natural finish's EQ: a 12 dB/octave low cut at 80 Hz (rumble and
 * plosive thumps a microphone's own roll-off would take) and +2 dB around
 * 3.5 kHz, where consonants carry. */
export const voiceEq = (x: Float32Array, rate: number) => runBiquad(runBiquad(x, highpass(80, rate)), peaking(3500, rate, 2, 0.9));

// ---- levels, tone, fades -------------------------------------------------------------

/** Integrated loudness (LUFS) and sample peak of a mono take. */
export function measureTake(x: Float32Array, rate: number): { lufs: number; peak: number } {
  const m = new LoudnessMeter(rate, 1);
  m.push([x], x.length);
  return { lufs: m.integrated(), peak: m.peak };
}

/** The gain (dB) that brings a take to `target` LUFS, its peak held at
 * -1 dBFS. */
export function takeGainDb(x: Float32Array, rate: number, target: number): number {
  const { lufs, peak } = measureTake(x, rate);
  const g = normalizeGain(lufs, target, peak, { ceilingDb: -1, minDb: -24, maxDb: 24 }).gain;
  return 20 * Math.log10(g);
}

/** A seeded generator, so the same take gets the same room tone. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pink noise (Paul Kellet's filter) `n` samples long at `db` dBFS RMS:
 * the soft, low-heavy hiss of a quiet room rather than white noise's. */
export function roomTone(n: number, db: number, seed = 1): Float32Array {
  const rnd = random(seed), out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = b0 + b1 + b2 + w * 0.1848;
    sum += out[i] * out[i];
  }
  const k = n ? Math.pow(10, db / 20) / Math.sqrt(sum / n || 1) : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Raised-cosine fades over the first `inSec` and last `outSec`, in place. */
export function fadeEdges(x: Float32Array, rate: number, inSec = FADE_IN, outSec = FADE_OUT): Float32Array {
  const a = Math.min(x.length, Math.round(inSec * rate)), b = Math.min(x.length, Math.round(outSec * rate));
  for (let i = 0; i < a; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  for (let i = 0; i < b; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
  return x;
}

const concat = (parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// ---- pauses and joins ------------------------------------------------------------------

/**
 * Set the silent runs [start, end) (seconds, in order, not overlapping) to
 * new lengths: the run's first and last `edge` seconds (the decay of the
 * word before and the lead-in of the word after) are kept and its middle
 * is replaced by silence of the right length, or cut out. The rest of the
 * read, its intonation included, is untouched.
 */
export function resizePauses(x: Float32Array, rate: number, runs: { start: number; end: number; seconds: number }[], edge = 0.04): Float32Array {
  const parts: Float32Array[] = [];
  let from = 0;
  for (const r of runs) {
    const s = Math.round(r.start * rate), e = Math.round(r.end * rate);
    const want = Math.round(r.seconds * rate);
    const keep = Math.min(Math.round(edge * rate), Math.floor((e - s) / 2), Math.floor(want / 2));
    parts.push(fadeEdges(x.slice(from, s + keep), rate, 0, keep / rate / 2), new Float32Array(Math.max(0, want - 2 * keep)));
    from = e - keep;
    // The kept lead-in fades up from the silence.
    parts.push(fadeEdges(x.slice(from, e), rate, keep / rate / 2, 0));
    from = e;
  }
  parts.push(x.slice(from));
  return concat(parts);
}

/**
 * Join two takes with exactly `seconds` between the end of the first's
 * speech (`aLast`, seconds into `a`) and the start of the second's
 * (`bFirst`): silence fills the difference, or the quiet ends are cut
 * shorter (never into the speech). Each side fades at the join.
 */
export function joinTakes(a: Float32Array, aLast: number, b: Float32Array, bFirst: number, rate: number, seconds: number): Float32Array {
  const tailA = a.length / rate - aLast, headB = bFirst;
  let cutA = 0, cutB = 0;
  const over = tailA + headB - seconds;
  if (over > 0) {
    // Take the excess from both quiet ends in proportion, keeping 20 ms each.
    const room = Math.max(0, tailA - 0.02) + Math.max(0, headB - 0.02);
    const share = room > 0 ? Math.min(1, over / room) : 0;
    cutA = Math.max(0, tailA - 0.02) * share;
    cutB = Math.max(0, headB - 0.02) * share;
  }
  const left = fadeEdges(a.slice(0, a.length - Math.round(cutA * rate)), rate, 0, FADE_OUT);
  const right = fadeEdges(b.slice(Math.round(cutB * rate)), rate, FADE_IN, 0);
  const gap = Math.max(0, Math.round((seconds - (tailA - cutA) - (headB - cutB)) * rate));
  return concat([left, new Float32Array(gap), right]);
}

/**
 * The finish after the pauses are set: EQ, trim, one loudness, room tone,
 * fades. Returns the finished take and the gain it was given (dB).
 */
export function finishTake(x: Float32Array, rate: number, f: Finish, seed = 1): { audio: Float32Array; gainDb: number } {
  let y = f.eq ? voiceEq(x, rate) : x.slice();
  y = trimSpeech(y, rate, TAKE_PRE, TAKE_POST);
  let gainDb = 0;
  if (f.loudness !== null) {
    gainDb = takeGainDb(y, rate, f.loudness);
    const g = Math.pow(10, gainDb / 20);
    for (let i = 0; i < y.length; i++) y[i] *= g;
  }
  if (f.roomDb !== null) {
    const tone = roomTone(y.length, f.roomDb, seed);
    for (let i = 0; i < y.length; i++) y[i] += tone[i];
  }
  return { audio: fadeEdges(y, rate), gainDb: +gainDb.toFixed(2) };
}
