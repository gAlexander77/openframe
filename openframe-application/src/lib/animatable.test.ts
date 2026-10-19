// Keyframes only where something moves (ADR-066), one ease vocabulary, and
// the keys themselves in describe_project, so key edits show in answers.
import { describe, expect, it } from "vitest";
import { animatablePaths, keyframeProblem } from "./animatable";
import { describeProject, runCommand } from "./commands";
import { createProject } from "./project/defaults";
import type { Clip, Project } from "./project/types";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);
const described = (p: Project, id: string) => describeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Record<string, unknown>;

function project(): Project {
  let p: Project = { ...createProject(), assets: [{ id: "a", kind: "audio", name: "m.wav", src: "m.wav", duration: 30, hasVideo: false, hasAudio: true }] };
  p = runCommand(p, "add_text", { text: "Title", start: 0, duration: 3 });
  p = runCommand(p, "add_media_clip", { asset_id: "a", start: 0, duration: 5 });
  return p;
}
const title = (p: Project) => clips(p).find((c) => c.type === "text")!;
const music = (p: Project) => clips(p).find((c) => c.type === "audio")!;

describe("which paths animate", () => {
  it("names the paths each kind of clip animates, the type's size, tracking and color on titles", () => {
    const p = project();
    expect(animatablePaths(title(p))).toEqual(expect.arrayContaining(["transform.x", "opacity", "style.size", "style.letterSpacing", "style.color"]));
    expect(animatablePaths(music(p))).toEqual(expect.arrayContaining(["volume", "pan", "lowpass.cutoff"]));
    expect(animatablePaths(music(p))).not.toContain("transform.x");
  });

  it("refuses a path nothing draws, listing what does", () => {
    const p = project();
    expect(keyframeProblem(title(p), "transform.x")).toBeNull();
    expect(keyframeProblem(title(p), "style.letterSpacing")).toBeNull();
    const why = keyframeProblem(title(p), "style.lineHeight")!;
    expect(why).toMatch(/style.lineHeight does not animate on text clips/);
    expect(why).toMatch(/Animatable on this clip: transform.x, .*style.size/);
    expect(keyframeProblem(music(p), "transform.x")).toMatch(/does not animate on audio clips/);
    expect(keyframeProblem(title(p), "chromaKey.similarity")).toMatch(/does not animate/);
  });

  it("says what a key needs before it shows", () => {
    const p = project();
    expect(keyframeProblem(title(p), "transform.scaleY")).toMatch(/set_uniform_scale/);
    expect(keyframeProblem(title(p), "mask.x")).toMatch(/set_mask first/);
    expect(keyframeProblem(music(p), "reverb.mix")).toMatch(/set_reverb first/);
    const q = runCommand(p, "set_reverb", { clip_ids: [music(p).id], preset: "hall" });
    expect(keyframeProblem(music(q), "reverb.mix")).toBeNull();
    const s = runCommand(p, "add_shape", { kind: "rectangle", start: 0, duration: 1 });
    const shape = clips(s).find((c) => c.type === "color")!;
    expect(keyframeProblem(shape, "shape.width")).toBeNull();
    expect(keyframeProblem(shape, "shape.stroke.width")).toMatch(/no outline/);
  });
});

