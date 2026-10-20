import { describe, expect, it } from "vitest";
import { COMMANDS, CommandError, describeProject, runAgentCommand, runCommand, validate, type CommandReport } from "./commands";
import { createProject } from "./project/defaults";
import * as ops from "./project/ops";
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

  it("describes a clip's mask and crop, so a framed picture can be checked", () => {
    let p = withAsset();
    p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 0, duration: 4 });
    const id = p.tracks[0].clips[0].id;
    const seen = () => describeProject(p).tracks.flatMap((x) => x.clips).find((c) => c.id === id)!;
    expect(seen()).not.toHaveProperty("mask");
    expect(seen()).not.toHaveProperty("crop");
    p = runCommand(p, "set_mask", { clip_ids: [id], shape: "circle", width: 0.56, height: 1, feather: 0.02 });
    p = runCommand(p, "set_crop", { clip_ids: [id], left: 0.25, right: 0.25 });
    expect(seen()).toMatchObject({ mask: { shape: "circle", x: 0, y: 0, width: 0.56, height: 1, feather: 0.02 }, crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 } });
  });

  it("sets what the inspector could and agents could not: blend, key, canvas fill, copies", () => {
    let p = withAsset();
    p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 0, duration: 4 });
    p = runCommand(p, "add_text", { text: "Sale", start: 1, duration: 2, style: { color: "#ffcc00" } });
    const all = () => p.tracks.flatMap((t) => t.clips);
    const v = all().find((c) => c.type === "video")!, t = all().find((c) => c.type === "text")!;
    p = runCommand(p, "set_blend", { clip_ids: [v.id], mode: "screen" });
    expect(describeProject(p).tracks.flatMap((x) => x.clips).find((c) => c.id === v.id)).toMatchObject({ blend: "screen" });
    p = runCommand(p, "set_chroma_key", { clip_ids: [v.id], similarity: 0.6 });
    expect((all().find((c) => c.id === v.id) as { chromaKey: object }).chromaKey).toEqual({ enabled: true, color: "#00b140", similarity: 0.6, smoothness: 0.1, spill: 0.5 });
    p = runCommand(p, "set_canvas_fill", { clip_ids: [v.id], fill: "blur", amount: 70 });
    expect((all().find((c) => c.id === v.id) as { canvas: object }).canvas).toEqual({ type: "blur", amount: 70 });
    p = runCommand(p, "set_canvas_fill", { clip_ids: [v.id], fill: "none" });
    expect("canvas" in all().find((c) => c.id === v.id)!).toBe(false);
    expect(() => runCommand(p, "set_chroma_key", { clip_ids: [t.id] })).toThrow("Only video and image");
    p = runCommand(p, "set_fades", { clip_ids: [v.id], fade_in: 0.5, fade_out: 9 });
    // 25 fps: half a second is 12.5 frames, a tie, taken to 12 (the frame
    // on screen then, ADR-102); 9 s is capped at half the 4 s clip.
    expect(all().find((c) => c.id === v.id)).toMatchObject({ fadeIn: 12, fadeOut: 50 });
    expect(describeProject(p).tracks.flatMap((x) => x.clips).find((c) => c.id === v.id)).toMatchObject({ fade_in: 0.48, fade_out: 2 });
    expect(() => runCommand(p, "set_fades", { clip_ids: [t.id], fade_in: 1 })).toThrow("set_animation");
    p = runCommand(p, "duplicate_clips", { clip_ids: [t.id], at: 5 });
    const copy = all().find((c) => c.type === "text" && c.id !== t.id)!;
    expect(copy.start).toBe(125);
    expect((copy as { style: { color: string } }).style.color).toBe("#ffcc00");
  });

  it("changes the frame rate it says it does, and refuses odd rates", () => {
    let p = withAsset();
    p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 2, duration: 4 });
    const q = runCommand(p, "set_project", { fps: "50" });
    expect(q.fps).toEqual({ num: 50, den: 1 });
    // The clip keeps its time: 2 s at 25 fps, still 2 s at 50.
    expect(q.tracks[0].clips[0].start).toBe(100);
    expect(() => runCommand(p, "set_project", { fps: "48" })).toThrow();
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
    expect(runCommand(p, "remove_keyframes", { clip_id: id, at: [4] })).toBe(p);
  });
});

