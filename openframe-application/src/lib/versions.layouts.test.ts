// export_versions on designed layouts (ADR-101): an animated title card
// built as a compound, a split screen whose halves fill the frame, and a
// picture-in-picture with a mask under a lower third; and a version's
// overrides, by hand. Each version keeps its subjects and text inside the
// frame and the safe area as check_project judges it.

import { describe, expect, it } from "vitest";
import { addAdElement } from "./ads";
import { VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Clip, CompoundClip, Project, TextClip, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { applyOverrides, boxOf, expandVersions, versionProject } from "./versions";

// The engine's measure: about 0.55 em a character, wrapping between words.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080, em = size * 0.55;
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
const inside = (p: Project) => [...all(p), ...(p.compounds ?? []).flatMap((k) => k.tracks.flatMap((t) => t.clips))];
const added = (before: Project, after: Project) => inside(after).filter((c) => !inside(before).some((o) => o.id === c.id));
const byId = <T extends Clip = VisualClip>(p: Project, id: string) => inside(p).find((c) => c.id === id) as T;

/** 15 s of 1920x1080: 0-5 a title card built as a compound (a box that
 * grows, a headline rising in, a subhead) over footage; 5-10 a split
 * screen, two cropped halves filling the frame, a label on each; 10-15 a
 * round picture-in-picture over footage, under a lower third. */
function layouts(): { p: Project; ids: Record<string, string> } {
  let p: Project = {
    ...createProject({ name: "Layouts" }),
    assets: ["city", "sea", "sky", "harbor"].map((id) => ({ id, kind: "video" as const, name: `${id}.mp4`, src: `${id}.mp4`, duration: 12, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false })),
  };
  const ids: Record<string, string> = {};
  const step = (cmd: string, args: Record<string, unknown>, name?: string) => {
    const q = runCommand(p, cmd, args);
    if (name) ids[name] = added(p, q)[0].id;
    p = q;
  };
  step("add_media_clip", { asset_id: "city", start: 0, duration: 5 }, "city");
  step("add_shape", { kind: "rounded_rectangle", start: 0, duration: 5, width: 0.62, height: 0.36, color: "#101820dd", radius: 0.15 }, "box");
  step("add_text", { text: "CITY OF LIGHT", start: 0, duration: 5, y: -0.04, style: { size: 120, bold: true } }, "head");
  step("add_text", { text: "A weekend in Paris", start: 0, duration: 5, y: 0.09, style: { size: 56 } }, "sub");
  step("set_animation", { clip_id: ids.head, slot: "in", type: "rise", duration: 0.6 });
  step("add_keyframe", { clip_id: ids.box, path: "shape.width", at: 0, value: 0.05 });
  step("add_keyframe", { clip_id: ids.box, path: "shape.width", at: 0.6, value: 0.62 });
  step("create_compound_clip", { clip_ids: [ids.box, ids.head, ids.sub], name: "Title card" }, "card");
  step("add_media_clip", { asset_id: "city", start: 5, duration: 5, in: 5 }, "left");
  step("add_track", { kind: "video", name: "Right" });
  step("add_media_clip", { asset_id: "sea", start: 5, duration: 5, track_id: p.tracks[0].id }, "right");
  step("set_crop", { clip_ids: [ids.left, ids.right], left: 0.25, right: 0.25 });
  step("set_param", { clip_ids: [ids.left], path: "transform.x", value: -0.25 });
  step("set_param", { clip_ids: [ids.right], path: "transform.x", value: 0.25 });
  step("add_text", { text: "PARIS", start: 5, duration: 5, x: -0.25, y: 0.33, style: { size: 72, bold: true } }, "labelL");
  step("add_text", { text: "THE SEA", start: 5, duration: 5, x: 0.25, y: 0.33, style: { size: 72, bold: true } }, "labelR");
  step("add_media_clip", { asset_id: "sky", start: 10, duration: 5 }, "sky");
  step("add_track", { kind: "video", name: "PIP" });
  step("add_media_clip", { asset_id: "harbor", start: 10, duration: 5, track_id: p.tracks[0].id }, "pip");
  step("set_param", { clip_ids: [ids.pip], path: "transform.scale", value: 0.36 });
  step("set_param", { clip_ids: [ids.pip], path: "transform.x", value: 0.27 });
  step("set_param", { clip_ids: [ids.pip], path: "transform.y", value: -0.22 });
  step("set_mask", { clip_ids: [ids.pip], shape: "circle", width: 0.56, height: 1 });
  const before = p;
  p = addAdElement(p, "lower_third", { start: 315, duration: 120, headline: "Downtown", subline: "Live from the 40th floor" }).project;
  const lower = added(before, p).filter((c) => c.type === "text") as TextClip[];
  ids.name = lower.find((c) => c.text === "Downtown")!.id;
  ids.role = lower.find((c) => c.text !== "Downtown")!.id;
  return { p, ids };
}

/** The frame's safe area as check_project judges it, pixels. */
function safe(q: Project) {
  const s = q.height > q.width ? VERTICAL_SAFE : { left: 0.05, top: 0.05, right: 0.05, bottom: 0.05 };
  return { left: s.left * q.width, right: q.width * (1 - s.right), top: s.top * q.height, bottom: q.height * (1 - s.bottom) };
}
const within = (b: { left: number; right: number; top: number; bottom: number }, r: typeof b) => b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;

/** A clip's box where it rests, through the compound clip that plays it. */
function inCard(q: Project, card: CompoundClip, id: string) {
  const k = q.compounds!.find((x) => x.id === card.compoundId)!;
  const inner = boxOf({ ...q, tracks: k.tracks }, byId(q, id), 30);
  const s = card.transform.scale, cx = q.width / 2 + card.transform.x * q.width, cy = q.height / 2 + card.transform.y * q.height;
  return { left: cx + (inner.left - q.width / 2) * s, right: cx + (inner.right - q.width / 2) * s, top: cy + (inner.top - q.height / 2) * s, bottom: cy + (inner.bottom - q.height / 2) * s };
}

describe("versions of designed layouts", () => {
  for (const ratio of ["9:16", "1:1", "4:5"] as const) {
    it(`keeps the title card one picture on ${ratio}: its text inside its box, the box inside the safe area`, () => {
      const { p, ids } = layouts();
      const q = versionProject(p, { ratio });
      const card = byId<CompoundClip>(q, ids.card);
      const box = inCard(q, card, ids.box), head = inCard(q, card, ids.head), sub = inCard(q, card, ids.sub);
      for (const [name, t] of [["headline", head], ["subhead", sub]] as const) expect(within(t, box), `${ratio} ${name}`).toBe(true);
      // The headline keeps a margin in its box, as the master's did (about 13% each side).
      expect((box.right - box.left - (head.right - head.left)) / (box.right - box.left), ratio).toBeGreaterThan(0.12);
      expect(within(box, safe(q)), ratio).toBe(true);
      // The subhead is still readable: drawn at least at the frame's floor.
      const k = q.compounds!.find((x) => x.id === card.compoundId)!;
      const drawn = (k.tracks.flatMap((t) => t.clips).find((c) => c.id === ids.sub) as TextClip).style.size * card.transform.scale;
      expect(drawn, ratio).toBeGreaterThanOrEqual(minTextSize(q.width, q.height) - 0.01);
    });

    it(`fills the ${ratio} frame with the split screen, its labels on their halves and in the safe area`, () => {
      const { p, ids } = layouts();
      const q = versionProject(p, { ratio });
      const L = boxOf(q, byId(q, ids.left), 0), R = boxOf(q, byId(q, ids.right), 0);
      const u = { left: Math.min(L.left, R.left), right: Math.max(L.right, R.right), top: Math.min(L.top, R.top), bottom: Math.max(L.bottom, R.bottom) };
      expect([u.left, u.top], ratio).toEqual([expect.closeTo(0, 0), expect.closeTo(0, 0)]);
      expect([u.right, u.bottom], ratio).toEqual([expect.closeTo(q.width, 0), expect.closeTo(q.height, 0)]);
      // Stacked on a tall frame, side by side on a square one.
      if (q.height > q.width) expect(L.bottom, ratio).toBeLessThanOrEqual(R.top + 1);
      else expect(L.right, ratio).toBeLessThanOrEqual(R.left + 1);
      for (const [label, half] of [[ids.labelL, L], [ids.labelR, R]] as const) {
        const b = boxOf(q, byId(q, label), 0);
        expect(within(b, half) && within(b, safe(q)), `${ratio} ${(byId(q, label) as TextClip).text}`).toBe(true);
      }
    });

    it(`passes check_project's layout rules on ${ratio}, the lower third's role line included`, () => {
      const { p, ids } = layouts();
      const q = versionProject(p, { ratio });
      const layout = checkProject(q).findings.filter((f) => ["text_outside_title_safe", "text_under_app_buttons", "text_too_small"].includes(f.rule));
      expect(layout.map((f) => `${f.rule}: ${f.message}`), ratio).toEqual([]);
      expect(byId<TextClip>(q, ids.role).style.size, ratio).toBeGreaterThanOrEqual(minTextSize(q.width, q.height) - 0.01);
      // The round picture keeps its mask round and its place inside the frame.
      const pip = byId(q, ids.pip);
      expect(pip.mask, ratio).toMatchObject({ shape: "circle", width: 0.56, height: 1 });
      expect(within(boxOf(q, pip, 0), { left: 0, top: 0, right: q.width, bottom: q.height }), ratio).toBe(true);
    });
  }
});

describe("a version's overrides", () => {
  it("move a lower third with its group, enlarge a title inside a compound and hide a clip, in that version only", () => {
    const { p, ids } = layouts();
    const auto = versionProject(p, { ratio: "9:16" });
    const q = versionProject(p, { ratio: "9:16", overrides: [{ clip_id: ids.name, y: 0.05 }, { clip_id: ids.head, scale: 1.2 }, { clip_id: ids.pip, hidden: true }] });
    // The name rests at y 0.05; its role line moved by as much, below it.
    expect(byId(q, ids.name).transform.y).toBeCloseTo(0.05, 5);
    const moved = byId(q, ids.name).transform.y - byId(auto, ids.name).transform.y;
    expect(byId(q, ids.role).transform.y - byId(auto, ids.role).transform.y).toBeCloseTo(moved, 4);
    // The headline 1.2 times the size the version gave it, the rest as adapted.
    expect(byId<TextClip>(q, ids.head).style.size).toBeCloseTo(byId<TextClip>(auto, ids.head).style.size * 1.2, 2);
    expect(byId<TextClip>(q, ids.sub).style.size).toBe(byId<TextClip>(auto, ids.sub).style.size);
    expect(byId(q, ids.pip).disabled).toBe(true);
    expect(byId(auto, ids.pip).disabled).toBeUndefined();
    // Another version, and the master, are untouched.
    expect(versionProject(p, { ratio: "1:1" }).tracks).toEqual(versionProject(p, { ratio: "1:1" }).tracks);
    expect(byId(p, ids.pip).disabled).toBeUndefined();
  });

  it("resize a group about its anchor, keyed motion moved with it, and name an id the version lacks", () => {
    const { p, ids } = layouts();
    let q = runCommand(p, "add_keyframe", { clip_id: ids.card, path: "transform.x", at: 0, value: -0.5 });
    q = runCommand(q, "add_keyframe", { clip_id: ids.card, path: "transform.x", at: 0.5, value: 0 });
    const out = applyOverrides(q, [{ clip_id: ids.card, x: 0.1 }]);
    expect(byId(out, ids.card).keyframes!["transform.x"].map((k) => k.v)).toEqual([-0.4, 0.1]);
    const big = applyOverrides(q, [{ clip_id: ids.name, scale: 2 }]);
    const [n0, r0, n1, r1] = [byId(q, ids.name), byId(q, ids.role), byId(big, ids.name), byId(big, ids.role)];
    expect(r1.transform.y - n1.transform.y).toBeCloseTo((r0.transform.y - n0.transform.y) * 2, 4);
    expect((r1 as TextClip).style.size).toBeCloseTo((r0 as TextClip).style.size * 2, 2);
    expect(() => applyOverrides(q, [{ clip_id: "c_gone", hidden: true }])).toThrow(/no clip c_gone/);
    // On the call, for every version that does not say.
    expect(expandVersions({ ratios: ["9:16", "1:1"], overrides: [{ clip_id: "c_1", hidden: true }] }, 15)).toEqual([
      { ratio: "9:16", overrides: [{ clip_id: "c_1", hidden: true }] },
      { ratio: "1:1", overrides: [{ clip_id: "c_1", hidden: true }] },
    ]);
  });
});
