// Versions of screen-recording edits (ADR-122), from Claude film test 3's
// 1:1 version: crops followed detected subjects instead of the regions the
// editor pushed into, callouts were moved by the title layout rules, the
// spotlights' masks were not adapted, a frame-wide ring was shrunk by a
// transform scale its size keys did not know about, and the check sheet
// named only the rings that touched captions.

import { describe, expect, it } from "vitest";
import type { SaliencyMap } from "./analysis/subject";
import { runCommand } from "./commands";
import { inSource, onCanvas } from "./follow";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ColorClip, Project, VisualClip } from "./project/types";
import type { Looks } from "./reframe";
import { layerAt } from "./render/plan";
import { fittedSize, setTextMeasure } from "./render/size";
import { calloutsOf, type CalloutReport } from "./versionCallouts";
import { captionCollisions, versionProject } from "./versions";

// About 0.55 em a character, wrapping at the style's width, as versions.test.ts measures.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080;
  const widest = Math.max(...c.text.split("\n").map((l) => l.length)) * size * 0.55;
  const lines = c.text.split("\n").length * Math.max(1, Math.ceil(widest / (c.style.maxWidth * w)));
  return { width: Math.min(widest, c.style.maxWidth * w) + 4, height: size * c.style.lineHeight * lines + 4 };
});

const FPS = 30;
const frame = (s: number) => Math.round(s * FPS);
const clip = <T = VisualClip>(p: Project, id: string) => findClip(p, id)!.clip as T;
const ids = (p: Project) => new Set(p.tracks.flatMap((t) => t.clips).map((c) => c.id));
const added = (before: Project, after: Project) => [...ids(after)].filter((id) => !ids(before).has(id));

/** A 1920x1080 explainer with one 2560x1440 screen recording on its main
 * track from `start` for `duration` seconds. */
