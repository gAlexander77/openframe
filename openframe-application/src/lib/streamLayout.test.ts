import { describe, expect, it } from "vitest";
import { applyStreamLayout, streamBand, streamBands } from "./streamLayout";
import { clipForAsset, createProject, normalizeProject } from "./project/defaults";
import { addClip, findClip, mainTrack, moveClip, settle, splitClip, trimClip } from "./project/ops";
import type { Asset, VideoClip } from "./project/types";
import { layerBox } from "./align";
import { layerAt } from "./render/plan";
import { describeProject, runCommand, validate, COMMANDS, coerceNumbers } from "./commands";
import { moveEdits } from "./editPoints";

const facecam = { x: 0.7, y: 0.05, w: 0.25, h: 0.3 };
function setup() {
  let p = createProject();
  const a: Asset = { id: "vod", kind: "video", name: "VOD", src: "vod.mp4", duration: 120, width: 1920, height: 1080, hasVideo: true, hasAudio: true };
  p.assets = [a];
  const c = { ...clipForAsset(a, 0, p.fps), in: 10, duration: 1800 } as VideoClip;
  p = addClip(p, mainTrack(p).id, c);
  return { p, c };
}

describe("stream layout", () => {
  it("maps an off-center source region to exactly its filled band", () => {
    const { p, c } = setup();
    const q = applyStreamLayout(p, c.id, { facecam });
    expect([q.width, q.height]).toEqual([1080, 1920]);
    const videos = q.tracks.flatMap(t => t.clips).filter((x): x is VideoClip => x.type === "video");
    expect(videos).toHaveLength(2);
    const face = videos.find(c => c.streamLayout === "facecam")!, game = videos.find(c => c.streamLayout === "gameplay")!;
    for (const v of videos) { expect([v.start, v.duration, v.in, v.assetId]).toEqual([c.start, c.duration, c.in, c.assetId]); expect(v.group).toBe(face.group); }
    expect([face.muted, game.muted]).toEqual([true, false]);
    const f = layerBox(q, face, layerAt(q, face, 0)!);
    const g = layerBox(q, game, layerAt(q, game, 0)!);
    expect(f.cx).toBeCloseTo(540); expect(f.cy).toBeCloseTo(336); expect(f.w).toBeCloseTo(1080); expect(f.h).toBeCloseTo(672);
    expect(g.cy).toBeCloseTo(1296); expect(g.w).toBeCloseTo(1080); expect(g.h).toBeCloseTo(1248);
    expect(face.crop.left).toBeGreaterThanOrEqual(facecam.x - 1e-9);
    expect(face.crop.top).toBeGreaterThanOrEqual(facecam.y - 1e-9);
    expect(describeProject(q).tracks.flatMap(t => t.clips).every(c => c.group_name === "Stream layout")).toBe(true);
    expect(p.height).toBe(1080);
  });

  it("honors split, gap, order, fit and an editable inset band border", () => {
    const { p, c } = setup();
    const q = applyStreamLayout(p, c.id, { facecam, split: 0.4, gap: 20, order: "gameplay_top", facecam_fit: "fit", border: { width: 10, color: "#ffffff" } });
    const bands = streamBands(1080, 1920, { facecam, split: 0.4, gap: 20, order: "gameplay_top" });
    expect(bands.gameplay).toEqual({ y: 0, w: 1080, h: 1140 });
    expect(bands.facecam).toEqual({ y: 1160, w: 1080, h: 760 });
    const face = q.tracks.flatMap(t => t.clips).find(c => c.streamLayout === "facecam") as VideoClip;
    const b = layerBox(q, face, layerAt(q, face, 0)!);
    expect(b.cy).toBeCloseTo(1540); expect(b.h).toBeLessThanOrEqual(760); expect(b.w).toBeLessThanOrEqual(1080);
    expect(face.crop.left).toBeCloseTo(facecam.x); expect(face.crop.right).toBeCloseTo(1 - facecam.x - facecam.w);
    expect(face.crop.top).toBeCloseTo(facecam.y); expect(face.crop.bottom).toBeCloseTo(1 - facecam.y - facecam.h);
    const border = q.tracks.flatMap(t => t.clips).find(c => c.streamLayout === "border");
    expect(border?.type).toBe("color");
    if (border?.type === "color") { expect(border.shape?.stroke?.color).toBe("#ffffff"); expect(border.group).toBe(face.group); }
  });

  it("fills the whole tall frame without a facecam, preserves an existing tall size", () => {
    const { p, c } = setup();
    const q = applyStreamLayout({ ...p, width: 720, height: 1280 }, c.id);
    expect(q.tracks.flatMap(t => t.clips)).toHaveLength(1);
    const game = findClip(q, c.id)!.clip as VideoClip, b = layerBox(q, game, layerAt(q, game, 0)!);
    expect([b.w, b.h, b.cx, b.cy]).toEqual([720, 1280, 360, 640]);
  });

  it("splits both bands with separate groups, trims either band together, moves with linkage off", () => {
    const { p, c } = setup();
    const q = applyStreamLayout(p, c.id, { facecam, border: { width: 4, color: "red" } });
    const split = splitClip(q, c.id, 900);
    const left = split.tracks.flatMap(t => t.clips).filter(c => c.start === 0), right = split.tracks.flatMap(t => t.clips).filter(c => c.start === 900);
    expect(left).toHaveLength(3); expect(right).toHaveLength(3);
    expect(new Set(left.map(c => c.group)).size).toBe(1); expect(new Set(right.map(c => c.group)).size).toBe(1); expect(left[0].group).not.toBe(right[0].group);
    const face = left.find(c => c.streamLayout === "facecam")!;
    const trimmed = trimClip(split, face.id, "end", 600);
    expect(trimmed.tracks.flatMap(t => t.clips).filter(c => c.start === 0).map(c => c.duration)).toEqual([600, 600, 600]);
    const moved = settle(trimmed, moveClip(trimmed, c.id, mainTrack(trimmed).id, 100), { magnet: false, linkage: false });
    expect(moved.tracks.flatMap(t => t.clips).filter(c => c.group === face.group).map(c => c.start)).toEqual([100, 100, 100]);
  });

  it("validates geometry, locks, metadata and union schema at the boundary", () => {
    const { p, c } = setup();
    expect(() => applyStreamLayout(p, c.id, { facecam: { ...facecam, x: 0.9 } })).toThrow("inside");
    expect(() => streamBand({ w: 1080, h: 608 }, { x: 0, y: 0, w: 0, h: 1 }, { y: 0, w: 1080, h: 672 }, { width: 1080, height: 1920 })).toThrow();
    expect(() => applyStreamLayout(p, c.id, { split: 0.99 })).toThrow();
    expect(() => applyStreamLayout({ ...p, tracks: p.tracks.map(t => ({ ...t, locked: true })) }, c.id)).toThrow("unlocked");
    const raw = structuredClone(p); (raw.tracks[0].clips[0] as unknown as Record<string, unknown>).streamLayout = { part: "facecam" };
    expect(normalizeProject(raw).tracks[0].clips[0].streamLayout).toBeUndefined();
    const schema = COMMANDS.find(c => c.name === "apply_stream_layout")!.input;
    expect(validate({ clip_id: c.id, border: "none" }, schema)).toEqual([]);
    expect(validate({ clip_id: c.id, border: true }, schema).length).toBeGreaterThan(0);
    expect(coerceNumbers({ clip_id: c.id, border: { color: "red", width: "10" } }, schema)).toEqual({ clip_id: c.id, border: { color: "red", width: 10 } });
    const report = {};
    runCommand(p, "apply_stream_layout", { clip_id: c.id }, report);
    expect(report).toEqual({ notes: ["Canvas changed to 1080x1920 for the stream layout."] });
  });

  it("ripple-trims selected band heads once, with common bounds and atomic locks", () => {
    const { p, c } = setup();
    const q = applyStreamLayout(p, c.id, { facecam });
    const ids = q.tracks.flatMap(t => t.clips.map(c => c.id));
    const trimmed = moveEdits(q, ids.map(clipId => ({ clipId, edge: "start" })), { to: 60 }, true).project;
    expect(trimmed.tracks.flatMap(t => t.clips).map(c => c.duration)).toEqual([1740, 1740]);
    const locked = { ...q, tracks: q.tracks.map((t, i) => i === 0 ? { ...t, locked: true } : t) };
    expect(trimClip(locked, c.id, "end", 600)).toBe(locked);
    expect(splitClip(locked, c.id, 600)).toBe(locked);
  });
});
