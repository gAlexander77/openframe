import { describe, expect, it } from "vitest";
import { COMMANDS, CommandError, describeProject, runCommand, validate } from "./commands";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

const withAsset = (): Project => ({
  ...createProject({ fps: { num: 25, den: 1 } }),
  assets: [{ id: "a1", kind: "video", name: "talk.mp4", src: "talk.mp4", duration: 20, hasVideo: true, hasAudio: true }],
});

describe("command registry", () => {
  it("every command has a unique snake_case name and an object schema", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of COMMANDS) {
      expect(c.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(c.input.type).toBe("object");
      expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it("builds an edit from seconds, the way an agent would", () => {
    let p = withAsset();
    p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 0, duration: 8 });
    p = runCommand(p, "add_text", { text: "Welcome", start: 1, duration: 3, y: 0.35 });
    p = runCommand(p, "split", { at: 4 });
    const d = describeProject(p);
    expect(d.duration).toBe(8);
    const main = d.tracks.find((t) => t.main)!;
    expect(main.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(d.tracks.find((t) => !t.main)!.clips[0]).toMatchObject({ type: "text", text: "Welcome", start: 1, end: 4 });
  });

  it("clamps a media clip to its source", () => {
    const p = runCommand(withAsset(), "add_media_clip", { asset_id: "a1", start: 0, in: 15, duration: 30 });
    expect(describeProject(p).duration).toBe(5);
  });

  it("refuses bad arguments with every problem named", () => {
    expect(() => runCommand(withAsset(), "split", { at: "soon", extra: 1 })).toThrow(/args.at must be a number; args.extra is not a known argument/);
    expect(() => runCommand(withAsset(), "nope")).toThrow(CommandError);
    expect(() => runCommand(withAsset(), "delete_clips", { clip_ids: ["x"] })).not.toThrow();
    expect(() => runCommand(withAsset(), "trim_clip", { clip_id: "x", edge: "start", to: 1 })).toThrow(/no clip/);
  });

  it("validates enums and ranges", () => {
    expect(validate({ kind: "midi" }, COMMANDS.find((c) => c.name === "add_track")!.input)).toEqual([
      "args.kind must be one of video, audio",
    ]);
  });
});

describe("add_captions", () => {
  it("puts captions on one track and replaces them on request", () => {
    let p = withAsset();
    p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 1.2, text: "Hello" }, { start: 1.2, end: 2, text: "world" }] });
    const track = () => describeProject(p).tracks.find((t) => t.name === "Captions")!;
    expect(track().clips.map((c) => c.text)).toEqual(["Hello", "world"]);
    p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 1, text: "Again" }], replace: true });
    expect(track().clips.map((c) => c.text)).toEqual(["Again"]);
  });
});

describe("analysis commands", () => {
  const talk = () => runCommand(withAsset(), "add_media_clip", { asset_id: "a1", start: 0, in: 2, duration: 10 });
  const mainClips = (p: Project) => describeProject(p).tracks.find((t) => t.main)!.clips;

  it("describeProject reports each media clip's source window", () => {
    expect(mainClips(talk())[0]).toMatchObject({ start: 0, end: 10, in: 2, out: 12, speed: 1 });
  });

  it("cut_ranges removes source seconds and ripples", () => {
    let p = talk();
    const id = mainClips(p)[0].id;
    p = runCommand(p, "cut_ranges", { clip_id: id, ranges: [{ start: 4, end: 5 }, { start: 9, end: 10.6 }] });
    expect(mainClips(p).map((c) => [c.start, c.end, c.in, c.out])).toEqual([
      [0, 2, 2, 4],
      [2, 6, 5, 9],
      [6, 7.4, 10.6, 12],
    ]);
    expect(() => runCommand(p, "cut_ranges", { clip_id: id, ranges: [{ start: 1 }] })).toThrow(/ranges\[0\]\.end is required/);
  });

  it("cut_ranges refuses clips with no source", () => {
    const p = runCommand(withAsset(), "add_text", { text: "Hi", start: 0, duration: 2 });
    const id = describeProject(p).tracks.flatMap((t) => t.clips)[0].id;
    expect(() => runCommand(p, "cut_ranges", { clip_id: id, ranges: [] })).toThrow(/no source/);
  });

  it("split_at_times splits at source seconds", () => {
    let p = talk();
    p = runCommand(p, "split_at_times", { clip_id: mainClips(p)[0].id, times: [7, 4, 30] });
    expect(mainClips(p).map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 5],
      [5, 10],
    ]);
  });

  it("add_markers adds many at timeline seconds without duplicating", () => {
    let p = talk();
    p = runCommand(p, "add_markers", { times: [1, 0.4, 1.0001], label: "Beat", color: "#f5c543" }); // 25 fps
    expect(describeProject(p).markers).toEqual([
      { at: 0.4, label: "Beat" },
      { at: 1, label: "Beat" },
    ]);
    const again = runCommand(p, "add_markers", { times: [0.4, 1], label: "Beat" });
    expect(again).toBe(p);
    expect(runCommand(p, "add_markers", { times: [1], label: "Scene" }).markers.length).toBe(3);
  });
});

it("names the valid catalog entries when a model invents one", () => {
  const p = runCommand(runCommand(withAsset(), "add_media_clip", { asset_id: "a1", start: 0, duration: 4 }), "split", { at: 2 });
  const id = describeProject(p).tracks[0].clips[0].id;
  expect(() => runCommand(p, "set_transition", { clip_id: id, type: "crossDissolve" })).toThrow(/must be one of dissolve, dipBlack/);
  expect(() => runCommand(p, "set_transition", { clip_id: id, type: "dissolve" })).not.toThrow();
});