function recording(start = 0, duration = 7.3): { p: Project; shot: string } {
  let p: Project = { ...createProject({ name: "Explainer" }), assets: [{ id: "a_rec", kind: "video", name: "03-cut.mp4", src: "03-cut.mp4", duration: 30, width: 2560, height: 1440, fps: 30, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "a_rec", start, duration, in: 3.1, track_id: p.tracks.find((t) => t.main)!.id });
  return { p, shot: p.tracks.flatMap((t) => t.clips)[0].id };
}

/** Saliency with one blob at (u, v): what the detector calls the subject. */
function blob(u: number, v: number, r = 0.05): SaliencyMap {
  const w = 64, h = 36, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.max(0, 1 - Math.hypot((x + 0.5) / w - u, ((y + 0.5) / h - v) * (h / w)) / r);
  return { w, h, v: out };
}
const looking = (id: string, u: number, v: number, from = 3.1, seconds = 8): Looks => {
  const times = Array.from({ length: seconds * 2 + 1 }, (_, i) => from + i * 0.5);
  return { [id]: { assetId: "a_rec", times, maps: times.map(() => blob(u, v)) } };
};

/** The picture point (source fractions) at the version frame's center at second s. */
function frameCenter(q: Project, shot: string, s: number) {
  const c = clip(q, shot);
  return inSource(q, c, layerAt(q, c, frame(s))!, q.width / 2, q.height / 2);
}

/** Where a box of the master's canvas (fractions from the center, sizes in
 * fractions of the frame) is in the shot's picture at second s. */
function inShot(p: Project, shot: string, x: number, y: number, w: number, h: number, s: number) {
  const c = clip(p, shot), l = layerAt(p, c, frame(s))!;
  const f = fittedSize(p, c);
  const m = inSource(p, c, l, (0.5 + x) * p.width, (0.5 + y) * p.height);
  return { u: m.u, v: m.v, w: (w * p.width) / (f.w * l.scale), h: (h * p.height) / (f.h * l.scale) };
}

/** Where that picture box is drawn on q at second s, canvas pixels. */
function onVersion(q: Project, shot: string, t: { u: number; v: number; w: number; h: number }, s: number) {
  const c = clip(q, shot), l = layerAt(q, c, frame(s))!;
  const f = fittedSize(q, c);
  const at = onCanvas(q, c, l, t.u, t.v);
  return { cx: at.x, cy: at.y, w: t.w * f.w * l.scale, h: t.h * f.h * l.scale };
}

/** A ring's middle and size as q draws it at second s, canvas pixels. */
function ringOn(q: Project, id: string, s: number) {
  const c = clip<ColorClip>(q, id), r = frame(s) - c.start;
  const k = (path: string) => paramAt(c, path, r);
  return { cx: (0.5 + k("transform.x")) * q.width, cy: (0.5 + k("transform.y")) * q.height, w: k("shape.width") * q.width * k("transform.scale"), h: k("shape.height") * q.height * k("transform.scale") };
}

/** A spotlight's hole as q draws it at second s (its layer the whole frame). */
function holeOn(q: Project, id: string, s: number) {
  const c = clip<ColorClip>(q, id), r = frame(s) - c.start;
  const k = (path: string) => paramAt(c, path, r);
  return { cx: (0.5 + k("mask.x")) * q.width, cy: (0.5 + k("mask.y")) * q.height, w: k("mask.width") * q.width, h: k("mask.height") * q.height };
}

/** The tester's cut section: 03-cut at 12.3 s, a push into the timeline's
 * left side, the Split button ringed and spotlit at 14.2 s, both gliding to
 * the trimmed edge at 15.43-15.83 s (its calls 59, 74, 76 and 77). */
function cutSection() {
  const { p: p0, shot } = recording(12.3);
  let p = runCommand(p0, "frame_region", { clip_id: shot, region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.04, y: 0.38, w: 0.62, h: 0.62 }, from: 12.9, to: 13.7 });
  let before = p;
  p = runCommand(p, "add_shape", { kind: "rectangle", start: 14.2, duration: 4.3, width: 1, height: 1, color: "#000000", opacity: 0.5 });
  const dim = added(before, p)[0];
  p = runCommand(p, "set_mask", { clip_ids: [dim], shape: "rectangle", x: -0.377, y: -0.2, width: 0.08, height: 0.14, radius: 0.3, feather: 0.02, invert: true });
  before = p;
  p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 14.2, duration: 4.3, x: -0.377, y: -0.2, width: 0.08, height: 0.14, radius: 0.3, fill: false, stroke_color: "#22C3DA", stroke_width: 6 });
  const ring = added(before, p)[0];
  const glide = (id: string, paths: [string, number, number][]) => {
    for (const [path, a, b] of paths) {
      p = runCommand(p, "add_keyframe", { clip_id: id, path, at: 15.433, value: a, ease: "easeInOut" });
      p = runCommand(p, "add_keyframe", { clip_id: id, path, at: 15.833, value: b });
    }
  };
  glide(dim, [["mask.x", -0.377, 0.345], ["mask.y", -0.2, 0.31], ["mask.width", 0.08, 0.18], ["mask.height", 0.14, 0.23]]);
  glide(ring, [["transform.x", -0.377, 0.345], ["transform.y", -0.2, 0.31], ["shape.width", 0.08, 0.18], ["shape.height", 0.14, 0.23]]);
  return { p, shot, ring, dim };
}

describe("a version crops around the regions the editor framed", () => {
  it("keeps the Letter rise card the push was for, not the picture the detector sees beside it", () => {
    // Call 59: 05-titles framed on {0.55, 0.1, 0.45, 0.45}; the card the
    // ring circles is at 0.82 of the picture, a city picture at 0.6.
    const { p: p0, shot } = recording();
    const p = runCommand(p0, "frame_region", { clip_id: shot, region: { x: 0.55, y: 0.1, w: 0.45, h: 0.45 } });
    const q = versionProject(p, { ratio: "1:1" }, undefined, looking(shot, 0.6, 0.3));
    // Centered on the region, as the master frames it.
    expect(frameCenter(q, shot, 1).u).toBeCloseTo(0.775, 2);
    // The card is inside the frame: the window is 0.253 of the picture wide.
    const half = 1080 / 2 / (fittedSize(q, clip(q, shot)).w * layerAt(q, clip(q, shot), 30)!.scale);
    expect(Math.abs(0.8155 - frameCenter(q, shot, 1).u)).toBeLessThan(half - 0.04);
  });

  it("still frames the subject of a shot the master shows whole", () => {
    const { p, shot } = recording();
    const q = versionProject(p, { ratio: "1:1" }, undefined, looking(shot, 0.2, 0.5));
    expect(frameCenter(q, shot, 1).u).toBeLessThan(0.35);
  });
});

