// export_versions on a designed film (the 2026-10-18 launch film's shape):
// floating windows that are compound clips sliding in with keyframed x and
// scale, a big one-word wordmark, titles beside the windows, and drifting
// full-frame glow sprites over a near-black background (ADR-067).

import { describe, expect, it } from "vitest";
import { safeArea } from "./ads";
import { runCommand } from "./commands";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import type { Clip, CompoundClip, ImageClip, Project, TextClip, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { boxOf, reshape } from "./versions";

// The engine's measure: about 0.55 em a character, wrapping between words
// at the style's width, and a word wider than that as wide as it is.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080, em = size * 0.55 + (c.style.letterSpacing * h) / 1080;
  const lines = c.text.split("\n").flatMap((para) => {
    const out: string[] = [];
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * em > c.style.maxWidth * w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    return [...out, line];
  });
  return { width: Math.max(...lines.map((l) => l.length * em)), height: size * c.style.lineHeight * lines.length };
});

const clips = (p: Project) => [...p.tracks, ...(p.compounds ?? []).flatMap((k) => k.tracks)].flatMap((t) => t.clips);
const find = <T extends Clip>(p: Project, pred: (c: Clip) => boolean) => clips(p).find(pred) as T;

/** A 4 s, 1920x1080 stretch of the film: background, a drifting glow, a
 * window (UI footage, border, shadow) sliding in from the right with an
 * expo-out, "Cut." on its left, then the wordmark. */
function film(): Project {
  let p: Project = {
    ...createProject({ name: "Launch" }),
    assets: [
      { id: "ui", kind: "video", name: "ui.mp4", src: "ui.mp4", duration: 10, width: 2560, height: 1440, fps: 30, hasVideo: true, hasAudio: false },
      { id: "shadow", kind: "image", name: "shadow.png", src: "shadow.png", duration: 0, width: 2400, height: 1500, hasVideo: true, hasAudio: false },
      { id: "glow", kind: "image", name: "glow.png", src: "glow.png", duration: 0, width: 1400, height: 1400, hasVideo: true, hasAudio: false },
    ],
  };
  p = runCommand(p, "add_color_clip", { color: "#05060a", start: 0, duration: 4 });
  p = runCommand(p, "batch", {
    commands: [
      { command: "add_media_clip", args: { asset_id: "glow", start: 0, duration: 4 } },
      { command: "set_param", args: { clip_ids: ["$1"], path: "transform.scale", value: 2.4 } },
      { command: "add_keyframe", args: { clip_id: "$1", path: "transform.x", at: 0, value: -0.08 } },
      { command: "add_keyframe", args: { clip_id: "$1", path: "transform.x", at: 3.9, value: 0.08 } },
      // The window's layers, made into one compound clip.
      { command: "add_media_clip", args: { asset_id: "shadow", start: 1, duration: 2 } },
      { command: "set_param", args: { clip_ids: ["$5"], path: "transform.scale", value: 1.12 } },
      { command: "add_media_clip", args: { asset_id: "ui", start: 1, duration: 2 } },
      { command: "set_param", args: { clip_ids: ["$7"], path: "transform.scale", value: 0.8 } },
      { command: "add_shape", args: { kind: "rounded_rectangle", start: 1, duration: 2, width: 0.8, height: 0.8, radius: 0.04, fill: false, stroke_color: "#ffffff2e", stroke_width: 2 } },
      { command: "create_compound_clip", args: { clip_ids: ["$5", "$7", "$9"], name: "Window: cut" } },
    ],
  });
  const win = find<CompoundClip>(p, (c) => c.type === "compound");
  p = runCommand(p, "batch", {
    commands: [
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.x", at: 1, value: 0.75, ease: "fastIn" } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.x", at: 1.5, value: 0.16 } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.scale", at: 1, value: 0.7 } },
      { command: "add_keyframe", args: { clip_id: win.id, path: "transform.scale", at: 2.99, value: 0.74 } },
      { command: "add_text", args: { text: "Cut.", start: 1, duration: 2, x: -0.346, y: -0.04, style: { size: 165, bold: true } } },
      { command: "add_text", args: { text: "OpenFrame", start: 3, duration: 1, y: 0.06, style: { size: 170, bold: true, letterSpacing: -5 } } },
    ],
  });
  return p;
}

/** The share of a box inside the frame. */
const shown = (q: Project, b: { left: number; right: number; top: number; bottom: number }) =>
  (Math.max(0, Math.min(b.right, q.width) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, q.height) - Math.max(b.top, 0))) / ((b.right - b.left) * (b.bottom - b.top));

