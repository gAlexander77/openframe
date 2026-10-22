import { describe, expect, it } from "vitest";
import { blurPlan, blurSigma, BLUR_MAX, glowSigma, simulate1d, usesGlowPyramid, usesPyramid } from "./blur";

/** An impulse at `at` in a row of n, blurred; its spread as a sigma. */
function spread(sigma: number, at = 2048.3, n = 4096) {
  const row = new Float64Array(n);
  // A point between texels, split linearly, so its own mean is `at`.
  const i = Math.floor(at);
  row[i] = 1 - (at - i);
  row[i + 1] = at - i;
  const out = simulate1d(row, sigma);
  let m0 = 0, m1 = 0, m2 = 0;
  out.forEach((v, x) => {
    m0 += v;
    m1 += v * x;
  });
  const mean = m1 / m0;
  out.forEach((v, x) => (m2 += v * (x - mean) ** 2));
  // Less the split point's own spread.
  const own = (at - i) * (1 - (at - i));
  return { sigma: Math.sqrt(m2 / m0 - own), mean, mass: m0, out };
}

describe("blurPlan", () => {
  it("spreads a tiny highlight without separate peaks at glow radius 48", () => {
    const row = new Float64Array(513);
    row[256] = 1;
    // Simulate the selected GPU path; the old seven-tap path had copies
    // at every 16 pixels, with completely dark gaps between them.
    const radius = 48;
    const result = usesGlowPyramid(radius) ? simulate1d(row, glowSigma(radius)) : row.map((_, x) => {
      let sum = 0;
      for (let i = -3; i <= 3; i++) sum += row[x + i * radius / 3] ?? 0;
      return sum / 7;
    });
    for (let x = 258; x < 304; x++) {
      expect(result[x]).toBeGreaterThan(0);
      expect(result[x]).toBeLessThanOrEqual(result[x - 1] + 1e-9);
    }
    expect(usesGlowPyramid(18)).toBe(false);
  });
  it("halves until the Gaussian is 3 to 6 texels wide, taps under a texel apart", () => {
    expect(blurPlan(3).levels).toBe(0);
    expect(blurPlan(5.9).levels).toBe(0);
    expect(blurPlan(6).levels).toBe(1);
    expect(blurPlan(150).levels).toBe(5);
    for (const s of [1, 5.9, 6, 20, 33, 64, 150, 300]) {
      const p = blurPlan(s);
      if (p.levels) expect(s / 2 ** p.levels).toBeGreaterThanOrEqual(3);
      expect(s / 2 ** p.levels).toBeLessThan(6);
      expect(p.step).toBeLessThan(1.15);
    }
  });

  it("keeps the old mapping: radius 0.6 px per unit, twice sigma; 500 is 300 px", () => {
    expect(blurSigma(100)).toBeCloseTo(30, 9);
    expect(blurSigma(BLUR_MAX) * 2).toBeCloseTo(300, 9);
    expect(usesPyramid(100)).toBe(false);
    expect(usesPyramid(100.5)).toBe(true);
  });
});

describe("the pyramid blur", () => {
  it("draws the sigma asked for, from 2 to 300 pixels", () => {
    for (const s of [2, 5, 5.9, 6.1, 12, 30, 60, 100, 150, 300]) {
      const r = spread(s);
      expect(r.sigma / s, `sigma ${s}`).toBeGreaterThan(0.97);
      expect(r.sigma / s, `sigma ${s}`).toBeLessThan(1.03);
      // Nothing gained or lost, and the light stays where it was.
      expect(r.mass).toBeCloseTo(1, 4);
      expect(Math.abs(r.mean - 2048.3)).toBeLessThan(0.01);
    }
  });

  it("grows smoothly across a change of level: under two 8-bit steps", () => {
    // White bars from a hairline to a wide edge, blurred just under and just
    // over each place the plan halves once more.
    const bar = (w: number) => new Float64Array(4096).map((_, i) => (i >= 2048 && i < 2048 + w ? 1 : 0));
    for (const s of [6, 12, 24, 96]) {
      for (const w of [1, 4, 16, 1000]) {
        const a = simulate1d(bar(w), s - 0.05), b = simulate1d(bar(w), s + 0.05);
        let worst = 0;
        a.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - b[i]))));
        expect(worst * 255, `sigma ${s}, bar ${w}`).toBeLessThan(2);
      }
    }
  });

  it("falls off like a Gaussian, with no hard edge", () => {
    // A 300-pixel blur (sigma 150) of a step: the edge spreads over
    // hundreds of pixels and every step down is small.
    const n = 4096, row = new Float64Array(n).map((_, i) => (i < 2048 ? 1 : 0));
    const out = simulate1d(row, 150);
    expect(out[2048 - 150]).toBeGreaterThan(0.8);
    expect(out[2048 - 150]).toBeLessThan(0.87); // 1 - Phi(-1) = 0.841
    expect(out[2048 + 150]).toBeGreaterThan(0.13);
    expect(out[2048 + 150]).toBeLessThan(0.2);
    let jump = 0;
    for (let i = 1600; i < 2500; i++) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
    expect(jump).toBeLessThan(0.004); // 1/255 is 0.0039: no visible step
  });

  it("keeps a small point's glow where the point is, wherever it falls on the grid", () => {
    // A box halving would snap these to the 32-pixel grid of a 150 blur.
    for (const at of [2048, 2049, 2050.5, 2051.25, 2063, 2077.6]) {
      const r = spread(150, at);
      expect(Math.abs(r.mean - at), `at ${at}`).toBeLessThan(0.01);
      expect(Math.abs(r.sigma - 150), `at ${at}`).toBeLessThan(3);
    }
  });

  it("smooths a point without combing it into taps", () => {
    for (const s of [3, 5, 6.5, 40]) {
      const out = spread(s, 2048).out;
      // One peak: values rise to it and fall from it, never back up.
      const peak = out.indexOf(Math.max(...out));
      for (let i = peak + 1; i < peak + 4 * s; i++) expect(out[i], `sigma ${s}`).toBeLessThanOrEqual(out[i - 1] + 1e-12);
    }
  });
});
