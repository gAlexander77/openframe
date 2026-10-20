import { describe, expect, it } from "vitest";
import { clipGainAt, COMPRESSOR_SETTLE, fromDb, gainEnvelope, panEnvelope, soundingClips, soundOverlaps, soundPanAt, soundPreroll, toDb } from "./audio";
import { COMPRESSOR_PRESETS } from "./compressor";
import { clipForAsset, createProject, createTrack } from "./project/defaults";
import type { AudioClip, CompoundClip, Project, VideoClip } from "./project/types";

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

  it("adds the track's pan to each clip's, within -1..1", () => {
    const p: Project = createProject();
    const t = { ...createTrack("audio", "A"), pan: 0.5, clips: [{ ...clip, pan: 0.25 }, { ...clip, id: "far", pan: 0.75 }] };
    const s = soundingClips({ ...p, tracks: [...p.tracks, t] }, () => true);
    expect(s.map((x) => soundPanAt(x, p.fps, 0.1))).toEqual([0.75, 1]);
    expect(panEnvelope(s[0], p.fps, 0, 1)).toBeNull(); // nothing animated: one value holds
  });

  it("follows keyframed pan, plus the track's", () => {
    const p: Project = createProject(); // 30 fps
    const swept = { ...clip, start: 0, duration: 60, pan: 0, keyframes: { pan: [{ f: 0, v: -1 }, { f: 30, v: 0.6 }] } };
    const t = { ...createTrack("audio", "A"), pan: 0.4, clips: [swept] };
    const [s] = soundingClips({ ...p, tracks: [...p.tracks, t] }, () => true);
    expect(soundPanAt(s, p.fps, 0)).toBeCloseTo(-0.6, 5);
    expect(soundPanAt(s, p.fps, 1.5)).toBe(1); // 0.6 + 0.4, held after the last key
    const env = panEnvelope(s, p.fps, 0, 1, 10)!;
    expect(env[0]).toBeCloseTo(-0.6, 5);
    expect(env[5]).toBeGreaterThan(env[0]);
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

describe("soundPreroll", () => {
  it("starts a render early for a compressor, the clip's own or a compound clip's it plays through", () => {
    const voice = { ...clip, compressor: COMPRESSOR_PRESETS.voice };
    expect(soundPreroll({ clip, track })).toBe(0);
    // Each 10 s export window began with the compressor's 6 ms lookahead
    // empty: a gap in the sound, then its gain out of step.
    expect(soundPreroll({ clip: voice, track })).toBe(COMPRESSOR_SETTLE);
    const k = { id: "k", type: "compound", compoundId: "kk", start: 0, duration: 300, in: 0, speed: 1, volume: 1, pan: 0, fadeIn: 0, fadeOut: 0, muted: false, compressor: COMPRESSOR_PRESETS.gentle } as unknown as CompoundClip;
    expect(soundPreroll({ clip, track, via: [{ clip: k, track }] })).toBe(COMPRESSOR_SETTLE);
    // An echo's tail longer than that wins.
    expect(soundPreroll({ clip: { ...voice, echo: { time: 1, feedback: 0.8, mix: 0.5 } }, track })).toBeGreaterThan(COMPRESSOR_SETTLE);
  });
});

describe("a split", () => {
  // A split of one sound (the same file going on at the same speed) is no
  // splice: each half ramping to nothing over the click guard put an 8 ms,
  // 18 dB hole in a song split on its drop, heard as a tick (preview_audio's
  // edges found it; set_crossfade refuses a split, so nothing could fix it).
  const song = { id: "s", src: "s.wav", name: "s", kind: "audio" as const, duration: 20, hasAudio: true, hasVideo: false };
  const split = (edit: (a: AudioClip, b: AudioClip) => [AudioClip, AudioClip] = (a, b) => [a, b]) => {
    const p = createProject();
    p.assets = [song];
    const a: AudioClip = { ...(clipForAsset(song, 0, p.fps) as AudioClip), id: "a", duration: 45, fadeIn: 0, fadeOut: 0 };
    const b: AudioClip = { ...a, id: "b", start: 45, in: 1.5 };
    const t = { ...createTrack("audio", "Music"), clips: edit(a, b) };
    p.tracks = [t];
    const o = soundOverlaps(p);
    return (id: string, at: number) => clipGainAt(t.clips.find((c) => c.id === id)!, t, p.fps, at, o.get(id));
  };
  it("plays on at full gain across the cut", () => {
    const g = split();
    for (const at of [1.4995, 1.498, 1.497]) expect(g("a", at)).toBe(1);
    for (const at of [1.5, 1.5005, 1.502]) expect(g("b", at)).toBe(1);
    // The halves' own outer edges keep their guard.
    expect(g("a", 0)).toBe(0);
    expect(g("b", 2.9999)).toBeLessThan(0.1);
  });
  it("moves to the second half's level at the cut when the halves differ", () => {
    const g = split((a, b) => [a, { ...b, volume: 0.5 }]);
    expect(g("a", 1.49)).toBe(1);
    expect(g("a", 1.5 - 1e-6)).toBeCloseTo(0.5, 3);
    expect(g("b", 1.5)).toBe(0.5);
  });
  it("keeps the guard where the sound does not go on: another place in the file, a fade, another speed, a muted half", () => {
    expect(split((a, b) => [a, { ...b, in: 4 }])("a", 1.4999)).toBeLessThan(0.1);
    expect(split((a, b) => [{ ...a, fadeOut: 3 }, b])("a", 1.4999)).toBeLessThan(0.1);
    expect(split((a, b) => [a, { ...b, fadeIn: 3 }])("b", 1.5001)).toBeLessThan(0.1);
    expect(split((a, b) => [a, { ...b, speed: 2 }])("a", 1.4999)).toBeLessThan(0.1);
    expect(split((a, b) => [a, { ...b, muted: true }])("a", 1.4999)).toBeLessThan(0.1);
  });
});
