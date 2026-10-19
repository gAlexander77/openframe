import { describe, expect, it } from "vitest";
import { CANDIDATES, followPath, saliencyMap, subjectBox, windowScores, type SaliencyMap } from "./subject";

const W = 128, H = 72;
const whole = { left: 0, top: 0, right: 1, bottom: 1 };

/** A W x H RGBA frame, each pixel from `at(u, v)` (fractions), 0..255. */
function frame(at: (u: number, v: number, x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) px.set([...at((x + 0.5) / W, (y + 0.5) / H, x, y), 255], (y * W + x) * 4);
  return px;
}

/** A little deterministic texture, like water or haze. */
const grain = (x: number, y: number) => ((x * 73 + y * 151) % 17) - 8;

/** The speedboat shot: sky, a green island across the middle and right,
 * teal sea with a texture, and a small white boat and wake left of center. */
const boatShot = (boatU: number) =>
  frame((u, v, x, y) => {
    if (v < 0.24) return [150 + grain(x, y) / 2, 190, 225];
    if (v < 0.32 && u > 0.31 && u < 0.84 && v > 0.32 - 0.08 * Math.sin(((u - 0.31) / 0.53) * Math.PI)) return [60 + grain(x, y), 110, 55];
    if (Math.abs(u - boatU) < 0.035 && Math.abs(v - 0.4) < 0.02) return [245, 248, 250];
    return [25 + grain(x, y), 95 + grain(y, x), 110];
  });

/** The Paris shot: a sunset sky, darker above, a dark rooftop band below,
 * and a thin dark tower right of center. */
const towerShot = () =>
  frame((u, v, x, y) => {
    if (v > 0.62) return [30 + grain(x, y) * 2, 32 + grain(y, x), 50];
    if (Math.abs(u - 0.67) < 0.012 + (v > 0.45 ? 0.02 * (v - 0.45) * 5 : 0) && v > 0.12) return [25, 15, 30];
    return [200 - 120 * (0.62 - v), 120 - 60 * (0.62 - v), 140 + 40 * (0.62 - v)];
  });

const best = (s: Float64Array) => {
  let a = 0;
  for (let i = 0; i < s.length; i++) if (s[i] > s[a]) a = i;
  return a / CANDIDATES;
};

describe("a picture's subject", () => {
  it("finds a small boat that a larger island would outweigh by area", () => {
    const map = saliencyMap(boatShot(0.36), W, H);
    // A 9:16 crop of a 16:9 picture keeps 0.316 of its width.
    const c = best(windowScores(map, "x", 0.316, whole));
    expect(Math.abs(c - 0.36)).toBeLessThan(0.1);
    const s = subjectBox(map)!;
    expect((s.left + s.right) / 2).toBeCloseTo(0.36, 1);
  });

  it("finds a thin tower against a sunset, right of center", () => {
    const map = saliencyMap(towerShot(), W, H);
    const c = best(windowScores(map, "x", 0.316, whole));
    // The tower is inside the window, clear of its edges.
    expect(c - 0.158 + 0.04).toBeLessThan(0.67);
    expect(c + 0.158 - 0.04).toBeGreaterThan(0.67);
  });

  it("keeps a window inside the room it is given", () => {
    const map = saliencyMap(towerShot(), W, H);
    const s = windowScores(map, "x", 0.316, { left: 0, top: 0, right: 0.6, bottom: 1 });
    const c = best(s);
    expect(c + 0.158).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(s[90]).toBe(-Infinity);
    // A room narrower than the window: only its middle.
    const narrow = windowScores(map, "x", 0.5, { left: 0.3, top: 0, right: 0.7, bottom: 1 });
    expect(narrow.filter(Number.isFinite)).toHaveLength(1);
    expect(best(narrow)).toBeCloseTo(0.5, 2);
  });

  it("follows a subject that moves, and holds still on one that does not", () => {
    const moving: SaliencyMap[] = [], still: SaliencyMap[] = [];
    for (let k = 0; k < 10; k++) {
      moving.push(saliencyMap(boatShot(0.2 + 0.05 * k), W, H));
      still.push(saliencyMap(boatShot(0.36 + (k % 2 ? 0.004 : -0.004)), W, H));
    }
    const path = followPath(moving.map((m) => windowScores(m, "x", 0.316, whole)));
    expect(path[0]).toBeLessThan(0.33);
    expect(path.at(-1)).toBeGreaterThan(0.55);
    expect(path.every((x, i) => i === 0 || x >= path[i - 1] - 0.01)).toBe(true);
    const held = followPath(still.map((m) => windowScores(m, "x", 0.316, whole)));
    expect(Math.max(...held) - Math.min(...held)).toBeLessThan(0.02);
  });

  it("is quick enough to look at a film: a 128 x 72 frame in a few milliseconds", () => {
    const px = boatShot(0.4);
    const t = performance.now();
    for (let i = 0; i < 10; i++) saliencyMap(px, W, H);
    expect((performance.now() - t) / 10).toBeLessThan(60);
  });
});
