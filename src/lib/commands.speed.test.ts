import { describe, expect, it } from "vitest";
import { CommandError, describeProject, runCommand } from "./commands";
import { createProject } from "./project/defaults";
import { findClip, sourceRange } from "./project/ops";
import type { Project, VideoClip } from "./project/types";

const fps = { num: 30, den: 1 };

/** One 4 s clip (source 1..5 s) followed by a 2 s clip. */
function timeline(): [Project, string] {
  let p: Project = {
    ...createProject({ fps }),
    assets: [{ id: "a1", kind: "video", name: "run.mp4", src: "run.mp4", duration: 10, hasVideo: true, hasAudio: true }],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 0, in: 1, duration: 4 });
  p = runCommand(p, "add_media_clip", { asset_id: "a1", start: 4, in: 6, duration: 2 });
  return [p, p.tracks[0].clips[0].id];
}

const clip = (p: Project, id: string) => findClip(p, id)!.clip as VideoClip;

describe("speed commands", () => {
  it("set_speed_curve applies a preset over the same source and ripples", () => {
    const [p0, id] = timeline();
    const p = runCommand(p0, "set_speed_curve", { clip_id: id, preset: "bullet" });
    const c = clip(p, id);
    expect(c.speedCurve?.preset).toBe("bullet");
    const [lo, hi] = sourceRange(c, fps);
    expect(lo).toBe(1);
    expect(Math.abs(hi - 5)).toBeLessThan(0.07);
    expect(p.tracks[0].clips[1].start).toBe(c.duration);
    expect(describeProject(p).tracks[0].clips[0]).toMatchObject({ speed_curve: "bullet" });
  });

  it("set_speed_curve takes custom points and pins the ends", () => {
    const [p0, id] = timeline();
    const p = runCommand(p0, "set_speed_curve", { clip_id: id, points: [{ t: 0.5, speed: 2 }] });
    const c = clip(p, id);
    // A single 2x point held across the clip halves it.
    expect(c.duration).toBe(60);
    expect(c.speedCurve!.points.map((x) => x.f)).toEqual([0, 30, 60]);
    expect(() => runCommand(p0, "set_speed_curve", { clip_id: id })).toThrow(CommandError);
    expect(() => runCommand(p0, "set_speed_curve", { clip_id: id, points: [{ t: 0.5, speed: 50 }] })).toThrow(/<= 10/);
  });

  it("preset none returns to the constant speed", () => {
    const [p0, id] = timeline();
    const p = runCommand(runCommand(p0, "set_speed_curve", { clip_id: id, preset: "montage" }), "set_speed_curve", { clip_id: id, preset: "none" });
    expect(clip(p, id).speedCurve).toBeUndefined();
    // Within a frame of the original 120: a clip is whole frames, so a ramp's
    // end lands within half a frame of source, as constant speeds do.
    expect(Math.abs(clip(p, id).duration - 120)).toBeLessThanOrEqual(1);
  });

  it("set_reverse flips direction over the same range; text clips refuse", () => {
    const [p0, id] = timeline();
    const p = runCommand(p0, "set_reverse", { clip_id: id, reverse: true });
    expect([clip(p, id).reverse, clip(p, id).in, clip(p, id).duration]).toEqual([true, 5, 120]);
    expect(describeProject(p).tracks[0].clips[0]).toMatchObject({ reverse: true, in: 5 });
    const t = runCommand(p0, "add_text", { text: "hi", start: 0, duration: 1 });
    const textId = t.tracks[0].clips.find((c) => c.type === "text")!.id;
    expect(() => runCommand(t, "set_reverse", { clip_id: textId, reverse: true })).toThrow(/cannot play backward/);
  });

  it("set_preserve_pitch maps onto CapCut's Change pitch toggle", () => {
    const [p0, id] = timeline();
    const p = runCommand(p0, "set_preserve_pitch", { clip_id: id, preserve: false });
    expect(clip(p, id).changePitch).toBe(true);
    expect(describeProject(p).tracks[0].clips[0]).toMatchObject({ change_pitch: true });
    expect(clip(runCommand(p, "set_preserve_pitch", { clip_id: id, preserve: true }), id)).not.toHaveProperty("changePitch");
  });
});
