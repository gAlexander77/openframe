// Audio retiming for speed changes, ramps and reverse (ADR-028). Pure DSP
// on Float32Array channels, so preview and export play the same samples and
// the tests can listen to them.
//
// Both retimers follow a position map: output sample n (absolute, at the
// output rate) plays the input around pos(n) (absolute input samples at the
// same rate, increasing). The caller hands in whatever slice of the input
// covers inputSpan(); calls must cover contiguous output ranges.
//
// - varispeed: reads the input at pos(n), like tape; pitch follows speed
//   (CapCut's "Change pitch" on).
// - wsola: Waveform Similarity Overlap-Add. 40 ms Hann grains every 20 ms,
//   each taken from where pos() says, nudged up to ±10 ms to the offset
//   whose waveform best continues the previous grain. Grains play at the
//   original rate, so the pitch stays put while the timing follows pos().
//   In slow motion a centered grain reads input that belongs later than its
//   own output, so sounds arrive early, by up to half a grain times
//   (1/speed - 1): 90 ms at 0.1x, measured. Capping each grain at its 3/4
//   point instead, where the Hann window falls to half weight, puts a new
//   sound at half weight exactly on time: within ±9 ms from 0.1x to 3x.

export interface Retimer {
  /** Input positions [lo, hi) that render(n0, n0 + len) may read. */
  inputSpan(n0: number, n1: number): [number, number];
  /** Fill `out` with output samples [n0, n0 + out[0].length). `input[c][i]`
   * is input position `inStart + i`; reads outside it are silence. */
  render(input: Float32Array[], inStart: number, n0: number, out: Float32Array[]): void;
}

export type PositionMap = (n: number) => number;

const at = (x: Float32Array, i: number) => (i >= 0 && i < x.length ? x[i] : 0);

/** Tape-style: the pitch rises and falls with the rate. Cubic (Catmull-Rom)
 * interpolation.
 * ponytail: no anti-alias filter, so above ~3x the top octave folds back
 * (as Web Audio's playbackRate does). Upgrade: a polyphase low-pass. */
export function varispeed(pos: PositionMap): Retimer {
  return {
    inputSpan: (n0, n1) => [Math.floor(pos(n0)) - 2, Math.ceil(pos(n1)) + 3],
    render(input, inStart, n0, out) {
      const len = out[0].length;
      for (let i = 0; i < len; i++) {
        const p = pos(n0 + i) - inStart;
        const k = Math.floor(p);
        const t = p - k;
        for (let c = 0; c < out.length; c++) {
          const x = input[Math.min(c, input.length - 1)];
          const y0 = at(x, k - 1), y1 = at(x, k), y2 = at(x, k + 1), y3 = at(x, k + 2);
          out[c][i] = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
        }
      }
    },
  };
}

const sample = (x: Float32Array, p: number) => {
  if (Number.isInteger(p)) return at(x, p);
  const k = Math.floor(p), t = p - k;
  const a = at(x, k - 1), b = at(x, k), c = at(x, k + 1), d = at(x, k + 2);
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
};

export interface WsolaOptions {
  /** Grain length in seconds (default 0.04). */
  grain?: number;
  /** How far a grain may move to match the waveform (default 0.01 s). */
  tolerance?: number;
  /** Source samples per grain sample; independent of the position map. */
  rate?: PositionMap;
}

