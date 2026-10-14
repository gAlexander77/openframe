// Integrated loudness per ITU-R BS.1770 / EBU R128, and the gain that
// brings a clip to a target. Streaming: feed decoded chunks to a
// LoudnessMeter, read `integrated()` at the end. Memory is one number per
// 100 ms, so an hour of audio costs 36k numbers.
//
// K-weighting coefficients are computed for any sample rate the way
// libebur128 does; at 48 kHz they match the standard's table.

/** Biquad coefficients [b0, b1, b2, a1, a2] (a0 = 1). */
export type Biquad = [number, number, number, number, number];

/** Stage 1 (head shelf, +4 dB) and stage 2 (RLB high-pass) at `rate` Hz. */
export function kWeighting(rate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / rate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / rate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, highpass];
}

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
const fromLufs = (lufs: number) => Math.pow(10, (lufs + 0.691) / 10);

export class LoudnessMeter {
  private readonly filters: [Biquad, Biquad];
  /** Per channel: transposed direct form II state, two per biquad. */
  private readonly z: Float64Array[];
  private readonly weights: number[];
  private readonly hop: number;
  private acc = 0;
  private n = 0;
  /** Channel-weighted mean square of each 100 ms step. */
  private readonly steps: number[] = [];
  /** Largest |sample| seen, 0..1+. */
  peak = 0;

  constructor(rate: number, channels: number) {
    this.filters = kWeighting(rate);
    this.z = Array.from({ length: channels }, () => new Float64Array(4));
    // A mono source plays on both speakers, so it counts twice (dual mono).
    // ponytail: surround is weighted 1 per channel; BS.1770's 1.41 for the
    // rear pair and LFE exclusion need the channel layout, add with 5.1.
    this.weights = channels === 1 ? [2] : Array(channels).fill(1);
    this.hop = Math.round(rate / 10);
  }

  /** Planar samples, `frames` long each, one array per channel. */
  push(planes: Float32Array[], frames: number) {
    const [s, h] = this.filters;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let ch = 0; ch < planes.length; ch++) {
        const x = planes[ch][i];
        const ax = Math.abs(x);
        if (ax > this.peak) this.peak = ax;
        const z = this.z[ch];
        const y1 = s[0] * x + z[0];
        z[0] = s[1] * x - s[3] * y1 + z[1];
        z[1] = s[2] * x - s[4] * y1;
        const y2 = h[0] * y1 + z[2];
        z[2] = h[1] * y1 - h[3] * y2 + z[3];
        z[3] = h[2] * y1 - h[4] * y2;
        sum += this.weights[ch] * y2 * y2;
      }
      this.acc += sum;
      if (++this.n === this.hop) {
        this.steps.push(this.acc / this.hop);
        this.acc = this.n = 0;
      }
    }
  }

  /** Gated integrated loudness in LUFS; -Infinity for silence. */
  integrated(): number {
    // 400 ms blocks overlapping by 75%: four consecutive 100 ms steps. A
    // clip shorter than one block is measured as a single short block.
    const st = this.steps;
    const blocks: number[] = [];
    if (st.length < 4) {
      if (st.length) blocks.push(st.reduce((a, b) => a + b, 0) / st.length);
    } else {
      for (let j = 0; j + 4 <= st.length; j++) blocks.push((st[j] + st[j + 1] + st[j + 2] + st[j + 3]) / 4);
    }
    const loud = blocks.filter((z) => z > fromLufs(ABSOLUTE_GATE));
    if (!loud.length) return -Infinity;
    const gate = fromLufs(toLufs(mean(loud)) + RELATIVE_GATE);
    return toLufs(mean(loud.filter((z) => z > gate)));
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface Normalization {
  /** Linear gain to set as the clip's volume. */
  gain: number;
  /** What held the gain below the target, if anything. */
  limitedBy: "peak" | "range" | null;
}

/**
 * The volume that brings `measured` LUFS to `target`, without pushing the
 * sample peak over `ceilingDb` and within the inspector's range.
 * ponytail: sample peak, not 4x-oversampled true peak; inter-sample peaks
 * can exceed the ceiling by a fraction of a dB. A true-peak limiter is the
 * upgrade for broadcast deliverables.
 */
export function normalizeGain(measured: number, target: number, peak: number, { ceilingDb = -1, minDb = -60, maxDb = 12 } = {}): Normalization {
  if (!Number.isFinite(measured)) return { gain: 1, limitedBy: null };
  let db = target - measured;
  let limitedBy: Normalization["limitedBy"] = null;
  if (peak > 0) {
    const room = ceilingDb - 20 * Math.log10(peak);
    if (db > room) [db, limitedBy] = [room, "peak"];
  }
  if (db > maxDb) [db, limitedBy] = [maxDb, "range"];
  if (db < minDb) [db, limitedBy] = [minDb, "range"];
  return { gain: Math.pow(10, db / 20), limitedBy };
}
