import { expect, it } from "vitest";
import { runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

const rules = (p: Project, kind?: Parameters<typeof checkProject>[1]) => checkProject(p, kind).findings.map((f) => f.rule);
const base = () => {
  let p = createProject();
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 6, track_id: p.tracks[0].id });
  return p;
};

it("passes a tidy project, and reports its shape", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "Clean title", start: 1, duration: 3, style: { size: 96, stroke: { color: "#000000", width: 6 } } });
  const r = checkProject(p);
  expect(r.ok).toBe(true);
  expect(r.findings.filter((f) => f.level !== "tip")).toEqual([]);
  expect(r.summary).toMatchObject({ duration: 6, shots: 1, titles: 1 });
});

it("flags text that is off-safe, small, short, many-fonted or under the apps' buttons", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "Edge", start: 0, duration: 3, x: 0.48, style: { stroke: { color: "#000", width: 4 } } });
  p = runCommand(p, "add_text", { text: "tiny", start: 0, duration: 3, style: { size: 24, font: "Georgia" } });
  p = runCommand(p, "add_text", { text: "six words is too many here", start: 3, duration: 1, style: { font: "Impact" } });
  expect(rules(p)).toEqual(expect.arrayContaining(["text_outside_title_safe", "text_too_small", "text_too_short", "too_many_fonts"]));
  let v = createProject({ width: 1080, height: 1920 });
  v = runCommand(v, "add_text", { text: "Shop", start: 0, duration: 3, y: 0.42 });
  expect(rules(v)).toContain("text_under_app_buttons");
});

it("flags captions read faster than 20 characters a second", () => {
  let p = base();
  p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 1, text: "this caption has far too many characters for one second" }] });
  expect(rules(p)).toContain("caption_too_fast");
});

it("errs on strobes over three a second and on black holes in the main track", () => {
  let p = base();
  const id = p.tracks[0].clips[0].id;
  p = runCommand(p, "add_effect", { clip_id: id, type: "flash", params: { rate: 6 } });
  p = runCommand(p, "add_color_clip", { color: "#000000", start: 8, duration: 2, track_id: p.tracks[0].id });
  const r = checkProject(p);
  expect(r.ok).toBe(false);
  expect(r.findings.filter((f) => f.level === "error").map((f) => f.rule)).toEqual(expect.arrayContaining(["flashes_too_fast", "gap_on_main_track"]));
});

it("asks an ad for an end card and an epic edit for cuts on the beat", () => {
  let p = base();
  expect(rules(p, "ad")).toContain("no_end_card");
  expect(rules(p, "epic_edit")).toContain("no_beat_grid");
  p = runCommand(p, "split", { at: 2.5, clip_ids: [p.tracks[0].clips[0].id] });
  p = runCommand(p, "add_markers", { times: [1, 2, 3], label: "Beat" });
  expect(rules(p, "epic_edit")).toContain("cuts_off_beat");
  p = runCommand(p, "add_markers", { times: [2.5], label: "Beat" });
  expect(rules(p, "epic_edit")).not.toContain("cuts_off_beat");
});