describe("export_versions on a designed film", () => {
  it("knows the film: the window's box is what its timeline draws, sliding in from the right edge", () => {
    const p = film();
    const win = find<CompoundClip>(p, (c) => c.type === "compound");
    expect(win.keyframes!["transform.x"].map((k) => k.v)).toEqual([0.75, 0.16]);
    // At rest the window is a 16:9 picture well inside the 16:9 frame's width.
    const rest = boxOf(p, win, 15);
    expect(rest.right - rest.left).toBeLessThan(1920 * 0.8);
    expect(shown(p, boxOf(p, win, 0))).toBeLessThan(0.3);
  });

  for (const ratio of ["9:16", "1:1", "4:5"] as const) {
    it(`lays the sliding window out again on ${ratio}: inside the frame where it rests, off the edge where it starts`, () => {
      const p = film(), q = reshape(p, ratio, "fill");
      const win0 = find<CompoundClip>(p, (c) => c.type === "compound"), win = find<CompoundClip>(q, (c) => c.id === win0.id);
      // Too wide for the new frame, it is fitted to the safe area, clear of
      // the apps' buttons on 9:16.
      const rest = boxOf(q, win, 15), safe = safeArea(q);
      expect(rest.left).toBeGreaterThanOrEqual(safe.left * q.width - 1);
      expect(rest.right).toBeLessThanOrEqual((1 - safe.right) * q.width + 1);
      expect(rest.top).toBeGreaterThanOrEqual(safe.top * q.height - 1);
      expect(rest.bottom).toBeLessThanOrEqual((1 - safe.bottom) * q.height + 1);
      // The slide still starts mostly past the right edge, about as far out
      // as it did on 16:9, and moves the same way.
      const start = boxOf(q, win, 0);
      expect(start.left).toBeGreaterThan(rest.left);
      expect(shown(q, start)).toBeCloseTo(shown(p, boxOf(p, win0, 0)), 1);
      // Its ease and timing are the master's.
      expect(win.keyframes!["transform.x"].map((k) => [k.f, k.ease])).toEqual(win0.keyframes!["transform.x"].map((k) => [k.f, k.ease]));
    });
  }

  it("keeps the window's footage a whole 16:9 picture inside it on 9:16, not a crop", () => {
    const q = reshape(film(), "9:16", "fill");
    const k = q.compounds![0];
    const view = { ...q, tracks: k.tracks };
    const ui = k.tracks.flatMap((t) => t.clips).find((c) => c.type === "video")!;
    const b = boxOf(view, ui as VisualClip);
    expect((b.right - b.left) / (b.bottom - b.top)).toBeCloseTo(16 / 9, 2);
    expect(b.left).toBeGreaterThanOrEqual(-1);
    expect(b.right).toBeLessThanOrEqual(q.width + 1);
  });

  it("shrinks a one-word wordmark wider than the narrow frame to its safe width, centered", () => {
    for (const [ratio, room] of [["9:16", (1 - 0.11 - 0.19) * 1080], ["1:1", 0.9 * 1080]] as const) {
      const q = reshape(film(), ratio, "fill");
      const mark = find<TextClip>(q, (c) => c.type === "text" && c.text === "OpenFrame");
      const b = boxOf(q, mark);
      expect(b.right - b.left, ratio).toBeLessThanOrEqual(room * 1.03);
      expect(b.left, ratio).toBeGreaterThanOrEqual(0);
      expect(b.right, ratio).toBeLessThanOrEqual(q.width);
    }
  });

  it("keeps the drifting glow covering the frame and the title inside the safe area", () => {
    const q = reshape(film(), "9:16", "fill");
    const glow = find<ImageClip>(q, (c) => c.type === "image" && c.assetId === "glow");
    for (const f of [0, 60, 116]) {
      const b = boxOf(q, glow, f);
      expect(b.left).toBeLessThanOrEqual(0.5);
      expect(b.right).toBeGreaterThanOrEqual(q.width - 0.5);
      expect(b.top).toBeLessThanOrEqual(0.5);
      expect(b.bottom).toBeGreaterThanOrEqual(q.height - 0.5);
      expect(paramAt(glow, "transform.x", f)).toBeDefined();
    }
    const cut = find<TextClip>(q, (c) => c.type === "text" && c.text === "Cut.");
    const b = boxOf(q, cut);
    expect(b.left).toBeGreaterThanOrEqual(0.11 * 1080 - 0.5);
    expect(b.bottom).toBeLessThanOrEqual(0.65 * 1920 + 0.5);
  });
});
