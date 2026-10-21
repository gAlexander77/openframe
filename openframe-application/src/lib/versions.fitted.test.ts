// Versions of fitted shots, and framing control (ADR-123), from Claude film
// test 4: a 58.5 s 9:16 how-to cut from 2560x1440 screen recordings pushed
// in with frame_region fit (the picture spans the frame's width, with dark
// bands above and below), add_callout rings pinned to them. Its 16:9
// version laid those shots out as pictures-in-picture: four rings and their
// dims ran off the frame, focus and pushes changed nothing and said
// nothing, an override on a shot left its rings behind, the shots that
// passed came out small in black, and nothing flagged it. frame_region
// could not hold a region mid-frame past about 3x on 9:16, and inside a
// batch it said its pinned rings were "moved by hand" to a single point.

import { describe, expect, it } from "vitest";
import { followAnchors } from "./anchors";
import { runCommand, type CommandReport } from "./commands";
import { inSource } from "./follow";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ColorClip, Project, VisualClip } from "./project/types";
import { layerAt } from "./render/plan";
import { fittedSize } from "./render/size";
import { calloutReports, type CalloutReport } from "./versionCallouts";
import { coverageReports, versionProject, type VersionSays } from "./versions";

const FPS = 30;
const frame = (s: number) => Math.round(s * FPS);
const clip = <T = VisualClip>(p: Project, id: string) => findClip(p, id)!.clip as T;
const ids = (p: Project) => new Set(p.tracks.flatMap((t) => t.clips).map((c) => c.id));
const rec = (id: string, name: string, duration: number, w = 2560, h = 1440) => ({ id, kind: "video" as const, name, src: name, duration, width: w, height: h, fps: 30, hasVideo: true, hasAudio: false });

/** The tester's master, from its calls 30, 33, 48, 49, 53 and 87: the
 * speedboat hook pushed in full frame, then eleven screen-recording shots
 * framed with frame_region fit (pushes up to 3.03x, pans to the
 * recording's edges), eight callouts gliding through their parts. */
