// The plan's side of shapes, track mattes, motion blur, edges and wiggle
// (ADR-056 to ADR-059, ADR-062).
import { describe, expect, it } from "vitest";
import { createColorClip, createProject, createTextClip, createTrack } from "../project/defaults";
import { addClip, addTrack, setTransition } from "../project/ops";
import type { Clip, ColorClip, Project } from "../project/types";
import { planFrame, planLayers, type Layer } from "./plan";

const solid = (id: string, start: number, duration: number, extra: Partial<ColorClip> = {}): Clip => ({ ...createColorClip("#fff", start, duration), id, ...extra }) as Clip;

/** Clips bottom track first, one clip per track. */
function stack(...clips: Clip[]): Project {
  let p = createProject({ fps: { num: 30, den: 1 } });
  p = addClip(p, p.tracks[0].id, clips[0]);
  for (const c of clips.slice(1)) {
    const t = createTrack("video", "V");
    p = addTrack(p, t, 0);
    p = addClip(p, t.id, c);
  }
  return p;
}

const layers = (p: Project, f: number) => planFrame(p, f).flatMap((i) => (i.kind === "layer" ? [i.layer] : []));

describe("shapes", () => {
  it("plan as a shape source with keyed numbers resolved", () => {
    const p = stack(solid("s", 0, 30, { shape: { kind: "line", width: 0.4, height: 0.1 }, keyframes: { "shape.draw": [{ f: 0, v: 0 }, { f: 10, v: 1 }] } }));
    const l = layers(p, 5)[0];
    expect(l.source.kind).toBe("shape");
    expect(l.source.kind === "shape" && l.source.shape.draw).toBeCloseTo(0.5, 6);
    expect(layers(stack(solid("c", 0, 30)), 0)[0].source.kind).toBe("color");
  });
});

describe("track mattes", () => {
  const text = { ...createTextClip("SALE", 0, 60), id: "t" } as Clip;

  it("hide the matte and carry its layer on the clip it cuts", () => {
    const p = stack(solid("v", 0, 60, { trackMatte: { clipId: "t", mode: "alpha" } }), text);
    const ls = layers(p, 10);
    expect(ls.map((l) => l.clipId)).toEqual(["v"]);
    expect(ls[0].trackMatte?.mode).toBe("alpha");
    expect(ls[0].trackMatte?.layer?.clipId).toBe("t");
    // The matte's source loads like any other layer's.
    expect(planLayers(planFrame(p, 10)).map((l) => l.clipId)).toEqual(["v", "t"]);
  });

  it("give an empty matte where the matte clip does not show", () => {
    const p = stack(solid("v", 0, 90, { trackMatte: { clipId: "t", mode: "alphaInverted" } }), text);
    const l = layers(p, 75)[0];
    expect(l.trackMatte).toEqual({ layer: null, mode: "alphaInverted" });
  });

  it("read the track above when no clip is named, hiding it only meanwhile", () => {
    const p = stack(solid("v", 0, 30, { trackMatte: { mode: "luma" } }), solid("above", 0, 60));
    expect(layers(p, 10).map((l) => [l.clipId, l.trackMatte?.layer?.clipId])).toEqual([["v", "above"]]);
    expect(layers(p, 45).map((l) => l.clipId)).toEqual(["above"]);
  });

  it("cut both sides of a transition", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    p = addClip(p, p.tracks[0].id, solid("a", 0, 30, { trackMatte: { mode: "alpha" } }));
    p = addClip(p, p.tracks[0].id, solid("b", 30, 30, { trackMatte: { mode: "alpha" } }));
    p = setTransition(p, "a", { type: "dissolve", duration: 10 });
    const top = createTrack("video", "Matte");
    p = addTrack(p, top, 0);
    p = addClip(p, top.id, solid("m", 0, 60));
    const item = planFrame(p, 30).find((i) => i.kind === "transition")!;
    expect(item.kind === "transition" && [item.from.trackMatte?.layer?.clipId, item.to.trackMatte?.layer?.clipId]).toEqual(["m", "m"]);
    expect(planFrame(p, 30).some((i) => i.kind === "layer" && i.layer.clipId === "m")).toBe(false);
  });
});

