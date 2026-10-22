// Sample-level dynamics, imported directly by the bundled AudioWorklet.
import type { Deesser, EqBand, Gate, Limiter } from "./project/types";
export const dbGain = (db: number) => 10 ** (db / 20);
const coefficient = (seconds: number, rate: number) => Math.exp(-1 / Math.max(1, seconds * rate));
export type Biquad = [number, number, number, number, number];
/** RBJ biquads: Q is a ratio; shelves use slope 1, as Web Audio does. */
export function eqCoefficients(b: EqBand, rate: number): Biquad {
  const w = 2 * Math.PI * Math.min(b.freq, rate * 0.475) / rate, c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * b.q), a = 10 ** (b.gain / 40);
  let n: number[];
  switch (b.type) {
    case "peaking": n = [1 + alpha * a, -2 * c, 1 - alpha * a, 1 + alpha / a, -2 * c, 1 - alpha / a]; break;
    case "notch": n = [1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha]; break;
    case "highpass": n = [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha]; break;
    case "lowpass": n = [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha]; break;
    case "lowshelf": {
      const t = s * Math.sqrt(2 * a);
      n = [a * ((a + 1) - (a - 1) * c + t), 2 * a * ((a - 1) - (a + 1) * c), a * ((a + 1) - (a - 1) * c - t), (a + 1) + (a - 1) * c + t, -2 * ((a - 1) + (a + 1) * c), (a + 1) + (a - 1) * c - t]; break;
    }
    case "highshelf": {
      const t = s * Math.sqrt(2 * a);
      n = [a * ((a + 1) + (a - 1) * c + t), -2 * a * ((a - 1) + (a + 1) * c), a * ((a + 1) + (a - 1) * c - t), (a + 1) - (a - 1) * c + t, 2 * ((a - 1) - (a + 1) * c), (a + 1) - (a - 1) * c - t]; break;
    }
  }
  return [n[0] / n[3], n[1] / n[3], n[2] / n[3], n[4] / n[3], n[5] / n[3]];
}
export function eqResponse(bands: EqBand[], frequency: number, rate = 48000): number {
  const w = 2 * Math.PI * frequency / rate;
  return bands.filter(b => b.on).reduce((gain, b) => {
    const [b0, b1, b2, a1, a2] = eqCoefficients(b, rate);
    const mag = (x: number, y: number, z: number) => (x + y * Math.cos(w) + z * Math.cos(2 * w)) ** 2 + (y * Math.sin(w) + z * Math.sin(2 * w)) ** 2;
    return gain * Math.sqrt(mag(b0, b1, b2) / mag(1, a1, a2));
  }, 1);
}
export class GateEnvelope {
  envelope = 0;
  gain: number;
  open = false;
  private held = 0;
  private readonly floor: number;
  private readonly threshold: number;
  private readonly attack: number;
  private readonly release: number;
  private readonly followAttack: number;
  private readonly followRelease: number;
  constructor(readonly params: Gate, readonly rate: number) {
    this.floor = dbGain(-params.range); this.gain = params.ratio === 1 ? 1 : this.floor;
    this.followAttack = coefficient(0.0005, rate); this.followRelease = coefficient(0.01, rate);
    this.threshold = dbGain(params.threshold);
    this.attack = coefficient(params.attack, rate); this.release = coefficient(params.release, rate);
  }
  step(peak: number): number {
    const follow = peak > this.envelope ? this.followAttack : this.followRelease;
    this.envelope = peak + follow * (this.envelope - peak);
    if (this.envelope >= this.threshold) { this.open = true; this.held = Math.round(this.params.hold * this.rate); }
    else if (this.envelope < this.threshold * dbGain(-3)) {
      if (this.held > 0) this.held--; else this.open = false;
    }
    const target = this.open ? 1 : Math.max(this.floor, Math.min(1, (this.envelope / this.threshold) ** (this.params.ratio - 1)));
    const c = target > this.gain ? this.attack : this.release;
    this.gain = target + c * (this.gain - target);
    return this.gain;
  }
}
/** Stereo-linked detector; only the sibilance band is attenuated. */
export class DeesserProcessor {
  private z = [new Float64Array(2), new Float64Array(2)];
  private filter: Biquad;
  private envelope = 0;
  private gain = 1;
  private band = new Float64Array(2);
  private attack: number;
  private release: number;
  constructor(readonly params: Deesser, readonly rate: number) {
    this.attack = coefficient(0.001, rate); this.release = coefficient(0.05, rate);
    const center = Math.sqrt(params.low * params.high), q = center / (params.high - params.low);
    const w = 2 * Math.PI * Math.min(center, rate * 0.475) / rate, alpha = Math.sin(w) / (2 * q);
    this.filter = [alpha / (1 + alpha), 0, -alpha / (1 + alpha), -2 * Math.cos(w) / (1 + alpha), (1 - alpha) / (1 + alpha)];
  }
  process(input: Float32Array[], output: Float32Array[]) {
    const [b0, b1, b2, a1, a2] = this.filter;
    for (let n = 0; n < output[0].length; n++) {
      let peak = 0;
      const band = this.band;
      for (let ch = 0; ch < output.length; ch++) {
        const x = input[ch]?.[n] ?? 0, z = this.z[ch], y = b0 * x + z[0];
        z[0] = b1 * x - a1 * y + z[1]; z[1] = b2 * x - a2 * y;
        band[ch] = y; peak = Math.max(peak, Math.abs(y));
      }
      const c = peak > this.envelope ? this.attack : this.release;
      this.envelope = peak + c * (this.envelope - peak);
      const reduction = Math.min(this.params.amount, Math.max(0, 20 * Math.log10(this.envelope + 1e-15) + 36) * 0.75);
      const target = dbGain(-reduction), g = target < this.gain ? this.attack : this.release;
      this.gain = target + g * (this.gain - target);
      for (let ch = 0; ch < output.length; ch++) output[ch][n] = (input[ch]?.[n] ?? 0) + (this.gain - 1) * band[ch];
    }
  }
}
/** A 5 ms stereo-linked sliding peak maximum; no block-boundary resets. */
export class LookaheadLimiter {
  readonly latency: number;
  private ring: Float32Array[];
  private peaks: Float64Array;
  private indices: Float64Array;
  private head = 0;
  private tail = 0;
  private n = 0;
  private gain = 1;
  constructor(readonly params: Limiter, readonly rate: number) {
    this.latency = Math.ceil(rate * 0.005);
    this.ring = [new Float32Array(this.latency + 1), new Float32Array(this.latency + 1)];
    this.peaks = new Float64Array(this.latency + 2); this.indices = new Float64Array(this.latency + 2);
  }
  process(input: Float32Array[], output: Float32Array[]) {
    const size = this.peaks.length, delay = this.latency + 1, ceiling = dbGain(this.params.ceiling), release = coefficient(this.params.release, this.rate);
    for (let i = 0; i < output[0].length; i++, this.n++) {
      let peak = 0;
      for (let ch = 0; ch < output.length; ch++) {
        const x = input[ch]?.[i] ?? 0;
        this.ring[ch][this.n % delay] = x; peak = Math.max(peak, Math.abs(x));
      }
      while (this.tail > this.head && this.peaks[(this.tail - 1) % size] <= peak) this.tail--;
      this.peaks[this.tail % size] = peak; this.indices[this.tail++ % size] = this.n;
      while (this.tail > this.head && this.indices[this.head % size] < this.n - this.latency) this.head++;
      const target = Math.min(1, ceiling / Math.max(1e-15, this.peaks[this.head % size]));
      this.gain = target < this.gain ? target : target + release * (this.gain - target);
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = this.n < this.latency ? 0 : this.ring[ch][(this.n - this.latency) % delay] * this.gain;
    }
  }
}
