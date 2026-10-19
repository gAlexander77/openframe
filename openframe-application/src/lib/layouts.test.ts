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
  it("leaves a main-track clip in place: no gap, no ripple", () => {
    const p = createProject(); const a = createColorClip("red", 0, 60), b = createColorClip("blue", 0, 60), after = createColorClip("green", 60, 30);
    p.tracks = [{ ...createTrack("video", "Card"), clips: [b] }, { ...createTrack("video", "Main"), main: true, clips: [a, after] }];
    const q = applyLayout(p, [a.id, b.id], "pip-top-right");
    const main = q.tracks.find(t => t.main)!;
    expect(main.clips.map(c => [c.id, c.start])).toEqual([[a.id, 0], [after.id, 60]]);
    const cardTrack = q.tracks.findIndex(t => t.clips.some(c => c.id === b.id));
    expect(cardTrack).toBeLessThan(q.tracks.indexOf(main));
    expect(() => applyLayout(p, [b.id, a.id], "pip-top-right")).toThrow(/main-track clip stays underneath/);
    const split = applyLayout(p, [b.id, a.id], "split-vertical");
    expect(split.tracks.find(t => t.main)!.clips.map(c => c.id)).toEqual([a.id, after.id]);
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

describe("fit and stacking", () => {
  const recording = (p: ReturnType<typeof createProject>) => ({ ...p, assets: [{ id: "rec", kind: "video" as const, name: "rec.mp4", src: "rec.mp4", duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] });
  const media = (start: number) => ({ ...createColorClip("x", start, 60), type: "video" as const, assetId: "rec", in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }) as never;

  it("contains a screen recording in its cell: the whole picture, centered, over an optional background", () => {
    const p = recording(createProject());
    const a = media(0), b = media(0);
    p.tracks = [{ ...createTrack("video", "B"), clips: [b] }, { ...createTrack("video", "A"), clips: [a] }];
    const q = applyLayout(p, [(a as { id: string }).id, (b as { id: string }).id], "split-vertical", { fit: "contain", background: "#202020", radius: 0.1 });
    const all = q.tracks.flatMap(t => t.clips);
    const cells = layoutCells("split-vertical", 2, 1920, 1080);
    for (const [id, cell] of [[(a as { id: string }).id, cells[0]], [(b as { id: string }).id, cells[1]]] as const) {
      const c = all.find(x => x.id === id) as unknown as { crop: object; transform: { scale: number; x: number; y: number }; group: string };
      expect(c.crop).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
      // A 16:9 picture in a tall cell: as wide as the cell, centered in it.
      expect(1920 * c.transform.scale).toBeCloseTo(cell.w, 3);
      expect(c.transform.x).toBeCloseTo((cell.x + cell.w / 2) / 1920 - 0.5, 5);
      const bg = all.find(x => x.name === "Layout background" && x.group === c.group) as unknown as { shape: { width: number; height: number; fill: boolean }; transform: { x: number } };
      expect(bg.shape).toMatchObject({ width: cell.w / 1920, height: cell.h / 1080, fill: true });
      // The background under its picture.
      const row = (x: string) => q.tracks.findIndex(t => t.clips.some(k => k.id === x));
      expect(row((bg as unknown as { id: string }).id)).toBeGreaterThan(row(id));
    }
    // Cover is still the default.
    const cover = applyLayout(p, [(a as { id: string }).id, (b as { id: string }).id], "split-vertical");
    expect((cover.tracks.flatMap(t => t.clips).find(x => x.id === (a as { id: string }).id) as unknown as { crop: { left: number } }).crop.left).toBeGreaterThan(0);
  });

  it("puts the Layout tracks just above the highest chosen clip, under titles already above it", () => {
    const p = createProject();
    const a = createColorClip("red", 0, 60), b = createColorClip("blue", 0, 60), label = { ...createColorClip("white", 0, 60), name: "Label" };
    p.tracks = [{ ...createTrack("video", "Labels"), clips: [label] }, { ...createTrack("video", "B"), clips: [b] }, { ...createTrack("video", "A"), clips: [a] }, ...p.tracks];
    const q = applyLayout(p, [a.id, b.id], "split-vertical");
    const row = (id: string) => q.tracks.findIndex(t => t.clips.some(c => c.id === id));
    expect(row(label.id)).toBe(0);
    expect(row(a.id)).toBeGreaterThan(0);
    expect(row(b.id)).toBeGreaterThan(0);
    // The tracks the clips left empty are gone; the Layout ones replace them.
    expect(q.tracks.map(t => t.name)).toEqual(["Labels", "Layout", "Layout", ...p.tracks.slice(3).map(t => t.name)]);
  });
});
