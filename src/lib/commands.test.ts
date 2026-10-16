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

describe("color commands", () => {
  const graded = () => {
    let p: Project = { ...withAsset(), luts: [{ id: "l1", name: "Teal.cube", src: "teal.cube", kind: "3d", size: 33 }] };
    p = runCommand(p, "add_color_clip", { color: "#808080", start: 0, duration: 2 });
    return { p, id: describeProject(p).tracks[0].clips[0].id };
  };
  const adjustOf = (p: Project, id: string) => {
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.id === id)!;
    return "adjust" in c ? c.adjust : null;
  };

  it("set_hsl changes one band, keeps the others, and removes zeroed ones", () => {
    let { p, id } = graded();
    p = runCommand(p, "set_hsl", { clip_id: id, band: "red", saturation: -40 });
    p = runCommand(p, "set_hsl", { clip_id: id, band: "blue", hue: 10 });
    expect(adjustOf(p, id)!.hsl).toEqual({ red: { hue: 0, saturation: -40, lightness: 0 }, blue: { hue: 10, saturation: 0, lightness: 0 } });
    p = runCommand(p, "set_hsl", { clip_id: id, band: "all", reset: true });
    expect(adjustOf(p, id)!.hsl).toBeUndefined();
    expect(() => runCommand(p, "set_hsl", { clip_id: id, band: "teal" })).toThrow(/must be one of/);
  });

  it("set_curve stores cleaned points and resets with none", () => {
    let { p, id } = graded();
    p = runCommand(p, "set_curve", { clip_id: id, channel: "luma", points: [[1, 1], [0, 0], [0.5, 0.6]] });
    expect(adjustOf(p, id)!.curves).toEqual({ luma: [[0, 0], [0.5, 0.6], [1, 1]] });
    p = runCommand(p, "set_curve", { clip_id: id, channel: "luma" });
    expect(adjustOf(p, id)!.curves).toBeUndefined();
    expect(() => runCommand(p, "set_curve", { clip_id: id, channel: "r", points: [[0.5]] })).toThrow(/\[input, output\]/);
    expect(() => runCommand(p, "set_curve", { clip_id: id, channel: "r", points: [[0.5, 1.5]] })).toThrow(/<= 1/);
  });

  it("set_color_wheel takes a balance or a hue and amount", () => {
    let { p, id } = graded();
    p = runCommand(p, "set_color_wheel", { clip_id: id, wheel: "gain", y: 12 });
    p = runCommand(p, "set_color_wheel", { clip_id: id, wheel: "lift", hue: 240, amount: 20 });
    const w = adjustOf(p, id)!.wheels!;
    expect(w.gain).toEqual({ r: 0, g: 0, b: 0, y: 12 });
    expect(w.lift!.b).toBeGreaterThan(10);
    expect(w.lift!.r).toBeLessThan(0);
    p = runCommand(p, "set_color_wheel", { clip_id: id, wheel: "lift", reset: true });
    expect(Object.keys(adjustOf(p, id)!.wheels!)).toEqual(["gain"]);
  });

  it("apply_lut needs a listed LUT and removes with none", () => {
    let { p, id } = graded();
    expect(() => runCommand(p, "apply_lut", { clip_id: id, lut_id: "zz" })).toThrow(/no LUT with id zz/);
    p = runCommand(p, "apply_lut", { clip_id: id, lut_id: "l1", intensity: 0.5 });
    expect(adjustOf(p, id)!.lut).toEqual({ id: "l1", intensity: 0.5 });
    const d = describeProject(p);
    expect(d.luts).toEqual([{ id: "l1", name: "Teal.cube", kind: "3d", size: 33 }]);
    expect(d.tracks[0].clips[0]).toMatchObject({ lut: { id: "l1", intensity: 0.5 } });
    p = runCommand(p, "apply_lut", { clip_id: id, lut_id: "none" });
    expect(adjustOf(p, id)!.lut).toBeUndefined();
  });

  it("refuses clips without a picture", () => {
    let p = runCommand({ ...withAsset(), assets: [{ ...withAsset().assets[0], kind: "audio", hasVideo: false }] }, "add_media_clip", { asset_id: "a1", start: 0 });
    const id = describeProject(p).tracks.flatMap((t) => t.clips)[0].id;
    expect(() => runCommand(p, "set_hsl", { clip_id: id, band: "red", hue: 5 })).toThrow(/audio clips take no color grade/);
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
      { id: p.markers[0].id, frame: 10, at: 0.4, label: "Beat", color: "#f5c543" },
      { id: p.markers[1].id, frame: 25, at: 1, label: "Beat", color: "#f5c543" },
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
describe("keyframe commands", () => {
  // 25 fps: 0.4 s = 10 frames. The clip starts at 1 s (frame 25).
  const animated = () => {
    let p = runCommand(withAsset(), "add_color_clip", { color: "#f00", start: 1, duration: 4 });
    const id = describeProject(p).tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 1, value: -0.3 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 2, value: 0.3 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 2, value: 1 });
    const keys = (q: Project) => q.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!.keyframes;
    return { p, id, keys };
  };

  it("move_keyframe retimes in seconds and can set the value", () => {
    const { p, id, keys } = animated();
    const q = runCommand(p, "move_keyframe", { clip_id: id, path: "transform.x", at: 2, to: 3, value: 0.5 });
    expect(keys(q)!["transform.x"]).toEqual([{ f: 0, v: -0.3 }, { f: 50, v: 0.5 }]);
    // past the clip's end it stops on the last frame
    const r = runCommand(p, "move_keyframe", { clip_id: id, path: "transform.x", at: 2, to: 60 });
    expect(keys(r)!["transform.x"][1].f).toBe(99);
    expect(() => runCommand(p, "move_keyframe", { clip_id: id, path: "transform.x", at: 1.5, to: 2 })).toThrow(/no transform.x keyframe/);
    expect(() => runCommand(p, "move_keyframe", { clip_id: id, path: "transform.x", at: 2 })).toThrow(/give to, value/);
  });

  it("set_keyframe_ease takes a preset or a bezier, per path or per time", () => {
    const { p, id, keys } = animated();
    const q = runCommand(p, "set_keyframe_ease", { clip_id: id, at: 2, ease: "overshoot" });
    expect(keys(q)!["transform.x"][1].ease).toEqual([0.34, 1.56, 0.64, 1]);
    expect(keys(q)!.opacity[0].ease).toEqual([0.34, 1.56, 0.64, 1]);
    const r = runCommand(p, "set_keyframe_ease", { clip_id: id, path: "transform.x", bezier: [0.2, 0, 0.8, 1] });
    expect(keys(r)!["transform.x"].map((k) => k.ease)).toEqual([[0.2, 0, 0.8, 1], [0.2, 0, 0.8, 1]]);
    expect(keys(r)!.opacity[0].ease).toBeUndefined();
    expect(() => runCommand(p, "set_keyframe_ease", { clip_id: id, bezier: [2, 0, 0.5, 1] })).toThrow(/x1 and x2 in 0..1/);
    expect(() => runCommand(p, "set_keyframe_ease", { clip_id: id, ease: "wobbly" })).toThrow(/must be one of/);
  });

  it("remove_keyframes by time, by path, or all", () => {
    const { p, id, keys } = animated();
    expect(keys(runCommand(p, "remove_keyframes", { clip_id: id, at: [2] }))).toEqual({ "transform.x": [{ f: 0, v: -0.3 }] });
    expect(Object.keys(keys(runCommand(p, "remove_keyframes", { clip_id: id, path: "transform.x" }))!)).toEqual(["opacity"]);
    expect(keys(runCommand(p, "remove_keyframes", { clip_id: id }))).toBeUndefined();
    expect(() => runCommand(p, "remove_keyframes", { clip_id: id, at: [4] })).toThrow(/no matching keyframes/);
  });
});
