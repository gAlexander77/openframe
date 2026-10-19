// export_versions on a film laid out side by side (the 2026-10-19 launch
// film's shape, ADR-091): floating windows on alternating sides, each
// beside its headline, a glow behind one, a split screen with a label on
// each half, an end card, and captions on a hidden track. On a tall
// version every pair is stacked in the safe column and the captions are
// burned in below it; check_project's layout rules pass on the result.

import { describe, expect, it } from "vitest";
import { addAdElement, safeArea } from "./ads";
import { runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Project, TextClip, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { boxOf, expandVersions, sideBySide, versionProject } from "./versions";

// The engine's measure: about 0.55 em a character, wrapping between words
// at the style's width.
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

const all = (p: Project) => p.tracks.flatMap((t) => t.clips);
const byText = (p: Project, text: string) => all(p).find((c) => c.type === "text" && c.text === text) as TextClip;
const byId = (p: Project, id: string) => all(p).find((c) => c.id === id) as VisualClip;
const added = (before: Project, after: Project) => all(after).filter((c) => !all(before).some((o) => o.id === c.id));

/** 12 s of 1920x1080: a window and its headline on each side in turn, a
 * split screen with labels, an end card, captions on a hidden track. */
function film(): { p: Project; ids: Record<string, string> } {
  let p: Project = {
    ...createProject({ name: "Launch" }),
    assets: [
      { id: "ui", kind: "video", name: "ui.mp4", src: "ui.mp4", duration: 20, width: 2560, height: 1440, fps: 30, hasVideo: true, hasAudio: false },
      { id: "cam", kind: "video", name: "cam.mp4", src: "cam.mp4", duration: 20, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false },
    ],
  };
  const ids: Record<string, string> = {};
  p = runCommand(p, "add_color_clip", { color: "#05060a", start: 0, duration: 12 });
  // Window A on the left (a compound: footage and a border), a glow behind it.
  let q = runCommand(p, "add_shape", { kind: "ellipse", start: 0, duration: 3, x: -0.22, width: 0.5, height: 0.6, gradient: { kind: "radial", from: "#6a5cffcc", to: "transparent" } });
  ids.glow = added(p, q)[0].id;
  p = q;
  q = runCommand(p, "batch", {
    commands: [
      { command: "add_media_clip", args: { asset_id: "ui", start: 0, duration: 3 } },
      { command: "set_param", args: { clip_ids: ["$1"], path: "transform.scale", value: 0.8 } },
      { command: "add_shape", args: { kind: "rounded_rectangle", start: 0, duration: 3, width: 0.8, height: 0.8, radius: 0.04, fill: false, stroke_color: "#ffffff2e", stroke_width: 2 } },
      { command: "create_compound_clip", args: { clip_ids: ["$1", "$3"], name: "Window A" } },
    ],
  });
  ids.winA = added(p, q).find((c) => c.type === "compound")!.id;
  p = runCommand(q, "batch", {
    commands: [
      { command: "add_keyframe", args: { clip_id: ids.winA, path: "transform.x", at: 0, value: -0.75, ease: "fastIn" } },
      { command: "add_keyframe", args: { clip_id: ids.winA, path: "transform.x", at: 0.5, value: -0.22 } },
      { command: "set_param", args: { clip_ids: [ids.winA], path: "transform.scale", value: 0.45 } },
      { command: "add_text", args: { text: "Every edit\nis a tool.", start: 0, duration: 3, x: 0.25, style: { size: 100, bold: true } } },
    ],
  });
  // Window B on the right (footage alone), its headline on the left.
  q = runCommand(p, "add_media_clip", { asset_id: "ui", start: 3, duration: 3, track_id: p.tracks.find((t) => t.clips.some((c) => c.id === ids.winA))!.id });
  ids.winB = added(p, q)[0].id;
  p = runCommand(q, "batch", {
    commands: [
      { command: "set_param", args: { clip_ids: [ids.winB], path: "transform.scale", value: 0.45 } },
      { command: "set_param", args: { clip_ids: [ids.winB], path: "transform.x", value: 0.22 } },
      { command: "add_text", args: { text: "Agents call\nevery one.", start: 3, duration: 3, x: -0.25, style: { size: 100, bold: true } } },
    ],
  });
  // A split screen: two shots cut into halves, a label on each.
  p = runCommand(runCommand(p, "add_track", { kind: "video", name: "Left" }), "add_track", { kind: "video", name: "Right" });
  q = runCommand(p, "batch", {
    commands: [
      { command: "add_media_clip", args: { asset_id: "cam", start: 6, duration: 3, track_id: p.tracks[1].id } },
      { command: "add_media_clip", args: { asset_id: "ui", start: 6, duration: 3, track_id: p.tracks[0].id } },
    ],
  });
  const [left, right] = [q.tracks[1].clips[0].id, q.tracks[0].clips[0].id];
  ids.left = left;
  ids.right = right;
  p = runCommand(q, "apply_layout", { clip_ids: [left, right], layout: "split-vertical" });
  p = runCommand(p, "batch", {
    commands: [
      { command: "add_text", args: { text: "Before", start: 6, duration: 3, x: -0.242, y: -0.38, style: { size: 56, bold: true } } },
      { command: "add_text", args: { text: "After", start: 6, duration: 3, x: 0.258, y: -0.38, style: { size: 56, bold: true } } },
    ],
  });
  p = addAdElement(p, "end_card", { start: 270, duration: 90, headline: "OpenFrame", cta: "Free download" }).project;
  p = runCommand(p, "add_captions", {
    captions: [
      { start: 0.2, end: 2.8, text: "Every edit in OpenFrame is a tool" },
      { start: 3.2, end: 5.8, text: "that an agent can call by name" },
      { start: 6.2, end: 8.8, text: "before and after, side by side" },
      { start: 9.2, end: 11.8, text: "free, on your own computer" },
    ],
  });
  // As the film had them: the caption track hidden, exported as an SRT.
  p = { ...p, tracks: p.tracks.map((t) => (t.clips.length && t.clips.every((c) => c.type === "text" && c.caption) ? { ...t, hidden: true } : t)) };
  return { p, ids };
}

type Rect = { left: number; right: number; top: number; bottom: number };
const overlap = (a: Rect, b: Rect) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
const at = (q: Project, c: VisualClip, seconds: number) => boxOf(q, c, Math.round(seconds * 30) - c.start);
const safe = (q: Project): Rect => {
  const s = safeArea(q);
  return { left: s.left * q.width, right: q.width * (1 - s.right), top: s.top * q.height, bottom: q.height * (1 - s.bottom) };
};
const within = (b: Rect, r: Rect, slack = 1) => b.left >= r.left - slack && b.right <= r.right + slack && b.top >= r.top - slack && b.bottom <= r.bottom + slack;
const captionAt = (q: Project, seconds: number) => all(q).find((c) => c.type === "text" && c.caption && c.start <= seconds * 30 && seconds * 30 < c.start + c.duration) as TextClip;

describe("export_versions restacks a side-by-side film for tall frames", () => {
  it("finds the side-by-side pairs on the master", () => {
    const { p, ids } = film();
    const comps = sideBySide(p, (p.tracks.flatMap((t) => t.clips).filter((c) => c.type !== "audio" && c.type !== "adjustment" && !(c.type === "text" && c.caption) && c.type !== "color") as VisualClip[]).map((c) => [c]));
    const named = comps.map((comp) => comp.flat().map((c) => (c.type === "text" ? c.text : Object.entries(ids).find(([, id]) => id === c.id)?.[0])).sort());
    expect(named).toContainEqual(["Every edit\nis a tool.", "winA"]);
    expect(named).toContainEqual(["Agents call\nevery one.", "winB"]);
    expect(named).toContainEqual(["left", "right"]);
  });

  for (const ratio of ["9:16", "4:5"] as const) {
    it(`stacks each window above its headline on ${ratio}, inside the safe area and clear of the captions`, () => {
      const { p, ids } = film();
      const q = versionProject(p, { ratio });
      const area = safe(q);
      for (const [win, text, t] of [[ids.winA, "Every edit\nis a tool.", 2], [ids.winB, "Agents call\nevery one.", 4.5]] as const) {
        const w = at(q, byId(q, win), t), h = at(q, byText(q, text), t);
        expect(overlap(w, h), `${ratio} ${text}`).toBe(false);
        expect(w.bottom, `${ratio} ${text}`).toBeLessThanOrEqual(h.top + 0.5);
        expect(within(w, area), `${ratio} window`).toBe(true);
        expect(within(h, area), `${ratio} ${text}`).toBe(true);
        // Both centered on the apps' column; on 9:16 the picture is as wide
        // as it (on 4:5 the captions take the middle, and it shrinks).
        const column = { left: 0.11 * q.width, right: 0.81 * q.width };
        expect((w.left + w.right) / 2).toBeCloseTo((column.left + column.right) / 2, 0);
        expect((h.left + h.right) / 2).toBeCloseTo((column.left + column.right) / 2, 0);
        expect(w.right - w.left).toBeGreaterThan((column.right - column.left) * (ratio === "9:16" ? 0.8 : 0.45));
        // The burned caption below them both.
        const cap = boxOf(q, captionAt(q, t));
        expect(cap.top, `${ratio} caption`).toBeGreaterThanOrEqual(h.bottom);
      }
      // The window still slides in from off the left edge.
      const winA = byId(q, ids.winA);
      expect(at(q, winA, 0).right).toBeLessThan(at(q, winA, 2).left + 1);
    });

    it(`stacks the split screen's halves on ${ratio}, cut wider, each label on its half`, () => {
      const { p, ids } = film();
      const q = versionProject(p, { ratio });
      const L = at(q, byId(q, ids.left), 7.5), R = at(q, byId(q, ids.right), 7.5);
      expect(overlap(L, R)).toBe(false);
      expect(L.bottom).toBeLessThanOrEqual(R.top + 0.5);
      expect(within(L, safe(q))).toBe(true);
      expect(within(R, safe(q))).toBe(true);
      // Wider than tall now: the halves were tall slivers of 16:9.
      expect((L.right - L.left) / (L.bottom - L.top)).toBeGreaterThan(1);
      for (const [label, cell] of [["Before", L], ["After", R]] as const) {
        const b = at(q, byText(q, label), 7.5);
        expect(within(b, cell), label).toBe(true);
      }
    });
  }

  it("keeps the glow behind its window", () => {
    const { p, ids } = film();
    const q = versionProject(p, { ratio: "9:16" });
    const g = at(q, byId(q, ids.glow), 2), w = at(q, byId(q, ids.winA), 2);
    expect((g.left + g.right) / 2).toBeCloseTo((w.left + w.right) / 2, -1);
    expect((g.top + g.bottom) / 2).toBeCloseTo((w.top + w.bottom) / 2, -1);
  });

  it("burns the captions in on tall versions, sized by the short side and set in the apps' column", () => {
    const { p } = film();
    const q = versionProject(p, { ratio: "9:16" });
    const track = q.tracks.find((t) => t.clips.some((c) => c.type === "text" && c.caption))!;
    expect(track.hidden).toBe(false);
    const cap = captionAt(q, 1);
    expect(cap.style.size).toBeCloseTo(64 * (1080 / 1920), 1);
    expect(cap.transform).toMatchObject({ x: -0.04, y: 0.05 });
    expect(cap.style.maxWidth).toBeLessThanOrEqual(0.62);
    // As the project has them on a wide version; none or as_project when asked.
    expect(versionProject(p, { ratio: "1:1" }).tracks.find((t) => t.id === track.id)!.hidden).toBe(true);
    expect(versionProject(p, { ratio: "9:16", captions: "as_project" }).tracks.find((t) => t.id === track.id)!.hidden).toBe(true);
    expect(all(versionProject(p, { ratio: "9:16", captions: "none" })).filter((c) => c.type === "text" && c.caption).every((c) => c.disabled)).toBe(true);
    expect(versionProject(p, { ratio: "16:9", captions: "burn" }).tracks.find((t) => t.id === track.id)!.hidden).toBe(false);
  });

  for (const ratio of ["9:16", "4:5", "1:1"] as const) {
    it(`passes check_project's layout rules on ${ratio}`, () => {
      const q = versionProject(film().p, { ratio, captions: "burn" });
      const layout = checkProject(q).findings.filter((f) => ["text_outside_title_safe", "text_under_app_buttons", "text_too_small"].includes(f.rule));
      expect(layout.map((f) => `${f.rule}: ${f.message}`)).toEqual([]);
    });
  }

  it("takes captions for every version from the call", () => {
    expect(expandVersions({ ratios: ["9:16", "16:9"], captions: "none" }, 12)).toEqual([{ ratio: "9:16", captions: "none" }, { ratio: "16:9", captions: "none" }]);
    expect(expandVersions({ versions: [{ ratio: "9:16", captions: "burn" }], captions: "none" }, 12)).toEqual([{ ratio: "9:16", captions: "burn" }]);
  });

  it("keeps a square version side by side, each pair fitted as one", () => {
    const { p, ids } = film();
    const q = versionProject(p, { ratio: "1:1" });
    for (const [win, text, t] of [[ids.winA, "Every edit\nis a tool.", 2], [ids.winB, "Agents call\nevery one.", 4.5]] as const) {
      const w = at(q, byId(q, win), t), h = at(q, byText(q, text), t);
      // Still side by side, on the same sides, not on top of each other.
      expect(overlap(w, h), text).toBe(false);
      expect((h.left + h.right) / 2 > (w.left + w.right) / 2, text).toBe(win === ids.winA);
      expect(within(w, safe(q)) && within(h, safe(q)), text).toBe(true);
    }
    const L = at(q, byId(q, ids.left), 7.5), R = at(q, byId(q, ids.right), 7.5);
    expect(overlap(L, R)).toBe(false);
    expect(within(at(q, byText(q, "Before"), 7.5), L)).toBe(true);
  });

  for (const ratio of ["9:16", "4:5"] as const)
    it(`keeps the end card above the burned captions on ${ratio}`, () => {
      const q = versionProject(film().p, { ratio });
      const cap = boxOf(q, captionAt(q, 10.5));
      const card = all(q).filter((c) => c.name === "End card" && c.type === "text") as VisualClip[];
      for (const c of card) expect(at(q, c, 11.9).bottom, (c as TextClip).text).toBeLessThanOrEqual(cap.top);
    });

  it("never touches the master", () => {
    const { p } = film();
    const before = JSON.stringify(p);
    versionProject(p, { ratio: "9:16" });
    expect(JSON.stringify(p)).toBe(before);
  });
});

