import { expect, it } from "vitest";
import { autoAdjust, frameStats } from "./autoColor";

/** A gradient frame with a color cast: values lo..hi times (r, g, b). */
function frame(lo: number, hi: number, cast: [number, number, number]) {
  const px = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = lo + ((hi - lo) * i) / 255;
    px.set([v * cast[0] * 255, v * cast[1] * 255, v * cast[2] * 255, 255], i * 4);
  }
  return px;
}

it("measures channel means and luma percentiles", () => {
  const s = frameStats(frame(0, 1, [1, 1, 1]));
  expect(s.p1).toBeCloseTo(0.01, 1);
  expect(s.p50).toBeCloseTo(0.5, 1);
  expect(s.p99).toBeCloseTo(0.99, 1);
  // The neutral mean is of midtone-or-brighter, unclipped pixels: here
  // the gradient's 0.25..0.94 part.
  expect(s.r).toBeCloseTo(0.6, 1);
});

it("brightens a dark frame, warms a blue one, and leaves a good one alone", () => {
  const dark = autoAdjust(frameStats(frame(0.02, 0.4, [1, 1, 1])));
  expect(dark.exposure).toBeGreaterThan(10);
  const blue = autoAdjust(frameStats(frame(0.1, 0.9, [0.8, 1, 1.2])));
  expect(blue.temperature).toBeGreaterThan(10);
  const fine = autoAdjust(frameStats(frame(0, 1, [1, 1, 1])));
  for (const v of Object.values(fine)) expect(Math.abs(v)).toBeLessThan(12);
});

it("lifts a washed-out frame's black point and stretches its whites", () => {
  const flat = autoAdjust(frameStats(frame(0.25, 0.7, [1, 1, 1])));
  expect(flat.blacks).toBeGreaterThan(20);
  expect(flat.whites).toBeLessThan(-10);
});

it("balances on the neutral pixels and leaves a frame of saturated color alone", () => {
  // Pure green fills the frame: nothing neutral, so no tint is invented.
  const green = new Uint8ClampedArray(64 * 4);
  for (let i = 0; i < 64; i++) green.set([20, 200, 30, 255], i * 4);
  expect(autoAdjust(frameStats(green)).tint).toBe(0);
});

it("leaves a frame that is dark by design alone (a dark-theme app recording)", () => {
  // 97% cool dark gray, 2% red accents, 1% white text.
  const px = new Uint8ClampedArray(1000 * 4);
  for (let i = 0; i < 1000; i++) px.set(i < 970 ? [20, 22, 28, 255] : i < 990 ? [200, 30, 40, 255] : [250, 250, 250, 255], i * 4);
  const a = autoAdjust(frameStats(px));
  expect(a).toEqual({ exposure: 0, temperature: 0, tint: 0, blacks: 0, whites: 0 });
});
