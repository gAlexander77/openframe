import { describe, expect, it } from "vitest";
import { meterLevels } from "./mixer";
describe("post-fader meter math", () => {
  it("reports silence without NaN", () => expect(meterLevels(new Float32Array(4))).toEqual({ peak: -Infinity, rms: -Infinity }));
  it("distinguishes peak and RMS", () => {
    const m = meterLevels(new Float32Array([1, 0, -1, 0]));
    expect(m.peak).toBe(0); expect(m.rms).toBeCloseTo(-3.0103);
  });
});
