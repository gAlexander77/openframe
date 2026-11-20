// Multicam: switch_angles (ADR-148).
import { describe, expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { createProject, createTrack } from "./project/defaults";
import { findClip } from "./project/ops";
import { layerAt } from "./render/plan";
import type { Project, VideoClip, VisualClip } from "./project/types";

const fps = { num: 30, den: 1 };
/** A wide camera on the main track and a close one above it, both 0 to 10 s; a recorder's sound under them. */
function shoot() {
  let p: Project = {
    ...createProject({ fps }),
    assets: [
      { id: "wide", kind: "video", name: "wide.mp4", src: "wide.mp4", duration: 30, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
      { id: "close", kind: "video", name: "close.mp4", src: "close.mp4", duration: 30, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
      { id: "rec", kind: "audio", name: "recorder.wav", src: "recorder.wav", duration: 30, hasVideo: false, hasAudio: true },
    ],
  };
  const over = createTrack("video", "Camera 2"), sound = createTrack("audio", "Recorder");
  p = { ...p, tracks: [...p.tracks, over, sound] };
  p = runCommand(p, "add_media_clip", { asset_id: "wide", start: 0, duration: 10 });
  p = runCommand(p, "add_media_clip", { asset_id: "close", start: 0, duration: 10, track_id: over.id });
  p = runCommand(p, "add_media_clip", { asset_id: "rec", start: 0, duration: 10, track_id: sound.id });
  const [w, c, r] = p.tracks.map((t) => t.clips[0].id);
  return { p, w, c, r };
}
const clip = (p: Project, id: string) => findClip(p, id)!.clip as VideoClip;
/** Is the clip drawn at a timeline second, as the render plan decides it? */
const shows = (p: Project, id: string, seconds: number) => (layerAt(p, clip(p, id) as VisualClip, Math.round(seconds * 30))?.opacity ?? 0) > 0;
/** Which of the two angles is drawn at each second given. */
const program = (p: Project, a: string, b: string, at: number[]) => at.map((t) => (shows(p, a, t) ? "a" : "") + (shows(p, b, t) ? "b" : ""));

describe("switch_angles", () => {
  it("shows one angle at a time: the first until the first cut, then each cut's", () => {
    const { p, w, c } = shoot();
    const report: CommandReport = {};
    const q = runCommand(p, "switch_angles", { angles: [w, c], cuts: [{ at: 6, angle: w }, { at: 2.5, angle: c }, { at: 8, angle: c }] }, report);
    expect(program(q, w, c, [0, 2.4, 2.5, 5.9, 6, 7.9, 8, 9.9])).toEqual(["a", "a", "b", "b", "a", "a", "b", "b"]);
    // Opacity keys that hold, on clips left whole and where they were.
    expect(clip(q, w).keyframes!.opacity).toEqual([{ f: 0, v: 1, ease: "hold" }, { f: 75, v: 0, ease: "hold" }, { f: 180, v: 1, ease: "hold" }, { f: 240, v: 0, ease: "hold" }]);
    expect([clip(q, w), clip(q, c)].map((x) => [x.start, x.duration])).toEqual([[0, 300], [0, 300]]);
    expect(report.notes).toEqual([`Program: ${w} from 0 s, ${c} from 2.5 s, ${w} from 6 s, ${c} from 8 s.`, `2 angles are heard at once (${w}, ${c}): sound_from keeps one.`]);
  });

  it("replaces the program when called again, and no cuts shows the first angle throughout", () => {
    const { p, w, c } = shoot();
    const once = runCommand(p, "switch_angles", { angles: [w, c], cuts: [{ at: 3, angle: c }] });
    const again = runCommand(once, "switch_angles", { angles: [w, c], cuts: [{ at: 7, angle: c }] });
    expect(program(again, w, c, [1, 4, 6.9, 7])).toEqual(["a", "a", "a", "b"]);
    const none = runCommand(again, "switch_angles", { angles: [w, c], cuts: [] });
    expect(program(none, w, c, [1, 8])).toEqual(["a", "a"]);
    // An angle that always shows needs no keys; one that never does holds 0.
    expect([clip(none, w).keyframes?.opacity, clip(none, c).keyframes!.opacity]).toEqual([undefined, [{ f: 0, v: 0, ease: "hold" }]]);
  });

  it("keeps one sound: an angle's, or a recorder's, the other angles muted", () => {
    const { p, w, c, r } = shoot();
    const cuts = [{ at: 5, angle: c }];
    const one: CommandReport = {};
    const q = runCommand(p, "switch_angles", { angles: [w, c], cuts, sound_from: c }, one);
    expect([clip(q, w).muted, clip(q, c).muted]).toEqual([true, false]);
    expect(one.notes).toHaveLength(1);
    const rec = runCommand(p, "switch_angles", { angles: [w, c], cuts, sound_from: r });
    expect([clip(rec, w).muted, clip(rec, c).muted, clip(rec, r).muted]).toEqual([true, true, false]);
  });

  it("refuses an angle that is not there when asked to show, in seconds", () => {
    const { p, w, c, r } = shoot();
    const short = runCommand(p, "trim_clip", { clip_id: c, edge: "end", to: 6 });
    expect(() => runCommand(short, "switch_angles", { angles: [w, c], cuts: [{ at: 4, angle: c }] })).toThrow(`${c} is asked to show from 4 s to 10 s but is on the timeline from 0 s to 6 s`);
    expect(() => runCommand(p, "switch_angles", { angles: [w, c], cuts: [{ at: 4, angle: r }] })).toThrow("is not one of the angles");
    expect(() => runCommand(p, "switch_angles", { angles: [w, r], cuts: [] })).toThrow("an angle is a picture");
    expect(() => runCommand(p, "switch_angles", { angles: [w], cuts: [] })).toThrow("two or more");
  });
});
