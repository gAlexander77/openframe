// Callouts, anchors, frame_region moves and set_mask at (ADR-120), from
// Claude film test 3: a 70 s explainer made from 2560x1440 screen
// recordings, whose callouts took two hand-synced layers and 16 keys a
// move, placed by hand in canvas fractions while the zooms took source
// fractions.

import { describe, expect, it } from "vitest";
import { anchoredKeys, reanchor } from "./anchors";
import { calloutKeys } from "./callouts";
import { describeProject, runCommand, type CommandReport } from "./commands";
import { onCanvas } from "./follow";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ColorClip, Project, TextClip, VisualClip } from "./project/types";
import { layerAt } from "./render/plan";
import { fittedSize } from "./render/size";

const FPS = 30;

/** The explainer's cut section: 03-cut (2560x1440) at 12.3-19.6 s on a
 * 1920x1080 timeline. */
function film(): { p: Project; shot: string } {
  let p: Project = { ...createProject({ name: "Explainer" }), assets: [{ id: "a_cut", kind: "video", name: "03-cut.mp4", src: "03-cut.mp4", duration: 13.3, width: 2560, height: 1440, fps: 30, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "a_cut", start: 12.3, duration: 7.3, in: 3.1, track_id: p.tracks.find((t) => t.main)!.id });
  return { p, shot: p.tracks.flatMap((t) => t.clips)[0].id };
}

const clip = <T = VisualClip>(p: Project, id: string) => findClip(p, id)!.clip as T;
const all = (p: Project) => p.tracks.flatMap((t) => t.clips);
const frame = (s: number) => Math.round(s * FPS);

/** Where a point of the shot's picture (source fractions) is drawn at
 * timeline second `s`, canvas fractions from the center, as the renderer
 * places it. */
function drawn(p: Project, shot: string, u: number, v: number, s: number) {
  const c = clip(p, shot);
  const q = onCanvas(p, c, layerAt(p, c, frame(s))!, u, v);
  return { x: q.x / p.width - 0.5, y: q.y / p.height - 0.5 };
}

/** The canvas box a region of the shot covers at second `s`. */
function box(p: Project, shot: string, r: { x: number; y: number; w: number; h: number }, s: number) {
  const c = clip(p, shot), l = layerAt(p, c, frame(s))!;
  const { w, h } = fittedSize(p, c);
  return { ...drawn(p, shot, r.x + r.w / 2, r.y + r.h / 2, s), w: (r.w * w * l.scale) / p.width, h: (r.h * h * l.scale) / p.height };
}

const at = (p: Project, id: string, path: string, s: number) => {
  const c = clip(p, id);
  return paramAt(c, path, frame(s) - c.start);
};

/** The tester's push-in: the whole picture to the timeline's left side. */
const PUSH = { region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.04, y: 0.38, w: 0.62, h: 0.62 }, from: 12.9, to: 13.7 };
const SPLIT = { x: 0.06, y: 0.27, w: 0.04, h: 0.06 };
const EDGE = { x: 0.52, y: 0.62, w: 0.1, h: 0.12 };