describe("rings and spotlights stay on what they point at", () => {
  const { p, shot, ring, dim } = cutSection();
  // The detector sees the middle of the region: the Split button would fall outside.
  const looks = looking(shot, 0.35, 0.69);
  const ringAt = (s: number) => {
    const c = clip<ColorClip>(p, ring), r = frame(s) - c.start;
    const k = (path: string) => paramAt(c, path, r);
    return inShot(p, shot, k("transform.x"), k("transform.y"), k("shape.width"), k("shape.height"), s);
  };

  for (const ratio of ["1:1", "9:16", "4:5"] as const) {
    it(`keeps the Split button and the trimmed edge in the ${ratio} crop, ring and hole on them`, () => {
      const q = versionProject(p, { ratio }, undefined, looks);
      for (const s of [14.3, 15.0, 15.433, 15.6, 15.833, 16.5, 18.4]) {
        const want = onVersion(q, shot, ringAt(s), s);
        const got = ringOn(q, ring, s), hole = holeOn(q, dim, s);
        // The target inside the frame.
        expect(want.cx - want.w / 2, `${ratio} at ${s}`).toBeGreaterThanOrEqual(-1);
        expect(want.cx + want.w / 2, `${ratio} at ${s}`).toBeLessThanOrEqual(q.width + 1);
        // The ring on it, its size the target's, and the hole on the ring.
        for (const [a, b] of [[got, want], [hole, want]] as const) {
          expect(Math.abs(a.cx - b.cx), `${ratio} at ${s}`).toBeLessThan(1);
          expect(Math.abs(a.cy - b.cy), `${ratio} at ${s}`).toBeLessThan(1);
          expect(Math.abs(a.w - b.w), `${ratio} at ${s}`).toBeLessThan(1);
          expect(Math.abs(a.h - b.h), `${ratio} at ${s}`).toBeLessThan(1);
        }
      }
      // The ring keeps its scale and its 6 px stroke against the short side.
      const c = clip<ColorClip>(q, ring);
      expect(c.transform.scale).toBe(1);
      expect(c.shape!.stroke!.width * (q.height / 1080)).toBeCloseTo(6 * (Math.min(q.width, q.height) / 1080), 1);
    });
  }

  it("names the shot's callouts and what they point into", () => {
    const found = calloutsOf(p);
    expect(found).toHaveLength(2);
    expect(found).toEqual(expect.arrayContaining([
      { id: dim, part: "mask", shot, follows: true },
      { id: ring, part: "shape", shot, follows: true },
    ]));
  });

  it("keeps a callout pinned with add_callout on its button, out of the overlay layout", () => {
    const { p: p0, shot: s0 } = recording(12.3);
    let m = runCommand(p0, "frame_region", { clip_id: s0, region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.04, y: 0.38, w: 0.62, h: 0.62 }, from: 12.9, to: 13.7 });
    const before = m;
    m = runCommand(m, "add_callout", { clip_id: s0, region: { x: 0.09, y: 0.52, w: 0.05, h: 0.09 }, at: 14.2, duration: 4.3, to: [{ region: { x: 0.51, y: 0.81, w: 0.11, h: 0.14 }, at: 15.83 }] });
    const pinned = added(before, m).find((id) => clip<ColorClip>(m, id).shape?.fill === false)!;
    const q = versionProject(m, { ratio: "1:1" }, undefined, looking(s0, 0.35, 0.69));
    for (const [s, r] of [[14.5, { x: 0.09, y: 0.52, w: 0.05, h: 0.09 }], [17, { x: 0.51, y: 0.81, w: 0.11, h: 0.14 }]] as const) {
      const want = onVersion(q, s0, { u: r.x + r.w / 2, v: r.y + r.h / 2, w: r.w, h: r.h }, s);
      const got = ringOn(q, pinned, s);
      expect(Math.abs(got.cx - want.cx), `at ${s}`).toBeLessThan(1);
      expect(Math.abs(got.cy - want.cy), `at ${s}`).toBeLessThan(1);
      expect(want.cx - want.w / 2).toBeGreaterThanOrEqual(0);
      expect(want.cx + want.w / 2).toBeLessThanOrEqual(q.width);
    }
  });
});

