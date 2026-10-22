import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { cropClips, cropFeatherAlpha, dragCrop, mirrorCrop, NO_CROP } from "./crop";
import { createProject, normalizeProject } from "./project/defaults";
import type { Clip, Project } from "./project/types";
import { reshape } from "./versions";
import { planFrame } from "./render/plan";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);
const picture = () => runCommand(createProject(), "add_color_clip", { color: "#ffffff", start: 0, duration: 4 });

describe("crop softness", () => {
  it("keeps hard edges at zero and smooths inward with resolution-independent units", () => {
    expect(cropFeatherAlpha(0, 100, 500, 400)).toBe(1);
    expect(cropFeatherAlpha(-1, 100, 500, 400, 100)).toBe(0);
    expect(cropFeatherAlpha(0, 100, 500, 400, 100)).toBe(0);
    expect(cropFeatherAlpha(25, 100, 500, 400, 100)).toBe(0.15625);
    expect(cropFeatherAlpha(50, 100, 500, 400, 100)).toBe(0.5);
    expect(cropFeatherAlpha(100, 100, 500, 400, 100)).toBe(1);
    expect(cropFeatherAlpha(400, 350, 500, 400, 100)).toBe(0.5);
    expect(cropFeatherAlpha(50 * 2 / 3, 100, 500, 400, 100, 720)).toBeCloseTo(0.5);
  });
  it("sets softness alone, preserves it across flips, drags and ratios, and describes it", () => {
    let p = picture();
    const id = clips(p)[0].id;
    p = runCommand(p, "set_crop", { clip_ids: [id], feather: 100 });
    expect(cropClips(p, [id], { feather: 100 })).toBe(p);
    expect(describeProject(p).tracks.flatMap((t) => t.clips)[0]).toMatchObject({ crop: { feather: 100 } });
    const crop = { ...NO_CROP, feather: 100 };
    expect(mirrorCrop(crop, true, true).feather).toBe(100);
    expect(dragCrop(crop, "w", 0.1, 0, { w: 1920, h: 1080 }, null).feather).toBe(100);
    p = runCommand(p, "set_crop", { clip_ids: [id], ratio: "1:1" });
    expect(clips(p)[0]).toMatchObject({ crop: { feather: 100 } });
    p = runCommand(p, "set_crop", { clip_ids: [id], ratio: "16:9", feather: 40 });
    expect(clips(p)[0]).toMatchObject({ crop: { feather: 40 } });
  });
  it("carries softness through version fitting with the other pixel-sized settings", () => {
    let p: Project = { ...createProject(), assets: [{ id: "pic", kind: "image", name: "pic.png", src: "pic.png", duration: 0, width: 1920, height: 1080, hasVideo: true, hasAudio: false }] };
    p = runCommand(p, "add_media_clip", { asset_id: "pic", start: 0, duration: 4 });
    const id = clips(p)[0].id;
    p = runCommand(p, "set_param", { clip_ids: [id], path: "transform.scale", value: 0.4 });
    p = runCommand(p, "set_crop", { clip_ids: [id], feather: 120 });
    const c = clips(reshape(p, "9:16", "fill")).find((c) => c.id === id)!;
    expect(c).toMatchObject({ crop: { feather: 67.5 } });
  });

});

describe("masked adjustments and paths", () => {
  it("accepts an adjustment mask and resolves its keyed transform in the plan", () => {
    let p = runCommand(picture(), "add_adjustment_clip", { start: 0, duration: 4 });
    const id = clips(p).find((c) => c.type === "adjustment")!.id;
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "circle", aspect: 1, width: 0.2, feather: 0.1, invert: true });
    p = runCommand(p, "set_mask", { clip_ids: [id], x: 0.4, at: 2 });
    const item = planFrame(p, 30).find((i) => i.kind === "adjust");
    expect(item).toMatchObject({ kind: "adjust", mask: { shape: "circle", x: 0.2, width: 0.2, height: expect.closeTo(0.2 * 1920 / 1080, 4), feather: 0.1, invert: true } });
    expect(describeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === id)).toMatchObject({ mask: { shape: "circle", invert: true } });
    expect(normalizeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === id)).toMatchObject({ mask: { shape: "circle", invert: true } });
  });
  it("stores path points, reports them, keys only the transform, and rejects partial handles", () => {
    let p = picture();
    const id = clips(p)[0].id;
    const points = [{ x: -0.3, y: -0.3, out: [0.1, 0] }, { x: 0.3, y: -0.3 }, { x: 0, y: 0.3 }];
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "path", points });
    p = runCommand(p, "set_mask", { clip_ids: [id], rotation: 90, at: 2 });
    expect(describeProject(p).tracks.flatMap((t) => t.clips)[0]).toMatchObject({ mask: { shape: "path", points, closed: true } });
    expect(clips(p)[0].keyframes).toHaveProperty("mask.rotation");
    expect(() => runCommand(p, "set_mask", { clip_ids: [id], points: [{ x: 0, y: 0, out: [0.2] }] })).toThrow(/two-number handles/);
    const item = planFrame(p, 30)[0];
    expect(item).toMatchObject({ kind: "layer", layer: { mask: { rotation: 45, points } } });
  });
  it("cleans optional fields at the file boundary, and keeps legacy masks intact", () => {
    const p = picture(), c = clips(p)[0];
    const load = (extra: object): Clip => clips(normalizeProject({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((x) => x.id === c.id ? { ...x, ...extra } : x) })) }))[0];
    for (const feather of [NaN, Infinity, -1, "20"]) expect((load({ crop: { ...NO_CROP, feather } }) as Clip & { crop: object }).crop).not.toHaveProperty("feather");
    expect(load({ mask: { shape: "path", points: [{ x: 0, y: 0, in: [1] }] } })).not.toHaveProperty("mask");
    expect((load({ mask: { shape: "path", points: [], closed: "false" } }) as Clip & { mask: object }).mask).not.toHaveProperty("closed");
    const mask = { shape: "rectangle", x: 0.1, y: -0.2, width: 0.5, height: 0.7, rotation: 30, feather: 0.02, invert: false };
    expect(load({ mask })).toMatchObject({ mask });
  });
});
