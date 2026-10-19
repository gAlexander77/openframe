import { describe, expect, it } from "vitest";
import { applyCurves, bakeCurves, cleanCurve, curveFn, isIdentityCurve, isIdentityCurves } from "./curves";

describe("curveFn", () => {
  it("passes through every point and is a straight line for two", () => {
    const s = curveFn([[0, 0], [0.25, 0.15], [0.75, 0.85], [1, 1]]);
    expect(s(0.25)).toBeCloseTo(0.15, 9);
    expect(s(0.75)).toBeCloseTo(0.85, 9);
    expect(s(0.5)).toBeCloseTo(0.5, 6);
    const line = curveFn([[0, 0.1], [1, 0.9]]);
    expect(line(0.5)).toBeCloseTo(0.5, 9);
  });

  it("never overshoots its points (the reason it is monotone)", () => {
    // A natural spline swings below 0.2 between these and above 0.8 after.
    const f = curveFn([[0, 0], [0.4, 0.2], [0.45, 0.8], [1, 1]]);
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x);
      if (x >= 0.4 && x <= 0.45) expect(y).toBeGreaterThanOrEqual(0.2 - 1e-9);
      if (x >= 0.45) expect(y).toBeGreaterThanOrEqual(0.8 - 1e-9);
      if (x <= 0.4) expect(y).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    // ...and stays monotone where the points are.
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.005) {
      expect(f(x)).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f(x);
    }
  });

  it("holds flat beyond the first and last points", () => {
    const f = curveFn([[0.2, 0.3], [0.8, 0.6]]);
    expect(f(0)).toBe(0.3);
    expect(f(1)).toBe(0.6);
  });
});

describe("cleanCurve", () => {
  it("clamps, sorts and merges repeated inputs; needs two points", () => {
    expect(cleanCurve([[1.2, 1], [0.5, -1], [0, 0], [0.5, 0.4]])).toEqual([[0, 0], [0.5, 0.4], [1, 1]]);
    expect(cleanCurve([[0, 0]])).toBeNull();
    expect(cleanCurve("nope")).toBeNull();
  });

  it("knows the identity", () => {
    expect(isIdentityCurve([[0, 0], [0.5, 0.5], [1, 1]])).toBe(true);
    expect(isIdentityCurve([[0.1, 0.1], [1, 1]])).toBe(false);
    expect(isIdentityCurves({ luma: [[0, 0], [1, 1]] })).toBe(true);
    expect(isIdentityCurves({ r: [[0, 0.1], [1, 1]] })).toBe(false);
  });
});

describe("bakeCurves / applyCurves", () => {
  it("bakes identity to the byte ramp", () => {
    const t = bakeCurves({});
    expect(t[0]).toBe(0);
    expect(t[128 * 4]).toBe(128);
    expect(t[255 * 4 + 3]).toBe(255);
  });

  it("applies luma to every channel, then each channel's own curve", () => {
    const t = bakeCurves({ luma: [[0, 0], [1, 0.5]], r: [[0, 1], [1, 1]] });
    const [r, g, b] = applyCurves(t, [0.2, 0.6, 1]);
    expect(r).toBe(1); // red curve pins every red to 1
    expect(g).toBeCloseTo(0.3, 2);
    expect(b).toBeCloseTo(0.5, 2);
  });
});
