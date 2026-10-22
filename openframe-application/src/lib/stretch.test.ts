import { describe, expect, it } from "vitest";
import { pitchShift, varispeed, wsola, type PositionMap, type Retimer } from "./stretch";

const SR = 48000;

function sine(freq: number, seconds: number, amp = 0.5): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

/** Render [n0, n1) in blocks of `block`, giving each call only the input it asks for. */
function run(r: Retimer, input: Float32Array[], n0: number, n1: number, block = 4096): Float32Array[] {
  const out = input.map(() => new Float32Array(n1 - n0));
  for (let n = n0; n < n1; n += block) {
    const len = Math.min(block, n1 - n);
    const [lo, hi] = r.inputSpan(n, n + len);
    const a = Math.max(0, lo);
    const slice = input.map((x) => x.slice(a, Math.max(a, Math.min(x.length, hi))));
    const part = input.map(() => new Float32Array(len));
    r.render(slice, a, n, part);
    part.forEach((p, c) => out[c].set(p, n - n0));
  }
  return out;
}

/** Frequency from positive-going zero crossings (linear interpolated). */
function frequency(x: Float32Array, from = 0, to = x.length): number {
  const ups: number[] = [];
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return ((ups.length - 1) * SR) / (ups[ups.length - 1] - ups[0]);
}

function rmsWindows(x: Float32Array, win = 960): number[] {
  const out: number[] = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += x[j] * x[j];
    out.push(Math.sqrt(s / win));
  }
  return out;
}

const constant = (speed: number): PositionMap => (n) => n * speed;

describe("varispeed", () => {
  it("2x doubles the pitch and halves the length", () => {
    const y = run(varispeed(constant(2)), [sine(440, 2)], 0, SR)[0];
    expect(frequency(y, 1000, SR - 1000)).toBeCloseTo(880, 0);
  });

  it("reads exactly the input at 1x", () => {
    const x = sine(1234, 0.5);
    const y = run(varispeed(constant(1)), [x], 0, x.length)[0];
    for (let i = 0; i < x.length; i += 997) expect(y[i]).toBeCloseTo(x[i], 6);
  });
});

describe("wsola", () => {
  it("1x passes the input through unchanged", () => {
    const x = sine(440, 1);
    const y = run(wsola(constant(1), SR), [x], 0, x.length)[0];
    let err = 0;
    for (let i = 2000; i < x.length - 4000; i++) err = Math.max(err, Math.abs(y[i] - x[i]));
    expect(err).toBeLessThan(1e-5);
  });

  for (const speed of [0.25, 0.5, 2, 3]) {
    it(`${speed}x keeps a 440 Hz tone at 440 Hz with steady loudness`, () => {
      const seconds = 1.5;
      const x = sine(440, Math.max(seconds * speed, 0.1) + 0.2);
      const y = run(wsola(constant(speed), SR), [x], 0, seconds * SR)[0];
      expect(Math.abs(frequency(y, 4000, y.length - 4000) - 440)).toBeLessThan(2);
      const r = rmsWindows(y.subarray(4000, y.length - 4000));
      expect(Math.min(...r)).toBeGreaterThan(0.85 * Math.max(...r));
    });
  }

  it("keeps events in time: a click at input t lands at output t / speed", () => {
    const x = new Float32Array(3 * SR);
    for (let i = 0; i < x.length; i++) x[i] = 0.05 * Math.sin((2 * Math.PI * 300 * i) / SR);
    for (const t of [0.5, 1.5, 2.5]) for (let i = 0; i < 480; i++) x[Math.round(t * SR) + i] = 0.9 * Math.sin((2 * Math.PI * 2000 * i) / SR);
    const speed = 0.5;
    const y = run(wsola(constant(speed), SR), [x], 0, 6 * SR)[0];
    for (const t of [0.5, 1.5, 2.5]) {
      const want = Math.round((t / speed) * SR);
      let onset = -1;
      for (let i = want - 2400; i < want + 2400; i++) if (Math.abs(y[i]) > 0.4) { onset = i; break; }
      // Within 20 ms: under a frame, and inside EBU R37's +40/-60 ms. A
      // short click over a quiet bed is WSOLA's hardest case (measured
      // worst: 16 ms late at 0.5x).
      expect(Math.abs(onset - want) / SR).toBeLessThan(0.02);
    }
  });

  it("a sound after silence starts on time at every speed CapCut allows", () => {
    // Centered grains made this 90 ms early at 0.1x; a search that broke
    // ties toward its first candidate made it 10 ms late at 0.5x.
    const x = new Float32Array(Math.round(1.2 * SR));
    const B = Math.round(0.7 * SR);
    for (let i = 0; i < 4800; i++) x[B + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / SR);
    for (const speed of [0.1, 0.2, 0.25, 0.5, 1.5, 2, 3]) {
      const want = 0.7 / speed;
      const y = run(wsola(constant(speed), SR), [x], 0, Math.round((want + 0.2) * SR))[0];
      let onset = -1;
      for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > 0.25) { onset = i; break; }
      expect(Math.abs(onset / SR - want), `${speed}x`).toBeLessThan(0.01);
    }
  });

  it("follows a ramp: the position map decides where every grain comes from", () => {
    // Speed ramps from 0.5x to 2x over 2 s of output; the tone stays put.
    const pos: PositionMap = (n) => {
      const t = n / SR;
      return (0.5 * t + (1.5 * t * t) / 4) * SR; // âˆ« (0.5 + 0.75 t) dt
    };
    const x = sine(660, 4);
    const y = run(wsola(pos, SR), [x], 0, 2 * SR)[0];
    for (const [a, b] of [[0.1, 0.6], [0.7, 1.2], [1.3, 1.9]]) {
      expect(Math.abs(frequency(y, a * SR, b * SR) - 660)).toBeLessThan(3);
    }
  });

  it("block size does not change the result (streaming is exact)", () => {
    const x = [sine(330, 2), sine(495, 2, 0.3)];
    const whole = run(wsola(constant(0.7), SR), x, 1000, SR + 1000, 1 << 20);
    const blocks = run(wsola(constant(0.7), SR), x, 1000, SR + 1000, 3001);
    for (let c = 0; c < 2; c++) for (let i = 0; i < whole[c].length; i += 13) expect(blocks[c][i]).toBeCloseTo(whole[c][i], 6);
  });

  it("runs far faster than real time (stereo, 48 kHz)", () => {
    const x = [sine(440, 12), sine(550, 12)];
    const t0 = performance.now();
    run(wsola(constant(1.5), SR), x, 0, 8 * SR, 24000);
    const seconds = (performance.now() - t0) / 1000;
    // Typically ~40x on a desktop; the bound only catches a pathological slowdown.
    expect(8 / seconds).toBeGreaterThan(5);
  });
});