describe("add_keyframe and set_param", () => {
  it("refuses a key on a path that does not animate, and keeps the project as it was", () => {
    const p = project();
    expect(() => runCommand(p, "add_keyframe", { clip_id: title(p).id, path: "style.lineHeight", at: 0, value: 1 })).toThrow(/does not animate.*Animatable on this clip/);
    expect(() => runCommand(p, "add_keyframe", { clip_id: music(p).id, path: "transform.x", at: 0, value: 1 })).toThrow(/audio clips/);
  });

  it("refuses set_param writing a key into dead keys left from before", () => {
    const p = project();
    const dead = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.type === "text" ? ({ ...c, keyframes: { "style.lineHeight": [{ f: 0, v: 1 }, { f: 30, v: 2 }] } } as Clip) : c)) })) };
    expect(() => runCommand(dead, "set_param", { clip_ids: [title(p).id], path: "style.lineHeight", value: 1.5, at: 0.5 })).toThrow(/remove_keyframes/);
    // Without keys, set_param sets the value for the whole clip, at or not.
    const q = runCommand(p, "set_param", { clip_ids: [title(p).id], path: "style.lineHeight", value: 1.5, at: 0.5 });
    expect((title(q) as Clip & { style: { lineHeight: number } }).style.lineHeight).toBe(1.5);
  });

  it("takes set_keyframe_ease's twelve presets and a bezier", () => {
    let p = project();
    const id = title(p).id;
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 0, value: 0.8, ease: "fastIn" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 1, value: 0, ease: "spring" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 0, value: 0, bezier: [0.2, 0, 0, 1] });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 1, value: 1, ease: "linear" });
    const keys = title(p).keyframes!;
    expect(keys["transform.x"].map((k) => k.ease)).toEqual([[0.16, 1, 0.3, 1], "spring"]);
    expect(keys.opacity.map((k) => k.ease)).toEqual([[0.2, 0, 0, 1], undefined]);
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 2, value: 1, bezier: [2, 0, 0, 1] })).toThrow(/x1 and x2 in 0..1/);
    expect(() => runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 2, value: 1, ease: "wobble" })).toThrow(/must be one of/);
  });

  it("names an effect's parameter by place or type in move_keyframe too", () => {
    let p = project();
    const id = title(p).id;
    p = runCommand(p, "add_effect", { clip_id: id, type: "glow" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "effects.0.amount", at: 0, value: 10 });
    p = runCommand(p, "move_keyframe", { clip_id: id, path: "effects.glow.amount", at: 0, value: 40 });
    expect(Object.values(title(p).keyframes!)[0]).toEqual([{ f: 0, v: 40 }]);
  });
});

describe("describe_project shows the keys", () => {
  it("lists each path's keys as [at, value, ease] in timeline seconds", () => {
    let p = project();
    p = runCommand(p, "move_clip", { clip_id: title(p).id, start: 1 });
    const id = title(p).id;
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 1, value: 0.75, ease: "fastIn" });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "transform.x", at: 1.5, value: 0.16 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "opacity", at: 2, value: 0.5, bezier: [0.1, 0.2, 0.3, 0.4] });
    expect(described(p, id).keyframes).toEqual({ "transform.x": [[1, 0.75, "fastIn"], [1.5, 0.16]], opacity: [[2, 0.5, [0.1, 0.2, 0.3, 0.4]]] });
  });

  it("sums up a dense path instead of listing every key", () => {
    let p = project();
    const id = music(p).id;
    p = runCommand(p, "batch", { commands: Array.from({ length: 40 }, (_, i) => ({ command: "add_keyframe", args: { clip_id: id, path: "volume", at: i * 0.1, value: i % 2 ? 1 : 0.25 } })) });
    expect(described(p, id).keyframes).toEqual({ volume: { count: 40, first: [0, 0.25], last: [3.9, 1], range: [0.25, 1] } });
  });

  it("so a keyed value's edit shows in what changed", () => {
    let p = project();
    const id = music(p).id;
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "volume", at: 0, value: 1 });
    p = runCommand(p, "add_keyframe", { clip_id: id, path: "volume", at: 2, value: 0.5 });
    const before = described(p, id);
    p = runCommand(p, "set_param", { clip_ids: [id], path: "volume", value: 0.25, at: 2 });
    expect(described(p, id).keyframes).not.toEqual(before.keyframes);
    expect((described(p, id).keyframes as Record<string, unknown>).volume).toEqual([[0, 1], [2, 0.25]]);
  });
});

it("takes lineHeight in a text style", () => {
  const p = runCommand(createProject(), "add_text", { text: "Two\nlines", start: 0, duration: 1, style: { lineHeight: 0.95 } });
  expect((title(p) as Clip & { style: { lineHeight: number } }).style.lineHeight).toBe(0.95);
});
