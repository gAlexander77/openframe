import { describe, expect, it } from "vitest";
import { CommandError, runCommand } from "./commands";
import { alignPreset, pictureEnd } from "./epic";
import { createProject } from "./project/defaults";
import { findClip, sourceRange } from "./project/ops";
import type { AdjustmentClip, AudioClip, Project, VideoClip } from "./project/types";
import { PRESETS, speedAt } from "./speed";

const fps = { num: 30, den: 1 };
const BEAT = 60 / 128;
/** 128 BPM from 0.25 s, as the beat-128 fixture. */
const beatTimes = (n: number) => Array.from({ length: n }, (_, i) => 0.25 + i * BEAT);

function project(): Project {
  let p: Project = {
    ...createProject({ fps }),
    assets: [
      { id: "long", kind: "video", name: "long.mp4", src: "long.mp4", duration: 10, hasVideo: true, hasAudio: true },
      { id: "short", kind: "video", name: "short.mp4", src: "short.mp4", duration: 1.2, hasVideo: true, hasAudio: true },
      { id: "pic", kind: "image", name: "pic.jpg", src: "pic.jpg", duration: 0, hasVideo: true, hasAudio: false },
      { id: "song", kind: "audio", name: "song.m4a", src: "song.m4a", duration: 20, hasVideo: false, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_markers", { times: beatTimes(40), label: "Beat" });
  return p;
}

const main = (p: Project) => p.tracks.find((t) => t.main)!.clips as VideoClip[];
const beatFrames = (p: Project) => p.markers.filter((m) => m.label === "Beat").map((m) => m.frame);

describe("cut_to_beats", () => {
  it("cuts every shot on a beat, the intro inside the first", () => {
    const p = runCommand(project(), "cut_to_beats", { media: [{ asset_id: "long" }, { asset_id: "pic" }, { asset_id: "long" }, { asset_id: "long", in: 2 }] });
    const b = beatFrames(p);
    const clips = main(p);
    expect(clips.map((c) => c.start)).toEqual([0, b[2], b[4], b[6]]);
    expect(clips[3].start + clips[3].duration).toBe(b[8]);
    // The second shot of "long" carries on where the first stopped.
    expect(clips[2].in).toBeCloseTo(b[2] / 30, 6);
    expect(clips[3].in).toBe(2);
    expect(clips[0].muted).toBe(true);
    expect(clips[1].type).toBe("image");
  });

  it("follows a pattern, a shot's own beats, a start on a beat and an end", () => {
    const p0 = project();
    const b = beatFrames(p0);
    const p = runCommand(p0, "cut_to_beats", { media: [{ asset_id: "long" }, { asset_id: "pic" }, { asset_id: "pic", beats: 3 }, { asset_id: "pic" }, { asset_id: "pic" }], pattern: [4, 1], start: 0.25, end: 4, mute: false });
    const clips = main(p);
    // 4 beats, 1, then the third shot's own 3; the grid ends at 4 s (beat 8).
    expect(clips.map((c) => c.start)).toEqual([b[0], b[4], b[5]]);
    expect(clips[2].start + clips[2].duration).toBe(b[8]);
    expect(b[8]).toBe(120);
    expect(clips[0].muted).toBe(false);
  });

  it("ends a short file's shot on the last beat it can fill, and slides in-points back inside", () => {
    const p = runCommand(project(), "cut_to_beats", { media: [{ asset_id: "short" }, { asset_id: "long", in: 9.8 }], every: 4 });
    const b = beatFrames(p);
    const [s, l] = main(p);
    // 1.2 s of media: beat 2 (0.94 s from 0) fits, beat 4 (1.88 s) does not.
    expect(s.start + s.duration).toBe(b[2]);
    const [lo, hi] = sourceRange(l, fps);
    expect(hi).toBeLessThanOrEqual(10 + 1e-9);
    expect(hi - lo).toBeCloseTo(l.duration / 30, 6);
    expect(l.start + l.duration).toBe(b[6]);
  });

  it("cuts on bars or explicit times, and says what is missing", () => {
    let p = project();
    expect(() => runCommand(p, "cut_to_beats", { media: [{ asset_id: "long" }], grid: "bars" })).toThrow(/no Bar markers: run analyze_music with markers \["bars"\]/);
    p = runCommand(p, "add_markers", { times: [0.25, 2.125, 4], label: "Bar" });
    const q = runCommand(p, "cut_to_beats", { media: [{ asset_id: "pic" }, { asset_id: "pic" }, { asset_id: "pic" }], grid: "downbeats" });
    expect(main(q).map((c) => [c.start, c.duration])).toEqual([[0, 64], [64, 56]]);
    expect(() => runCommand(p, "cut_to_beats", { media: [{ asset_id: "x" }], beats: [1] })).toThrow(CommandError);
    expect(() => runCommand(p, "cut_to_beats", { media: [{ asset_id: "song" }] })).toThrow(/audio/);
  });
});

const hitsTracks = (p: Project) => p.tracks.filter((t) => t.name.startsWith("Hits"));

describe("add_beat_hits", () => {
  it("puts hits on the beats on one Hits track above the footage, peaking and easing out", () => {
    let p = runCommand(project(), "cut_to_beats", { media: [{ asset_id: "long" }, { asset_id: "long" }, { asset_id: "long" }] });
    p = runCommand(p, "add_beat_hits", { effects: ["zoom", "rgbSplit"], every: 2, to: 3 });
    const b = beatFrames(p);
    const [hits] = hitsTracks(p);
    expect(hitsTracks(p)).toHaveLength(1);
    expect(p.tracks.indexOf(hits)).toBe(p.tracks.findIndex((t) => t.main) - 1);
    const clips = hits.clips as AdjustmentClip[];
    expect(clips.map((c) => c.start)).toEqual([b[0], b[2], b[4]]);
    const c = clips[1];
    expect(c.name).toBe("Hit: Zoom punch + RGB split");
    expect(c.duration).toBe(7); // 0.25 s at 30 fps: 7.5 frames, a tie, to the earlier (ADR-102)
    expect(c.effects.map((e) => e.type)).toEqual(["zoom", "rgbSplit"]);
    const zoom = c.keyframes![`effects.${c.effects[0].id}.amount`];
    expect(zoom).toEqual([{ f: 0, v: 25, ease: "easeOut" }, { f: 7, v: 0 }]);
    // At the cuts instead, a second call fits on the same track when free.
    const q = runCommand(p, "add_beat_hits", { effect: "flash", at_cuts: true, intensity: 0.5, duration: 0.1 });
    expect(hitsTracks(q)).toHaveLength(2);
    const flashes = hitsTracks(q)[1].clips as AdjustmentClip[];
    expect(flashes.map((x) => x.start)).toEqual([b[2], b[4]]);
    expect(flashes[0].keyframes!["adjust.exposure"][0].v).toBe(50);
  });

  it("keeps flashes to three a second and keeps the rest of the hit", () => {
    const p = runCommand(project(), "add_color_clip", { color: "#336699", start: 0, duration: 5 });
    // Eight beats a second: only three flashes may fall in any second.
    const times = Array.from({ length: 16 }, (_, i) => i * 0.125);
    const q = runCommand(p, "add_beat_hits", { effects: ["flash", "shake"], times });
    const clips = hitsTracks(q)[0].clips;
    expect(clips).toHaveLength(16);
    const flashed = clips.filter((c) => c.name!.includes("Flash")).map((c) => c.start);
    for (let i = 0; i + 3 < flashed.length; i++) expect(flashed[i + 3] - flashed[i]).toBeGreaterThanOrEqual(30);
    expect(flashed.length).toBeGreaterThanOrEqual(5);
    // Flash alone: the beats that would break the limit get nothing.
    const r = runCommand(p, "add_beat_hits", { effect: "flash", times });
    expect(hitsTracks(r)[0].clips.length).toBe(flashed.length);
    // Hits a second call adds count against the first's.
    const s = runCommand(r, "add_beat_hits", { effect: "flash", times: [0.05] });
    expect(s).toBe(r);
  });

  it("leaves titles off the Hits track", () => {
    let p = runCommand(project(), "add_media_clip", { asset_id: "long", start: 0, duration: 4 });
    p = runCommand(p, "add_beat_hits", { effect: "zoom", times: [3] });
    p = runCommand(p, "add_text", { text: "TITLE", start: 0.5, duration: 1 });
    const title = p.tracks.find((t) => t.clips.some((c) => c.type === "text"))!;
    expect(title.name).not.toMatch(/Hits/);
    expect(p.tracks.indexOf(title)).toBe(0);
    expect(() => runCommand(p, "add_beat_hits", { effect: "zoom", times: [] })).toThrow(/no hit times/);
    expect(() => runCommand(p, "add_beat_hits", {})).toThrow(/give effect/);
  });
});

describe("add_cinematic_bars", () => {
  it("letterboxes the picture's length above hits and footage, below titles, sliding in", () => {
    let p = runCommand(project(), "add_media_clip", { asset_id: "long", start: 0, duration: 6 });
    p = runCommand(p, "add_beat_hits", { effect: "zoom", times: [1] });
    p = runCommand(p, "add_text", { text: "TITLE", start: 0, duration: 2 });
    p = runCommand(p, "add_cinematic_bars", { ratio: 1.85, animate_in: 0.5 });
    const names = p.tracks.map((t) => t.name);
    expect(names.indexOf("Bars")).toBe(names.indexOf("Hits") - 1);
    expect(p.tracks[names.indexOf("Bars") - 1].clips[0].type).toBe("text");
    const bars = p.tracks[names.indexOf("Bars")].clips[0] as AdjustmentClip;
    expect([bars.start, bars.duration]).toEqual([0, 180]);
    expect(bars.effects[0]).toMatchObject({ type: "letterbox", params: { ratio: 1.85, amount: 100 } });
    expect(bars.keyframes![`effects.${bars.effects[0].id}.amount`]).toEqual([{ f: 0, v: 0, ease: "easeInOut" }, { f: 15, v: 100 }, { f: 180, v: 100 }]);
    // Again: the bars are replaced, not stacked.
    const q = runCommand(p, "add_cinematic_bars", { ratio: 2.39 });
    expect(q.tracks.filter((t) => t.name.startsWith("Bars"))).toHaveLength(1);
    expect((q.tracks[names.indexOf("Bars")].clips[0] as AdjustmentClip).effects[0].params.ratio).toBe(2.39);
    expect(pictureEnd(q)).toBe(180);
    expect(() => runCommand(project(), "add_cinematic_bars", {})).toThrow(/no picture/);
  });
});

describe("set_speed_ramp", () => {
  it("lands the slow moment on the beat and keeps the clip's place and length", () => {
    const p0 = runCommand(project(), "cut_to_beats", { media: [{ asset_id: "long" }, { asset_id: "long", in: 4 }], every: 4 });
    const b = beatFrames(p0);
    const id = main(p0)[1].id;
    const p = runCommand(p0, "set_speed_ramp", { clip_id: id, at: b[6] / 30 });
    const c = findClip(p, id)!.clip as VideoClip;
    expect([c.start, c.duration]).toEqual([main(p0)[1].start, main(p0)[1].duration]);
    expect(main(p)[0]).toEqual(main(p0)[0]);
    const u = b[6] - c.start;
    expect(speedAt(c.speedCurve!.points, u)).toBeCloseTo(0.3, 6);
    expect(speedAt(c.speedCurve!.points, u - 10)).toBeCloseTo(2, 6);
    expect(c.speedCurve!.preset).toBe("custom");
    const [lo, hi] = sourceRange(c, fps);
    expect(lo).toBe(4);
    expect(hi).toBeLessThanOrEqual(10);
    // Default: the beat nearest the middle; fast moment.
    const q = runCommand(p0, "set_speed_ramp", { clip_id: id, moment: "fast" });
    const f = findClip(q, id)!.clip as VideoClip;
    expect(speedAt(f.speedCurve!.points, b[6] - f.start)).toBeCloseTo(3, 6);
  });

  it("moves the in-point back, then slows the ramp, when the media runs out", () => {
    let p = runCommand(project(), "add_media_clip", { asset_id: "short", start: 0, duration: 1, in: 0.1 });
    const id = main(p)[0].id;
    p = runCommand(p, "set_speed_ramp", { clip_id: id, at: 0.5, base: 3 });
    const c = findClip(p, id)!.clip as VideoClip;
    const [lo, hi] = sourceRange(c, fps);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThanOrEqual(1.2 + 1e-6);
    expect(c.duration).toBe(30);
    expect(() => runCommand(p, "set_speed_ramp", { clip_id: id, at: 5 })).toThrow(/inside the clip/);
  });

  it("aligns a preset's slowest point to the beat", () => {
    const pts = alignPreset(PRESETS.bullet.points, 0.25, "slow");
    expect(pts.find((x) => x.speed === 0.2)!.t).toBeCloseTo(0.25, 9);
    expect(pts[0].t).toBe(0);
    expect(pts[pts.length - 1].t).toBe(1);
    const flash = alignPreset(PRESETS.flashOut.points, 0.5, "fast");
    expect(flash.find((x) => x.speed === 8)!.t).toBe(0.5);
  });
});

describe("fit_music", () => {
  function scored() {
    let p = runCommand(project(), "add_media_clip", { asset_id: "long", start: 0, duration: 6 });
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0 });
    return [p, p.tracks.find((t) => t.kind === "audio")!.clips[0].id] as const;
  }

  it("ends the music with the picture and fades it", () => {
    const [p0, id] = scored();
    const p = runCommand(p0, "fit_music", { clip_id: id, fade_out: 1.5 });
    const c = findClip(p, id)!.clip as AudioClip;
    expect([c.start, c.duration, c.fadeOut]).toEqual([0, 180, 45]);
    // On the last bar line before the picture's end instead.
    const q = runCommand(runCommand(p0, "add_markers", { times: [0.25, 2.125, 4, 5.875, 7.75], label: "Bar" }), "fit_music", { clip_id: id, end: "bar" });
    expect((findClip(q, id)!.clip as AudioClip).duration).toBe(176);
  });

  it("slides the drop onto its time, cutting what falls before 0, and moves the beats along", () => {
    let [p0, id] = scored();
    p0 = runCommand(p0, "add_markers", { times: [8.0], label: "Drop" });
    const p = runCommand(p0, "fit_music", { clip_id: id, drop_at: 2, trim_picture: true, end_at: 5 });
    const c = findClip(p, id)!.clip as AudioClip;
    // Drop at 8 s now plays at 2 s: 6 s of the head is gone.
    expect(c.start).toBe(0);
    expect(c.in).toBeCloseTo(6, 6);
    expect(c.duration).toBe(150);
    expect(p.markers.find((m) => m.label === "Drop")!.frame).toBe(60);
    expect(beatFrames(p)[0]).toBe(beatFrames(p0).find((f) => f >= 180)! - 180);
    // The picture stops with it.
    expect(main(p)[0].duration).toBe(150);
    const [bare, music] = scored();
    expect(() => runCommand(bare, "fit_music", { clip_id: music, drop_at: 2 })).toThrow(/no Drop marker/);
  });
});
