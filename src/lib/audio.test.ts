import { describe, expect, it } from "vitest";
import { clipGainAt, fromDb, gainEnvelope, soundingClips, toDb } from "./audio";
import { createProject, createTrack } from "./project/defaults";
import type { AudioClip, Project } from "./project/types";

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
});

it("converts decibels", () => {
  expect(toDb(1)).toBe(0);
  expect(fromDb(-6)).toBeCloseTo(0.501, 3);
});
