import { describe, expect, it } from "vitest";
import { createColorClip } from "./project/defaults";
import type { VisualClip } from "./project/types";
import { DEFAULT_PERSPECTIVE, resolveTilt, tiltMatrix, type Quad } from "./tilt";

const W = 1920, H = 1080;
/** Where layer point (a, b) lands on the canvas, in pixels. */
function land(m: number[], a: number, b: number) {
  const x = m[0] * a + m[3] * b + m[6], y = m[1] * a + m[4] * b + m[7], w = m[2] * a + m[5] * b + m[8];
  return [((x / w + 1) / 2) * W, ((1 - y / w) / 2) * H, w];
}
const quad: Quad = { cx: 960, cy: 540, sx: 960, sy: 540, shiftX: 0, shiftY: 0, rotation: 0 };

describe("tiltMatrix", () => {
  it("is the flat placement when nothing tilts", () => {
    const m = tiltMatrix({ ...quad, cx: 1200, rotation: 30 }, { x: 0, y: 0, distance: 2000 }, W, H);
    const [x, y, w] = land(m, 0.5, 0.5);
    expect([x, y, w].map((v) => +v.toFixed(6))).toEqual([1200, 540, 1]);
    // The top-left corner, turned 30 degrees about the center.
    const c = land(m, 0, 0);
    const r = Math.PI / 6;
    expect(c[0]).toBeCloseTo(1200 + Math.cos(r) * -480 - Math.sin(r) * -270, 6);
    expect(c[1]).toBeCloseTo(540 + Math.sin(r) * -480 + Math.cos(r) * -270, 6);
  });

  it("turns the right side away for a positive y tilt", () => {
    const m = tiltMatrix(quad, { x: 0, y: 30, distance: 2000 }, W, H);
    const left = [land(m, 0, 0), land(m, 0, 1)], right = [land(m, 1, 0), land(m, 1, 1)];
    const height = (e: number[][]) => e[1][1] - e[0][1];
    expect(height(right)).toBeLessThan(height(left));
    // The far side shrinks and pulls in; the near side grows toward the camera.
    expect(height(right)).toBeLessThan(540);
    expect(height(left)).toBeGreaterThan(540);
    expect(right[0][0]).toBeLessThan(960 + 480 * Math.cos(Math.PI / 6));
    // The center stays put; nothing falls behind the camera.
    expect(land(m, 0.5, 0.5).slice(0, 2).map((v) => +v.toFixed(6))).toEqual([960, 540]);
    for (const p of [...left, ...right]) expect(p[2]).toBeGreaterThan(0);
  });

  it("tips the top away for a positive x tilt", () => {
    const m = tiltMatrix(quad, { x: 25, y: 0, distance: 1500 }, W, H);
    const top = land(m, 1, 0)[0] - land(m, 0, 0)[0], bottom = land(m, 1, 1)[0] - land(m, 0, 1)[0];
    expect(top).toBeLessThan(bottom);
  });

  it("is less strong from farther away", () => {
    const skew = (d: number) => {
      const m = tiltMatrix(quad, { x: 0, y: 30, distance: d }, W, H);
      return (land(m, 0, 1)[1] - land(m, 0, 0)[1]) / (land(m, 1, 1)[1] - land(m, 1, 0)[1]);
    };
    expect(skew(1000)).toBeGreaterThan(skew(4000));
    expect(skew(1e7)).toBeCloseTo(1, 3);
  });
});

describe("resolveTilt", () => {
  const clip = (t: Record<string, number>, keyframes?: VisualClip["keyframes"]) => {
    const c = createColorClip("#fff", 0, 30) as VisualClip;
    return { ...c, transform: { ...c.transform, ...t }, ...(keyframes ? { keyframes } : {}) } as VisualClip;
  };
  it("is nothing for a flat picture, and keys like any transform value", () => {
    expect(resolveTilt(clip({}), 0)).toBeUndefined();
    expect(resolveTilt(clip({ rotateY: 20 }), 0)).toEqual({ x: 0, y: 20, distance: DEFAULT_PERSPECTIVE });
    expect(resolveTilt(clip({}, { "transform.rotateX": [{ f: 0, v: 0 }, { f: 10, v: 40 }] }), 5)).toEqual({ x: 20, y: 0, distance: DEFAULT_PERSPECTIVE });
    expect(resolveTilt(clip({ rotateY: 120, perspective: 900 }), 0)).toEqual({ x: 0, y: 89, distance: 900 });
  });
});
