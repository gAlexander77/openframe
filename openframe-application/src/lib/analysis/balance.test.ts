import { expect, it } from "vitest";
import { createProject, createTrack } from "../project/defaults";
import { activeSpan, aimDepths, lineMarginsMet, combinedLoudness, duckDepth, duckTargetsError, isolateTracks, isDialog, isMusic, lineBalances, lineCeiling, lineDepths, LINE_CEILING_LU, loudnessDifference, marginSummary, speechWindows, windowLoudness } from "./balance";

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
it("holds every line under a ceiling: a line over a quiet passage dips less, never under none (film test 3.14)", () => {
  // The film's first music clip, one 13.3 dB dip for the speech target:
  // the hook line sat 16.7 LU over the quiet intro, the next 15.1.
  expect(lineDepths([13.3, 13.3, 13.9], [16.7, 15.1, 10.3], 10, 13.3, 15)).toEqual([11.3, 12.9, 13.9]);
  // Its second clip: the last hit's line 19 LU over a 14.9 dB dip.
  expect(lineDepths([14.9, 14.9, 14.9], [15.2, 10.1, 19], 10, 14.9, 15)).toEqual([14.4, 14.9, 10.6]);
  // A line far over it loses its whole dip, and the music is never raised.
  expect(lineDepths([4], [30], 10, 0, 15)).toEqual([0]);
  // The minimum still wins under the ceiling; no ceiling, as before.
  expect(lineDepths([6, 6], [16, 7.5], 8, 6, 15)).toEqual([4.7, 6.8]);
  expect(lineDepths([6, 6], [16, 7.5], 8, 6)).toEqual([6, 6.8]);
  // The default ceiling: 15 LU, or 3 over a higher target or minimum.
  expect(LINE_CEILING_LU).toBe(15);
  expect(lineCeiling(12, 10)).toBe(15);
  expect(lineCeiling(14)).toBe(17);
  expect(lineCeiling(undefined, 13)).toBe(16);
  // A ceiling under the speech target cannot be met by any dip: refused
  // before rendering, not answered met false after four measures.
  expect(duckTargetsError(12, undefined, 8)).toMatch(/max_line_lu \(8\) is under voice_above_music_lu \(12\)/);
  expect(duckTargetsError(12, 10, 15)).toBeUndefined();
  expect(duckTargetsError(12, undefined, 12)).toBeUndefined();
  expect(duckTargetsError(undefined, 10, 10.5)).toMatch(/at least 1 LU over min_line_lu/);
  expect(duckTargetsError(31)).toMatch(/between 0 and 30/);
});
it("keeps the lines together on their target while the ceiling holds one back", () => {
  // voice_above_music_lu 12, min_line_lu 10, the default 15 LU ceiling:
  // one dip for the target left the line over the quiet intro 20.1 LU over.
  const first = aimDepths([11, 11, 11, 11, 11], [20.1, 11.9, 11.6, 12.2, 12], { target: 12, speech: 12, min: 10, max: 15, floor: 11 });
  expect(first).toEqual([5.6, 11, 11, 11, 11]);
  // Measured so, the intro's line at 14.7 lifted the lines together to
  // 12.9 and the call answered met false: every line moves by what the
  // speech window is off, still between the minimum and the ceiling.
  expect(aimDepths(first, [14.7, 11.9, 11.6, 12.2, 12], { target: 12, speech: 12.9, min: 10, max: 15, floor: 11 })).toEqual([4.7, 10.1, 10.1, 10.1, 10.1]);
  // A line the move would take under the minimum dips back to it.
  expect(aimDepths([5.6, 11], [14.7, 10.4], { target: 12, speech: 12.9, min: 10, max: 15, floor: 11 })).toEqual([4.7, 10.9]);
  // On target (within 0.5), or with no target: the bounds alone, as before.
  expect(aimDepths([11, 11], [20.1, 11.9], { target: 12, speech: 12.3, min: 10, max: 15, floor: 11 })).toEqual(lineDepths([11, 11], [20.1, 11.9], 10, 11, 15));
  expect(aimDepths([11, 11], [20.1, 11.9], { min: 10, max: 15, floor: 11 })).toEqual(lineDepths([11, 11], [20.1, 11.9], 10, 11, 15));
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

it("film 5: a measured 20.1 LU line fails the requested 15 LU ceiling, even at zero dip", () => {
  expect(lineMarginsMet([20.1, 10.7, 12], 10, 15)).toBe(false);
  expect(lineMarginsMet([10.7, 12, 15], 10, 15)).toBe(true);
  expect(lineMarginsMet([9.8, 12], 10, 15)).toBe(false);
  expect(lineMarginsMet([null], 10, 15)).toBe(false);
  expect(lineMarginsMet([], 10, 15)).toBe(false);
});