describe("frame_region moves", () => {
  it("takes a push-in and a later pan in one call", () => {
    const { p: p0, shot } = film();
    const A = { x: 0.04, y: 0.38, w: 0.62, h: 0.62 }, B = { x: 0.3, y: 0.38, w: 0.62, h: 0.62 };
    const p = runCommand(p0, "frame_region", { clip_id: shot, moves: [{ region: { x: 0, y: 0, w: 1, h: 1 }, at: 12.9 }, { region: A, at: 13.7 }, { region: A, at: 15.4 }, { region: B, at: 15.8, ease: "fastIn" }] });
    const keys = clip(p, shot).keyframes!;
    expect(keys["transform.scale"].map((k) => k.f)).toEqual([18, 42, 93, 105]);
    expect(keys["transform.x"].map((k) => k.ease)).toEqual(["easeInOut", "easeInOut", [0.16, 1, 0.3, 1], undefined]);
    // Each region fills the frame at its moment, the same as one call for it.
    for (const [s, r] of [[13.7, A], [15.4, A], [15.8, B]] as const) {
      const one = runCommand(p0, "frame_region", { clip_id: shot, region: r });
      for (const path of ["transform.scale", "transform.x", "transform.y"]) expect(at(p, shot, path, s)).toBeCloseTo(paramAt(clip(one, shot), path, 0), 6);
    }
  });

  it("keeps the single-move form as it was", () => {
    const { p: p0, shot } = film();
    const p = runCommand(p0, "frame_region", { clip_id: shot, ...PUSH });
    const k = clip(p, shot).keyframes!["transform.scale"];
    expect(k).toEqual([{ f: 18, v: 1, ease: "easeInOut" }, { f: 42, v: 1.612903 }]);
  });

  it("refuses moves mixed with region, out of order, or outside the clip", () => {
    const { p, shot } = film();
    const r = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(() => runCommand(p, "frame_region", { clip_id: shot, region: r, moves: [{ region: r, at: 13 }] })).toThrow(/moves replaces region/);
    expect(() => runCommand(p, "frame_region", { clip_id: shot, moves: [{ region: r, at: 14 }, { region: r, at: 13 }] })).toThrow(/move 2 at 13 s is not after move 1/);
    expect(() => runCommand(p, "frame_region", { clip_id: shot, moves: [{ region: r, at: 25 }] })).toThrow(/outside/);
    expect(() => runCommand(p, "frame_region", { clip_id: shot })).toThrow(/give region/);
  });
});

describe("set_mask at", () => {
  it("keys a mask that had no keys, from its values at the clip's start", () => {
    // The tester's spotlight: a static hole on Split, then two calls with at.
    const { p: p0 } = film();
    let p = runCommand(p0, "add_shape", { kind: "rectangle", start: 14.2, duration: 4.3, width: 1, height: 1, color: "#000000", opacity: 0.5 });
    const id = all(p).find((c) => c.type === "color")!.id;
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "rectangle", x: -0.377, y: -0.2, width: 0.08, height: 0.14, radius: 0.3, invert: true });
    p = runCommand(p, "set_mask", { clip_ids: [id], at: 15.45, x: -0.377, y: -0.2, width: 0.08, height: 0.14 });
    p = runCommand(p, "set_mask", { clip_ids: [id], at: 15.85, x: 0.345, y: 0.31, width: 0.18, height: 0.23 });
    expect(clip(p, id).keyframes!["mask.x"].map((k) => [k.f, k.v])).toEqual([[0, -0.377], [37, -0.377], [49, 0.345]]);
    expect(at(p, id, "mask.width", 14.5)).toBeCloseTo(0.08);
    expect(at(p, id, "mask.width", 16)).toBeCloseTo(0.18);
  });

  it("says when at meets a mask the call makes", () => {
    const { p: p0 } = film();
    let p = runCommand(p0, "add_shape", { kind: "rectangle", start: 1, duration: 2 });
    const id = all(p).find((c) => c.type === "color")!.id;
    const report: CommandReport = {};
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "circle", at: 2, x: 0.1 }, report);
    expect(clip(p, id).keyframes?.["mask.x"]).toBeUndefined();
    expect(report.notes?.join(" ")).toMatch(/mask on .* is new/);
  });
});

