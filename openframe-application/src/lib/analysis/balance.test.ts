import { expect, it } from "vitest";
import { createProject, createTrack } from "../project/defaults";
import { activeSpan, combinedLoudness, duckDepth, isolateTracks, isDialog, isMusic, lineBalances, lineDepths, loudnessDifference, marginSummary, speechWindows, windowLoudness } from "./balance";

/** 100 ms steps (mean squares) at a steady LUFS. */
const steps = (lufs: number, n: number) => Array(n).fill(10 ** ((lufs + 0.691) / 10));

it("measures any window of a render from its 100 ms steps", () => {
  // 2 s at -20 LUFS, 1 s of silence, 2 s at -30, from t0 = 10 s.
  const s = [...steps(-20, 20), ...steps(-90, 10), ...steps(-30, 20)];
  expect(windowLoudness(s, 10, [[10, 12]])).toBeCloseTo(-20, 3);
  expect(windowLoudness(s, 10, [[13, 15]])).toBeCloseTo(-30, 3);
  // Together, the louder half dominates; the silence in between is gated
  // out (but for the 400 ms blocks that straddle its edges).
  expect(windowLoudness(s, 10, [[10, 15]])).toBeCloseTo(-22.6, 0);
  expect(windowLoudness(s, 10, [[10, 12], [13, 15]])).toBeCloseTo(-22.6, 1);
  expect(windowLoudness(s, 10, [[12.1, 12.9]])).toBe(-Infinity);
  // Where the voice sounds inside a clip's window: its lead-in and tail out.
  expect(activeSpan([...steps(-90, 5), ...steps(-24, 30), ...steps(-90, 5)], 0, 0, 4)).toEqual([0.5, 3.5]);
  expect(activeSpan(steps(-90, 10), 0, 0, 1)).toBeNull();
});

it("gives each line its margin, sums them up, and deepens only the lines short of a minimum", () => {
  const voice = [...steps(-20, 30), ...steps(-26, 30)];
  const bed = steps(-30, 60);
  const lines = lineBalances(voice, bed, 0, [[0, 3], [3, 6]]);
  expect(lines.map((l) => l.voice_above_music_lu)).toEqual([10, 4]);
  expect(marginSummary(lines)).toEqual({ lines: 2, min_lu: 4, median_lu: 10, max_lu: 10, lowest: { start: 3, end: 6 } });
  // At least 8 LU: the second line dips 4.3 dB deeper, the first keeps its dip.
  expect(lineDepths([0, 0], [10, 4], 8)).toEqual([0, 4.3]);
  expect(lineDepths([6, 6], [16, 7.5], 8, 6)).toEqual([6, 6.8]);
  expect(lineDepths([30, 30], [2, null], 8)).toEqual([36.3, 30]);
  expect(lineDepths([38], [2], 8)).toEqual([40]);
});
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
