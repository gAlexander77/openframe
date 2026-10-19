import { expect, it } from "vitest";
import { createProject, createTrack } from "../project/defaults";
import { duckDepth, isolateTracks, isDialog, isMusic, loudnessDifference } from "./balance";
it("computes attenuation in LU and handles silence without inventing a balance", () => {
  expect(duckDepth(-16, -12, 10)).toBe(14);
  expect(duckDepth(-16, -30, 10)).toBe(0);
  expect(duckDepth(-60, -10, 10)).toBe(40);
  expect(loudnessDifference(-16, -26)).toBe(10);
  expect(loudnessDifference(-Infinity, -26)).toBeNull();
  expect(() => duckDepth(-Infinity, -26, 10)).toThrow(/silent/);
});
it("isolates stems while retaining mute, solo, gain and the original document", () => {
  const p = createProject();
  const voice = { ...createTrack("audio", "Voiceover"), solo: true, volume: 0.5 };
  const music = createTrack("audio", "Music");
  p.tracks = [voice, music];
  const q = isolateTracks(p, [music.id]);
  expect(q.tracks.every(t => t.muted)).toBe(true);
  expect(p.tracks[1].muted).toBe(false);
  expect(isolateTracks(p, [voice.id]).tracks[0]).toMatchObject({ muted: false, solo: false, volume: 0.5 });
  expect(isDialog(voice)).toBe(true);
  expect(isMusic(music)).toBe(true);
  expect(isMusic(createTrack("audio", "Sound effects"))).toBe(false);
});