/** First strong autocorrelation peak, interpolated to fractional lag. */
function correlatedPitch(x: Float32Array): number {
  const start = 5000, length = 4000;
  const score = (lag: number) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = start; i < start + length; i++) { const a = x[i], b = x[i + lag]; xy += a * b; xx += a * a; yy += b * b; }
    return xy / Math.sqrt(xx * yy);
  };
  let best = 0;
  let before = score(24), now = score(25);
  for (let lag = 25; lag < 600; lag++) {
    const after = score(lag + 1);
    if (now > 0.85 && now > before && now >= after) { best = lag; break; }
    before = now; now = after;
  }
  if (!best) return NaN;
  const a = score(best - 1), b = score(best), c = score(best + 1);
  return SR / (best + 0.5 * (a - c) / (a - 2 * b + c));
}

describe("independent pitch shift", () => {
  for (const [speed, semitones] of [[1, 12], [1, -12], [2, 5], [0.5, -5]]) {
    it(`${semitones} semitones at ${speed}x keeps the time map and joins blocks`, () => {
      const input = sine(440, 2.2);
      const y = run(pitchShift(constant(speed), SR, semitones), [input], 0, 2 * SR / speed, 24000)[0];
      expect(y.length / SR).toBeCloseTo(2 / speed, 8);
      const expected = 440 * 2 ** (semitones / 12);
      expect(Math.abs(correlatedPitch(y) - expected)).toBeLessThan(3);
      let own = 0, join = 0;
      for (let i = 4000; i < y.length - 4000; i++) if (i % 24000 > 8 && i % 24000 < 23992) own = Math.max(own, Math.abs(y[i] - y[i - 1]));
      for (let i = 24000; i < y.length - 4000; i += 24000) join = Math.max(join, Math.abs(y[i] - y[i - 1]));
      expect(join).toBeLessThanOrEqual(own * 1.01);
      const alternate = run(pitchShift(constant(speed), SR, semitones), [input], 0, y.length, 3001)[0];
      for (let i = 4000; i < y.length - 4000; i += 997) expect(alternate[i]).toBeCloseTo(y[i], 6);
    });
  }
  it("composes pitch with a speed ramp and with tape pitch", () => {
    const pos = (n: number) => n * 0.5 + n * n / (4 * SR);
    const y = run(pitchShift(pos, SR, 7), [sine(440, 4)], 0, 2 * SR)[0];
    expect(correlatedPitch(y)).toBeCloseTo(440 * 2 ** (7 / 12), 0);
    const tape = run(pitchShift(constant(2), SR, 5, true), [sine(440, 3)], 0, SR)[0];
    expect(correlatedPitch(tape)).toBeCloseTo(880 * 2 ** (5 / 12), 0);
  });
});

it("autocorrelation detects the fundamental rather than accepting a subharmonic", () => {
  expect(correlatedPitch(sine(440, 1))).toBeCloseTo(440, 0);
  expect(correlatedPitch(sine(220, 1))).toBeCloseTo(220, 0);
  expect(correlatedPitch(sine(880, 1))).toBeCloseTo(880, 0);
});
