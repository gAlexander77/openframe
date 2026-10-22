import { describe, expect, it } from "vitest";
import { clipGainAt, continuousSoundRuns, fadeGain, normalizationMix, soundingClips } from "./audio";
import { copyAttributes, pasteAttributes } from "./attributes";
import { detachAudio } from "./project/ops";
import { runCommand } from "./commands";
import { clipForAsset, createProject, createTrack, normalizeProject } from "./project/defaults";
import { splitAt } from "./project/ops";
import { FADE_CURVES, type AudioClip } from "./project/types";
import { applyVoicePreset, cleanFx, saturationCurve, VOICE_PRESETS } from "./soundFx";

function setup(settings: Partial<AudioClip> = {}) {
  const p = createProject();
  p.assets = [{ id: "a", src: "voice.wav", name: "Voice", kind: "audio", duration: 20, hasAudio: true, hasVideo: false }];
  const t = createTrack("audio", "Voice");
  const c = { ...clipForAsset(p.assets[0], 0, p.fps), ...settings } as AudioClip;
  t.clips = [c]; p.tracks.push(t);
  return { p, t, c };
}

describe("fade shapes", () => {
  for (const curve of Object.keys(FADE_CURVES) as (keyof typeof FADE_CURVES)[]) {
    it(`${curve} has clamped endpoints and rises monotonically`, () => {
      expect(fadeGain(-1, curve)).toBe(0);
      expect(fadeGain(2, curve)).toBeCloseTo(1, 12);
      for (let i = 1; i <= 100; i++) expect(fadeGain(i / 100, curve)).toBeGreaterThanOrEqual(fadeGain((i - 1) / 100, curve));
    });
  }
  it("has the intended midpoints and equal-power pair", () => {
    expect(fadeGain(0.5)).toBe(0.5);
    expect(fadeGain(0.5, "equalPower")).toBeCloseTo(Math.SQRT1_2);
    expect(fadeGain(0.5, "logarithmic")).toBeCloseTo(Math.log10(5.5));
    expect(fadeGain(0.5, "exponential")).toBeCloseTo((Math.sqrt(10) - 1) / 9);
    expect(fadeGain(0.5, "sCurve")).toBe(0.5);
    for (let i = 0; i <= 100; i++) expect(fadeGain(i / 100, "equalPower") ** 2 + fadeGain(1 - i / 100, "equalPower") ** 2).toBeCloseTo(1, 12);
  });
  it("uses the shapes on both sides and leaves legacy linear fades alone", () => {
    const { p, t, c } = setup({ fadeIn: 60, fadeOut: 60 });
    expect(clipGainAt(c, t, p.fps, 1)).toBeCloseTo(0.5);
    expect(clipGainAt(c, t, p.fps, 19)).toBeCloseTo(0.5);
    expect(clipGainAt({ ...c, fadeInCurve: "logarithmic" }, t, p.fps, 1)).toBeCloseTo(Math.log10(5.5));
    expect(clipGainAt({ ...c, fadeOutCurve: "exponential" }, t, p.fps, 19)).toBeCloseTo((Math.sqrt(10) - 1) / 9);
  });
});

it("cleans every new optional value at the project boundary", () => {
  const { p, c } = setup();
  Object.assign(c, { pitch: 100, fadeInCurve: "bogus", fadeOutCurve: "sCurve", crossfadeCurve: [], voice: "__proto__", mono: "yes", saturation: { drive: 4 }, ringMod: { frequency: -5, mix: Infinity } });
  const clean = normalizeProject(p).tracks.flatMap((t) => t.clips).find((x) => x.id === c.id) as AudioClip;
  expect(clean.pitch).toBe(12);
  expect(clean.fadeInCurve).toBeUndefined(); expect(clean.fadeOutCurve).toBe("sCurve");
  expect(clean.crossfadeCurve).toBeUndefined(); expect(clean.voice).toBeUndefined(); expect(clean.mono).toBeUndefined();
  expect(clean.saturation).toEqual({ drive: 1 }); expect(clean.ringMod).toEqual({ frequency: 20, mix: 0.6 });
  for (const pitch of [NaN, Infinity, "4", null]) {
    const { p, c } = setup(); Object.assign(c, { pitch });
    expect((normalizeProject(p).tracks.flatMap((t) => t.clips).find((x) => x.id === c.id) as AudioClip).pitch).toBeUndefined();
  }
});

