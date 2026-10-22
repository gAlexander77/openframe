import { describe, expect, it } from "vitest";
import { cleanMaskPoints, flattenPath, maskPathData, pathBounds, pathContains, pathMaskContains, togglePathCorner } from "./maskPath";
import type { Mask, MaskPoint } from "./project/types";

const square: MaskPoint[] = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
const mask: Mask = { shape: "path", points: square, x: 0, y: 0, width: 0.6, height: 0.4, rotation: 0, feather: 0, invert: false };

describe("pen mask geometry", () => {
  it("bounds anchors and curved extrema, including the closing segment", () => {
    expect(pathBounds(square)).toEqual({ left: -0.5, top: -0.5, right: 0.5, bottom: 0.5 });
    const arch = [{ x: 0, y: 0, out: [0, -1] }, { x: 1, y: 0, in: [0, -1] }] as MaskPoint[];
    const overshoot = [{ x: 0, y: 0, out: [4, 0] }, { x: 1, y: 0, in: [3, 0] }] as MaskPoint[];
    expect(pathBounds(overshoot).right).toBeGreaterThan(3);
    expect(pathBounds(arch).top).toBeCloseTo(-0.75, 4);
    expect(maskPathData(arch)).toContain("C 0 -1 1 -1 1 0");
    expect(maskPathData(square, false)).not.toContain("Z");
    expect(flattenPath(arch).length).toBeGreaterThan(10);
    expect(pathBounds([])).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
  it("matches rectangle coverage at pixel centers to within one pixel", () => {
    const w = 160, h = 90;
    let disagreements = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
      const rect = Math.abs(px) < w * mask.width / 2 && Math.abs(py) < h * mask.height / 2;
      if (pathMaskContains(mask, px, py, w, h) !== rect) disagreements++;
    }
    expect(disagreements).toBe(0);
  });
  it("uses nonzero winding at self-intersections and overlapping loops", () => {
    // The same square traced twice has winding 2. Even-odd would erase it.
    expect(pathContains([...square, ...square], 0, 0)).toBe(true);
    const bowtie = [square[0], square[2], square[1], square[3]];
    expect(pathContains(bowtie, 0.3, 0)).toBe(true);
    expect(pathContains(bowtie, 0, 0.3)).toBe(false);
    expect(pathContains(square, 0.7, 0)).toBe(false);
  });
  it("applies size, rigid rotation, translation, inversion, and open drafts", () => {
    const m = { ...mask, x: 0.1, y: -0.1, rotation: 90 };
    // A 1152 x 432 rectangle turned rigidly: center 192,-108.
    expect(pathMaskContains(m, 192, 400, 1920, 1080)).toBe(true);
    expect(pathMaskContains(m, 500, -108, 1920, 1080)).toBe(false);
    expect(pathMaskContains({ ...m, invert: true }, 192, 400, 1920, 1080)).toBe(false);
    expect(pathMaskContains({ ...m, closed: false }, 192, -108, 1920, 1080)).toBe(false);
  });
  it("rejects malformed and unbounded point data", () => {
    expect(cleanMaskPoints([{ x: NaN, y: 0 }])).toBeUndefined();
    expect(cleanMaskPoints([{ x: 0, y: 0, in: [1] }])).toBeUndefined();
    expect(cleanMaskPoints([{ x: 0, y: 0, out: [0, Infinity] }])).toBeUndefined();
    expect(cleanMaskPoints(Array(257).fill({ x: 0, y: 0 }))).toBeUndefined();
    expect(cleanMaskPoints([{ x: 0, y: 0, out: [0.2, -0.3] }])).toEqual([{ x: 0, y: 0, out: [0.2, -0.3] }]);
  });
  it("toggles smooth handles without changing anchors or neighbors", () => {
    const smooth = togglePathCorner(square, 1);
    expect(smooth[0]).toBe(square[0]);
    expect(smooth[1]).toEqual({ x: 0.5, y: -0.5, in: [-1 / 6, -1 / 6], out: [1 / 6, 1 / 6] });
    expect(togglePathCorner(smooth, 1)).toEqual(square);
  });
});