function howTo() {
  let p: Project = { ...createProject({ name: "How-to" }), assets: [rec("a_boat", "speedboat.mp4", 12, 1920, 1080), rec("a_play", "02-timeline-play.mp4", 13.8), rec("a_lib", "12c-media-library.mp4", 11.97), rec("a_ai", "09-ai-agent.mp4", 23.17), rec("a_cut", "03-cut.mp4", 13.3), rec("a_titles", "05-titles.mp4", 25.67), rec("a_caps", "06-captions.mp4", 14.13), rec("a_exp", "10-export.mp4", 22.23)] };
  p = runCommand(p, "set_project", { width: 1080, height: 1920, fps: "30" });
  const main = p.tracks.find((t) => t.main)!.id;
  const shots: string[] = [];
  for (const [asset, start, inn, duration, speed] of [["a_boat", 0, 2, 2], ["a_play", 2, 4.9, 2.9], ["a_lib", 4.9, 0.6, 9], ["a_ai", 13.9, 6.2, 3.1], ["a_cut", 17, 0, 13.3, 1.2], ["a_titles", 28.083, 20.9, 3.3], ["a_titles", 31.383, 1.38, 8.22, 1.8], ["a_titles", 35.95, 13.6, 1.4], ["a_caps", 37.35, 3.6, 2.3], ["a_caps", 39.65, 8.6, 2.35], ["a_exp", 42, 0.55, 4.45], ["a_exp", 46.45, 5.2, 4.3, 1.4]] as const) {
    const before = ids(p);
    p = runCommand(p, "add_media_clip", { asset_id: asset, track_id: main, start, in: inn, duration });
    const id = [...ids(p)].find((x) => !before.has(x))!;
    shots.push(id);
    if (speed) p = runCommand(p, "set_speed", { clip_id: id, speed });
  }
  const [boat, play, lib, ai, cut, titles1, titles2, titles3, caps1, caps2, exp1, exp2] = shots;
  const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const fit = (clip_id: string, args: object) => (p = runCommand(p, "frame_region", { clip_id, mode: "fit", ...args }));
  p = runCommand(p, "frame_region", { clip_id: boat, region: R(0.3, 0, 0.316, 1), to_region: R(0.32, 0.06, 0.27, 0.854) });
  fit(play, { moves: [{ region: R(0.41, 0.15, 0.24, 0.25), at: 2 }, { region: R(0.41, 0.15, 0.24, 0.25), at: 2.3 }, { region: R(0.26, 0.04, 0.52, 0.711), at: 3.6 }] });
  fit(lib, { moves: [[R(0, 0.05, 0.48, 0.4), 4.9], [R(0, 0.05, 0.48, 0.4), 5.8], [R(0, 0.075, 0.33, 0.25), 6.5], [R(0, 0.075, 0.33, 0.25), 9.5], [R(0, 0.39, 0.33, 0.25), 10.2], [R(0, 0.39, 0.33, 0.25), 11.8], [R(0, 0.23, 0.33, 0.25), 12.4]].map(([region, at]) => ({ region, at })) });
  fit(ai, { moves: [{ region: R(0, 0.28, 0.38, 0.52), at: 13.9 }, { region: R(0, 0.28, 0.38, 0.52), at: 15.3 }, { region: R(0.22, 0.28, 0.38, 0.52), at: 16.9 }] });
  fit(cut, { moves: [[R(0.37, 0.505, 0.36, 0.45), 17], [R(0.37, 0.505, 0.36, 0.45), 18.1], [R(0.377, 0.75, 0.33, 0.25), 18.7], [R(0.377, 0.75, 0.33, 0.25), 19.6], [R(0.377, 0.495, 0.33, 0.25), 20.15], [R(0.377, 0.495, 0.33, 0.25), 21.2], [R(0, 0.495, 0.33, 0.25), 21.85], [R(0, 0.495, 0.33, 0.25), 22.6], [R(0.4, 0.75, 0.33, 0.25), 23.4]].map(([region, at]) => ({ region, at })) });
  fit(titles1, { region: R(0.336, 0.108, 0.393, 0.392), to_region: R(0.363, 0.19, 0.34, 0.22) });
  fit(titles2, { moves: [{ region: R(0, 0.06, 0.33, 0.25), at: 31.367 }, { region: R(0, 0.06, 0.33, 0.25), at: 33.9 }, { region: R(0.37, 0.175, 0.33, 0.25), at: 34.5 }] });
  fit(titles3, { region: R(0.67, 0.265, 0.33, 0.25) });
  fit(caps1, { region: R(0.06, 0.375, 0.33, 0.25) });
  fit(caps2, { region: R(0.336, 0.108, 0.393, 0.392), to_region: R(0.36, 0.2, 0.345, 0.3) });
  fit(exp1, { moves: [{ region: R(0.67, 0.025, 0.33, 0.25), at: 42 }, { region: R(0.67, 0.025, 0.33, 0.25), at: 44.1 }, { region: R(0.455, 0.11, 0.33, 0.25), at: 44.7 }] });
  fit(exp2, { moves: [{ region: R(0.455, 0.11, 0.33, 0.25), at: 46.433 }, { region: R(0.455, 0.6, 0.33, 0.25), at: 46.9 }] });
  const rings: string[] = [];
  const callout = (args: object) => {
    const before = ids(p);
    p = runCommand(p, "add_callout", { color: "#FFD23F", dim: 0.45, ...args });
    rings.push(...[...ids(p)].filter((x) => !before.has(x)));
  };
  callout({ clip_id: lib, region: R(0.011, 0.13, 0.06, 0.034), at: 6.5, duration: 7.4, shape: "rounded", to: [{ region: R(0.009, 0.062, 0.028, 0.052), at: 9.1, glide: 0.4 }, { region: R(0.104, 0.47, 0.092, 0.105), at: 10.5, glide: 0.5 }, { region: R(0.104, 0.306, 0.092, 0.105), at: 12.4, glide: 0.5 }, { region: R(0.166, 0.358, 0.028, 0.046), at: 13.15, glide: 0.35 }] });
  callout({ clip_id: ai, region: R(0.105, 0.605, 0.14, 0.1), at: 14.6, duration: 1.3 });
  callout({ clip_id: cut, region: R(0.456, 0.838, 0.172, 0.08), at: 18.75, duration: 9.15, to: [{ region: R(0.531, 0.558, 0.024, 0.036), at: 20.25, glide: 0.4 }, { region: R(0.099, 0.534, 0.024, 0.036), at: 21.95, glide: 0.6 }, { region: R(0.535, 0.838, 0.016, 0.08), at: 23.6, glide: 0.7 }, { region: R(0.577, 0.838, 0.016, 0.08), at: 25.6, glide: 1.6 }, { region: R(0.535, 0.838, 0.016, 0.08), at: 26.1, glide: 0.3 }] });
  callout({ clip_id: titles2, region: R(0.073, 0.062, 0.026, 0.052), at: 31.85, duration: 4.08, to: [{ region: R(0.147, 0.209, 0.068, 0.127), at: 33.35, glide: 0.4 }, { region: R(0.43, 0.262, 0.205, 0.065), at: 34.6, glide: 0.6 }] });
  callout({ clip_id: titles3, region: R(0.778, 0.354, 0.068, 0.073), at: 36.3, duration: 1.03 });
  callout({ clip_id: caps1, region: R(0.157, 0.462, 0.13, 0.082), at: 38.65, duration: 0.98 });
  callout({ clip_id: caps2, region: R(0.37, 0.38, 0.355, 0.045), at: 40.1, duration: 1.9, dim: 0.35 });
  callout({ clip_id: exp1, region: R(0.928, 0.006, 0.062, 0.036), at: 43.65, duration: 2.78, to: [{ region: R(0.495, 0.215, 0.262, 0.034), at: 44.95, glide: 0.5 }] });
  callout({ clip_id: exp2, region: R(0.495, 0.707, 0.262, 0.034), at: 46.75, duration: 2.78, to: [{ region: R(0.694, 0.84, 0.068, 0.04), at: 49.1, glide: 0.4 }] });
  return { p, shots, boat, lib, titles2, exp1, rings };
}

