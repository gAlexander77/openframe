import { describe, expect, it } from "vitest";
import { keyframeProblem } from "./animatable";
import { cleanColorize, colorizeRgb, COLORIZE_DEFAULT } from "./colorize";
import { describeProject, runCommand } from "./commands";
import { resolveGrade } from "./grade";
import { createProject, normalizeProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ImageClip, Project } from "./project/types";

const AMBER: [number, number, number] = [1, 0xb3 / 255, 0x47 / 255];

/** A white glow sprite on the main track, as the Claude film test had. */
function sprite(): { p: Project; id: string } {
  let p: Project = { ...createProject(), assets: [{ id: "glow", kind: "image", name: "glow-white.png", src: "glow-white.png", duration: 0, width: 1400, height: 1400, hasVideo: true, hasAudio: false }] };
  p = runCommand(p, "add_media_clip", { asset_id: "glow", start: 0, duration: 4 });
  return { p, id: p.tracks.flatMap((t) => t.clips)[0].id };
}
const clipOf = (p: Project, id: string) => findClip(p, id)!.clip as ImageClip;

describe("colorize (ADR-105)", () => {
  it("makes white the color, keeps black, shades grays, and mixes by amount", () => {
    expect(colorizeRgb([1, 1, 1], AMBER, 1)).toEqual(AMBER);
    expect(colorizeRgb([0, 0, 0], AMBER, 1)).toEqual([0, 0, 0]);
    const gray = colorizeRgb([0.5, 0.5, 0.5], AMBER, 1);
    gray.forEach((v, i) => expect(v).toBeCloseTo(AMBER[i] * 0.5, 9));
    expect(colorizeRgb([1, 1, 1], AMBER, 0)).toEqual([1, 1, 1]);
    colorizeRgb([1, 1, 1], AMBER, 0.5).forEach((v, i) => expect(v).toBeCloseTo((1 + AMBER[i]) / 2, 9));
  });

  it("cleans a stored colorize: a bad color takes the default's, the amount is clamped", () => {
    expect(cleanColorize({ color: "not a color", amount: 3 })).toEqual({ color: COLORIZE_DEFAULT.color, amount: 1 });
    expect(cleanColorize({ color: "#00e5ff" })).toEqual({ color: "#00e5ff", amount: 1 });
    expect(cleanColorize("amber")).toBeUndefined();
  });

  it("set_colorize colors a white sprite: the grade the renderer reads carries it", () => {
    const { p, id } = sprite();
    const q = runCommand(p, "set_colorize", { clip_ids: [id], color: "#ffb347" });
    expect(clipOf(q, id).adjust.colorize).toEqual({ color: "#ffb347", amount: 1 });
    const g = resolveGrade(q, clipOf(q, id), 0)!;
    g.colorize!.rgb.forEach((v, i) => expect(v).toBeCloseTo(AMBER[i], 9));
    expect(g.colorize!.amount).toBe(1);
    // Before, nothing in the grade: the shader runs it as off.
    expect(resolveGrade(p, clipOf(p, id), 0)).toBeUndefined();
    // Values left out keep theirs; amount 0 resolves as off.
    const half = runCommand(q, "set_colorize", { clip_ids: [id], amount: 0.5 });
    expect(clipOf(half, id).adjust.colorize).toEqual({ color: "#ffb347", amount: 0.5 });
    expect(resolveGrade(runCommand(q, "set_colorize", { clip_ids: [id], amount: 0 }), clipOf(runCommand(q, "set_colorize", { clip_ids: [id], amount: 0 }), id), 0)).toBeUndefined();
  });

  it("keyframes the amount, keys at `at` once keyed, and off removes it with its keys", () => {
    const { p, id } = sprite();
    expect(keyframeProblem(clipOf(p, id), "adjust.colorize.amount")).toContain("set_colorize first");
    let q = runCommand(p, "set_colorize", { clip_ids: [id], color: "#ffb347", amount: 0 });
    expect(keyframeProblem(clipOf(q, id), "adjust.colorize.amount")).toBeNull();
    q = runCommand(q, "add_keyframe", { clip_id: id, path: "adjust.colorize.amount", at: 0, value: 0 });
    q = runCommand(q, "add_keyframe", { clip_id: id, path: "adjust.colorize.amount", at: 2, value: 1 });
    expect(resolveGrade(q, clipOf(q, id), 30)!.colorize!.amount).toBeCloseTo(0.5, 2);
    q = runCommand(q, "set_colorize", { clip_ids: [id], amount: 0.8, at: 2 });
    expect(clipOf(q, id).keyframes!["adjust.colorize.amount"].map((k) => k.v)).toEqual([0, 0.8]);
    const off = runCommand(q, "set_colorize", { clip_ids: [id], off: true });
    expect(clipOf(off, id).adjust.colorize).toBeUndefined();
    expect(clipOf(off, id).keyframes?.["adjust.colorize.amount"]).toBeUndefined();
  });

  it("works on an adjustment clip, refuses sound, and checks the color", () => {
    let p = sprite().p;
    p = runCommand(p, "add_adjustment_clip", { start: 0, duration: 2 });
    const adj = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "adjustment")!;
    expect(() => runCommand(p, "set_colorize", { clip_ids: [adj.id], color: "#00e5ff" })).not.toThrow();
    p = { ...p, assets: [...p.assets, { id: "s", kind: "audio", name: "s.wav", src: "s.wav", duration: 4, hasVideo: false, hasAudio: true }] };
    p = runCommand(p, "add_media_clip", { asset_id: "s", start: 0 });
    const sound = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!;
    expect(() => runCommand(p, "set_colorize", { clip_ids: [sound.id] })).toThrow("no picture to colorize");
    expect(() => runCommand(p, "set_colorize", { clip_ids: [adj.id], color: "amberish" })).toThrow("is not a color");
  });

  it("is told by describe_project and kept by a saved project", () => {
    const { p, id } = sprite();
    const q = runCommand(p, "set_colorize", { clip_ids: [id], color: "#ffb347", amount: 0.9 });
    const desc = describeProject(q).tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Record<string, unknown>;
    expect(desc.colorize).toEqual({ color: "#ffb347", amount: 0.9 });
    const loaded = normalizeProject(JSON.parse(JSON.stringify(q)));
    expect(clipOf(loaded, id).adjust.colorize).toEqual({ color: "#ffb347", amount: 0.9 });
  });
});