/** WSOLA: native pitch by default; rate resamples the grains for a shift. */
export function wsola(pos: PositionMap, sampleRate: number, opts: WsolaOptions = {}): Retimer {
  const H = Math.max(16, Math.round(((opts.grain ?? 0.04) * sampleRate) / 2));
  const N = 2 * H;
  const tol = Math.max(1, Math.round((opts.tolerance ?? 0.01) * sampleRate));
  const win = new Float32Array(N);
  for (let j = 0; j < N; j++) win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N); // periodic Hann: halves sum to 1
  /** Latest input start for the grain at output n: its 3/4 point (output
   * n + 3H/2) may read no later than pos() says for that instant. */
  const Q = Math.round(1.5 * H);
  const rateAt = opts.rate ?? (() => 1);
  const latest = (n: number) => pos(n + Q) - Q * rateAt(n);
  /** Ideal input start of the grain laid at output n: centered on its
   * output, capped by latest(). */
  const ideal = (n: number) => Math.round(Math.min(pos(n + H) - H * rateAt(n), latest(n)));

  let next: number | null = null; // output start of the next grain
  let tailStart = 0;
  let tail: Float32Array[] = [];
  let prevRate = 1;
  let prev: number | null = null; // input start of the previous grain

  /** Offset in [-tol, up] whose first H samples best continue `natural`. */
  function search(mono: Float32Array, base: number, natural: number, up: number, rate: number): number {
    const power = (from: number, len: number) => {
      let e = 0;
      for (let j = 0; j < len; j += 4) e += sample(mono, from + rate * j) ** 2;
      return (4 * e) / len;
    };
    const before = power(natural, H);
    // Nothing to continue (silence): stay exactly on time. Otherwise every
    // offset ties at 0 and the first one tried would win, which delayed
    // each sound after a pause by the full tolerance.
    if (before < 1e-10) return 0;
    // A sound starting in this grain (power up 6 dB): matching the previous
    // grain would steer away from it and make it late, so lay it on time.
    if (power(base, N) > 4 * before) return 0;
    const score = (d: number, step: number) => {
      let xy = 0;
      let yy = 1e-9;
      for (let j = 0; j < H; j += step) {
        const y = sample(mono, base + d + rate * j);
        xy += sample(mono, natural + prevRate * j) * y;
        yy += y * y;
      }
      return xy / Math.sqrt(yy);
    };
    let best = 0;
    let bestScore = -Infinity;
    // Nearest offsets first, so a tie keeps the grain closest to on time.
    for (let k = 0; k <= tol; k += 2) {
      for (const d of k ? (k <= up ? [k, -k] : [-k]) : [0]) {
        const s = score(d, 4);
        if (s > bestScore) [bestScore, best] = [s, d];
      }
    }
    const coarse = best;
    bestScore = -Infinity;
    for (let d = Math.max(-tol, coarse - 2); d <= Math.min(up, coarse + 2); d++) {
      const s = score(d, 1);
      if (s > bestScore) [bestScore, best] = [s, d];
    }
    return best;
  }

  return {
    inputSpan: (n0, n1) => {
      if (!opts.rate) return [ideal(n0 - N) - tol - N, ideal(n1 + N) + tol + 2 * N];
      const margin = Math.ceil(N * Math.max(1, rateAt(n0 - N), rateAt(n1 + N)) * 3);
      return [Math.floor(ideal(n0 - N) - tol - margin), Math.ceil(ideal(n1 + N) + tol + margin)];
    },
    render(input, inStart, n0, out) {
      const C = out.length;
      const len = out[0].length;
      const n1 = n0 + len;
      if (next === null || n0 !== tailStart) {
        // First call, or a jump: start fresh so n0 gets two full grains.
        next = n0 - H;
        tailStart = n0 - H;
        tail = Array.from({ length: C }, () => new Float32Array(0));
        prev = null;
      }
      const buf = Array.from({ length: C }, (_, c) => {
        const b = new Float32Array(n1 + N - tailStart);
        b.set(tail[c]);
        return b;
      });
      // Similarity is judged on the channels' sum, and every channel takes
      // the same offset, so the stereo image never smears.
      const mono = new Float32Array(input[0].length);
      for (const ch of input) for (let i = 0; i < mono.length; i++) mono[i] += ch[i];
      while (next < n1) {
        const rate = rateAt(next);
        let start = ideal(next);
        // Searching later is allowed only as far as the no-read-ahead limit.
        const up = Math.min(tol, Math.max(0, Math.floor(latest(next) - start)));
        if (prev !== null) start += search(mono, start - inStart, prev + prevRate * H - inStart, up, rate);
        const o = next - tailStart;
        const s = start - inStart;
        for (let c = 0; c < C; c++) {
          const x = input[Math.min(c, input.length - 1)];
          const b = buf[c];
          for (let j = 0; j < N; j++) b[o + j] += win[j] * (rate === 1 ? at(x, s + j) : sample(x, s + rate * j));
        }
        prev = start;
        prevRate = rate;
        next += H;
      }
      for (let c = 0; c < C; c++) {
        out[c].set(buf[c].subarray(n0 - tailStart, n1 - tailStart));
        tail[c] = buf[c].slice(n1 - tailStart);
      }
      tailStart = n1;
    },
  };
}


/** Resample each grain by the pitch ratio and WSOLA its placement against
 * the original time map, in one retiming pass. Its length is always the
 * caller's output length. Tape mode adds the map's local speed to pitch.
 * ponytail: cubic resampling can fold the highest octave on upward shifts;
 * a polyphase low-pass is the upgrade, as for varispeed. */
export function pitchShift(pos: PositionMap, sampleRate: number, semitones: number, tape = false): Retimer {
  const ratio = 2 ** (Math.max(-12, Math.min(12, semitones)) / 12);
  return wsola(pos, sampleRate, { rate: (n) => ratio * (tape ? Math.max(0.001, (pos(n + 16) - pos(n - 16)) / 32) : 1) });
}