describe("motion blur", () => {
  const moving = (extra: Partial<ColorClip> = {}) =>
    stack(solid("s", 0, 60, { shape: { kind: "rectangle", width: 0.1, height: 0.1 }, motionBlur: { shutter: 180 }, keyframes: { "transform.x": [{ f: 0, v: -0.4 }, { f: 20, v: 0.4 }] }, ...extra }));

  it("samples the shutter around the frame while the layer moves", () => {
    const l = layers(moving(), 10)[0];
    // 0.04 of 1920 px a frame, half a frame open: ~38 px, a sample per 2 px.
    expect(l.motion!.length).toBeGreaterThan(10);
    const xs = l.motion!.map((t) => t.x);
    expect(Math.min(...xs)).toBeLessThan(l.x);
    expect(Math.max(...xs)).toBeGreaterThan(l.x);
    // Centered: the mean placement is the frame's own.
    expect(xs.reduce((s, v) => s + v, 0) / xs.length).toBeCloseTo(l.x, 6);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.04 * 0.5 + 1e-9);
  });

  it("draws once when still, when off, or with one sample asked for", () => {
    expect(layers(moving(), 40)[0].motion).toBeUndefined();
    expect(layers(moving({ motionBlur: undefined }), 10)[0].motion).toBeUndefined();
    expect(planFrame(moving(), 10, { motionSamples: 1 }).map((i) => i.kind === "layer" && i.layer.motion)).toEqual([undefined]);
    expect(planFrame(moving(), 10, { motionSamples: 6 }).map((i) => (i.kind === "layer" ? i.layer.motion?.length : 0))).toEqual([6]);
  });

  it("blurs moving transitions only", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    p = addClip(p, p.tracks[0].id, solid("a", 0, 30, { motionBlur: { shutter: 180 } }));
    p = addClip(p, p.tracks[0].id, solid("b", 30, 30));
    const at = (type: string) => planFrame(setTransition(p, "a", { type, duration: 10 }), 30)[0];
    const push = at("pushLeft");
    expect(push.kind === "transition" && push.motion?.spread).toBeCloseTo(0.5 / 10, 9);
    expect(push.kind === "transition" && push.motion!.samples).toBeGreaterThan(1);
    const dissolve = at("dissolve");
    expect(dissolve.kind === "transition" && dissolve.motion).toBeUndefined();
  });
});

describe("edges and wiggle", () => {
  it("carry the edge mode", () => {
    expect(layers(stack(solid("s", 0, 10, { edge: "mirror" })), 0)[0].edge).toBe("mirror");
    expect(layers(stack(solid("s", 0, 10)), 0)[0].edge).toBeUndefined();
  });

  it("add the wiggle to the placement, and blur it when it moves", () => {
    const w = { x: { frequency: 5, amplitude: 0.05, seed: 3 } };
    const still = layers(stack(solid("s", 0, 90)), 20)[0] as Layer;
    const shaken = Array.from({ length: 30 }, (_, f) => layers(stack(solid("s", 0, 90, { wiggle: w })), f)[0].x);
    expect(still.x).toBe(0);
    expect(Math.max(...shaken.map(Math.abs))).toBeGreaterThan(0.01);
    expect(Math.max(...shaken.map(Math.abs))).toBeLessThanOrEqual(0.05);
    const blurred = layers(stack(solid("s", 0, 90, { wiggle: w, motionBlur: { shutter: 180 }, shape: { kind: "rectangle", width: 0.1, height: 0.1 } })), 20)[0];
    expect(blurred.motion?.length).toBeGreaterThan(1);
  });
});

describe("drop shadows and animated titles (ADR-070, ADR-071)", () => {
  it("carry the shadow, keyed, on the layer, but not on its canvas fill", () => {
    const p = stack(solid("w", 0, 30, { shadow: { color: "#000", blur: 60, x: 0, y: 24, opacity: 0.5 }, keyframes: { "shadow.blur": [{ f: 0, v: 0 }, { f: 10, v: 100 }] } }));
    expect(layers(p, 5)[0].shadow).toEqual({ color: "#000", blur: 50, x: 0, y: 24, opacity: 0.5 });
    expect(layers(stack(solid("plain", 0, 30)), 5)[0].shadow).toBeUndefined();
  });

  it("give a keyed title its style at the frame, and an unkeyed one itself", () => {
    const keyed = { ...createTextClip("Grow", 0, 30, { size: 80 }), id: "t", keyframes: { "style.size": [{ f: 0, v: 80 }, { f: 10, v: 160 }], "style.color": [{ f: 0, v: 0x000000 }, { f: 10, v: 0xffffff }] } } as Clip;
    const l = layers(stack(keyed), 5)[0];
    expect(l.source.kind === "text" && [l.source.clip.style.size, l.source.clip.style.color]).toEqual([120, "#808080"]);
    const plain = { ...createTextClip("Still", 0, 30), id: "s" } as Clip;
    const s = layers(stack(plain), 5)[0];
    expect(s.source.kind === "text" && s.source.clip).toBe(plain);
  });
});