describe("anchors", () => {
  it("keep a title on its point of the picture through a push-in, with keys only where the zoom moves", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_text", { text: "Split", start: 13, duration: 3, anchor: { clip_id: shot, x: 0.08, y: 0.3 } });
    const title = all(p).find((c) => c.type === "text")!.id;
    expect(clip(p, title).keyframes).toBeUndefined();
    expect(at(p, title, "transform.x", 13.5)).toBeCloseTo(drawn(p, shot, 0.08, 0.3, 13.5).x, 6);
    p = runCommand(p, "frame_region", { clip_id: shot, ...PUSH });
    // Exact: the zoom's own frames and ease (it starts 3 frames before the
    // title), nothing sampled.
    expect(clip(p, title).keyframes!["transform.x"].map((k) => [k.f, k.ease])).toEqual([[-3, "easeInOut"], [21, undefined]]);
    for (const s of [13, 13.1, 13.3, 13.45, 13.7, 15]) {
      const want = drawn(p, shot, 0.08, 0.3, s);
      expect(at(p, title, "transform.x", s)).toBeCloseTo(want.x, 4);
      expect(at(p, title, "transform.y", s)).toBeCloseTo(want.y, 4);
    }
  });

  it("follow the footage moved in time, and let go when it is deleted", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "frame_region", { clip_id: shot, ...PUSH });
    p = runCommand(p, "add_shape", { kind: "ellipse", start: 13, duration: 3, anchor: { clip_id: shot, x: 0.5, y: 0.5 } });
    const dot = all(p).find((c) => c.type === "color")!.id;
    p = runCommand(p, "move_clip", { clip_id: shot, start: 12.6 });
    for (const s of [13.2, 13.6, 14]) expect(at(p, dot, "transform.x", s)).toBeCloseTo(drawn(p, shot, 0.5, 0.5, s).x, 4);
    const report: CommandReport = {};
    p = runCommand(p, "delete_clips", { clip_ids: [shot] }, report);
    expect(clip(p, dot).anchor).toBeUndefined();
    expect(report.notes?.join(" ")).toMatch(/no longer follows/);
  });

  it("refuse x and y with an anchor, a clip on another timeline and a pinned clip", () => {
    const { p: p0, shot } = film();
    expect(() => runCommand(p0, "add_text", { text: "x", start: 13, duration: 1, x: 0.1, anchor: { clip_id: shot, x: 0.5, y: 0.5 } })).toThrow(/not both/);
    expect(() => runCommand(p0, "add_shape", { kind: "ellipse", start: 13, duration: 1, anchor: { clip_id: "c_nope", x: 0.5, y: 0.5 } })).toThrow(/no clip with id c_nope/);
    const p = runCommand(p0, "add_shape", { kind: "ellipse", start: 13, duration: 1, anchor: { clip_id: shot, x: 0.5, y: 0.5 } });
    const dot = all(p).find((c) => c.type === "color")!.id;
    expect(() => runCommand(p, "add_text", { text: "x", start: 13, duration: 1, anchor: { clip_id: dot, x: 0.5, y: 0.5 } })).toThrow(/itself pinned/);
  });

  it("sample a turn, within a pixel of where the point is drawn", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_keyframe", { clip_id: shot, path: "transform.rotation", at: 13, value: 0 });
    p = runCommand(p, "add_keyframe", { clip_id: shot, path: "transform.rotation", at: 14, value: 30 });
    p = runCommand(p, "add_text", { text: "x", start: 12.5, duration: 2, anchor: { clip_id: shot, x: 0.2, y: 0.2 } });
    const title = all(p).find((c) => c.type === "text")!.id;
    for (let s = 12.5; s < 14.4; s += 0.1) expect(Math.abs(at(p, title, "transform.x", s) - drawn(p, shot, 0.2, 0.2, s).x) * p.width).toBeLessThan(0.5);
  });

  it("are pinned again where a hand moves them", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_text", { text: "Split", start: 13, duration: 3, anchor: { clip_id: shot, x: 0.08, y: 0.3 } });
    const title = all(p).find((c) => c.type === "text")!.id;
    const report: CommandReport = {};
    p = runCommand(p, "set_param", { clip_ids: [title], path: "transform.y", value: 0.1 }, report);
    expect(report.notes?.join(" ")).toMatch(/moved by hand, so it is pinned there now/);
    expect(at(p, title, "transform.y", 13.5)).toBeCloseTo(0.1, 6);
    p = runCommand(p, "frame_region", { clip_id: shot, ...PUSH });
    const a = clip(p, title).anchor!.keys[0];
    expect(at(p, title, "transform.y", 15)).toBeCloseTo(drawn(p, shot, a.x, a.y, 15).y, 4);
  });

  it("show in describe_project, and set_anchor pins and unpins", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_text", { text: "Split", start: 13, duration: 3 });
    const title = all(p).find((c) => c.type === "text")!.id;
    p = runCommand(p, "set_anchor", { clip_ids: [title], anchor: { clip_id: shot, x: 0.25, y: 0.75 } });
    const described = describeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === title) as { anchor?: unknown };
    expect(described.anchor).toEqual({ clip_id: shot, x: 0.25, y: 0.75 });
    p = runCommand(p, "set_anchor", { clip_ids: [title], none: true });
    expect(clip(p, title).anchor).toBeUndefined();
    p = runCommand(p, "frame_region", { clip_id: shot, ...PUSH });
    expect(clip(p, title).keyframes).toBeUndefined();
    expect(() => runCommand(p, "set_anchor", { clip_ids: [title] })).toThrow(/give anchor/);
  });

  it("are written again by reanchor after footage moved outside the edit path", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_text", { text: "x", start: 13, duration: 2, anchor: { clip_id: shot, x: 0.9, y: 0.1 } });
    const title = all(p).find((c) => c.type === "text")!.id;
    const moved = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === shot ? { ...c, transform: { ...(c as VisualClip).transform, x: 0.1 } } : c)) })) } as Project;
    expect(at(reanchor(moved), title, "transform.x", 14)).toBeCloseTo(drawn(moved, shot, 0.9, 0.1, 14).x, 6);
  });
});

