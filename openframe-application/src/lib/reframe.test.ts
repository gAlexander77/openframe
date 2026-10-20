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
import { relOf, type Looks, type SubjectNote } from "./reframe";
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

  it("stays inside what the master showed: a push-in's framing is kept", () => {
    let { p, id } = film();
    // The master pushes in to 1.5x on the picture's middle.
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.scale", at: 0, value: 1 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.scale", at: 5.9, value: 1.5 });
    const q = reshape(p, "9:16", "fill", { looks: looking(id, () => 0.9) });
    const c = findClip(q, id)!.clip as VideoClip;
    // At the end the master shows 0.17..0.83 of the width: the frame keeps inside it.
    const rel = 177, l = { x: paramAt(c, "transform.x", rel), y: 0, scale: paramAt(c, "transform.scale", rel), rotation: 0, flipX: false, flipY: false } as Layer;
    expect(inSource(q, c, l, 1080, 0).u).toBeLessThanOrEqual(0.834);
    // At the start (the whole picture) it reaches the subject.
    expect(landing(q, id, 0.9, 0).x).toBeGreaterThan(300);
    expect(paramAt(c, "transform.scale", rel) / paramAt(c, "transform.scale", 0)).toBeCloseTo(1.5, 1);
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
