// What the second Claude film test found in timeline edits (ADR-113).
import { describe, expect, it } from "vitest";
import { coerceNumbers, describeProject, runAgentCommand, runCommand, type CommandReport } from "./commands";
import { clipForAsset, createProject } from "./project/defaults";
import { findClip, mainTrack } from "./project/ops";
import type { AudioClip, Project, VideoClip } from "./project/types";

const fps = { num: 30, den: 1 };
const film = (): Project => ({
  ...createProject({ fps }),
  assets: [
    { id: "v", kind: "video", name: "launch.mp4", src: "launch.mp4", duration: 12, hasVideo: true, hasAudio: true },
    { id: "s", kind: "audio", name: "Camera shutter.wav", src: "shutter.wav", duration: 0.25, hasVideo: false, hasAudio: true, role: "effects" },
    { id: "pop", kind: "audio", name: "Pop.wav", src: "pop.wav", duration: 0.15, hasVideo: false, hasAudio: true, role: "effects" },
  ],
});
/** Shots of `v` laid end to end from 0: [in seconds, seconds] each. */
const shots = (...spec: [number, number][]) => {
  let p = film();
  let at = 0;
  for (const [inS, d] of spec) {
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: at, in: inS, duration: d });
    at += d;
  }
  return p;
};
const ids = (p: Project) => mainTrack(p).clips.map((c) => c.id);
const seconds = (p: Project, id: string) => {
  const c = describeProject(p).tracks.flatMap((t) => t.clips).find((x) => x.id === id)!;
  return [c.start, c.end, (c as { in?: number }).in];
};

describe("numbers sent as strings", () => {
  it("set_speed_ramp takes hold \"1.0\" as hold 1, and refuses what is not a number", () => {
    const p = shots([0.3, 6.3]);
    const [id] = ids(p);
    const args = { clip_id: id, at: 4.2, moment: "slow", speed: 0.5, base: 1.8, ease: 0.5 };
    const asNumber = runCommand(p, "set_speed_ramp", { ...args, hold: 1 });
    const asString = runCommand(p, "set_speed_ramp", { ...args, hold: "1.0" });
    expect(findClip(asString, id)!.clip).toEqual(findClip(asNumber, id)!.clip);
    for (const hold of ["1.0s", "", "one", "NaN"]) expect(() => runCommand(p, "set_speed_ramp", { ...args, hold })).toThrow("args.hold must be a number");
  });
  it("reads them inside objects and arrays, leaving strings the schema wants alone", () => {
    const schema = { type: "object" as const, properties: { at: { type: "number" as const }, name: { type: "string" as const }, points: { type: "array" as const, items: { type: "number" as const } } } };
    expect(coerceNumbers({ at: "-2.5e1", name: "7", points: ["1", ".5", "x"] }, schema)).toEqual({ at: -25, name: "7", points: [1, 0.5, "x"] });
  });
});

describe("roll_edit", () => {
  it("moves the cut between two shots in one call, and nothing else", () => {
    const p = shots([0, 2], [4, 2], [8, 2]);
    const [a, b, c] = ids(p);
    const q = runAgentCommand(p, "roll_edit", { clip_id: a, to: 2.5 });
    expect([seconds(q, a), seconds(q, b), seconds(q, c)]).toEqual([[0, 2.5, 0], [2.5, 4, 4.5], [4, 6, 8]]);
    // Its start edge rolls the cut with the clip before; back again.
    const r = runAgentCommand(q, "roll_edit", { clip_id: b, edge: "start", to: 1.5 });
    expect([seconds(r, a), seconds(r, b)]).toEqual([[0, 1.5, 0], [1.5, 4, 3.5]]);
  });
  it("says where the source stopped it, and refuses a cut with a gap at it", () => {
    const p = shots([0, 2], [0.5, 2]);
    const [a, b] = ids(p);
    const report: CommandReport = {};
    const q = runAgentCommand(p, "roll_edit", { clip_id: a, to: 1 }, report);
    expect(seconds(q, b)).toEqual([1.5, 4, 0]);
    expect(report.notes).toEqual(["Stopped at 1.5 s, not 1 s: " + b + ": the source starts there (launch.mp4 has nothing earlier)."]);
    const gap = runCommand(p, "move_clip", { clip_id: b, start: 3 });
    expect(() => runCommand(gap, "roll_edit", { clip_id: a, to: 2.5 })).toThrow(/no clip touches .* at 2 s \(the next starts at 3 s\)/);
  });
});