describe("a shape's size keys and the scale a version gives it agree", () => {
  it("draws the frame-wide timeline ring's Undo state at the Undo button's size", () => {
    // Calls 77 and 136: the ring around the timeline (0.88 wide) shrinks
    // onto the Undo button; the 1:1 version gave it transform.scale 0.57.
    const { p: p0, shot } = recording(0, 6);
    let p = runCommand(p0, "frame_region", { clip_id: shot, region: { x: 0, y: 0.25, w: 0.75, h: 0.75 } });
    const before = p;
    p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 1, duration: 3.2, x: 0.02, y: 0.235, width: 0.88, height: 0.24, radius: 0.15, fill: false, stroke_color: "#22C3DA", stroke_width: 6 });
    const ring = added(before, p)[0];
    for (const [path, a, b] of [["transform.x", 0.02, -0.431], ["transform.y", 0.235, 0.047], ["shape.width", 0.88, 0.06], ["shape.height", 0.24, 0.11]] as const) {
      p = runCommand(p, "add_keyframe", { clip_id: ring, path, at: 2.3, value: a, ease: "easeInOut" });
      p = runCommand(p, "add_keyframe", { clip_id: ring, path, at: 2.7, value: b });
    }
    const reports: CalloutReport[] = [];
    const q = versionProject(p, { ratio: "1:1" }, undefined, undefined, undefined, undefined, reports);
    const c = clip<ColorClip>(q, ring);
    expect(c.transform.scale).toBe(1);
    expect(c.keyframes?.["transform.scale"]).toBeUndefined();
    // The Undo button keeps its pixels on 1:1 (the picture does): so does its ring.
    expect(ringOn(q, ring, 3).w).toBeCloseTo(0.06 * 1920, 0);
    expect(ringOn(q, ring, 3).h).toBeCloseTo(0.11 * 1080, 0);
    // The timeline is wider than the square frame: named, not shrunk.
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ clip_id: ring, issue: "off_frame" });
    expect(reports[0].note).toMatch(/wider than this frame: fit "blur" or "fit" shows it whole/);
  });

  it("fits a shape too wide for the frame by its own size, keys and stroke with it, not a transform scale", () => {
    let p: Project = createProject({ name: "Card" });
    p = runCommand(p, "add_color_clip", { color: "#0F1117", start: 0, duration: 4, track_id: p.tracks.find((t) => t.main)!.id });
    const before = p;
    p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 0, duration: 4, width: 0.9, height: 0.3, fill: false, stroke_color: "#ffffff", stroke_width: 8 });
    const box = added(before, p)[0];
    p = runCommand(p, "add_keyframe", { clip_id: box, path: "shape.width", at: 1, value: 0.9 });
    p = runCommand(p, "add_keyframe", { clip_id: box, path: "shape.width", at: 2, value: 0.5 });
    const q = versionProject(p, { ratio: "9:16" });
    const c = clip<ColorClip>(q, box), was = clip<ColorClip>(p, box);
    expect(c.transform.scale).toBe(1);
    // One factor for the box, its keys and its stroke (pixels: 1920 tall).
    const k = (c.shape!.width * q.width) / (was.shape!.width * p.width);
    expect(k).toBeLessThan(1);
    expect((c.keyframes!["shape.width"][1].v * q.width) / (was.keyframes!["shape.width"][1].v * p.width)).toBeCloseTo(k, 3);
    expect((c.shape!.height * q.height) / (was.shape!.height * p.height)).toBeCloseTo(k, 3);
    expect((c.shape!.stroke!.width * q.height) / (was.shape!.stroke!.width * p.height)).toBeCloseTo(k, 2);
    // Inside the frame.
    expect(c.shape!.width).toBeLessThanOrEqual(1);
  });

  it("scales a solid's keyed mask with its static size", () => {
    let p: Project = createProject({ name: "Dim" });
    p = runCommand(p, "add_color_clip", { color: "#000000", start: 0, duration: 4, track_id: p.tracks.find((t) => t.main)!.id });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "rectangle", width: 0.2, height: 0.3, invert: true });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "mask.width", at: 1, value: 0.2 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "mask.width", at: 2, value: 0.4 });
    const q = versionProject(p, { ratio: "9:16" });
    const c = clip(q, id) as ColorClip, was = clip(p, id) as ColorClip;
    const k = c.mask!.width / was.mask!.width;
    expect(k).not.toBeCloseTo(1, 2);
    expect(c.keyframes!["mask.width"].map((x) => x.v / k)).toEqual(was.keyframes!["mask.width"].map((x) => expect.closeTo(x.v, 4)));
  });
});

