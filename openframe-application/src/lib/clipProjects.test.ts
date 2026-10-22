import { describe, expect, it } from "vitest";
import { momentsFromMarkers, planClips, planProjectExports } from "./clipProjects";
import { CLIP_TEMPLATE_SCHEMA } from "./mcp";
import { validate } from "./commands";
import { clipForAsset, createProject } from "./project/defaults";
import type { Asset, VideoClip } from "./project/types";

describe("clip project planning", () => {
  const source = { name: "Stream.mp4", duration: 120 };
  it("plans names, trims, defaults and explicit template steps in source order", () => {
    const plan = planClips(source, [{ start: 20, end: 40, title: "The clutch", peak: 35 }, { start: 60, end: 90, name: "Custom" }, { start: 100, end: 120 }]);
    expect(plan.map(p => p.name)).toEqual(["The clutch (Stream.mp4)", "Custom (Stream.mp4)", "Clip 3 (Stream.mp4)"]);
    expect(plan.map(p => [p.sourceIn, p.frames, p.width, p.height])).toEqual([[20, 600, 1080, 1920], [60, 900, 1080, 1920], [100, 600, 1080, 1920]]);
    expect(plan[0].steps).toEqual(["layout", "captions", "hook", "normalize"]);
    const full = planClips(source, [{ start: 0, end: 5 }], { layout: "full", captions: false, hook: false, credit: { name: "Streamer", platform: "twitch" } })[0];
    expect([full.width, full.height, full.endCard, full.steps]).toEqual([1920, 1080, 60, ["layout", "credit", "normalize"]]);
  });
  it("clamps lead times and snaps source windows once at fractional fps", () => {
    const plan = planClips(source, [{ start: 1, end: 119 }], { lead_in: 2, lead_out: 3 }, { num: 30000, den: 1001 })[0];
    expect(plan.sourceIn).toBe(0); expect(plan.frames).toBe(3596); expect(plan.seconds).toBeLessThanOrEqual(120);
  });
  it("rejects the entire invalid plan before work, including malformed templates", () => {
    for (const moments of [[], [{ start: 1, end: 1 }], [{ start: -1, end: 2 }], [{ start: 0, end: 121 }], [{ start: 0, end: NaN }]]) expect(() => planClips(source, moments)).toThrow();
    expect(() => planClips(source, [{ start: 1, end: 2 }], { captions: { words: 4 } })).toThrow();
    expect(() => planClips(source, [{ start: 1, end: 2 }], { facecam: { x: 0.9, y: 0, w: 0.2, h: 1 } })).toThrow();
    expect(validate({ captions: false }, CLIP_TEMPLATE_SCHEMA)).toEqual([]);
    expect(validate({ captions: true }, CLIP_TEMPLATE_SCHEMA).length).toBeGreaterThan(0);
    expect(validate({ captions: { words: 2, invented: 1 } }, CLIP_TEMPLATE_SCHEMA).length).toBeGreaterThan(0);
  });
  it("maps Highlight range markers through the VOD clip's source in-point", () => {
    const p = createProject(), a: Asset = { id: "vod", name: "VOD", kind: "video", src: "vod.mp4", duration: 120, hasVideo: true, hasAudio: true };
    p.assets = [a]; p.tracks[0].clips = [{ ...clipForAsset(a, 300, p.fps), in: 40, duration: 600 } as VideoClip];
    p.markers = [{ id: "m", frame: 330, duration: 150, label: "Highlight 1", color: "red" }, { id: "x", frame: 0, duration: 150, label: "Highlight 2", color: "red" }];
    expect(momentsFromMarkers(p, a.id)).toEqual([{ start: 41, end: 46, title: "Highlight 1" }]);
  });
});

describe("project export sequencing", () => {
  it("keeps project order and exports originals plus unique shapes without duplicate writes", () => {
    expect(planProjectExports(["b", "a", "b"], ["9:16", "original", "9:16", "16:9"])).toEqual([
      { id: "b", ratio: "original" }, { id: "b", ratio: "9:16" }, { id: "b", ratio: "16:9" },
      { id: "a", ratio: "original" }, { id: "a", ratio: "9:16" }, { id: "a", ratio: "16:9" },
    ]);
    expect(() => planProjectExports([])).toThrow();
    expect(() => planProjectExports(Array.from({ length: 101 }, (_, i) => String(i)))).toThrow();
  });
});