describe("set_param hold", () => {
  it("keeps what plays before at and steps there, instead of ramping from the key before", () => {
    // The film's music: volume keyed 0.17 at 35.8 s; 0.55 at 40.067 s
    // ramped up over four seconds under the last line.
    let p = film();
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 30, duration: 11, in: 0 });
    const [id] = ids(p);
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "volume", at: 35.8, value: 0.17 });
    const ramp = runCommand(p, "set_param", { clip_ids: [id], path: "volume", value: 0.55, at: 40.067 });
    expect(findClip(ramp, id)!.clip.keyframes!.volume.map((k) => [k.f, k.v])).toEqual([[174, 0.17], [302, 0.55]]);
    const held = runCommand(p, "set_param", { clip_ids: [id], path: "volume", value: 0.55, at: 40.067, hold: true });
    expect(findClip(held, id)!.clip.keyframes!.volume.map((k) => [k.f, k.v])).toEqual([[174, 0.17], [301, 0.17], [302, 0.55]]);
    // A path without keys gets the step as two keys; hold needs at.
    const step = runCommand(p, "set_param", { clip_ids: [id], path: "opacity", value: 0.5, at: 32, hold: true });
    expect(findClip(step, id)!.clip.keyframes!.opacity.map((k) => [k.f, k.v])).toEqual([[59, 1], [60, 0.5]]);
    expect(() => runCommand(p, "set_param", { clip_ids: [id], path: "volume", value: 0.5, hold: true })).toThrow("hold needs at");
  });
});

describe("freeze_frame", () => {
  /** The film: a launch shot 0-6.3 s, a pause for the freeze, a shot from 8 s. */
  const paused = () => {
    let p = shots([0.3, 6.3]);
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 8, in: 1, duration: 2.6, track_id: mainTrack(p).id });
    return p;
  };
  it("overwrite fills the pause left for it and moves nothing", () => {
    const p = paused();
    const [a, b] = ids(p);
    const q = runAgentCommand(p, "freeze_frame", { clip_id: a, at: 6.267, duration: 1.733, mode: "overwrite" });
    const main = mainTrack(q).clips as VideoClip[];
    expect(main.map((c) => [c.id === a || c.id === b ? c.id : "still", c.start, c.duration])).toEqual([[a, 0, 188], ["still", 188, 52], [b, 240, 78]]);
    expect(main[1].freeze).toBe(true);
  });
  it("insert at a shot's last frame leaves no one-frame piece and keeps the pause after it", () => {
    const p = paused();
    const [a, b] = ids(p);
    const q = runAgentCommand(p, "freeze_frame", { clip_id: a, at: 6.267, duration: 1.733 });
    expect(mainTrack(q).clips.map((c) => [c.start, c.duration])).toEqual([[0, 188], [188, 52], [291, 78]]);
    expect(findClip(q, b)!.clip.start).toBe(291);
  });
});

describe("a sound's length", () => {
  it("rounds up to the frame its tail plays in, so short effects keep their tails", () => {
    // Shutter 0.25 s became 0.233 s and pop 0.15 s 0.133 s at 30 fps.
    const p = film();
    expect(clipForAsset(p.assets[1], 0, fps).duration).toBe(8);
    expect(clipForAsset(p.assets[2], 0, fps).duration).toBe(5);
    const q = runCommand(p, "add_media_clip", { asset_id: "s", start: 1 });
    const c = q.tracks.flatMap((t) => t.clips).find((x) => x.type === "audio") as AudioClip;
    expect(c.duration).toBe(8);
    // A picture keeps the frames it fills.
    expect(clipForAsset({ ...p.assets[0], duration: 0.25 }, 0, fps).duration).toBe(7);
  });
});
