import { afterEach, describe, expect, it } from "vitest";
import { describeProject, runAgentCommand, runCommand, type CommandReport } from "./commands";
import { applyDefaultTransitions, nearestMainCut, setTransitionDefaults } from "./defaultTransitions";
import { createColorClip, createProject, createTrack } from "./project/defaults";
import { store } from "../state/store";

const fixture = () => {
  const p = createProject();
  p.tracks[0].clips = Array.from({ length: 4 }, (_, i) => ({ ...createColorClip("#fff", i * 60, 60), id: `c${i}` }));
  return p;
};
const transition = (p: ReturnType<typeof fixture>, i = 0) => {
  const c = p.tracks[0].clips[i];
  return "transitionOut" in c ? c.transitionOut : undefined;
};
afterEach(() => setTransitionDefaults({ type: "dissolve", videoSeconds: 0.5, audioSeconds: 0.5 }));

describe("apply_default_transitions", () => {
  it("finds the nearest main cut in a command-built project, ignoring closer overlay cuts", () => {
    let p = createProject();
    // Like the drive: implicit color layers go on an overlay, not main.
    p = runAgentCommand(p, "add_color_clip", { color: "#224466", start: 0, duration: 3.9 });
    p = runAgentCommand(p, "add_color_clip", { color: "#224466", start: 3.9, duration: 2 });
    const main = p.tracks.find(t => t.main)!;
    expect(main.clips).toHaveLength(0);
    for (const i of [3, 0, 2, 1]) p = runAgentCommand(p, "add_color_clip", { color: "#224466", track_id: main.id, start: i * 2, duration: 2 });
    const clips = p.tracks.find(t => t.main)!.clips;
    expect(clips.map(c => [c.start, c.duration])).toEqual([[0, 60], [60, 60], [120, 60], [180, 60]]);
    expect(describeProject(p).tracks.find(t => t.main)!.clips.map(c => c.start)).toEqual([0, 2, 4, 6]);
    const ids = nearestMainCut(p, 118, "video");
    expect(ids).toEqual([clips[1].id]);
    const q = runCommand(p, "apply_default_transitions", { clip_ids: ids });
    expect(q.tracks.flatMap(t => t.clips).filter(c => "transitionOut" in c).map(c => c.id)).toEqual(ids);
  });
  it("applies every touching main cut and reports the last clip's missing neighbor", () => {
    const report: CommandReport = {};
    const p = runCommand(fixture(), "apply_default_transitions", {}, report);
    expect(p.tracks[0].clips.slice(0, 3).map((_, i) => transition(p, i))).toEqual(Array(3).fill({ type: "dissolve", duration: 15 }));
    expect(report.cuts?.applied.map((c) => c.clip_id)).toEqual(["c0", "c1", "c2"]);
    expect(report.cuts?.skipped).toEqual([{ clip_id: "c3", kind: "video", reason: "no neighbor" }]);
  });
  it("skips gaps and locked tracks and preserves existing transitions unless replacing", () => {
    let p = fixture();
    p = runCommand(p, "set_transition", { clip_id: "c0", type: "wipeLeft", duration: 0.2 });
    p.tracks[0].clips[2].start += 1;
    const a = applyDefaultTransitions(p, {});
    expect(transition(a.project)).toEqual({ type: "wipeLeft", duration: 6 });
    expect(a.cuts.skipped.map((c) => c.reason)).toEqual(["already had one", "no neighbor", "no neighbor", "no neighbor"]);
    const replaced = applyDefaultTransitions(p, { replace: true, duration: 20 });
    expect(transition(replaced.project)).toEqual({ type: "dissolve", duration: 60 });
    p.tracks[0].locked = true;
    const locked = applyDefaultTransitions(p, { clip_ids: ["c0"], replace: true });
    expect(locked.project).toBe(p);
    expect(locked.cuts.skipped[0].reason).toBe("locked");
  });
  it("uses viewer defaults and optional overrides, and only the selected outgoing cuts", () => {
    setTransitionDefaults({ type: "wipeLeft", videoSeconds: 0.8, audioSeconds: 0.1 });
    const p = fixture();
    const q = runCommand(p, "apply_default_transitions", { clip_ids: ["c1"] });
    expect(transition(q, 1)).toEqual({ type: "wipeLeft", duration: 24 });
    expect(transition(q)).toBeUndefined();
    expect(transition(runCommand(q, "apply_default_transitions", { clip_ids: ["c1"], replace: true, type: "dissolve", duration: 0.2 }), 1)).toEqual({ type: "dissolve", duration: 6 });
    expect(nearestMainCut(p, 115, "video")).toEqual(["c1"]);
    expect(nearestMainCut(p, 90, "video")).toEqual(["c0"]);
  });
  it("crossfades audio via set_crossfade, shortening to handles and reporting unfit joins", () => {
    let p = fixture();
    const t = createTrack("audio", "Music");
    p.tracks.push(t);
    p.assets = [{ id: "a", kind: "audio", name: "music", src: "music", duration: 20, hasAudio: true, hasVideo: false }];
    for (const [start, source] of [[0, 0], [2, 0.2], [4, 0]]) p = runCommand(p, "add_media_clip", { asset_id: "a", track_id: t.id, start, in: source, duration: 2 });
    const ids = p.tracks[1].clips.map((c) => c.id);
    const report: CommandReport = {};
    let q = runCommand(p, "apply_default_transitions", { clip_ids: [...ids, "c0"], kind: "both" }, report);
    expect(q.tracks[1].clips[0]).toHaveProperty("crossfade", 0.2);
    expect(transition(q)).toBeDefined();
    expect(report.cuts?.applied).toHaveLength(2);
    expect(report.cuts?.skipped.some((c) => c.reason?.includes("very start"))).toBe(true);
    const existing = applyDefaultTransitions(q, { clip_ids: [ids[0]], kind: "audio" });
    expect(existing.cuts.skipped[0].reason).toBe("already had one");
    q = runCommand(q, "apply_default_transitions", { clip_ids: [ids[0]], kind: "audio", duration: 0.1, replace: true });
    expect(q.tracks[1].clips[0]).toHaveProperty("crossfade", 0.1);
  });
  it("batches several cuts as one undoable document edit, and rolls back a failing batch", () => {
    const p = fixture();
    store.load(p);
    const args = { commands: [0, 1, 2].map((i) => ({ command: "apply_default_transitions", args: { clip_ids: [`c${i}`] } })) };
    store.edit("Transitions", (q) => runCommand(q, "batch", args));
    expect(store.get().project.tracks[0].clips.slice(0, 3).every((c) => "transitionOut" in c)).toBe(true);
    store.undo();
    expect(store.get().project.tracks[0].clips.every((c) => !("transitionOut" in c))).toBe(true);
    expect(store.get().undoLabel).toBeNull();
    expect(() => store.edit("Bad batch", (q) => runCommand(q, "batch", { commands: [...args.commands, { command: "set_transition", args: { clip_id: "missing", type: "wipeLeft" } }] }))).toThrow();
    expect(store.get().project).toBe(p);
  });
});
