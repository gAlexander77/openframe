import { describe, expect, it } from "vitest";
import { applyLayout, coverCell, LAYOUTS, layoutCells } from "./layouts";
import { createColorClip, createProject, createTrack } from "./project/defaults";

describe("layout cells", () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080], [1080, 1350]]) {
    for (const layout of LAYOUTS) it(`${layout} at ${width}x${height}`, () => {
      for (const count of layout === "triptych" ? [3] : [2, 3, 4]) {
        const cells = layoutCells(layout, count, width, height);
        expect(cells).toHaveLength(count);
        cells.forEach((c, i) => {
          expect(c.x).toBeGreaterThanOrEqual(0); expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.w).toBeLessThanOrEqual(width + 0.001); expect(c.y + c.h).toBeLessThanOrEqual(height + 0.001);
          if (layout.startsWith("pip-") && i === 0) expect(c).toEqual({ x: 0, y: 0, w: width, h: height });
          const fit = coverCell({ w: 1600, h: 900 }, c, width, height);
          expect(1600 * fit.scale * (1 - fit.crop.left - fit.crop.right)).toBeCloseTo(c.w);
          expect(900 * fit.scale * (1 - fit.crop.top - fit.crop.bottom)).toBeCloseTo(c.h);
          for (const other of cells.slice(i + 1)) if (!(layout.startsWith("pip-") && i === 0)) expect(c.x + c.w <= other.x + 0.001 || other.x + other.w <= c.x + 0.001 || c.y + c.h <= other.y + 0.001 || other.y + other.h <= c.y + 0.001).toBe(true);
        });
      }
    });
  }
  it("rejects impossible gutters and nonoverlapping clips", () => {
    expect(() => layoutCells("triptych", 2, 1920, 1080)).toThrow();
    expect(() => layoutCells("grid-2x2", 4, 100, 100, 1, 1)).toThrow();
    const p = createProject(); const a = createColorClip("red", 0, 30), b = createColorClip("blue", 30, 30);
    p.tracks = [{ ...createTrack("video", "A"), clips: [a, b] }];
    expect(() => applyLayout(p, [a.id, b.id], "split-vertical")).toThrow(/overlap/);
  });
  it("adds editable borders and entrance keys atomically", () => {
    const p = createProject(); const a = createColorClip("red", 0, 30), b = createColorClip("blue", 0, 30);
    p.tracks = [a, b].map(c => ({ ...createTrack("video", "Picture"), clips: [c] }));
    const q = applyLayout(p, [a.id, b.id], "pip-top-left", { radius: 0.2, border: { width: 2, color: "white" }, animate: "scale" });
    const clips = q.tracks.flatMap(t => t.clips);
    expect(clips).toHaveLength(3);
    expect(clips.find(c => c.id === b.id)?.keyframes?.["transform.scale"]).toHaveLength(2);
    expect(clips[0].group).toBe(clips.find(c => c.id === b.id)?.group);
    expect(p.tracks.flatMap(t => t.clips)).toHaveLength(2);
  });
});
