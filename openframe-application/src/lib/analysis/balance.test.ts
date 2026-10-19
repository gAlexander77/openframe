import { expect, it } from "vitest";
import { createProject, createTrack } from "../project/defaults";
import { combinedLoudness, duckDepth, isolateTracks, isDialog, isMusic, loudnessDifference, speechWindows } from "./balance";
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
it("measures only where someone speaks: windows joined across short gaps, energies averaged", () => {
  expect(speechWindows([[30, 40], [0, 10], [11, 20]], 2)).toEqual([[0, 20], [30, 40]]);
  expect(speechWindows([], 2)).toEqual([]);
  expect(combinedLoudness([{ lufs: -20, seconds: 4 }, { lufs: -20, seconds: 6 }])).toBeCloseTo(-20, 6);
  // Half the time 10 dB louder: the louder half dominates the energy.
  expect(combinedLoudness([{ lufs: -10, seconds: 5 }, { lufs: -20, seconds: 5 }])).toBeCloseTo(-12.6, 1);
  expect(combinedLoudness([{ lufs: -Infinity, seconds: 5 }])).toBe(-Infinity);
});
