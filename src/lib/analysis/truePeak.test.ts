import { describe, expect, it } from "vitest";
import { LIMIT_BLOCK } from "./loudness";
import { toDbtp, truePeak, TruePeakMeter } from "./truePeak";

const RATE = 48000;

/** EBU Tech 3341's true-peak signals: a stereo sine at `fs / div` with
 * amplitude and phase as given, tapered over 10 ms at both ends. */
function sine(div: number, amp: number, phaseDeg: number, seconds = 1): Float32Array[] {
  const n = RATE * seconds;
  const taper = RATE / 100;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / taper, (n - 1 - i) / taper);
    x[i] = fade * amp * Math.sin((2 * Math.PI * i) / div + (phaseDeg * Math.PI) / 180);
  }
  return [x, x.slice()];
}

describe("true peak (BS.1770-4 Annex 2)", () => {
  // Tech 3341 table 1, signals 15-19: expected reading, +0.2/-0.4 dB.
  const cases: [string, number, number, number, number][] = [
    ["15: fs/4, 0.5 FFS, 0 deg", 4, 0.5, 0, -6.02],
    ["16: fs/4, 0.5 FFS, 45 deg", 4, 0.5, 45, -6.02],
    ["17: fs/6, 0.5 FFS, 60 deg", 6, 0.5, 60, -6.02],
    ["18: fs/8, 0.5 FFS, 67.5 deg", 8, 0.5, 67.5, -6.02],
    ["19: fs/4, 1.41 FFS, 45 deg", 4, 1.41, 45, 2.98],
  ];
  for (const [name, div, amp, phase, want] of cases) {
    it(`reads Tech 3341 signal ${name} within +0.2/-0.4 dB`, () => {
      const got = toDbtp(truePeak(sine(div, amp, phase)));
      expect(got).toBeGreaterThan(want - 0.4);
      expect(got).toBeLessThan(want + 0.2);
    });
  }

  it("finds the peak the samples miss: fs/4 at 45 degrees reads 3 dB over its sample peak", () => {
    const planes = sine(4, 0.5, 45);
    const sample = toDbtp(Math.max(...planes[0].map(Math.abs)));
    expect(sample).toBeCloseTo(-9.03, 1);
    expect(toDbtp(truePeak(planes)) - sample).toBeGreaterThan(2.6);
  });

  it("equals the sample peak for low frequencies", () => {
    const planes = sine(48, 0.8, 10); // 1 kHz
    expect(toDbtp(truePeak(planes))).toBeCloseTo(toDbtp(0.8), 1);
  });

  it("streams: pieces of any size give the whole signal's reading", () => {
    const [x] = sine(6, 0.7, 33);
    const m = new TruePeakMeter(1);
    for (let at = 0; at < x.length; at += 997) m.push([x.subarray(at, at + 997)], Math.min(997, x.length - at));
    m.flush();
    expect(m.peak).toBeCloseTo(truePeak([x]), 9);
  });

  it("puts each interpolated value in the limiter block of its own sample", () => {
    // One click at sample 1000: its ringing belongs to the blocks around it.
    const x = new Float32Array(4000);
    x[1000] = 1;
    const blocks = new Float32Array(Math.ceil(4000 / LIMIT_BLOCK) + 1);
    const m = new TruePeakMeter(1);
    m.push([x], x.length, blocks);
    m.flush(blocks);
    const hit = Math.floor(1000 / LIMIT_BLOCK);
    expect(blocks[hit]).toBeCloseTo(1, 6);
    expect(Math.max(...blocks.slice(0, hit - 1), ...blocks.slice(hit + 2))).toBe(0);
  });
});
