import { describe, expect, it } from "vitest";
import { varispeed, wsola, type PositionMap, type Retimer } from "./stretch";

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
      return (0.5 * t + (1.5 * t * t) / 4) * SR; // ∫ (0.5 + 0.75 t) dt
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
