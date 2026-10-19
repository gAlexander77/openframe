import { describe, expect, it } from "vitest";
import type { SpeedPoint } from "./project/types";
import { CURVE_MAX, CURVE_MIN, PRESETS, areaTo, cleanPoints, frameForArea, meanSpeed, normalizeWindow, speedAt, toFrames } from "./speed";

const ramp: SpeedPoint[] = [
  { f: 0, speed: 1 },
  { f: 30, speed: 4 },
  { f: 45, speed: 0.25 },
  { f: 90, speed: 0.25 },
  { f: 120, speed: 2 },
];

/** Composite Simpson over speedAt: an independent check of the closed form. */
function numeric(pts: SpeedPoint[], x: number, n = 20000): number {
  if (x === 0) return 0;
  const h = x / n;
  let s = speedAt(pts, 0) + speedAt(pts, x);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * speedAt(pts, i * h);
  return (s * h) / 3;
}

describe("speed curve math", () => {
  it("a single point is a constant speed", () => {
    const c = [{ f: 10, speed: 2 }];
    expect(areaTo(c, 15)).toBeCloseTo(30, 12);
    expect(areaTo(c, -5)).toBeCloseTo(-10, 12);
    expect(frameForArea(c, 30)).toBeCloseTo(15, 12);
  });

  it("interpolates exponentially between points and holds beyond them", () => {
    expect(speedAt(ramp, 0)).toBe(1);
    expect(speedAt(ramp, 15)).toBeCloseTo(2, 12); // halfway from 1 to 4 on a log axis
    expect(speedAt(ramp, 60)).toBeCloseTo(0.25, 12);
    expect(speedAt(ramp, -50)).toBe(1);
    expect(speedAt(ramp, 500)).toBe(2);
  });

  it("the closed-form area matches numeric integration everywhere", () => {
    for (const x of [-20, 0.5, 7, 30, 37.3, 45, 60, 100, 119.9, 150]) {
      // Simpson is the approximate side here: kinks at the points cost it ~1e-8 relative.
      const want = x < 0 ? x : numeric(ramp, x);
      expect(Math.abs(areaTo(ramp, x) - want)).toBeLessThan(1e-7 * Math.max(1, Math.abs(want)));
    }
  });

  it("frameForArea inverts areaTo, including before and after the points", () => {
    for (const x of [-12.5, 0, 1e-7, 3, 29.99, 30, 44, 61.25, 119, 121, 300]) {
      expect(frameForArea(ramp, areaTo(ramp, x))).toBeCloseTo(x, 9);
    }
  });

  it("a flat segment between equal speeds is exact (no 0/0)", () => {
    const flat = [
      { f: 0, speed: 0.5 },
      { f: 10, speed: 0.5 },
    ];
    expect(areaTo(flat, 4)).toBeCloseTo(2, 12);
    expect(frameForArea(flat, 2)).toBeCloseTo(4, 12);
  });

  it("shifting the points by -d (a left trim) keeps the rest of the mapping", () => {
    const d = 17;
    const shifted = ramp.map((p) => ({ ...p, f: p.f - d }));
    for (const x of [0, 5, 40, 80]) {
      expect(areaTo(shifted, x)).toBeCloseTo(areaTo(ramp, x + d) - areaTo(ramp, d), 9);
    }
  });

  it("normalizing a window and placing it back is exact", () => {
    const len = 70;
    const back = toFrames(normalizeWindow(ramp, len), len);
    expect(back[0].f).toBe(0);
    expect(back[back.length - 1].f).toBe(len);
    for (const x of [0, 10, 33, 44.4, 69, 70]) expect(areaTo(back, x)).toBeCloseTo(areaTo(ramp, x), 9);
  });

  it("mean speed of a normalized curve is its area over [0, 1]", () => {
    expect(meanSpeed([{ t: 0, speed: 3 }, { t: 1, speed: 3 }])).toBeCloseTo(3, 12);
    // 1 -> 4 exponential: (4 - 1) / ln 4
    expect(meanSpeed([{ t: 0, speed: 1 }, { t: 1, speed: 4 }])).toBeCloseTo(3 / Math.log(4), 12);
  });

  it("cleanPoints sorts, drops junk, clamps and lets a later duplicate win", () => {
    const out = cleanPoints(
      [
        { f: 5, speed: 2 },
        { f: 1, speed: 50 },
        { f: Number.NaN, speed: 1 },
        { f: 3, speed: -1 },
        { f: 5, speed: 0.01 },
      ],
      (p) => p.f,
    );
    expect(out).toEqual([
      { f: 1, speed: CURVE_MAX },
      { f: 5, speed: CURVE_MIN },
    ]);
    expect(cleanPoints([], (p: SpeedPoint) => p.f)).toBeNull();
  });

  it("every preset spans the clip inside CapCut's 0.1x-10x range", () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const ts = preset.points.map((p) => p.t);
      expect(ts[0], name).toBe(0);
      expect(ts[ts.length - 1], name).toBe(1);
      expect([...ts].sort((a, b) => a - b), name).toEqual(ts);
      for (const p of preset.points) expect(p.speed >= CURVE_MIN && p.speed <= CURVE_MAX, name).toBe(true);
    }
    expect(meanSpeed(PRESETS.custom.points)).toBeCloseTo(1, 12);
  });
});
