import { describe, expect, it } from "vitest";
import { clipGainAt, fromDb, gainEnvelope, soundingClips, soundOverlaps, toDb } from "./audio";
import { clipForAsset, createProject, createTrack } from "./project/defaults";
import type { AudioClip, Project, VideoClip } from "./project/types";

const fps = { num: 30, den: 1 };
const track = { ...createTrack("audio", "A"), volume: 0.5 };
const clip: AudioClip = {
  id: "c",
  type: "audio",
  assetId: "a",
  start: 30,
  duration: 90,
  in: 0,
  speed: 1,
  volume: 2,
  pan: 0,
  fadeIn: 30,
  fadeOut: 15,
  muted: false,
};

describe("clip gain", () => {
  it("is volume x track volume, silent outside the clip", () => {
    expect(clipGainAt(clip, track, fps, 2)).toBeCloseTo(1);
    expect(clipGainAt(clip, track, fps, 0.5)).toBe(0);
    expect(clipGainAt(clip, track, fps, 4)).toBe(0);
  });
  it("fades linearly at both ends", () => {
    expect(clipGainAt(clip, track, fps, 1.5)).toBeCloseTo(0.5);
    expect(clipGainAt(clip, track, fps, 3.75)).toBeCloseTo(0.5);
  });
  it("never starts at full gain, even without a fade (click guard)", () => {
    expect(clipGainAt({ ...clip, fadeIn: 0 }, track, fps, 1)).toBe(0);
  });
  it("follows keyframed volume", () => {
    const k = { ...clip, fadeIn: 0, keyframes: { volume: [{ f: 30, v: 0 }, { f: 60, v: 2 }] } };
    expect(clipGainAt(k, track, fps, 2.5)).toBeCloseTo(0.5);
  });
  it("samples an envelope for Web Audio", () => {
    const env = gainEnvelope(clip, track, fps, 1, 2, 10);
    expect(env.length).toBe(11);
    expect(env[0]).toBe(0);
    expect(env[10]).toBeCloseTo(1, 1);
  });
});

describe("sounding clips", () => {
  it("skip muted tracks, muted, disabled and frozen clips", () => {
    const p: Project = createProject();
    const a = { ...createTrack("audio", "A"), clips: [clip, { ...clip, id: "m", muted: true }] };
    const b = { ...createTrack("audio", "B"), muted: true, clips: [{ ...clip, id: "x" }] };
    const got = soundingClips({ ...p, tracks: [...p.tracks, a, b] }, () => true).map((s) => s.clip.id);
    expect(got).toEqual(["c"]);
  });
  it("play only soloed tracks while any is soloed", () => {
    const p: Project = createProject();
    const a = { ...createTrack("audio", "A"), clips: [clip] };
    const b = { ...createTrack("audio", "B"), solo: true, clips: [{ ...clip, id: "s" }] };
    expect(soundingClips({ ...p, tracks: [...p.tracks, a, b] }, () => true).map((s) => s.clip.id)).toEqual(["s"]);
  });
});

it("converts decibels", () => {
  expect(toDb(1)).toBe(0);
  expect(fromDb(-6)).toBeCloseTo(0.501, 3);
});

describe("soundOverlaps", () => {
  const setup = (aIn = 1, bIn = 1, src = 10) => {
    const p = createProject();
    p.assets = [{ id: "v", src: "v.mp4", name: "v", kind: "video", duration: src, width: 1920, height: 1080, hasAudio: true, hasVideo: true }];
    const a = clipForAsset(p.assets[0], 0, p.fps) as VideoClip;
    a.in = aIn;
    a.duration = 60;
    a.transitionOut = { type: "dissolve", duration: 20 };
    const b = { ...(clipForAsset(p.assets[0], 60, p.fps) as VideoClip), in: bIn, duration: 60 };
    p.tracks[0].clips = [a, b];
    return { p, a, b };
  };
  it("overlaps half the transition each way, within the handles", () => {
    const { p, a, b } = setup();
    const o = soundOverlaps(p);
    expect(o.get(a.id)).toEqual({ pre: 0, post: 10 / 30 });
    expect(o.get(b.id)).toEqual({ pre: 10 / 30, post: 0 });
    // No handle before the second clip's in point: no overlap at all.
    expect(soundOverlaps(setup(1, 0).p).size).toBe(0);
    // Only 0.1 s of source after the first clip: the overlap shrinks to it.
    const short = setup(7.9, 1, 10);
    expect(soundOverlaps(short.p).get(short.a.id)?.post).toBeCloseTo(0.1);
  });
  it("crossfades at constant power across the cut", () => {
    const { p, a, b } = setup();
    const o = soundOverlaps(p);
    const t = p.tracks[0];
    for (const s of [1.7, 1.8, 2, 2.2, 2.3]) {
      const ga = clipGainAt(a, t, p.fps, s, o.get(a.id)), gb = clipGainAt(b, t, p.fps, s, o.get(b.id));
      expect(ga * ga + gb * gb).toBeCloseTo(1, 5);
    }
    expect(clipGainAt(a, t, p.fps, 2.34, o.get(a.id))).toBe(0);
    expect(clipGainAt(b, t, p.fps, 1.6, o.get(b.id))).toBe(0);
  });
});
