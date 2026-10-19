import { expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { createProject, createTextClip, createTrack } from "./project/defaults";
import { describeChanges } from "./mcp";

it("styles several titles, accepts single aliases and refuses plural text", () => {
  const a = createTextClip("one", 0, 30), b = createTextClip("two", 30, 30);
  const p = { ...createProject(), tracks: [{ ...createTrack("video", "Titles"), clips: [a, b] }] };
  const q = runCommand(p, "set_text", { clip_ids: [a.id, b.id], style: { size: 100 } });
  expect(q.tracks[0].clips).toEqual(expect.arrayContaining([expect.objectContaining({ style: expect.objectContaining({ size: 100 }) })]));
  expect(q.tracks[0].clips.every(c => c.type === "text" && c.style.size === 100)).toBe(true);
  expect(() => runCommand(p, "set_text", { clip_ids: [a.id, b.id], text: "no" })).toThrow("exactly one");
  expect(runCommand(p, "set_text", { clip_id: a.id, text: "yes" }).tracks[0].clips[0]).toMatchObject({ text: "yes" });
  const report: CommandReport = {};
  const keyed = runCommand(p, "add_keyframe", { clip_id: a.id, path: "opacity", at: 0, value: 0 });
  const cleared = runCommand(keyed, "batch", { commands: [
    { command: "remove_keyframes", args: { clip_ids: [a.id, b.id], path: "opacity" } },
    { command: "set_text", args: { clip_id: b.id, style: { size: 123 } } },
  ] }, report);
  expect(cleared.tracks[0].clips[0].keyframes?.opacity).toBeUndefined();
  expect(cleared.tracks[0].clips[1]).toMatchObject({ style: { size: 123 } });
  expect(report.notes).toEqual([expect.stringContaining("No matching keyframes")]);
});

it.each(["add_text", "add_shape", "add_color_clip", "add_media_clip"])("reports removals and trims for %s", name => {
  const a = createTextClip("removed", 30, 30), b = createTextClip("trimmed", 60, 90);
  const track = { ...createTrack("video", "Titles"), clips: [a, b] };
  const p = { ...createProject(), tracks: [track], assets: [{ id: "asset", kind: "image" as const, name: "test", src: "test", duration: 10, hasVideo: true, hasAudio: false }] };
  const report: CommandReport = {};
  runCommand(p, name, { ...({ add_text: { text: "new" }, add_shape: { kind: "rectangle" }, add_color_clip: { color: "red" }, add_media_clip: { asset_id: "asset" } }[name]), start: 1, duration: 2, track_id: track.id }, report);
  expect(report.overwritten).toEqual([{ id: a.id, kind: "text", what: "removed" }, { id: b.id, kind: "text", what: "trimmed" }]);
  expect(describeChanges({ tracks: [] }, { tracks: [], ...report })).toMatchObject(report);
  const insert: CommandReport = {};
  if (name === "add_media_clip") {
    runCommand(p, name, { asset_id: "asset", start: 1, duration: 2, track_id: track.id, mode: "insert" }, insert);
    expect(insert.overwritten).toBeUndefined();
  }
});

it("keeps overwrite reports for clips added and lost within one batch", () => {
  const p = createProject();
  const report: CommandReport = {};
  runCommand(p, "batch", { commands: [
    { command: "add_track", args: { kind: "video", name: "Titles" } },
    { command: "add_text", args: { text: "first", start: 0, duration: 2, track_id: "$1.track" } },
    { command: "add_text", args: { text: "second", start: 0, duration: 2, track_id: "$1.track" } },
  ] }, report);
  expect(report.overwritten).toEqual([{ id: expect.any(String), kind: "text", what: "removed" }]);
});
