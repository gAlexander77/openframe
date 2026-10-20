// check_project inside compound clips (ADR-103): the Northbound test built
// its end card as a compound (a wordmark, a Georgia tagline, a pill, a url)
// and the check answered "no end card", listed only Inter, and measured
// none of it. Every text rule now sees a compound's titles where the
// compound clip shows them: placed, scaled and timed through it.

import { expect, it } from "vitest";
import { runCommand } from "./commands";
import { checkProject, contrastTargets, seenLetters, seenTexts } from "./designCheck";
import { createProject } from "./project/defaults";
import type { CompoundClip, Project, TextClip } from "./project/types";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);

/** 8 s of 1920x1080 footage-free picture, the last 3 s an end card built
 * as a compound: a wordmark (Inter) and a tagline (Georgia, size 64). */
function card(w = 1920, h = 1080) {
  let p = createProject({ width: w, height: h });
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 8, track_id: p.tracks[0].id });
  p = runCommand(p, "add_text", { text: "Shot one", start: 0, duration: 5, style: { size: 96, stroke: { color: "#000000", width: 6 } } });
  p = runCommand(p, "add_text", { text: "NORTHBOUND", start: 5, duration: 3, y: -0.1, style: { font: "Inter", size: 120 } });
  const head = clips(p).find((c) => c.type === "text" && c.text === "NORTHBOUND")!.id;
  p = runCommand(p, "add_text", { text: "Find your north.", start: 5, duration: 3, y: 0.05, style: { font: "Georgia", italic: true, size: 64 } });
  const tag = clips(p).find((c) => c.type === "text" && c.text === "Find your north.")!.id;
  p = runCommand(p, "create_compound_clip", { clip_ids: [head, tag], name: "Title card" });
  const comp = clips(p).find((c): c is CompoundClip => c.type === "compound")!;
  return { p, head, tag, comp };
}

it("finds an end card, its fonts and its titles inside a compound clip", () => {
  const { p, head, tag, comp } = card();
  const seen = seenTexts(p);
  expect(seen.map((s) => s.key)).toEqual(expect.arrayContaining([`${comp.id}/${head}`, `${comp.id}/${tag}`]));
  const r = checkProject(p, "ad");
  expect(r.findings.map((f) => f.rule)).not.toContain("no_end_card");
  expect(r.summary.fonts).toEqual(expect.arrayContaining(["Georgia"]));
  expect(r.summary.titles).toBe(3);
  // Contrast is measured on them where the compound shows them.
  const keys = contrastTargets(p).targets.map((t) => t.clipId);
  expect(keys).toEqual(expect.arrayContaining([`${comp.id}/${head}`, `${comp.id}/${tag}`]));
});

it("judges a compound's titles at the size and place its compound clip draws them", () => {
  const { p: p0, tag, comp } = card();
  // Half size, moved right: the tagline draws at 32 (under 49), and its box
  // follows the compound clip.
  let p = runCommand(p0, "set_param", { clip_ids: [comp.id], path: "transform.scale", value: 0.5 });
  p = runCommand(p, "set_param", { clip_ids: [comp.id], path: "transform.x", value: 0.3 });
  const small = checkProject(p).findings.find((f) => f.rule === "text_too_small" && f.clip_id === tag);
  expect(small).toMatchObject({ compound_clip_id: comp.id });
  expect(small!.message).toMatch(/size 32 as its compound clip draws it/);
  const s = seenTexts(p).find((x) => x.c.id === tag)!;
  const inner = seenLetters(p0, seenTexts(p0).find((x) => x.c.id === tag)!)!.box;
  const outer = seenLetters(p, s)!.box;
  // Half as wide, its center at 0.5 + 0.3 of the width plus half its old offset.
  expect(outer.right - outer.left).toBeCloseTo((inner.right - inner.left) / 2, 3);
  expect((outer.left + outer.right) / 2).toBeCloseTo(1920 * 0.8 + ((inner.left + inner.right) / 2 - 960) / 2, 3);
  // Timed through the compound clip: moved later, its titles move with it.
  const later = runCommand(p, "move_clip", { clip_id: comp.id, start: 6 });
  expect(seenTexts(later).find((x) => x.c.id === tag)).toMatchObject({ start: 180, duration: 90 });
  expect((seenTexts(later).find((x) => x.c.id === tag)!.c as TextClip).style.font).toBe("Georgia");
});

it("flags a compound's title under the apps' buttons on a tall frame, naming the compound clip", () => {
  const { p: p0, tag, comp } = card(1080, 1920);
  const p = runCommand(p0, "set_param", { clip_ids: [comp.id], path: "transform.y", value: 0.3 });
  const f = checkProject(p).findings.find((x) => x.rule === "text_under_app_buttons" && x.clip_id === tag);
  expect(f).toMatchObject({ compound_clip_id: comp.id });
  expect(f!.fix).toMatch(new RegExp(`compound clip ${comp.id}`));
});
