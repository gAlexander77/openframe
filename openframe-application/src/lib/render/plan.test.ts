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

  it("frame blending at half speed: odd frames mix two source frames half and half", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    p = { ...p, assets: [{ id: "a", kind: "video", name: "v", src: "v", duration: 10, fps: 30, hasVideo: true, hasAudio: false }] };
    const clip = { ...clipForAsset(p.assets[0], 0, p.fps), id: "v", speed: 0.5, frameBlend: true };
    p = addClip(p, p.tracks[0].id, clip);
    const src = (f: number) => {
      const item = planFrame(p, f)[0];
      return item.kind === "layer" && item.layer.source.kind === "video" ? item.layer.source : null;
    };
    // Frame 21 sits halfway between source frames 10 and 11.
    expect(src(21)?.next?.w).toBeCloseTo(0.5, 3);
    expect(src(21)!.time * 30).toBeCloseTo(10.25, 3);
    expect(src(21)!.next!.time * 30).toBeCloseTo(11.25, 3);
    // Even frames land on a source frame: nothing to mix.
    expect(src(20)?.next).toBeUndefined();
    // Off, the clip repeats frames as before.
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, frameBlend: undefined })) })) };
    expect(src(21)?.next).toBeUndefined();
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

describe("remove background", () => {
  const withCutout = (enabled: boolean) => {
    let p = createProject({ width: 1080, height: 1920, fps: { num: 30, den: 1 } });
    p = { ...p, assets: [{ id: "a", kind: "video", name: "v", src: "v", duration: 10, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
    const clip = { ...clipForAsset(p.assets[0], 0, p.fps), id: "v", in: 2, canvas: { type: "blur" as const, amount: 60 }, cutout: { enabled, src: "matte.mp4", from: 1.5, to: 8, model: "m" } };
    return addClip(p, p.tracks[0].id, clip);
  };

  it("gives the layer the matte at the source time less the matte's start", () => {
    const [fill, item] = planFrame(withCutout(true), 30);
    const layer = item.kind === "layer" ? item.layer : null;
    const t = layer?.source.kind === "video" ? layer.source.time : NaN;
    expect(layer?.matte?.src).toBe("matte.mp4");
    expect(layer?.matte?.time).toBeCloseTo(t - 1.5, 9);
    expect(t).toBeGreaterThan(3);
    // The canvas fill behind stays whole.
    expect(fill.kind === "layer" && fill.layer.matte).toBeUndefined();
  });

  it("keeps the matte off the layer while the toggle is off", () => {
    const item = planFrame(withCutout(false), 30)[1];
    expect(item.kind === "layer" && item.layer.matte).toBeUndefined();
  });

  it("shows the picture whole past the matte's end rather than holding its last frame", () => {
    const p = withCutout(true);
    const at = (f: number) => {
      const item = planFrame(p, f)[1];
      return item.kind === "layer" ? item.layer : null;
    };
    // Source 2 + 179/30 s is inside the matte (it ends at 8); 2 + 181/30 is past it.
    expect(at(179)?.matte).toBeDefined();
    expect(at(181)?.matte).toBeUndefined();
    expect(at(181)?.source.kind).toBe("video");
  });
});

describe("masks", () => {
  it("animates mask parameters by their keyframes and leaves still ones as stored", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    const mask = { shape: "circle" as const, x: 0, y: 0, width: 0.5, height: 0.5, rotation: 0, feather: 0.1, invert: false };
    p = addClip(p, p.tracks[0].id, { ...createColorClip("#f00", 0, 60), id: "m", mask, keyframes: { "mask.x": [{ f: 0, v: -0.2 }, { f: 20, v: 0.2 }] } });
    p = addClip(p, p.tracks[0].id, { ...createColorClip("#0f0", 60, 60), id: "s", mask });
    const at = (f: number) => (planFrame(p, f)[0] as { layer: { mask?: typeof mask } }).layer.mask!;
    expect(at(10)).toEqual({ ...mask, x: expect.closeTo(0) });
    expect(at(30).x).toBeCloseTo(0.2);
    expect(at(70)).toBe(mask);
  });
});

it("film 5: cropped transformed solid canvas fill covers the whole canvas", () => {
  let p = createProject({ width: 1080, height: 1920 });
  p = { ...p, assets: [{ id: "a", kind: "video", name: "Saturn", src: "v", duration: 10, width: 1920, height: 1080, hasVideo: true, hasAudio: false }] };
  const c = clipForAsset(p.assets[0], 0, p.fps);
  if (c.type !== "video") throw Error("video");
  p = addClip(p, p.tracks[0].id, { ...c, crop: { left: 0.09, right: 0.54, top: 0.04, bottom: 0.59 }, transform: { ...c.transform, scale: 2.5, scaleY: 1.8, y: 0.1152 }, canvas: { type: "color", color: "#071322" } });
  const item = planFrame(p, 0)[0];
  if (item.kind !== "layer") throw Error("layer");
  expect(item.layer).toMatchObject({ x: 0, y: 0, scale: 1, crop: { left: 0, right: 0, top: 0, bottom: 0 }, source: { kind: "color", color: "#071322" } });
  expect(item.layer.scaleY).toBeUndefined();
});