/** The picture's box on q at timeline second s, canvas pixels. */
function pictureBox(q: Project, id: string, s: number) {
  const c = clip(q, id), l = layerAt(q, c, frame(s))!, f = fittedSize(q, c);
  const w = f.w * l.scale, h = f.h * (l.scaleY ?? l.scale), cx = q.width * (0.5 + l.x), cy = q.height * (0.5 + l.y);
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, w, h };
}

/** The picture point (source fractions) at q's frame center at second s. */
const frameCenter = (q: Project, id: string, s: number) => inSource(q, clip(q, id), layerAt(q, clip(q, id), frame(s))!, q.width / 2, q.height / 2);

const says = (): VersionSays => ({ options: [], coverage: [] });

describe("a shot fitted with bands is footage a version reframes", () => {
  const { p, shots, lib, rings } = howTo();

  it("keeps every ring and dim of the 9:16 how-to on the 16:9 frame", () => {
    // Before: four rings and their dims off the frame at 10, 33.33, 36.3 and 44.47 s (100%, 27%, 36%, 90% outside).
    const reports: CalloutReport[] = [];
    versionProject(p, { ratio: "16:9" }, undefined, undefined, [], [], reports);
    expect(reports).toEqual([]);
    expect(rings.length).toBe(18);
  });

  it("fills the 16:9 frame with each interface shot, at its pixels where they cover it", () => {
    const q = versionProject(p, { ratio: "16:9" });
    for (const id of shots) {
      const c = clip(p, id);
      for (const s of [c.start / FPS + 0.2, (c.start + c.duration / 2) / FPS, (c.start + c.duration - 2) / FPS]) {
        const b = pictureBox(q, id, s);
        // No band: the picture covers the frame (it floated at 1728 x 972 before).
        expect(b.left).toBeLessThanOrEqual(0.5);
        expect(b.right).toBeGreaterThanOrEqual(q.width - 0.5);
        expect(b.top).toBeLessThanOrEqual(0.5);
        expect(b.bottom).toBeGreaterThanOrEqual(q.height - 0.5);
      }
    }
    // The media library at its 3.03x push: 3273 px wide in the master,
    // as wide in the version (its interface as readable on a phone).
    expect(pictureBox(q, lib, 8).w).toBeCloseTo(pictureBox(p, lib, 8).w, 0);
    expect(coverageReports(p, q)).toEqual([]);
  });

  it("frames it on what its ring points at as the ring glides", () => {
    const q = versionProject(p, { ratio: "16:9" });
    const ring = clip<ColorClip>(q, rings.slice(0, 2).find((x) => clip<ColorClip>(p, x).shape?.fill === false)!);
    // At 10 s the ring is on the Media tab (source 0.009-0.037, 0.062-0.114), at the recording's top-left corner.
    const r = frame(10) - ring.start;
    const cx = (0.5 + paramAt(ring, "transform.x", r)) * q.width, cy = (0.5 + paramAt(ring, "transform.y", r)) * q.height;
    const w = paramAt(ring, "shape.width", r) * q.width, h = paramAt(ring, "shape.height", r) * q.height;
    // Before: 100% above the frame (top -149 px).
    expect(cx - w / 2).toBeGreaterThan(0);
    expect(cy - h / 2).toBeGreaterThan(0);
    expect(frameCenter(q, lib, 10).u).toBeLessThan(0.33);
  });

  it("leaves a band of footage over a background, and a logo, as pictures", () => {
    let m: Project = { ...createProject({ name: "Layout" }), assets: [rec("bg", "bg.mp4", 10, 1080, 1920), rec("band", "band.mp4", 10, 1920, 1080)] };
    m = runCommand(m, "set_project", { width: 1080, height: 1920, fps: "30" });
    m = runCommand(m, "add_media_clip", { asset_id: "bg", start: 0, duration: 5, track_id: m.tracks[0].id });
    m = runCommand(m, "add_track", { kind: "video", name: "Band" });
    m = runCommand(m, "add_media_clip", { asset_id: "band", start: 0, duration: 5, track_id: m.tracks[0].id });
    const band = m.tracks[0].clips[0].id;
    const q = versionProject(m, { ratio: "16:9" });
    // Kept at its pixels against the short side, as a picture is: 1080 wide.
    expect(pictureBox(q, band, 1).w).toBeCloseTo(1080, 0);
  });
});