describe("set_background_removal", () => {
  const cutout = { enabled: true, src: "matte.mp4", from: 0, to: 8, model: "m" };
  const placed = () => {
    let p = runCommand(withAsset(), "add_media_clip", { asset_id: "a1", start: 0, duration: 8 });
    p = runCommand(p, "add_color_clip", { color: "#00ff00", start: 0, duration: 8 });
    const clips = p.tracks.flatMap((t) => t.clips);
    return { p, video: clips.find((c) => c.type === "video")!.id, color: clips.find((c) => c.type === "color")!.id };
  };

  it("toggles a clip's matte and keeps it while off", () => {
    const { p, video } = placed();
    const withMatte = ops.setCutout(p, video, cutout);
    const off = runCommand(withMatte, "set_background_removal", { clip_ids: [video], enabled: false });
    const clip = ops.findClip(off, video)!.clip;
    expect(clip.type === "video" && clip.cutout).toEqual({ ...cutout, enabled: false });
    expect(describeProject(off).tracks.flatMap((t) => t.clips).find((c) => c.id === video)).toMatchObject({ removeBackground: false });
    const on = runCommand(off, "set_background_removal", { clip_ids: [video], enabled: true });
    expect(ops.findClip(on, video)!.clip).toMatchObject({ cutout });
  });

  it("refuses clips with no matte and clips that are not video", () => {
    const { p, video, color } = placed();
    expect(() => runCommand(p, "set_background_removal", { clip_ids: [video], enabled: true })).toThrow(/no background matte yet/);
    expect(() => runCommand(ops.setCutout(p, video, cutout), "set_background_removal", { clip_ids: [color], enabled: true })).toThrow(/color clip/);
  });
});

