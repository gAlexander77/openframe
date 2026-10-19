import { expect, it } from "vitest";
import { auditionSummary } from "./audition";

const RATE = 48000;
const tone = (hz: number, seconds: number, amp: number) => Float32Array.from({ length: seconds * RATE }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

it("reads loudness every second, the silences and where it is, in timeline seconds", () => {
  // 3 s of a 1 kHz tone, 1.5 s of silence, 1.5 s of the tone 10 dB down, heard from 20 s.
  const x = new Float32Array(6 * RATE);
  x.set(tone(1000, 3, 0.1), 0);
  x.set(tone(1000, 1.5, 0.0316), 4.5 * RATE);
  const s = auditionSummary(x, x, RATE, 20);
  expect(s.seconds).toBe(6);
  expect(s.per_second_lufs).toHaveLength(6);
  expect(s.per_second_lufs[0]! - s.per_second_lufs[5]!).toBeCloseTo(10, 0);
  expect(s.per_second_lufs[3] ?? -Infinity).toBeLessThan(-60);
  // (The meter's filter rings a few milliseconds past the tone's end.)
  expect(s.silent).toHaveLength(1);
  expect(s.silent[0][0]).toBeCloseTo(23, 0);
  expect(s.silent[0][1]).toBe(24.5);
  expect(s.true_peak_dbtp).toBeCloseTo(-20, 0);
  // The same on both sides: mono.
  expect(s.correlation).toBe(1);
  expect(s.spectrum.mid).toBeGreaterThan(0.95);
  expect(s.clipped).toBe(0);
});

it("says where the energy sits, how wide it is and when it clips", () => {
  const low = tone(80, 2, 0.5), other = tone(80, 2, -0.5);
  const s = auditionSummary(low, other, RATE);
  expect(s.spectrum.low).toBeGreaterThan(0.95);
  expect(s.correlation).toBe(-1);
  const hot = tone(1000, 1, 1.2);
  expect(auditionSummary(hot, hot, RATE).clipped).toBeGreaterThan(0);
  const quiet = new Float32Array(RATE);
  expect(auditionSummary(quiet, quiet, RATE)).toMatchObject({ integrated_lufs: null, true_peak_dbtp: null, silent: [[0, 1]] });
});
