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