describe("set_crop", () => {
  const pictured = () => {
    const p = runCommand({ ...withAsset(), assets: [{ ...withAsset().assets[0], width: 1920, height: 1080 }] }, "add_media_clip", { asset_id: "a1", start: 0, duration: 4 });
    const id = p.tracks.find((t) => t.main)!.clips[0].id;
    const crop = (q: Project) => (q.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as { crop: object }).crop;
    return { p, id, crop };
  };

  it("sets the edges given and keeps the others", () => {
    const { p, id, crop } = pictured();
    const q = runCommand(p, "set_crop", { clip_ids: [id], left: 0.25, bottom: 0.1 });
    expect(crop(q)).toEqual({ left: 0.25, top: 0, right: 0, bottom: 0.1 });
    expect(crop(runCommand(q, "set_crop", { clip_ids: [id], right: 0.25 }))).toEqual({ left: 0.25, top: 0, right: 0.25, bottom: 0.1 });
  });

  it("crops the largest centered area of a ratio", () => {
    const { p, id, crop } = pictured();
    expect(crop(runCommand(p, "set_crop", { clip_ids: [id], ratio: "1:1" }))).toEqual({ left: 0.21875, top: 0, right: 0.21875, bottom: 0 });
    const square = runCommand(p, "set_crop", { clip_ids: [id], ratio: "1:1" });
    expect(crop(runCommand(square, "set_crop", { clip_ids: [id], ratio: "original" }))).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("refuses crops that leave nothing, mixed arguments and clips without a picture", () => {
    const { p, id } = pictured();
    expect(() => runCommand(p, "set_crop", { clip_ids: [id], left: 0.6, right: 0.6 })).toThrow(/at least 5%/);
    expect(() => runCommand(p, "set_crop", { clip_ids: [id], left: 0.1, ratio: "1:1" })).toThrow(/either edges or a ratio/);
    expect(() => runCommand(p, "set_crop", { clip_ids: [id], ratio: "free" })).toThrow(/must be one of/);
    const q = runCommand(p, "add_adjustment_clip", { start: 0, duration: 2 });
    const adj = q.tracks.flatMap((t) => t.clips).find((c) => c.type === "adjustment")!;
    expect(() => runCommand(q, "set_crop", { clip_ids: [adj.id], left: 0.1 })).toThrow(/no picture/);
  });
});

describe("set_mask", () => {
  const masked = () => {
    const p = runCommand(createProject(), "add_color_clip", { color: "#ff0000", start: 0, duration: 4 });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    const mask = (q: Project) => (q.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as { mask?: Record<string, unknown> }).mask;
    return { p, id, mask };
  };

  it("adds a shape, sets its numbers, and removes it", () => {
    const { p, id, mask } = masked();
    const heart = runCommand(p, "set_mask", { clip_ids: [id], shape: "heart", rotation: 30 });
    // Square on the 16:9 color layer.
    expect(mask(heart)).toMatchObject({ shape: "heart", width: expect.closeTo(0.6 * (1080 / 1920), 6), height: 0.6, rotation: 30 });
    const box = runCommand(heart, "set_mask", { clip_ids: [id], shape: "rectangle", radius: 0.5, invert: true });
    expect(mask(box)).toMatchObject({ shape: "rectangle", radius: 0.5, invert: true, rotation: 30 });
    expect(mask(runCommand(box, "set_mask", { clip_ids: [id], shape: "none" }))).toBeUndefined();
  });

  it("needs a shape for a clip with no mask and refuses clips without a picture", () => {
    const { p, id } = masked();
    expect(() => runCommand(p, "set_mask", { clip_ids: [id], feather: 0.2 })).toThrow(/give a shape/);
    expect(() => runCommand(p, "set_mask", { clip_ids: [id], shape: "triangle" })).toThrow(/must be one of/);
    const q = runCommand(p, "add_adjustment_clip", { start: 0, duration: 2 });
    const adj = q.tracks.flatMap((t) => t.clips).find((c) => c.type === "adjustment")!;
    expect(() => runCommand(q, "set_mask", { clip_ids: [adj.id], shape: "circle" })).toThrow(/no picture/);
  });
});

describe("what the Claude film test found (2026-10-20, ADR-102)", () => {
  /** 30 fps; a 12 s file. Main: a [0, 2), b [2, 4), c [4, 8); a PiP mostly
   * over c, a music bed over all of them. */
  const film = () => {
    let p: Project = { ...createProject(), assets: [{ id: "a1", kind: "video", name: "launch.mp4", src: "launch.mp4", duration: 12, hasVideo: true, hasAudio: false }, { id: "m", kind: "audio", name: "song.wav", src: "song.wav", duration: 30, hasVideo: false, hasAudio: true }] };
    for (const [start, duration, at] of [[0, 2, 0], [2, 2, 3], [4, 4, 6]]) p = runCommand(p, "add_media_clip", { asset_id: "a1", start, duration, in: at });
    p = runCommand(p, "add_track", { kind: "video", name: "PiP" });
    p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 4.5, duration: 3, in: 0, track_id: p.tracks[0].id });
    return runCommand(p, "add_media_clip", { asset_id: "m", start: 0, duration: 8 });
  };
  const at = (p: Project, id: string) => ops.findClip(p, id)!.clip.start / 30;
  const ids = (p: Project) => ({ a: p.tracks.find((t) => t.main)!.clips[0].id, c: p.tracks.find((t) => t.main)!.clips[2].id, pip: p.tracks[0].clips[0].id, bed: p.tracks.find((t) => t.kind === "audio")!.clips[0].id });

  it("carries clips on a main-track shot through a ripple trim and an insert, as the user's edits do", () => {
    const p = film(), { a, c, pip, bed } = ids(p);
    const trimmed = runAgentCommand(p, "trim_clip", { clip_id: a, edge: "end", to: 2.5, ripple: true });
    expect([at(trimmed, c), at(trimmed, pip), at(trimmed, bed)]).toEqual([4.5, 5, 0]);
    const inserted = runAgentCommand(trimmed, "add_media_clip", { asset_id: "a1", start: 2.5, duration: 1, in: 10, mode: "insert", track_id: p.tracks.find((t) => t.main)!.id });
    expect([at(inserted, c), at(inserted, pip), at(inserted, bed)]).toEqual([5.5, 6, 0]);
    // A command alone ripples its own track: that was the PiP left behind.
    expect(at(runCommand(p, "trim_clip", { clip_id: a, edge: "end", to: 2.5, ripple: true }), pip)).toBe(4.5);
  });

  it("never closes a gap on the main track unless the call asks", () => {
    const p = film(), b = p.tracks.find((t) => t.main)!.clips[1].id;
    const lifted = runAgentCommand(p, "delete_clips", { clip_ids: [b] });
    expect(lifted.tracks.find((t) => t.main)!.clips.map((x) => x.start / 30)).toEqual([0, 4]);
    expect(runAgentCommand(p, "delete_clips", { clip_ids: [b], ripple: true }).tracks.find((t) => t.main)!.clips.map((x) => x.start / 30)).toEqual([0, 2]);
  });

  it("says where a trim stopped and why, and describes a trimmed ramp from 0 to 1", () => {
    let p = film();
    const { c } = ids(p);
    // c reads 6 s of the 12 s file at 1x and ramps to 4x by its end.
    p = runCommand(p, "set_speed_curve", { clip_id: c, points: [{ t: 0, speed: 1 }, { t: 0.5, speed: 1 }, { t: 0.95, speed: 4 }, { t: 1, speed: 4 }] });
    const report: CommandReport = {};
    const end = (ops.findClip(p, c)!.clip.start + ops.findClip(p, c)!.clip.duration) / 30;
    const q = runCommand(p, "trim_clip", { clip_id: c, edge: "end", to: end + 2, ripple: true }, report);
    const got = (ops.findClip(q, c)!.clip.start + ops.findClip(q, c)!.clip.duration) / 30;
    expect(got).toBeLessThan(end + 2);
    expect(report.notes).toEqual([`Stopped at ${+got.toFixed(3)} s, not ${end + 2} s: the source ends there (launch.mp4 is 12 s long, and the clip reads it at 4x at its end).`]);
    const points = describeProject(q).tracks.flatMap((t) => t.clips).find((x) => x.id === c)!.speed_points as number[][];
    expect(points[0]).toEqual([0, 1]);
    expect(points.at(-1)).toEqual([1, 4]);
    // A trim without ripple stops at the next clip, and says so.
    const r2: CommandReport = {};
    const a = ids(p).a;
    runCommand(p, "trim_clip", { clip_id: a, edge: "end", to: 3 }, r2);
    expect(r2.notes?.[0]).toMatch(/^Stopped at 2 s, not 3 s: the next clip on its track starts there/);
  });

  it("slips by seconds of source on a ramped clip, and says where the file stopped it", () => {
    let p = film();
    const { c } = ids(p);
    p = runCommand(p, "set_speed_curve", { clip_id: c, points: [{ t: 0, speed: 2 }, { t: 0.5, speed: 0.5 }, { t: 1, speed: 2 }] });
    const inOf = (q: Project) => (ops.findClip(q, c)!.clip as { in: number }).in;
    const slipped = runCommand(p, "slip_clip", { clip_id: c, by: -0.75 });
    expect(inOf(slipped) - inOf(p)).toBeCloseTo(-0.75, 9);
    const report: CommandReport = {};
    const stopped = runCommand(p, "slip_clip", { clip_id: c, by: -20 }, report);
    expect(inOf(stopped)).toBe(0);
    expect(report.notes).toEqual([`Slipped ${+(-inOf(p)).toFixed(3)} s, not -20 s: the source starts there.`]);
  });
});

