import { expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import { setTextMeasure, textLines } from "./render/size";
import { boxOf, versionProject } from "./versions";
import type { OptionNote } from "./reframe";
import type { TextClip } from "./project/types";

setTextMeasure((c, w, h) => {
  const em = c.style.size * h / 1080 * 0.55, lines: string[] = [];
  for (const para of c.text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line && (line.length + word.length + 1) * em > c.style.maxWidth * w) { lines.push(line); line = word; }
      else line += (line ? " " : "") + word;
    }
    lines.push(line);
  }
  return { width: Math.max(...lines.map(l => l.length * em)), height: lines.length * c.style.size * h / 1080 * c.style.lineHeight, layout: { pad: 0, lines } };
});
function film() {
  let p = createProject({ fps: { num: 30, den: 1 } });
  p.assets.push({ id: "a", name: "Interview", src: "interview.mp4", duration: 60, kind: "video", width: 1920, height: 1080, hasAudio: true, hasVideo: true });
  p = runCommand(p, "add_media_clip", { asset_id: "a", start: 0, duration: 10 });
  const shot = p.tracks[0].clips[0].id;
  p = runCommand(p, "add_text", { text: "Jeanette Epps\nNASA astronaut", start: 1, duration: 4.8, x: -0.22, y: 0.17, style: { size: 50, maxWidth: 0.48 } });
  const title = p.tracks.flatMap(t => t.clips).find(c => c.type === "text")!.id;
  return { p, shot, title };
}
it("film 5: portrait speaker identifiers avoid the framed subject, with placement diagnostics", () => {
  const { p, shot, title } = film();
  const w = 100, h = 60, v = new Float32Array(w * h);
  for (let y = 15; y < 40; y++) for (let x = 60; x < 76; x++) v[y * w + x] = 1;
  const looks = { [shot]: { assetId: "a", times: [0], maps: [{ w, h, v }] } };
  const says = { options: [] as OptionNote[], coverage: [] };
  const q = versionProject(p, { ratio: "9:16", focus: [{ clip_id: shot, x: 0.68, y: 0.5 }] }, undefined, looks, [], [], [], says);
  const b = boxOf(q, findClip(q, title)!.clip as TextClip);
  expect(b.top >= q.height * 0.68 || b.bottom <= q.height * 0.32).toBe(true);
  expect(says.options.some(x => x.clip_id === title && /subject/.test(x.note))).toBe(true);
});
it("film 5: portrait conversion splits overflowing captions into at most two readable lines", () => {
  let { p } = film();
  p = runCommand(p, "add_captions", { captions: [{ start: 3, end: 7.2, text: "Being the first anything to me\nbears a lot of responsibility." }], style: { size: 52, maxWidth: 0.84 } });
  const q = versionProject(p, { ratio: "9:16" });
  const caps = q.tracks.flatMap(t => t.clips).filter((c): c is TextClip => c.type === "text" && !!c.caption);
  expect(caps.length).toBeGreaterThan(1);
  expect(caps.every(c => (textLines(q, c)?.length ?? 0) <= 2)).toBe(true);
  expect(caps.every(c => c.duration >= 25 && c.text.replace(/\s+/g, " ").length / (c.duration / 30) <= 20)).toBe(true);
  expect(caps.map(c => c.text).join(" ").replace(/\s+/g, " ")).toBe("Being the first anything to me bears a lot of responsibility.");
});

it("film5-layout: runs the drive's exact launch dimensions, fitted cutaway, title and captions together", () => {
  let p = createProject({ width: 1920, height: 1080, fps: { num: 30, den: 1 } });
  p.assets.push({ id: "launch", name: "Launch", src: "launch.mp4", kind: "video", duration: 60, width: 1920, height: 1012, hasAudio: true, hasVideo: true });
  const report: CommandReport = {};
  runCommand(p, "add_media_clip", { asset_id: "launch", start: 16.1, duration: 5.7, in: 12 }, report);
  p = runCommand(p, "add_media_clip", { asset_id: "launch", start: 0, duration: 10, fit: "fill" });
  const shot = p.tracks[0].clips[0];
  expect("transform" in shot && shot.transform.scale).toBeCloseTo(1080 / 1012, 6);
  expect(report.notes?.join(" ")).toMatch(/transparent bands/);
  p = runCommand(p, "add_text", { text: "Jeanette Epps\nNASA astronaut", start: 1, duration: 4.8, x: -0.22, y: 0.17, style: { size: 50, maxWidth: 0.48 } });
  p = runCommand(p, "add_captions", { captions: [{ start: 3, end: 7.2, text: "Being the first anything to me\nbears a lot of responsibility." }], style: { size: 52, maxWidth: 0.84 } });
  const title = p.tracks.flatMap(t => t.clips).find(c => c.type === "text" && !c.caption)!.id;
  const v = new Float32Array(100 * 60);
  for (let y = 15; y < 40; y++) for (let x = 60; x < 76; x++) v[y * 100 + x] = 1;
  const looks = { [shot.id]: { assetId: "launch", times: [0], maps: [{ w: 100, h: 60, v }] } };
  const says = { options: [] as OptionNote[], coverage: [] };
  const q = versionProject(p, { ratio: "9:16", focus: [{ clip_id: shot.id, x: 0.68, y: 0.5 }] }, undefined, looks, [], [], [], says);
  const b = boxOf(q, findClip(q, title)!.clip as TextClip);
  const caps = q.tracks.flatMap(t => t.clips).filter((c): c is TextClip => c.type === "text" && !!c.caption);
  expect(b.bottom <= q.height * 0.32 || b.top >= q.height * 0.68).toBe(true);
  expect(caps.length).toBeGreaterThan(1);
  expect(caps.every(c => (textLines(q, c)?.length ?? Infinity) <= 2)).toBe(true);
  expect(says.options.some(x => x.clip_id === title && /subject/.test(x.note))).toBe(true);
  const auto = { options: [] as OptionNote[], coverage: [] };
  versionProject(p, { ratio: "9:16" }, undefined, looks, [], [], [], auto);
  expect(auto.options.some(x => /low-confidence/.test(x.note))).toBe(true);
});
