import { placeSourceEdit } from "./drop";
import { runAgentCommand, type CommandReport } from "./commands";
import { createProject } from "./project/defaults";
import { expect, it } from "vitest";
import { initialSourceMarks, resolveSourceEdit, sourceFrames, sourceProject, withSourceRange } from "./sourceMonitor";
import type { Asset } from "./project/types";
const asset: Asset = { id: "a", name: "a", src: "a.mp4", kind: "video", duration: 10, fps: 60, hasVideo: true, hasAudio: true };
it("makes an isolated source timeline without changing source metadata", () => {
  const p = sourceProject(asset);
  expect(p.fps).toEqual({ num: 60, den: 1 });
  expect(sourceProject({ ...asset, fps: 29.97 }).fps).toEqual({ num: 30000, den: 1001 });
  expect(p.tracks[0].clips[0].duration).toBe(600);
  expect(sourceFrames({ ...asset, duration: 0.001 })).toBe(1);
});
it("converts exclusive ranges across frame rates without exceeding the out point", () => {
  const clip = sourceProject(asset).tracks[0].clips[0];
  const selected = withSourceRange(clip, asset, { in: 1, out: 2.05 }, { num: 30, den: 1 });
  expect(selected).toMatchObject({ in: 1, duration: 31 });
  expect(clip).toMatchObject({ in: 0, duration: 600 });
  expect(() => withSourceRange(clip, asset, { in: 2, out: 1 }, { num: 30, den: 1 })).toThrow();
  expect(() => withSourceRange(clip, asset, { in: 0, out: 11 }, { num: 30, den: 1 })).toThrow();
  expect(() => withSourceRange(clip, asset, { in: 0, out: 0.01 }, { num: 30, den: 1 })).toThrow();
});

const fps = { num: 30, den: 1 };
it("resolves all sixteen combinations of explicit source/timeline marks", () => {
  for (let mask = 0; mask < 16; mask++) {
    const si = !!(mask & 1), so = !!(mask & 2), ti = !!(mask & 4), to = !!(mask & 8);
    const marks = { ...(si ? { sourceIn: 2 } : {}), ...(so ? { sourceOut: 6 } : {}), ...(ti ? { timelineIn: 10 } : {}), ...(to ? { timelineOut: 14 } : {}) };
    const r = resolveSourceEdit(asset, fps, 600, marks);
    const length = ti && to ? 120 : (so ? 6 : 10) * 30 - (si ? 60 : 0);
    expect(r.duration, `combination ${mask}`).toBe(length);
    expect(r.start, `combination ${mask}`).toBe(ti ? 300 : to ? 420 - length : 600);
    expect(r.in, `combination ${mask}`).toBe(ti && to && !si && so ? 2 : si ? 2 : 0);
    expect(r.speed).toBe(1);
  }
});
it("requires a four-point choice and fits at constant speed or trims at speed one", () => {
  const marks = { sourceIn: 1, sourceOut: 7, timelineIn: 3, timelineOut: 6 };
  expect(() => resolveSourceEdit(asset, fps, 0, marks)).toThrow("Choose Fit");
  expect(resolveSourceEdit(asset, fps, 0, { ...marks, fit: "fill" })).toMatchObject({ start: 90, duration: 90, in: 1, out: 7, speed: 2 });
  expect(resolveSourceEdit(asset, fps, 0, { ...marks, fit: "trim" })).toMatchObject({ duration: 90, in: 1, out: 4, speed: 1 });
  const r = resolveSourceEdit(asset, fps, 0, { ...marks, fit: "fill" });
  expect(withSourceRange(sourceProject(asset).tracks[0].clips[0], asset, r, fps)).toMatchObject({ duration: 90, speed: 2, in: 1 });
});
it("refuses insufficient media, invalid marks and unsupported fit speed without clamping", () => {
  for (const marks of [{ sourceIn: 9, timelineIn: 1, timelineOut: 3 }, { sourceOut: 1, timelineIn: 1, timelineOut: 3 }, { sourceIn: 1, sourceOut: 2, timelineIn: 1, timelineOut: 3, fit: "trim" as const }, { sourceOut: 11 }, { sourceIn: NaN }, { timelineIn: 4, timelineOut: 2 }]) expect(() => resolveSourceEdit(asset, fps, 0, marks)).toThrow();
  expect(() => resolveSourceEdit({ ...asset, kind: "image", animated: true }, fps, 0, { sourceIn: 1, sourceOut: 7, timelineIn: 0, timelineOut: 3, fit: "fill" })).toThrow("video or audio");
  expect(() => resolveSourceEdit(asset, fps, 0, { sourceIn: 0, sourceOut: 0.01, timelineIn: 0, timelineOut: 10, fit: "fill" })).toThrow("speed");
});

it("places the resolved length before insert/overwrite, adopts first-source rate, and reports speed", () => {
  const p = createProject(); p.assets = [asset];
  const report: CommandReport = {};
  const q = runAgentCommand(p, "edit_from_source", { asset_id: "a", source_in: 1, source_out: 7, timeline_in: 3, timeline_out: 6, mode: "insert", fit: "fill" }, report);
  expect(q.tracks[0].clips[0]).toMatchObject({ start: 90, duration: 90, speed: 2, in: 1 });
  expect(report.sourceEdit).toMatchObject({ clip_id: q.tracks[0].clips[0].id, speed: 2 });
  const sixty = { ...asset, width: 1920, height: 1080 };
  const adopted = placeSourceEdit({ ...p, assets: [sixty] }, sixty, 60, { sourceIn: 1, timelineIn: 3, timelineOut: 6 }, "overwrite");
  expect(adopted.project.fps).toEqual({ num: 60, den: 1 });
  expect(adopted.project.tracks[0].clips[0]).toMatchObject({ start: 180, duration: 180, in: 1 });
  const inserted = placeSourceEdit(q, asset, 0, { sourceIn: 0, sourceOut: 1, timelineIn: 4 }, "insert");
  expect(inserted.project.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[90, 30], [120, 30], [150, 60]]);
  const overwritten = placeSourceEdit(q, asset, 0, { sourceIn: 0, sourceOut: 1, timelineIn: 4 }, "overwrite");
  expect(overwritten.project.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[90, 30], [120, 30], [150, 30]]);
  q.tracks[0].locked = true;
  expect(() => placeSourceEdit(q, asset, 0, {}, "insert")).toThrow("locked");
});


it("opens a moment with explicit source marks and keeps other previews unmarked", () => {
  expect(initialSourceMarks(300, 30, 5, 8)).toEqual({ markIn: 150, markOut: 240, hasIn: true, hasOut: true });
  expect(initialSourceMarks(300, 30)).toEqual({ markIn: 0, markOut: 300, hasIn: false, hasOut: false });
  expect(initialSourceMarks(300, 30, -1, 20)).toMatchObject({ markIn: 0, markOut: 300 });
  expect(initialSourceMarks(300, 30, 10, 10)).toMatchObject({ markIn: 299, markOut: 300 });
});