describe("what the edits hunt found (ADR-106)", () => {
  /** 30 fps; three 2 s shots of a 12 s file, a caption on each. */
  const captioned = () => {
    let p: Project = { ...createProject(), assets: [{ id: "a1", kind: "video", name: "launch.mp4", src: "launch.mp4", duration: 12, hasVideo: true, hasAudio: false }] };
    for (const start of [0, 2, 4]) p = runCommand(p, "add_media_clip", { asset_id: "a1", start, duration: 2, in: start });
    return runCommand(p, "add_captions", { captions: [{ start: 0, end: 1.8, text: "One" }, { start: 2, end: 3.8, text: "Two" }, { start: 4, end: 5.5, text: "Three" }] });
  };
  const starts = (p: Project, kind: "video" | "text") => p.tracks.flatMap((t) => t.clips).filter((c) => c.type === kind).map((c) => c.start / 30).sort((a, b) => a - b);

  it("an agent's insert carries every caption with its shot, not only the last", () => {
    const p = captioned();
    const q = runAgentCommand(p, "add_media_clip", { asset_id: "a1", start: 0, duration: 1, in: 8, mode: "insert", track_id: p.tracks.find((t) => t.main)!.id });
    expect(starts(q, "video")).toEqual([0, 1, 3, 5]);
    expect(starts(q, "text")).toEqual([1, 3, 5]);
  });

  it("an agent's ripple delete of a shot and its caption keeps the later captions on their shots", () => {
    const p = captioned();
    const two = (kind: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.type === kind && c.start === 60)!.id;
    const q = runAgentCommand(p, "delete_clips", { clip_ids: [two("video"), two("text")], ripple: true });
    expect(starts(q, "video")).toEqual([0, 2]);
    expect(starts(q, "text")).toEqual([0, 2]);
  });

  it("an agent's edits inside a compound and a batch's steps carry captions as its single edits do", () => {
    const p = captioned();
    // Inside a compound: the ripple trim moved the shots and left the captions.
    const q = runAgentCommand(p, "create_compound_clip", { clip_ids: p.tracks.flatMap((t) => t.clips.map((c) => c.id)) });
    const k = q.compounds![0];
    const r = runAgentCommand(q, "edit_compound", { compound_id: k.id, command: "trim_clip", args: { clip_id: k.tracks.find((t) => t.main)!.clips[0].id, edge: "end", to: 1.9, ripple: true } });
    const inner = { ...r, tracks: r.compounds![0].tracks };
    expect(starts(inner, "video")).toEqual([0, 1.9, 3.9]);
    expect(starts(inner, "text")).toEqual([0, 1.9, 3.9]);
    // A batch: its second step saw the first caption where the insert had
    // left it, and wrote the hook over it.
    const main = p.tracks.find((t) => t.main)!.id, captions = p.tracks.find((t) => t.name === "Captions")!.id;
    const b = runAgentCommand(p, "batch", { commands: [{ command: "add_media_clip", args: { asset_id: "a1", start: 0, duration: 1, in: 8, mode: "insert", track_id: main } }, { command: "add_text", args: { text: "Hook", start: 0, duration: 1, track_id: captions } }] });
    expect(b.tracks.find((t) => t.id === captions)!.clips.map((c) => [c.start / 30, c.duration / 30])).toEqual([[0, 1], [1, 1.8], [3, 1.8], [5, 1.5]]);
  });

  it("a reversed clip's end stops at the file's start, and says so", () => {
    let p = captioned();
    const c = p.tracks.find((t) => t.main)!.clips[2].id;
    p = runCommand(p, "set_reverse", { clip_id: c, reverse: true });
    const report: CommandReport = {};
    runCommand(p, "trim_clip", { clip_id: c, edge: "end", to: 20, ripple: true }, report);
    // Read backward from 6 s, its end reaches the file's first frame 6 s in.
    expect(report.notes).toEqual(["Stopped at 10 s, not 20 s: the source starts there (launch.mp4 has nothing earlier, played reversed)."]);
  });

  it("a freeze frame has nothing to slip, and says so instead of naming the source's end", () => {
    let p = captioned();
    p = runCommand(p, "freeze_frame", { clip_id: p.tracks.find((t) => t.main)!.clips[0].id, at: 1, duration: 1 });
    const freeze = p.tracks.find((t) => t.main)!.clips.find((c) => c.type === "video" && c.freeze)!.id;
    expect(() => runCommand(p, "slip_clip", { clip_id: freeze, by: 1 })).toThrow(/freeze frame holds one frame/);
  });
});
