import { describe, expect, it } from "vitest";
import { createColorClip } from "./project/defaults";
import type { Clip } from "./project/types";
import { cleanWiggle, noise, wiggleAt } from "./wiggle";

const withWiggle = (wiggle: object, keyframes?: Clip["keyframes"]) => ({ ...createColorClip("#fff", 0, 300), wiggle, ...(keyframes ? { keyframes } : {}) }) as Clip;

describe("noise", () => {
  it("stays in -1..1, centered, and reaches near the ceiling", () => {
    let most = 0, sum = 0, n = 0;
    for (let seed = 1; seed <= 20; seed++)
      for (let i = 0; i < 2000; i++) {
        const v = noise(i * 0.0371, seed);
        most = Math.max(most, Math.abs(v));
        sum += v;
        n++;
      }
    expect(most).toBeLessThanOrEqual(1);
    expect(most).toBeGreaterThan(0.95);
    expect(Math.abs(sum / n)).toBeLessThan(0.02);
  });

  it("is smooth: neighboring instants differ a little", () => {
    for (let i = 0; i < 500; i++) expect(Math.abs(noise(i * 0.01 + 0.001, 3) - noise(i * 0.01, 3))).toBeLessThan(0.02);
  });

  it("is the same for a seed and different for another", () => {
    expect(noise(1.234, 7)).toBe(noise(1.234, 7));
    expect(noise(1.234, 7)).not.toBe(noise(1.234, 8));
  });
});

describe("wiggleAt", () => {
  const clip = withWiggle({ x: { frequency: 3, amplitude: 0.02, seed: 5 }, y: { frequency: 3, amplitude: 0.02, seed: 5 } });

  it("adds nothing to a value with no wiggle", () => {
    expect(wiggleAt(clip, "rotation", 10, 30)).toBe(0);
    expect(wiggleAt(createColorClip("#fff", 0, 30), "x", 10, 30)).toBe(0);
  });

  it("stays within the amplitude and moves", () => {
    const xs = Array.from({ length: 300 }, (_, f) => wiggleAt(clip, "x", f, 30));
    expect(Math.max(...xs.map(Math.abs))).toBeLessThanOrEqual(0.02);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.01);
  });

  it("moves x and y apart with one seed", () => {
    const same = Array.from({ length: 60 }, (_, f) => wiggleAt(clip, "x", f, 30) === wiggleAt(clip, "y", f, 30));
    expect(same.filter(Boolean).length).toBeLessThan(3);
  });

  it("scales by strength, and reads keyed strength and amplitude", () => {
    const half = withWiggle({ x: { frequency: 3, amplitude: 0.02, seed: 5, strength: 0.5 } });
    expect(wiggleAt(half, "x", 17, 30)).toBeCloseTo(wiggleAt(clip, "x", 17, 30) / 2, 12);
    const ramp = withWiggle({ x: { frequency: 3, amplitude: 0.02, seed: 5 } }, { "wiggle.x.strength": [{ f: 0, v: 0 }, { f: 30, v: 1 }] });
    expect(wiggleAt(ramp, "x", 0, 30)).toBe(0);
    expect(wiggleAt(ramp, "x", 45, 30)).toBeCloseTo(wiggleAt(clip, "x", 45, 30), 12);
    const amp = withWiggle({ x: { frequency: 3, amplitude: 0.02, seed: 5 } }, { "wiggle.x.amplitude": [{ f: 0, v: 0.04 }] });
    expect(wiggleAt(amp, "x", 12, 30)).toBeCloseTo(2 * wiggleAt(clip, "x", 12, 30), 12);
  });

  it("is continuous between frames (motion blur samples between them)", () => {
    const a = wiggleAt(clip, "x", 10, 30), b = wiggleAt(clip, "x", 10.25, 30), c = wiggleAt(clip, "x", 10.5, 30);
    expect(Math.abs(b - a)).toBeLessThan(0.005);
    expect(Math.abs(c - b)).toBeLessThan(0.005);
  });
});

describe("cleanWiggle", () => {
  it("keeps valid targets, clamps the frequency, drops the rest", () => {
    expect(cleanWiggle({ x: { frequency: 500, amplitude: 0.01, seed: 2.4 }, y: { frequency: "a" }, z: { frequency: 1, amplitude: 1 } })).toEqual({ x: { frequency: 60, amplitude: 0.01, seed: 2 } });
    expect(cleanWiggle({ rotation: { frequency: 2, amplitude: 1, seed: 1, strength: 0.5 } })).toEqual({ rotation: { frequency: 2, amplitude: 1, seed: 1, strength: 0.5 } });
    expect(cleanWiggle({})).toBeUndefined();
    expect(cleanWiggle(null)).toBeUndefined();
  });
});
