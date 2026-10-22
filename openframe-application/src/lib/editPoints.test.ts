import { runAgentCommand, type CommandReport } from "./commands";
import { expect, it } from "vitest";
import { cutSides, moveEdits, nearestEdit } from "./editPoints";
import { clipForAsset, createProject } from "./project/defaults";
import type { Asset, VideoClip } from "./project/types";
const asset: Asset = { id: "a", name: "a", src: "a.mp4", kind: "video", duration: 10, hasVideo: true, hasAudio: false };
function project(gap = 0) {
  const p = createProject({ fps: { num: 30, den: 1 } }); p.assets = [asset];
  p.tracks[0].clips = [["left", 30, 60, 1], ["right", 90 + gap, 60, 4]].map(([id, start, duration, source]) => ({ ...clipForAsset(asset, Number(start), p.fps), id, duration, in: source } as VideoClip));
  return p;
}
const end = { clipId: "left", edge: "end" as const }, start = { clipId: "right", edge: "start" as const };
it("chooses outgoing at a cut, earlier on gap ties, and filters target/locked tracks", () => {
  expect(nearestEdit(project(), 90)).toEqual([end]);
  expect(nearestEdit(project(30), 105)).toEqual([end]);
  expect(nearestEdit(project(), 90, undefined, 1)).toEqual([{ clipId: "right", edge: "end" }]);
  expect(nearestEdit(project(), 90, undefined, -1)).toEqual([{ clipId: "left", edge: "start" }]);
  const p = project(); p.tracks[0].locked = true;
  expect(nearestEdit(p, 90)).toEqual([]);
  expect(nearestEdit(project(), 90, ["absent"])).toEqual([]);
});
it("rolls both touching sides once, trims a single edge, and never rolls a gap", () => {
  const p = project();
  expect(cutSides(p, start)).toEqual([start, end]);
  const roll = moveEdits(p, [start, end, end], { to: 105 });
  expect(roll.project.tracks[0].clips).toMatchObject([{ duration: 75 }, { start: 105, duration: 45, in: 4.5 }]);
  expect(roll.edges).toHaveLength(2);
  expect(moveEdits(p, [end], { to: 75 }).project.tracks[0].clips).toMatchObject([{ duration: 45 }, { start: 90 }]);
  expect(cutSides(project(30), end)).toEqual([end]);
  expect(moveEdits(project(30), [end], { to: 105 }).edges[0]).toMatchObject({ frame: 105 });
});
it("reuses media and neighbor clamping, preserves locked tracks, and nudges by frames", () => {
  const p = project(300);
  const limited = moveEdits(p, [end], { to: 400 });
  expect(limited.edges[0]).toMatchObject({ frame: 300, stopped: "source" });
  expect(moveEdits(project(), [end], { to: 100 }).edges[0]).toMatchObject({ frame: 90, stopped: "neighbor" });
  expect(moveEdits(project(), [end, start], { by: 1 }).edges.map((e) => e.frame)).toEqual([91, 91]);
  expect(moveEdits(project(), [end, start], { to: 300 }).edges[0]).toMatchObject({ frame: 149, stopped: "length (right)" });
  p.tracks[0].locked = true;
  expect(moveEdits(p, [end], { by: 1 })).toMatchObject({ project: p, edges: [{ frame: 90, stopped: "locked track" }] });
});

it("commands report landed edges and leave main-track gaps while linkage is settled", () => {
  const p = project(), report: CommandReport = {};
  const q = runAgentCommand(p, "extend_edit", { edits: [{ clip_id: "left", edge: "end" }], to: 2.5 }, report);
  expect(q.tracks[0].clips).toMatchObject([{ start: 30, duration: 45 }, { start: 90 }]);
  expect(report.edits).toMatchObject([{ clipId: "left", frame: 75, seconds: 2.5 }]);
  runAgentCommand(p, "trim_edits", { edits: [{ clip_id: "left", edge: "end" }], by: 2 }, report);
  expect(report.edits?.[0]).toMatchObject({ frame: 90, stopped: "neighbor" });
  const moved = runAgentCommand(p, "trim_edits", { edits: [{ clip_id: "left", edge: "end" }, { clip_id: "right", edge: "start" }], by: 1 / 30, unit: "seconds" }, report);
  expect(moved.tracks[0].clips[1].start).toBe(91);
  expect(() => runAgentCommand(p, "trim_edits", { edits: [{ clip_id: "left", edge: "end" }], by: 0.5 })).toThrow("integer frames");
});
