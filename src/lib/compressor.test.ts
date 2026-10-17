import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { cleanCompressor, COMPRESSOR_PRESETS, compressorPreset } from "./compressor";
import { clipForAsset, createProject, createTextClip, normalizeProject } from "./project/defaults";
import type { AudioClip, Project } from "./project/types";

describe("compressor", () => {
  it("keeps values in range and fills the rest from the Voice preset", () => {
    expect(cleanCompressor({ threshold: -100, ratio: 50, makeup: 3, attack: "fast" })).toEqual({ ...COMPRESSOR_PRESETS.voice, threshold: -60, ratio: 20, makeup: 3 });
    expect(cleanCompressor(null)).toBeUndefined();
    expect(cleanCompressor("loud")).toBeUndefined();
  });

  it("names a preset until a value moves", () => {
    expect(compressorPreset(COMPRESSOR_PRESETS.gentle)).toBe("gentle");
    expect(compressorPreset({ ...COMPRESSOR_PRESETS.voice, ratio: 3 })).toBe("custom");
  });

  it("is set, adjusted and removed by set_compressor, and shows in describe_project", () => {
    const p: Project = { ...createProject(), assets: [{ id: "a", kind: "audio", name: "vo.wav", src: "vo.wav", duration: 4, hasVideo: false, hasAudio: true }] };
    const voice = clipForAsset(p.assets[0], 0, p.fps) as AudioClip;
    p.tracks = [p.tracks[0], { id: "t_a", kind: "audio", name: "Audio", clips: [voice], muted: false, hidden: false, locked: false, volume: 1, pan: 0 } as Project["tracks"][number]];
    const comp = (q: Project) => (q.tracks[1].clips[0] as AudioClip).compressor;
    const on = runCommand(p, "set_compressor", { clip_ids: [voice.id], preset: "voice" });
    expect(comp(on)).toEqual(COMPRESSOR_PRESETS.voice);
    const tuned = runCommand(on, "set_compressor", { clip_ids: [voice.id], makeup: 4 });
    expect(comp(tuned)).toEqual({ ...COMPRESSOR_PRESETS.voice, makeup: 4 });
    expect(describeProject(tuned).tracks[1].clips[0]).toMatchObject({ compressor: "custom" });
    expect(comp(runCommand(tuned, "set_compressor", { clip_ids: [voice.id], preset: "off" }))).toBeUndefined();
    // A saved compressor survives loading; nonsense is dropped, not refused.
    expect(comp(normalizeProject(JSON.parse(JSON.stringify(on))))).toEqual(COMPRESSOR_PRESETS.voice);
    const junk = JSON.parse(JSON.stringify(on));
    junk.tracks[1].clips[0].compressor = "loud";
    expect(comp(normalizeProject(junk))).toBeUndefined();
  });

  it("refuses clips without sound", () => {
    const p = createProject();
    const title = createTextClip("Hi", 0, 30);
    p.tracks[0].clips = [title];
    expect(() => runCommand(p, "set_compressor", { clip_ids: [title.id], preset: "voice" })).toThrow(/no sound/);
  });
});
