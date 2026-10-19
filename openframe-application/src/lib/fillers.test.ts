import { expect, it } from "vitest";
import { fillerRanges } from "./fillers";

const w = (text: string, start: number, end: number) => ({ text, start, end });

it("cuts each filler from the previous word's end to the next word's start", () => {
  // Whisper base on "So, um, I think...": the um is stamped as a 20 ms sliver.
  const words = [w(" So,", 0.46, 0.62), w(" um,", 0.62, 0.64), w(" I", 0.9, 1.06), w(" think", 1.06, 1.18)];
  expect(fillerRanges(words)).toEqual([{ start: 0.66, end: 0.86 }]);
});

it("leaves a long pause around a filler, merges neighbors, and skips real words", () => {
  const words = [w("Well", 0, 0.3), w("Um", 3, 3.2), w("hmm", 3.2, 3.5), w("okay", 6, 6.4), w("umbrella", 7, 7.5)];
  expect(fillerRanges(words)).toEqual([{ start: 2.65, end: 3.85 }]);
  // Back-to-back fillers merge into one cut, no guard between them.
  expect(fillerRanges([w("a", 0, 1), w("um", 1, 1.1), w("uh", 1.1, 1.2), w("b", 1.4, 2)])).toEqual([{ start: 1.04, end: 1.36 }]);
});
