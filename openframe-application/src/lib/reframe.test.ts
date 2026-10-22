// export_versions keeps each shot's subject in frame (ADR-097): Codex's 9:16
// version of a 16:9 film center-cropped the speedboat and the Eiffel Tower
// out of it.

import { describe, expect, it } from "vitest";
import type { SaliencyMap } from "./analysis/subject";
import { runCommand } from "./commands";
import { inSource, onCanvas } from "./follow";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { Project, VideoClip } from "./project/types";
import { relOf, type OptionNote, type Looks, type SubjectNote } from "./reframe";
import type { Layer } from "./render/plan";
import { reshape, versionProject } from "./versions";

/** A saliency map with one blob centered at (u, v), `r` across. */
function blob(u: number, v = 0.45, r = 0.04): SaliencyMap {
  const w = 64, h = 36, out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = Math.max(0, 1 - Math.hypot((x + 0.5) / w - u, ((y + 0.5) / h - v) * (h / w)) / r);
  return { w, h, v: out };
}

/** A 1920x1080 film of one 6 s 16:9 shot. */
function film(): { p: Project; id: string } {
  let p: Project = { ...createProject({ name: "Earth" }), assets: [{ id: "a", kind: "video", name: "paris.mp4", src: "paris.mp4", duration: 12, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "a", start: 0, duration: 6, in: 2, track_id: p.tracks.find((t) => t.main)!.id });
  return { p, id: p.tracks.flatMap((t) => t.clips)[0].id };
}

/** Looks at the shot's source seconds 2..8 every half second, the subject
 * at `u(t)`. */
const looking = (id: string, u: (t: number) => number): Looks => {
  const times = Array.from({ length: 13 }, (_, i) => 2 + i * 0.5);
  return { [id]: { assetId: "a", times, maps: times.map((t) => blob(u(t))) } };
};

/** Where a point of the shot's picture lands on the version's frame at
 * clip frame `rel`, canvas pixels. */
function landing(q: Project, id: string, u: number, rel = 0) {
  const c = findClip(q, id)!.clip as VideoClip;
  const l = { x: paramAt(c, "transform.x", rel), y: paramAt(c, "transform.y", rel), scale: paramAt(c, "transform.scale", rel), rotation: 0, flipX: false, flipY: false } as Layer;
  return onCanvas(q, c, l, u, 0.45);
}

describe("versions keep the subject", () => {
  it("puts a tower right of center in a 9:16 frame, where the center crop lost it", () => {
    const { p, id } = film();
    const centered = reshape(p, "9:16", "fill");
    expect(landing(centered, id, 0.67).x).toBeGreaterThan(1080);
    const q = reshape(p, "9:16", "fill", { looks: looking(id, () => 0.67) });
    expect(landing(q, id, 0.67).x).toBeCloseTo(540, -1);
    // Still: one position, no keys.
    expect(findClip(q, id)!.clip.keyframes?.["transform.x"]).toBeUndefined();
  });

  it("follows a boat across the shot, keyed, the picture always covering the frame", () => {
    const { p, id } = film();
    const q = reshape(p, "9:16", "fill", { looks: looking(id, (t) => 0.25 + 0.06 * (t - 2)) });
    const c = findClip(q, id)!.clip as VideoClip;
    expect(c.keyframes?.["transform.x"]?.length).toBeGreaterThan(1);
    for (const rel of [0, 45, 90, 135, 179]) {
      const t = 2 + rel / 30, u = 0.25 + 0.06 * (t - 2);
      const x = landing(q, id, u, rel).x;
      expect(x, `at ${t} s`).toBeGreaterThan(1080 * 0.25);
      expect(x, `at ${t} s`).toBeLessThan(1080 * 0.75);
      // No empty band: the frame's edges stay on the picture.
      const l = { x: paramAt(c, "transform.x", rel), y: 0, scale: paramAt(c, "transform.scale", rel), rotation: 0, flipX: false, flipY: false } as Layer;
      expect(inSource(q, c, l, 0, 0).u).toBeGreaterThanOrEqual(-1e-3);
      expect(inSource(q, c, l, 1080, 0).u).toBeLessThanOrEqual(1 + 1e-3);
    }
  });

  it("takes a caller's focus over the subject, and center when asked", () => {
    const { p, id } = film();
    const looks = looking(id, () => 0.67);
    const q = reshape(p, "9:16", "fill", { looks, focus: [{ clip_id: id, x: 0.3 }] });
    expect(landing(q, id, 0.3).x).toBeCloseTo(540, -1);
    // A point past the reach of the frame is held at the picture's edge.
    const edge = reshape(p, "9:16", "fill", { looks, focus: [{ clip_id: id, x: 0.02 }] });
    expect(landing(edge, id, 0).x).toBeCloseTo(0, 0);
    const center = reshape(p, "9:16", "fill", { looks, reframe: "center" });
    expect(landing(center, id, 0.5).x).toBeCloseTo(540, 0);
  });

  it("stays inside what the master showed: a push-in's framing is kept, centered on the region it frames", () => {
    let { p, id } = film();
    // The master pushes in to 1.5x on the picture's middle.
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.scale", at: 0, value: 1 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.scale", at: 5.9, value: 1.5 });
    const q = reshape(p, "9:16", "fill", { looks: looking(id, () => 0.9) });
    const c = findClip(q, id)!.clip as VideoClip;
    // At the end the master shows 0.17..0.83 of the width: the frame keeps inside it.
    const rel = 177, l = { x: paramAt(c, "transform.x", rel), y: 0, scale: paramAt(c, "transform.scale", rel), rotation: 0, flipX: false, flipY: false } as Layer;
    expect(inSource(q, c, l, 1080, 0).u).toBeLessThanOrEqual(0.834);
    // The push frames a region (ADR-122): the frame stays on it from the
    // start, as the master's push does, rather than chasing the subject the
    // detector sees outside it (before, it reached 0.9 at the start).
    expect(landing(q, id, 0.5, 0).x).toBeCloseTo(540, 0);
    expect(landing(q, id, 0.5, rel).x).toBeCloseTo(540, 0);
    expect(paramAt(c, "transform.scale", rel) / paramAt(c, "transform.scale", 0)).toBeCloseTo(1.5, 1);
    // A drift under a tenth is motion: the subject still frames it.
    const slow = film();
    let drift = runCommand(slow.p, "add_keyframe", { clip_id: slow.id, path: "transform.scale", at: 0, value: 1 });
    drift = runCommand(drift, "add_keyframe", { clip_id: slow.id, path: "transform.scale", at: 5.9, value: 1.05 });
    expect(landing(reshape(drift, "9:16", "fill", { looks: looking(slow.id, () => 0.9) }), slow.id, 0.9, 0).x).toBeLessThan(1080);
  });

  it("keeps a wider version's frame around what a tall master showed, at the caller's focus", () => {
    // Claude film test 2: a 9:16 master pushes into the launch's middle
    // column (frame_region), its 16:9 version asks focus x 0.5. The frame,
    // wider than that column, was put with its left edge on the column's
    // (center 0.78, held at 0.59 by the picture's edge): the rocket sat left
    // of center, under the label's S.
    let { p, id } = film();
    p = { ...p, width: 1080, height: 1920 };
    p = runCommand(p, "frame_region", { clip_id: id, region: { x: 0.342, y: 0, w: 0.316, h: 1 }, to_region: { x: 0.37, y: 0.05, w: 0.259, h: 0.82 } });
    const end = 179;
    const focused = reshape(p, "16:9", "fill", { looks: looking(id, () => 0.5), focus: [{ clip_id: id, x: 0.5 }] });
    expect(landing(focused, id, 0.5, end).x).toBeCloseTo(960, -1);
    expect(landing(focused, id, 0.5, 0).x).toBeCloseTo(960, -1);
    // The subject framing centers it too, and the frame holds all the master showed.
    const q = reshape(p, "16:9", "fill", { looks: looking(id, () => 0.5) });
    expect(landing(q, id, 0.5, end).x).toBeCloseTo(960, -1);
    const c = findClip(q, id)!.clip as VideoClip;
    const l = { x: paramAt(c, "transform.x", end), y: paramAt(c, "transform.y", end), scale: paramAt(c, "transform.scale", end), rotation: 0, flipX: false, flipY: false } as Layer;
    expect(inSource(q, c, l, 0, 0).u).toBeLessThanOrEqual(0.37 + 1e-3);
    expect(inSource(q, c, l, 1920, 0).u).toBeGreaterThanOrEqual(0.629 - 1e-3);
  });

  it("relaxes or holds a tall master's keyed push on a version that asks, framing around what the master showed", () => {
    let { p, id } = film();
    p = { ...p, width: 1080, height: 1920 };
    p = runCommand(p, "frame_region", { clip_id: id, region: { x: 0.342, y: 0, w: 0.316, h: 1 }, to_region: { x: 0.37, y: 0.05, w: 0.259, h: 0.82 } });
    const end = 179;
    const zoom = (q: Project) => {
      const c = findClip(q, id)!.clip as VideoClip;
      return paramAt(c, "transform.scale", end) / paramAt(c, "transform.scale", 0);
    };
    const shownTop = (q: Project) => {
      const c = findClip(q, id)!.clip as VideoClip;
      const l = { x: paramAt(c, "transform.x", end), y: paramAt(c, "transform.y", end), scale: paramAt(c, "transform.scale", end), rotation: 0, flipX: false, flipY: false } as Layer;
      return inSource(q, c, l, 960, 0).v;
    };
    const looks = looking(id, () => 0.5);
    const kept = versionProject(p, { ratio: "16:9" }, undefined, looks);
    expect(zoom(kept)).toBeCloseTo(0.316 / 0.259, 2);
    // The master's push cut the top 5% of the picture: kept, so does the version.
    expect(shownTop(kept)).toBeCloseTo(0.05, 2);
    const relaxed = versionProject(p, { ratio: "16:9", pushes: "relax" }, undefined, looks);
    expect(zoom(relaxed)).toBeCloseTo(Math.sqrt(0.316 / 0.259), 2);
    expect(shownTop(relaxed)).toBeLessThan(0.05);
    const held = versionProject(p, { ratio: "16:9", pushes: "hold" }, undefined, looks);
    expect(zoom(held)).toBeCloseTo(1, 3);
    expect(shownTop(held)).toBeCloseTo(0, 2);
    expect(landing(held, id, 0.5, end).x).toBeCloseTo(960, -1);
  });

  it("notes a subject the master's own push crops in a wider version, which a held push shows", () => {
    // Claude film test 2: the 9:16 master pushes into the launch (the top
    // 9% of the picture cropped at its tightest); on 16:9 the same crop
    // cuts the rocket's nose off a wide frame. The strongest blob is the
    // flame; the nose is a faint streak running up from it.
    let { p, id } = film();
    p = { ...p, width: 1080, height: 1920 };
    p = runCommand(p, "frame_region", { clip_id: id, region: { x: 0.342, y: 0, w: 0.316, h: 1 }, to_region: { x: 0.37, y: 0.09, w: 0.26, h: 0.82 } });
    const rocket = (streak: boolean): SaliencyMap => {
      const m = blob(0.5, 0.6, 0.08);
      if (streak) for (let y = 1; y < Math.round(0.6 * m.h); y++) for (const x of [31, 32]) m.v[y * m.w + x] = Math.max(m.v[y * m.w + x], 0.3);
      return m;
    };
    const times = Array.from({ length: 13 }, (_, i) => 2 + i * 0.5);
    const looks = (streak: boolean): Looks => ({ [id]: { assetId: "a", times, maps: times.map(() => rocket(streak)) } });
    const notes: SubjectNote[] = [];
    versionProject(p, { ratio: "16:9" }, undefined, looks(true), notes);
    const pushed = notes.filter((n) => n.push);
    expect(pushed.length).toBeGreaterThan(0);
    // Where the push is tight, the subject's top (the nose) is off the frame.
    expect(pushed.every((n) => n.subject.top < 0.09 && n.kept < 1)).toBe(true);
    // Held, the version shows it; and a flame alone, which no push cuts, is not named.
    const held: SubjectNote[] = [];
    versionProject(p, { ratio: "16:9", pushes: "hold" }, undefined, looks(true), held);
    expect(held.filter((n) => n.push)).toEqual([]);
    const flame: SubjectNote[] = [];
    versionProject(p, { ratio: "16:9" }, undefined, looks(false), flame);
    expect(flame).toEqual([]);
    // The master's own shape crops nothing it did not show: no note there.
    const same: SubjectNote[] = [];
    versionProject(p, { ratio: "9:16" }, undefined, looks(true), same);
    expect(same).toEqual([]);
  });

  it("notes a subject the framing cuts, and one wider than the frame", () => {
    const { p, id } = film();
    const notes: SubjectNote[] = [];
    reshape(p, "9:16", "fill", { looks: looking(id, () => 0.67), reframe: "center", notes });
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatchObject({ clipId: id });
    expect(notes[0].kept).toBeLessThan(0.65);
    const fine: SubjectNote[] = [];
    reshape(p, "9:16", "fill", { looks: looking(id, () => 0.67), notes: fine });
    expect(fine).toEqual([]);
    // Two people far apart read as one wide subject (a tall figure each).
    const wide: Looks = { [id]: { assetId: "a", times: [2], maps: [blob(0.5, 0.5, 0.5)] } };
    const w: SubjectNote[] = [];
    reshape(p, "9:16", "fill", { looks: wide, notes: w });
    expect(w[0]).toMatchObject({ wide: true });
  });

  it("frames a cut-down's pieces from the same media's looks", () => {
    const { p, id } = film();
    const notes: SubjectNote[] = [];
    const q = versionProject(p, { ratio: "9:16", duration: 3 }, 30, looking(id, () => 0.67), notes);
    for (const c of q.tracks.flatMap((t) => t.clips)) expect(landing(q, c.id, 0.67).x, c.id).toBeCloseTo(540, -1);
  });

  it("maps source seconds to the clip's frames", () => {
    const { p, id } = film();
    const c = findClip(p, id)!.clip as VideoClip;
    expect(relOf(c, 2, p.fps)).toBe(0);
    expect(relOf(c, 3.5, p.fps)).toBe(45);
    expect(relOf(c, 9, p.fps)).toBeNull();
  });
});


it("reports center framing when the texture has no distinct subject, while an explicit focus still wins", () => {
  const { p, id } = film();
  const map = { w: 64, h: 36, v: Float32Array.from({ length: 64 * 36 }, (_, i) => i % 8 < 3 && Math.floor(i / 64) % 8 < 3 ? 1 : 0.05) };
  const looks = { [id]: { assetId: "a", times: [2, 4, 6], maps: [map, map, map] } };
  const says = { options: [] as OptionNote[], coverage: [] };
  const notes: SubjectNote[] = [];
  const q = versionProject(p, { ratio: "9:16" }, undefined, looks, notes, [], [], says);
  expect(landing(q, id, 0.5).x).toBeCloseTo(540, 0);
  expect(notes).toEqual([]);
  expect(says.options).toEqual(expect.arrayContaining([expect.objectContaining({ option: "reframe", note: expect.stringMatching(/no distinct subject.*center/i) })]));
  const focused = versionProject(p, { ratio: "9:16", focus: [{ clip_id: id, x: 0.73 }] }, undefined, looks);
  expect(landing(focused, id, 0.73).x).toBeCloseTo(540, 0);
});