describe("add_callout", () => {
  /** The tester's Split callout on the pushed-in cut shot, gliding to the
   * clip's edge as it is trimmed. */
  function split() {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "frame_region", { clip_id: shot, region: PUSH.region, to_region: PUSH.to_region, from: 12.9, to: 13.7 });
    p = runCommand(p, "add_callout", { clip_id: shot, region: SPLIT, at: 12.9, duration: 4.3, to: [{ region: EDGE, at: 15.83 }] });
    const ring = all(p).find((c) => c.name === "Callout")!.id;
    const dim = all(p).find((c) => c.name === "Callout dim")!.id;
    return { p, shot, ring, dim };
  }

  it("rings the region and holes the dim on it through the push-in, and glides", () => {
    const { p, shot, ring, dim } = split();
    const pad = (6 * 2) / 1080;
    for (const s of [13, 13.3, 13.6, 14.5, 15.43]) {
      const want = box(p, shot, SPLIT, s);
      expect(at(p, ring, "transform.x", s)).toBeCloseTo(want.x, 4);
      expect(at(p, ring, "transform.y", s)).toBeCloseTo(want.y, 4);
      expect(at(p, ring, "shape.width", s)).toBeCloseTo(want.w + pad * (1080 / 1920), 4);
      expect(at(p, ring, "shape.height", s)).toBeCloseTo(want.h + pad, 4);
      // The dim fills the frame, so its hole's fractions are the canvas's.
      expect(at(p, dim, "mask.x", s)).toBeCloseTo(want.x, 4);
      expect(at(p, dim, "mask.height", s)).toBeCloseTo(want.h + pad, 4);
    }
    const edge = box(p, shot, EDGE, 16);
    expect(at(p, ring, "transform.x", 16)).toBeCloseTo(edge.x, 4);
    expect(at(p, dim, "mask.width", 16)).toBeCloseTo(edge.w + pad * (1080 / 1920), 4);
    // Few keys: the zoom's two, the glide's two, the ends.
    expect(clip(p, ring).keyframes!["transform.x"].length).toBeLessThanOrEqual(5);
    // One element: grouped, the dim under the ring, the ring drawing on.
    const r = clip<ColorClip>(p, ring), d = clip<ColorClip>(p, dim);
    expect(r.group).toBeDefined();
    expect(r.group).toBe(d.group);
    expect(p.tracks.findIndex((t) => t.clips.some((c) => c.id === ring))).toBeLessThan(p.tracks.findIndex((t) => t.clips.some((c) => c.id === dim)));
    expect(r.keyframes!["shape.draw"].map((k) => k.v)).toEqual([0, 1]);
    expect(d.mask).toMatchObject({ shape: "rectangle", invert: true, radius: 0.35 });
    expect(d.opacity).toBe(0.5);
  });

  it("follows a frame_region given after it", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_callout", { clip_id: shot, region: SPLIT, at: 13, duration: 3, shape: "ring", dim: 0 });
    const ring = all(p).find((c) => c.name === "Callout")!.id;
    expect(all(p).some((c) => c.name === "Callout dim")).toBe(false);
    expect(clip<ColorClip>(p, ring).shape!.kind).toBe("ellipse");
    p = runCommand(p, "frame_region", { clip_id: shot, moves: [{ region: PUSH.region, at: 13.2 }, { region: PUSH.to_region, at: 14 }] });
    for (const s of [13.2, 13.5, 14, 15]) expect(at(p, ring, "transform.x", s)).toBeCloseTo(box(p, shot, SPLIT, s).x, 4);
  });

  it("moves its hole with its ring when the ring is moved by hand", () => {
    const { p: p0, shot } = film();
    let p = runCommand(p0, "add_callout", { clip_id: shot, region: SPLIT, at: 13, duration: 3 });
    const ring = all(p).find((c) => c.name === "Callout")!.id, dim = all(p).find((c) => c.name === "Callout dim")!.id;
    p = runCommand(p, "set_param", { clip_ids: [ring], path: "transform.x", value: 0.2 });
    expect(at(p, dim, "mask.x", 14)).toBeCloseTo(0.2, 4);
    expect(clip(p, dim).anchor!.keys).toEqual(clip(p, ring).anchor!.keys);
  });

  it("refuses footage it does not overlap, a glide out of order, and sound in a batch with no click", () => {
    const { p, shot } = film();
    expect(() => runCommand(p, "add_callout", { clip_id: shot, region: SPLIT, at: 30 })).toThrow(/does not overlap/);
    expect(() => runCommand(p, "add_callout", { clip_id: shot, region: SPLIT, at: 13, duration: 3, to: [{ region: EDGE, at: 12 }] })).toThrow(/to 1 arrives at 12 s, not after the callout starts/);
    expect(() => runCommand(p, "add_callout", { clip_id: shot, region: SPLIT, at: 13, duration: 1, to: [{ region: EDGE, at: 15 }] })).toThrow(/after the callout ends/);
    expect(() => runCommand(p, "batch", { commands: [{ command: "add_callout", args: { clip_id: shot, region: SPLIT, at: 13, sound: true } }] })).toThrow(/click's file/);
  });

  it("clicks as it draws on when the project has the click", () => {
    const { p: p0, shot } = film();
    const p1 = { ...p0, assets: [...p0.assets, { id: "a_click", kind: "audio" as const, name: "Click.wav", src: "click.wav", duration: 0.1, hasVideo: false, hasAudio: true, role: "effects" as const, sound: { id: "click" } }] };
    const p = runCommand(p1, "add_callout", { clip_id: shot, region: SPLIT, at: 13, sound: true });
    const click = all(p).find((c) => c.type === "audio")!;
    expect(click.start).toBe(frame(13));
    expect((click as { volume: number }).volume).toBe(0.35);
  });

  it("holds before each glide for its length", () => {
    const keys = calloutKeys({ region: SPLIT, start: 0, duration: 120, to: [{ region: EDGE, f: 60, glide: 12 }] });
    expect(keys.map((k) => [k.f, k.ease])).toEqual([[0, undefined], [48, "easeInOut"], [60, undefined]]);
    expect(keys[1].x).toBe(keys[0].x);
  });

  it("writes keys a titled overlay can read in its own frames", () => {
    const { p, shot, ring } = split();
    const { keys } = anchoredKeys(p, clip(p, shot), clip(p, ring));
    expect(keys[0][0].f).toBe(0);
    expect(clip<TextClip>(p, ring).anchor!.pad).toBe(6);
  });
});