it("expands every voice into cleaned settings and none restores defaults", () => {
  const { c } = setup({ volume: 0.7, fadeIn: 30 });
  for (const preset of Object.keys(VOICE_PRESETS)) {
    const applied = applyVoicePreset(c, preset);
    expect(applied.voice).toBe(preset);
    expect(applied).toMatchObject(VOICE_PRESETS[preset].settings);
    for (const key of ["lowpass", "highpass", "saturation", "ringMod", "echo", "reverb"] as const) if (applied[key]) expect(cleanFx(key, applied[key])).toEqual(applied[key]);
    const none = applyVoicePreset(applied, "none");
    expect(none).toEqual(c);
  }
  const curve = saturationCurve(0.7);
  expect(curve[2048]).toBe(0); expect(curve[0]).toBeCloseTo(-curve[4096], 6);
  expect(Math.max(...curve)).toBeLessThan(1);
});

it("validates curve, pitch and preset commands, leaving timing alone", () => {
  const { p, c } = setup();
  const ids = { clip_ids: [c.id] };
  let q = runCommand(p, "set_fades", { ...ids, fade_in: 2, fade_out: 1, curve: "sCurve", curve_out: "exponential" });
  let seen = () => q.tracks.flatMap((t) => t.clips).find((x) => x.id === c.id) as AudioClip;
  expect(seen()).toMatchObject({ fadeIn: 60, fadeOut: 30, fadeInCurve: "sCurve", fadeOutCurve: "exponential" });
  q = runCommand(q, "set_pitch", { ...ids, semitones: 5 });
  expect(seen()).toMatchObject({ pitch: 5, start: 0, duration: c.duration, speed: 1 });
  q = runCommand(q, "set_param", { ...ids, path: "pitch", value: -5 }); expect(seen().pitch).toBe(-5);
  expect(() => runCommand(q, "set_param", { ...ids, path: "pitch", value: 5, at: 1 })).toThrow(/not keyframeable/);
  expect(() => runCommand(q, "add_keyframe", { clip_id: c.id, path: "pitch", value: 5, at: 1 })).toThrow(/does not animate/);
  for (const args of [{ ...ids, semitones: 13 }, { ...ids, semitones: -13 }]) expect(() => runCommand(q, "set_pitch", args)).toThrow();
  expect(() => runCommand(q, "set_fades", { ...ids, curve: "bad" })).toThrow();
  expect(() => runCommand(q, "apply_voice_preset", { ...ids, preset: "bad" })).toThrow();
  q = runCommand(q, "apply_voice_preset", { ...ids, preset: "robot" }); expect(seen().ringMod?.frequency).toBe(65);
  q = runCommand(q, "set_param", { ...ids, path: "ringMod.frequency", value: 80 }); expect(seen().ringMod?.frequency).toBe(80);
  q = runCommand(q, "apply_voice_preset", { ...ids, preset: "none" }); expect(seen().ringMod).toBeUndefined();
});

it("sets and removes a crossfade's curve", () => {
  const { p, t, c } = setup({ duration: 90 });
  t.clips.push({ ...c, id: "next", start: 90, in: 5 });
  const q = runCommand(p, "set_crossfade", { clip_id: c.id, seconds: 0.5, curve: "linear" });
  expect((q.tracks.at(-1)!.clips[0] as AudioClip).crossfadeCurve).toBe("linear");
  expect(() => runCommand(p, "set_crossfade", { clip_id: c.id, seconds: 0.5, curve: "bad" })).toThrow();
  const r = runCommand(q, "set_crossfade", { clip_id: c.id, seconds: 0 });
  expect((r.tracks.at(-1)!.clips[0] as AudioClip).crossfadeCurve).toBeUndefined();
});

it("carries new processing through identical splits, including speed and reverse", () => {
  for (const settings of [{ pitch: 5 }, { voice: "robot", ringMod: { frequency: 65, mix: 0.6 } }, { pitch: -5, speed: 2 }, { pitch: 7, reverse: true, in: 20 }]) {
    const { p } = setup(settings);
    const q = splitAt(splitAt(p, 60), 120);
    const all = soundingClips(q, () => true);
    expect(continuousSoundRuns(all, q.fps)).toHaveLength(1);
    expect(all).toHaveLength(3);
  }
});

it("keeps keyed sound and speed curves continuous across splits", () => {
  const { p } = setup({ pitch: 5, speedCurve: { points: [{ f: 0, speed: 0.5 }, { f: 600, speed: 2 }] }, keyframes: { volume: [{ f: 0, v: 0.5 }, { f: 600, v: 1 }], "lowpass.cutoff": [{ f: 0, v: 400 }, { f: 600, v: 4000 }] }, lowpass: { cutoff: 400, resonance: 0 } });
  const all = soundingClips(splitAt(splitAt(p, 90), 180), () => true);
  const runs = continuousSoundRuns(all, p.fps);
  expect(runs).toHaveLength(1);
  expect(runs[0].clip.duration).toBe(600);
  expect(runs[0].clip.speedCurve).toEqual(all[0].clip.speedCurve);
  expect(runs[0].clip.keyframes).toEqual(all[0].clip.keyframes);
});

