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
  p = runCommand(p, "split", { at: 2.3, clip_ids: [p.tracks[0].clips[0].id] });
  p = runCommand(p, "add_markers", { times: [1, 2, 3], label: "Beat" });
  expect(rules(p, "epic_edit")).toContain("cuts_off_beat");
  p = runCommand(p, "add_markers", { times: [2.3], label: "Beat" });
  expect(rules(p, "epic_edit")).not.toContain("cuts_off_beat");
});

it("lets countdown digits, half-beat cuts and text on its own card pass", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "3", start: 0, duration: 0.5, style: { size: 200, stroke: { color: "#000", width: 6 } } });
  expect(rules(p)).not.toContain("text_too_short");
  p = runCommand(p, "split", { at: 1.5, clip_ids: [p.tracks.find((t) => t.main)!.clips[0].id] });
  p = runCommand(p, "add_markers", { times: [1, 2], label: "Beat" });
  expect(rules(p, "epic_edit")).not.toContain("cuts_off_beat");
});

it("does not call text on its own solid card a contrast risk", () => {
  let p = createProject();
  p = { ...p, assets: [{ id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 10, hasVideo: true, hasAudio: false, width: 1920, height: 1080 }] };
  p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 4 });
  p = runCommand(p, "add_text", { text: "Over footage", start: 0, duration: 3 });
  expect(rules(p)).toContain("text_contrast_risk");
  let q = runCommand(createProject(), "add_color_clip", { color: "#000", start: 0, duration: 4 });
  q = { ...q, assets: p.assets };
  q = runCommand(q, "add_media_clip", { asset_id: "v", start: 0, duration: 4, track_id: q.tracks.find((t) => t.main)!.id });
  q = runCommand(q, "add_color_clip", { color: "#111", start: 0, duration: 4 });
  q = runCommand(q, "add_text", { text: "On its card", start: 0, duration: 3 });
  expect(rules(q)).not.toContain("text_contrast_risk");
});

it("puts captions above the apps' zone on a tall canvas, and scales the size floor", () => {
  let v = createProject({ width: 1080, height: 1920 });
  v = runCommand(v, "add_captions", { captions: [{ start: 0, end: 2, text: "hello there" }] });
  const cap = v.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!;
  expect("transform" in cap && cap.transform.y).toBe(0.05);
  v = runCommand(v, "add_text", { text: "Small but fine", start: 0, duration: 3, style: { size: 26 } });
  expect(rules(v)).not.toContain("text_too_small");
});