describe("the check names a callout off the frame or off what it pointed at", () => {
  it("names a ring an override moved off its button", () => {
    const { p, ring } = cutSection();
    const reports: CalloutReport[] = [];
    versionProject(p, { ratio: "1:1", overrides: [{ clip_id: ring, x: 0.3, y: -0.3 }] }, undefined, undefined, undefined, undefined, reports);
    const r = reports.find((x) => x.clip_id === ring)!;
    expect(r).toMatchObject({ issue: "off_target" });
    expect(r.note).toMatch(/\(a ring\) sits over other content than in the master at [\d.]+ s in this shape: an override \{clip_id: "c_\w+", x: -?[\d.]+, y: -?[\d.]+\} puts it back/);
    // Followed, nothing is named.
    const clean: CalloutReport[] = [];
    versionProject(p, { ratio: "1:1" }, undefined, undefined, undefined, undefined, clean);
    expect(clean).toEqual([]);
  });

  it("asks for the captions to move, not a ring that crosses them", () => {
    // A 9:16 version burns its captions across a tall ring (as the Lift
    // ring's caption in the rebuilt film); an override moving the ring would
    // take it off the wheel it circles.
    const { p: p0 } = recording(0, 6);
    let p = runCommand(p0, "add_shape", { kind: "ellipse", start: 1, duration: 3, x: 0, y: 0.05, width: 0.3, height: 0.6, fill: false, stroke_color: "#22C3DA", stroke_width: 6 });
    const ring = added(p0, p)[0];
    p = runCommand(p, "add_captions", { captions: [{ text: "Lift the shadows", start: 1, end: 4 }] });
    const q = versionProject(p, { ratio: "9:16" });
    const hit = captionCollisions(q).find((x) => x.clip_id === ring)!;
    expect(hit.note).toMatch(/it points at what is under it, so move the captions/);
    expect(hit.note).not.toMatch(/an override \{clip_id/);
  });

  it("names a highlight box the layout moved off the footage, and keeps a ring around a caption on it", () => {
    const { p: p0, shot } = recording(0, 6);
    let p = runCommand(p0, "frame_region", { clip_id: shot, region: { x: 0.3, y: 0.05, w: 0.45, h: 0.45 } });
    let before = p;
    // A translucent box over a button near the frame's right edge.
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 1, duration: 2, x: 0.38, y: -0.1, width: 0.1, height: 0.1, color: "#22C3DA", opacity: 0.3 });
    const mark = added(before, p)[0];
    // The film's own caption, ringed (call 77's meta beat).
    p = runCommand(p, "add_captions", { captions: [{ text: "just like these", start: 3, end: 5 }] });
    const caption = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id;
    before = p;
    p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 3, duration: 2, x: 0, y: 0.368, width: 0.27, height: 0.13, radius: 1, fill: false, stroke_color: "#22C3DA", stroke_width: 6 });
    const ring = added(before, p)[0];
    expect(calloutsOf(p)).toEqual(expect.arrayContaining([{ id: mark, part: "shape", shot, follows: false }, { id: ring, part: "shape", title: caption, follows: true }]));
    const reports: CalloutReport[] = [];
    const q = versionProject(p, { ratio: "9:16" }, undefined, undefined, undefined, undefined, reports);
    expect(reports.find((r) => r.clip_id === mark)).toMatchObject({ issue: "off_target" });
    expect(reports.find((r) => r.clip_id === ring)).toBeUndefined();
    // The ring holds the caption's letters where the version put them.
    const r = ringOn(q, ring, 4), t = clip(q, caption);
    const cy = (0.5 + paramAt(t, "transform.y", 0)) * q.height;
    expect(Math.abs(r.cy - cy)).toBeLessThan(r.h / 2);
  });
});