it("keeps separate runs when sound settings or source continuity differ", () => {
  const { p } = setup({ pitch: 5 });
  const all = soundingClips(splitAt(p, 90), () => true);
  all[1].clip = { ...all[1].clip, pitch: 6 };
  expect(continuousSoundRuns(all, p.fps)).toHaveLength(2);
  all[1].clip = { ...all[1].clip, pitch: 5, in: 6 };
  expect(continuousSoundRuns(all, p.fps)).toHaveLength(2);
});

it("drops dead processor keys without mutating the input document", () => {
  const { p, c } = setup({ pitch: 5, keyframes: { pitch: [{ f: 0, v: 10 }], "ringMod.mix": [{ f: 0, v: 0.5 }] } });
  const clean = normalizeProject(p).tracks.flatMap((t) => t.clips).find((x) => x.id === c.id)!;
  expect(clean.keyframes?.pitch).toBeUndefined();
  expect(clean.keyframes?.["ringMod.mix"]).toBeUndefined();
  expect(c.keyframes?.pitch).toHaveLength(1);
});

it("saturation compensates the voiced reference and drive zero stays clean", () => {
  for (const drive of [0, 0.15, 0.25, 0.55, 0.8, 1]) {
    const curve = saturationCurve(drive);
    let dry = 0, wet = 0;
    for (let i = 0; i < 512; i++) {
      const x = 0.15 * Math.sin(2 * Math.PI * i / 512), p = (x + 1) / 2 * (curve.length - 1), k = Math.floor(p);
      const y = curve[k] + (curve[k + 1] - curve[k]) * (p - k);
      dry += x * x; wet += y * y;
    }
    expect(Math.abs(10 * Math.log10(wet / dry))).toBeLessThan(0.02);
  }
  const curve = saturationCurve(0);
  expect(curve[0]).toBe(-1); expect(curve[4096]).toBe(1);
});


it("normalizes the actual processed sound at unit gain, preserving a duck and mixer faders", () => {
  const { p, t, c } = setup({ pitch: 7, volume: 0.6, ringMod: { frequency: 65, mix: 0.5 }, saturation: { drive: 0.5 }, highpass: { cutoff: 500, resonance: 0 }, keyframes: { volume: [{ f: 0, v: 0.2 }, { f: 30, v: 0.6 }] } });
  t.volume = 0.4; t.pan = 0.5; t.muted = true; p.masterVolume = 0.3;
  const q = normalizationMix(p, c.id), track = q.tracks.find((x) => x.id === t.id)!;
  expect(q.masterVolume).toBe(1); expect(track).toMatchObject({ volume: 1, pan: 0, muted: false, solo: false });
  expect(track.clips[0]).toMatchObject({ pitch: 7, volume: 1, saturation: { drive: 0.5 }, ringMod: { frequency: 65, mix: 0.5 }, highpass: { cutoff: 500 } });
  expect(track.clips[0].keyframes?.volume.map((k) => k.v)).toEqual([0.33333, 1]);
  expect(p.masterVolume).toBe(0.3); expect(c.volume).toBe(0.6);
});


it("preserves sound shaping when pasting audio attributes or extracting video sound", () => {
  const { p, t, c } = setup({ pitch: 7, voice: "chipmunk", highpass: { cutoff: 180, resonance: 0 }, fadeInCurve: "sCurve", saturation: { drive: 0.3 } });
  const b = { ...c, id: "b", start: 600, pitch: 0, highpass: undefined, fadeInCurve: undefined };
  t.clips.push(b);
  const q = pasteAttributes(p, [b.id], copyAttributes(p, c.id), ["audio"]);
  expect(q.tracks.at(-1)!.clips[1]).toMatchObject({ pitch: 7, fadeInCurve: "sCurve", voice: "chipmunk", highpass: c.highpass, saturation: c.saturation });
  const asset = { ...p.assets[0], kind: "video" as const, hasVideo: true };
  const video = { ...clipForAsset(asset, 0, p.fps), pitch: c.pitch, voice: c.voice, fadeInCurve: c.fadeInCurve, highpass: c.highpass, saturation: c.saturation };
  const source = { ...createProject(), assets: [asset] };
  source.tracks[0].clips = [video];
  const extracted = detachAudio(source, video.id).tracks.flatMap((t) => t.clips).find((c) => c.type === "audio");
  expect(extracted).toMatchObject({ pitch: 7, fadeInCurve: "sCurve", voice: "chipmunk", highpass: c.highpass, saturation: c.saturation });
});
