import { describe, expect, it } from "vitest";
import { clipForAsset, createProject, createTextClip, createTrack, createColorClip, createAdjustmentClip } from "../project/defaults";
import { addClip, addTrack, setTransition } from "../project/ops";
import type { Project } from "../project/types";
import { animationAt, planFrame } from "./plan";

function twoClips(): Project {
  let p = createProject({ fps: { num: 30, den: 1 } });
  const main = p.tracks[0].id;
  p = addClip(p, main, { ...createColorClip("#f00", 0, 60), id: "a" });
  p = addClip(p, main, { ...createColorClip("#00f", 60, 60), id: "b" });
  return p;
}

describe("planFrame", () => {
  it("draws the clip under the frame, bottom track first", () => {
    let p = twoClips();
    const top = createTrack("video", "Titles");
    p = addTrack(p, top, 0);
    p = addClip(p, top.id, { ...createTextClip("Hi", 0, 30), id: "t" });
    const items = planFrame(p, 10);
    expect(items.map((i) => (i.kind === "layer" ? i.layer.clipId : i.kind))).toEqual(["a", "t"]);
    expect(planFrame(p, 70).map((i) => (i.kind === "layer" ? i.layer.clipId : ""))).toEqual(["b"]);
  });

  it("skips hidden tracks and disabled clips", () => {
    const p = twoClips();
    expect(planFrame({ ...p, tracks: [{ ...p.tracks[0], hidden: true }] }, 10)).toEqual([]);
  });

  it("replaces both clips with one transition centered on the cut", () => {
    const p = setTransition(twoClips(), "a", { type: "dissolve", duration: 10 });
    expect(planFrame(p, 54)[0].kind).toBe("layer");
    const first = planFrame(p, 55)[0];
    const last = planFrame(p, 64)[0];
    expect(first.kind === "transition" && [first.from.clipId, first.to.clipId]).toEqual(["a", "b"]);
    expect(first.kind === "transition" && first.progress).toBeCloseTo(0.05);
    expect(last.kind === "transition" && last.progress).toBeCloseTo(0.95);
    expect(planFrame(p, 65)[0].kind).toBe("layer");
  });

  it("adds a filter's look on top of the clip's own adjustments", () => {
    let p = twoClips();
    p = { ...p, tracks: [{ ...p.tracks[0], clips: p.tracks[0].clips.map((c) => (c.id === "a" ? { ...c, filter: { type: "warm", intensity: 0.5 } } : c)) }] };
    const item = planFrame(p, 0)[0];
    expect(item.kind === "layer" && item.layer.adjust.temperature).toBe(17.5);
  });

  it("carries a clip's grade to its layer, and leaves ungraded clips without one", () => {
    let p = twoClips();
    p = { ...p, tracks: [{ ...p.tracks[0], clips: p.tracks[0].clips.map((c) => (c.id === "a" && "adjust" in c ? { ...c, adjust: { ...c.adjust, hsl: { red: { hue: 0, saturation: -50, lightness: 0 } } } } : c)) }] };
    const a = planFrame(p, 0)[0];
    const b = planFrame(p, 70)[0];
    expect(a.kind === "layer" && a.layer.grade?.hsl?.[1]).toBe(-0.5);
    expect(b.kind === "layer" && b.layer.grade).toBeUndefined();
  });

  it("lists adjustment layers in stack order", () => {
    let p = twoClips();
    const fx = createTrack("video", "FX");
    p = addTrack(p, fx, 0);
    p = addClip(p, fx.id, { ...createAdjustmentClip(0, 90), id: "adj" });
    expect(planFrame(p, 5).map((i) => i.kind)).toEqual(["layer", "adjust"]);
  });
});

describe("animations", () => {
  const clip = { ...createTextClip("x", 0, 100), animIn: { type: "fade", duration: 10 }, animOut: { type: "zoomIn", duration: 20 } };
  it("fade in rises from 0 and is done at its duration", () => {
    expect(animationAt(clip, 0).opacity).toBe(0);
    expect(animationAt(clip, 5).opacity).toBeGreaterThan(0.5);
    expect(animationAt(clip, 10)).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 });
  });
  it("out animations end at their 'from' state", () => {
    const end = animationAt(clip, 99);
    expect(end.scale).toBeLessThan(0.7);
    expect(end.opacity).toBeLessThan(0.1);
  });
  it("pop overshoots before settling", () => {
    const pop = { ...clip, animIn: { type: "pop", duration: 20 }, animOut: undefined };
    const peak = Math.max(...Array.from({ length: 20 }, (_, r) => animationAt(pop, r).scale));
    expect(peak).toBeGreaterThan(1.02);
  });
});

describe("source time", () => {
  it("samples just past each frame's edge, inside the frame", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    p = { ...p, assets: [{ id: "a", kind: "video", name: "v", src: "v", duration: 10, fps: 30, hasVideo: true, hasAudio: false }] };
    const clip = { ...clipForAsset(p.assets[0], 0, p.fps), id: "v" };
    p = addClip(p, p.tracks[0].id, clip);
    const item = planFrame(p, 59)[0];
    const t = item.kind === "layer" && item.layer.source.kind === "video" ? item.layer.source.time : -1;
    expect(t).toBeGreaterThan(59 / 30);
    expect(t).toBeLessThan(59 / 30 + 0.5 / 30);
  });
});

describe("canvas fill", () => {
  it("draws a covering blurred copy, then the clip", () => {
    let p = createProject({ width: 1080, height: 1920, fps: { num: 30, den: 1 } });
    p = { ...p, assets: [{ id: "a", kind: "video", name: "v", src: "v", duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
    const clip = { ...clipForAsset(p.assets[0], 0, p.fps), id: "v", canvas: { type: "blur" as const, amount: 60 } };
    p = addClip(p, p.tracks[0].id, clip);
    const items = planFrame(p, 0);
    expect(items).toHaveLength(2);
    const fill = items[0].kind === "layer" ? items[0].layer : null;
    // 16:9 into 9:16: cover/fit = (1920/1080) / (1080/1920) = 3.16
    expect(fill!.scale).toBeCloseTo(3.16 * 1.04, 1);
    expect(fill!.effects[0]).toEqual({ type: "blur", params: { amount: 60 } });
  });
});
