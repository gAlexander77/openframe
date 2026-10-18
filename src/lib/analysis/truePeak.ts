// True peak per ITU-R BS.1770-4 Annex 2: the signal oversampled 4x and its
// largest absolute value read in dBTP, so the peaks between samples that a
// DAC or a lossy encoder reconstructs are counted too (a sample peak can
// read 3 dB under them at a quarter of the sample rate).
//
// The interpolation filter is designed here, the way libebur128 does it: a
// 49-tap Hann-windowed sinc split into four phases, phase 0 the samples
// themselves. The Annex's own 48-tap table is an example, not a
// requirement, and implementers report the generated filter meets EBU Tech
// 3341's true-peak tests (signals 15-23, +0.2/-0.4 dB) more closely.

import { LIMIT_BLOCK } from "./loudness";

/** Oversampling factor (BS.1770-4 asks for at least 4x at 48 kHz). */
export const TP_FACTOR = 4;
const TAPS = 49;
/** Input samples between a sample and the interpolated values it yields. */
export const TP_DELAY = (TAPS - 1) / 2 / TP_FACTOR;

/** phases[p][i] multiplies the input i samples back for output phase p. */
const PHASES: Float64Array[] = (() => {
  const out = Array.from({ length: TP_FACTOR }, () => [] as number[]);
  for (let j = 0; j < TAPS; j++) {
    const m = j - (TAPS - 1) / 2;
    const x = (Math.PI * m) / TP_FACTOR;
    let c = Math.abs(m) < 1e-9 ? 1 : Math.sin(x) / x;
    c *= 0.5 * (1 - Math.cos((2 * Math.PI * j) / (TAPS - 1)));
    out[j % TP_FACTOR][Math.floor(j / TP_FACTOR)] = Math.abs(c) < 1e-12 ? 0 : c;
  }
  return out.map((p) => Float64Array.from(p));
})();
const HIST = Math.ceil(TAPS / TP_FACTOR);

export class TruePeakMeter {
  /** Per channel: the last HIST samples, stored twice so a window of them
   * is always one contiguous run (no wrap inside the inner loop). */
  private readonly hist: Float64Array[];
  private pos = 0;
  /** Input samples pushed so far. */
  private count = 0;
  /** Largest absolute oversampled value, linear (0 for silence). */
  peak = 0;

  constructor(channels: number) {
    this.hist = Array.from({ length: channels }, () => new Float64Array(2 * HIST));
  }

  /**
   * Planar samples, `frames` long each. With `blocks`, each interpolated
   * value also raises the LIMIT_BLOCK it falls in (by the input sample it
   * sits after, counted from the first sample ever pushed), for the
   * export limiter.
   */
  push(planes: Float32Array[], frames: number, blocks?: Float32Array): void {
    const chans = Math.min(planes.length, this.hist.length);
    for (let i = 0; i < frames; i++) {
      // The oldest sample leaves, the new one enters at both copies.
      this.pos = (this.pos + HIST - 1) % HIST;
      let m = 0;
      for (let ch = 0; ch < chans; ch++) {
        const h = this.hist[ch];
        const x = planes[ch][i];
        h[this.pos] = x;
        h[this.pos + HIST] = x;
        for (let p = 0; p < TP_FACTOR; p++) {
          const c = PHASES[p];
          let y = 0;
          for (let k = 0; k < c.length; k++) y += c[k] * h[this.pos + k];
          const a = Math.abs(y);
          if (a > m) m = a;
        }
      }
      if (m > this.peak) this.peak = m;
      if (blocks) {
        const at = Math.max(0, this.count - TP_DELAY);
        const b = Math.min(blocks.length - 1, Math.floor(at / LIMIT_BLOCK));
        if (m > blocks[b]) blocks[b] = m;
      }
      this.count++;
    }
  }

  /** Push the filter's delay of silence, so the last samples' interpolated
   * values are counted. Call once, after the last push. */
  flush(blocks?: Float32Array): void {
    const z = new Float32Array(HIST);
    this.push(this.hist.map(() => z), HIST, blocks);
  }
}

/** True peak of whole planes, linear. */
export function truePeak(planes: Float32Array[]): number {
  const m = new TruePeakMeter(planes.length);
  m.push(planes, planes[0]?.length ?? 0);
  m.flush();
  return m.peak;
}

/** Linear level to dB (dBTP for a true peak); -Infinity for silence. */
export const toDbtp = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