describe("focus, pushes and overrides act or say why not", () => {
  const { p, shots, boat, lib, titles2, rings } = howTo();

  it("moves a fitted shot's frame to a focus, and follows a path of points with at", () => {
    const plain = versionProject(p, { ratio: "16:9" });
    // Before: a silent no-op on the fitted shot. Across, the 16:9 frame keeps
    // all of the 0.33 of the picture the master showed, so y is what moves.
    const one = versionProject(p, { ratio: "16:9", focus: [{ clip_id: titles2, y: 0.4 }] });
    expect(frameCenter(plain, titles2, 32).v).toBeCloseTo(0.293, 2);
    expect(frameCenter(one, titles2, 32).v).toBeCloseTo(0.4, 2);
    // A path: down the left panel, then the title card, each centered at its time.
    const said = says();
    const path = versionProject(p, { ratio: "16:9", focus: [{ clip_id: titles2, y: 0.32, at: 32 }, { clip_id: titles2, y: 0.5, at: 34.6 }] }, undefined, undefined, [], [], [], said);
    expect(frameCenter(path, titles2, 33).v).toBeCloseTo(0.32, 2);
    expect(frameCenter(path, titles2, 34.7).v).toBeCloseTo(0.5, 2);
    // Moving over the 0.4 s before its time, not across the whole span.
    expect(frameCenter(path, titles2, 34.1).v).toBeCloseTo(0.32, 2);
    expect(said.options).toEqual([]);
    // Past what the master showed (its bottom 0.29 ran off its frame), a point is held and said.
    const held = says();
    versionProject(p, { ratio: "16:9", focus: [{ clip_id: titles2, y: 0.5 }] }, undefined, undefined, [], [], [], held);
    expect(held.options[0].note).toMatch(/focus y 0.5 on c_\w+ is held at 0\.41\d* at/);
  });

  it("says why a focus could not act, and where it was held back", () => {
    let m = p;
    const before = ids(m);
    m = runCommand(m, "add_text", { text: "1 · IMPORT", start: 4.9, duration: 5, y: -0.4 });
    const title = [...ids(m)].find((x) => !before.has(x))!;
    const said = says();
    versionProject(m, { ratio: "16:9", focus: [{ clip_id: title, x: 0.5 }, { clip_id: "c_gone", x: 0.5 }, { clip_id: lib, x: 0.98, y: 0.5 }] }, undefined, undefined, [], [], [], said);
    const notes = said.options.map((o) => `${o.clip_id}: ${o.note}`);
    expect(notes.find((n) => n.startsWith(title))).toMatch(/is a title, not footage a version crops: overrides/);
    expect(notes.find((n) => n.startsWith("c_gone"))).toMatch(/no clip c_gone in this version/);
    // x 0.98 cannot be centered: the frame keeps what the master showed (the picture's left third).
    expect(notes.find((n) => n.startsWith(lib))).toMatch(/focus x 0.98 on c_\w+ is held at 0\.29\d* at [\d.]+ s: the frame stays on the picture and around what the master showed of it/);
    // A version that keeps the shape crops nothing.
    const same = says();
    versionProject(m, { ratio: "original", focus: [{ clip_id: lib, x: 0.2 }] }, undefined, undefined, [], [], [], same);
    expect(same.options[0].note).toMatch(/keeps the master's shape/);
  });

  it("relaxes a fitted shot's push, and says when no shot has one", () => {
    const keep = versionProject(p, { ratio: "16:9" }), relax = versionProject(p, { ratio: "16:9", pushes: "relax" });
    // Before: identical output. The media library's 2.08x-3.03x push, halved as a ratio.
    const k = (q: Project) => clip(q, lib).keyframes!["transform.scale"].map((x) => x.v);
    expect(Math.max(...k(relax)) / Math.min(...k(relax))).toBeCloseTo(Math.sqrt(Math.max(...k(keep)) / Math.min(...k(keep))), 3);
    let still: Project = { ...createProject({ name: "Still" }), assets: [rec("a", "a.mp4", 10)] };
    still = runCommand(still, "add_media_clip", { asset_id: "a", start: 0, duration: 4 });
    const said = says();
    versionProject(still, { ratio: "9:16", pushes: "hold" }, undefined, undefined, [], [], [], said);
    expect(said.options).toEqual([{ option: "pushes", note: expect.stringMatching(/pushes "hold" changed nothing: no shot this version crops or fits has a keyed zoom/) }]);
    expect(boat).toBeTruthy();
  });

  it("offsets an overridden shot's keys and carries its rings with it", () => {
    const plain = versionProject(p, { ratio: "16:9" });
    const said = says();
    const reports: CalloutReport[] = [];
    const q = versionProject(p, { ratio: "16:9", overrides: [{ clip_id: lib, y: 0.2 }] }, undefined, undefined, [], [], reports, said);
    // Its pan kept, offset: every key moved by one amount.
    const ys = (x: Project) => clip(x, lib).keyframes!["transform.y"].map((k) => k.v);
    const d = ys(q).map((v, i) => +(v - ys(plain)[i]).toFixed(4));
    expect(new Set(d).size).toBe(1);
    expect(new Set(ys(q)).size).toBeGreaterThan(3);
    // Before: the ring and dim stayed where the picture had been, named off their target.
    expect(reports.filter((r) => r.issue === "off_target")).toEqual([]);
    expect(calloutReports(p, q).filter((r) => rings.slice(0, 2).includes(r.clip_id) && r.issue === "off_target")).toEqual([]);
    expect(said.options).toEqual([{ option: "overrides", clip_id: lib, note: expect.stringMatching(/moved with it/) }]);
    expect(shots.length).toBe(12);
  });
});

describe("footage left floating small in a version is named", () => {
  it("names a framed window that covered most of the 9:16 frame and floats on 16:9", () => {
    let m: Project = { ...createProject({ name: "Window" }), assets: [rec("a", "a.mp4", 10, 1080, 1920)] };
    m = runCommand(m, "set_project", { width: 1080, height: 1920, fps: "30" });
    m = runCommand(m, "add_media_clip", { asset_id: "a", start: 0, duration: 4 });
    const win = m.tracks.flatMap((t) => t.clips)[0].id;
    m = runCommand(m, "set_param", { clip_ids: [win], path: "transform.scale", value: 0.9 });
    m = runCommand(m, "set_border", { clip_ids: [win], width: 8, color: "#ffffff" });
    const said = says();
    versionProject(m, { ratio: "16:9" }, undefined, undefined, [], [], [], said);
    expect(said.coverage).toHaveLength(1);
    const r = said.coverage[0];
    expect(r.clip_id).toBe(win);
    expect(r.master).toBeGreaterThan(0.75);
    expect(r.covered).toBeLessThan(0.35);
    expect(r.note).toMatch(/floating in the empty rest: this version places it as a picture-in-picture .* an override \{clip_id: "c_\w+", scale: [\d.]+\}/);
  });
});

describe("frame_region places a region anywhere at any zoom", () => {
  /** 03-cut on a 9:16 canvas. */
  function cutOnTall() {
    let p: Project = { ...createProject({ name: "Cut" }), assets: [rec("a_cut", "03-cut.mp4", 13.3)] };
    p = runCommand(p, "set_project", { width: 1080, height: 1920, fps: "30" });
    p = runCommand(p, "add_media_clip", { asset_id: "a_cut", start: 0, duration: 8 });
    return { p, id: p.tracks.flatMap((t) => t.clips)[0].id };
  }
  /** Where the center of a source region lands on the canvas at second s, fractions from its center. */
  function landed(p: Project, id: string, r: { x: number; y: number; w: number; h: number }, s: number) {
    const c = clip(p, id), l = layerAt(p, c, frame(s))!, f = fittedSize(p, c);
    return { x: l.x + ((r.x + r.w / 2 - 0.5) * f.w * l.scale) / p.width, y: l.y + ((r.y + r.h / 2 - 0.5) * f.h * l.scale) / p.height };
  }

  it("holds the timeline's main track mid-frame at 4x instead of sliding it to the bottom edge", () => {
    const { p, id } = cutOnTall();
    const track = { x: 0.41, y: 0.644, w: 0.26, h: 0.356 };
    // Before (and without place_at): the picture slides back, the track lands 0.28 below the center (the apps' buttons).
    const slid = runCommand(p, "frame_region", { clip_id: id, mode: "fit", region: track });
    expect(landed(slid, id, track, 1).y).toBeGreaterThan(0.25);
    const placed = runCommand(p, "frame_region", { clip_id: id, mode: "fit", region: track, place_at: { x: 0, y: -0.05 } });
    expect(landed(placed, id, track, 1).x).toBeCloseTo(0, 4);
    expect(landed(placed, id, track, 1).y).toBeCloseTo(-0.05, 4);
    // Per move, in a push: the Import button at the top edge held at 0.1 above the middle.
    const moves = runCommand(p, "frame_region", { clip_id: id, mode: "fit", moves: [{ region: { x: 0, y: 0, w: 1, h: 1 }, at: 0 }, { region: { x: 0.01, y: 0.02, w: 0.2, h: 0.15 }, at: 2, place_at: { y: -0.1 } }] });
    expect(landed(moves, id, { x: 0.01, y: 0.02, w: 0.2, h: 0.15 }, 3).y).toBeCloseTo(-0.1, 4);
    expect(landed(moves, id, { x: 0, y: 0, w: 1, h: 1 }, 0).y).toBeCloseTo(0, 4);
  });
});

describe("frame_region in a batch says the truth about what is pinned", () => {
  it("does not call a followed ring moved by hand, and describes a gliding one as gliding", () => {
    const { p, lib, rings } = howTo();
    const report: CommandReport = {};
    const moves = [{ region: { x: 0, y: 0, w: 0.62, h: 0.62 }, at: 4.9 }, { region: { x: 0, y: 0.03, w: 0.5, h: 0.5 }, at: 6.5 }];
    // Before: "c_... was moved by hand, so it is pinned there now: it follows c_...'s picture at x 0.15, y 0.522 of its source".
    const q = runCommand(p, "batch", { commands: [{ command: "frame_region", args: { clip_id: lib, moves } }] }, report);
    expect(report.notes ?? []).toEqual([]);
    // The ring still follows its five regions through the new framing.
    const id = rings.slice(0, 2).find((x) => clip<ColorClip>(p, x).shape?.fill === false)!;
    expect(clip(q, id).anchor!.keys).toEqual(clip(p, id).anchor!.keys);
    // A real move of the gliding ring (a drag: every x key 0.01 to the right) is described as the glide it is.
    const notes: string[] = [];
    const ring = clip<ColorClip>(q, id);
    const dragged = { ...ring, transform: { ...ring.transform, x: ring.transform.x + 0.01 }, keyframes: { ...ring.keyframes, "transform.x": ring.keyframes!["transform.x"].map((k) => ({ ...k, v: k.v + 0.01 })) } };
    followAnchors(q, { ...q, tracks: q.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === ring.id ? dragged : c)) })) }, notes);
    expect(notes.join(" ")).toMatch(/was moved by hand, so it is pinned there now: it follows c_\w+'s picture through its 5 regions, each moved as much \(the region \{x: [\d.]+, y: [\d.]+, w: [\d.]+, h: [\d.]+\} of its source at [\d.]+ s/);
  });
});
