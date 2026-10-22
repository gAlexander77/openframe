import type { AudioClip } from "./project/types";
import { timelineWords } from "./transcript";
import { createProject, clipForAsset } from "./project/defaults";
import { expect, it } from "vitest";
import { merge, missing, wordRanges, wordsIn } from "./transcript";

const w = (text: string, start: number, end: number) => ({ text, start, end });
const words = [w("So", 0, 0.3), w("this", 0.4, 0.6), w("part", 0.65, 0.9), w("goes", 0.95, 1.2), w("away", 1.25, 1.5), w("now", 2.5, 2.8)];

it("cuts a run of deleted words between its kept neighbors, with a guard", () => {
  // "part goes" deleted: from after "this" to before "away".
  expect(wordRanges(words, (_, i) => i === 2 || i === 3)).toEqual([{ start: 0.64, end: 1.21 }]);
  // The last words deleted: reach past their end, but not to the next word.
  expect(wordRanges(words, (_, i) => i === 4)).toEqual([{ start: 1.24, end: 1.85 }]);
});

it("remembers what was heard, so pieces of a cut clip reuse it", () => {
  let h = merge(undefined, 0, 2, words.slice(0, 5));
  expect(missing(h, 0.5, 1.5)).toBeNull();
  expect(missing(h, 1.5, 3)).toEqual({ start: 1.5, end: 3 });
  h = merge(h, 1.5, 3, [w("now", 2.5, 2.8)]);
  expect(h.spans).toEqual([{ start: 0, end: 3 }]);
  expect(h.words.map((x) => x.text)).toEqual(["So", "this", "part", "goes", "away", "now"]);
  // A re-run of a span replaces its words instead of doubling them.
  h = merge(h, 0, 2, words.slice(0, 5));
  expect(h.words.length).toBe(6);
  expect(wordsIn(h.words, 0.9, 2).map((x) => x.text)).toEqual(["goes", "away"]);
});


it("maps source words after a middle cut and clips them to timeline bounds", () => {
  const p = createProject();
  const c = { ...(clipForAsset({ id: "a", kind: "audio", name: "speech", src: "speech", duration: 10, hasAudio: true, hasVideo: false }, 60, p.fps) as AudioClip), duration: 90, in: 4 };
  const words = [{ text: " gone", start: 2, end: 3 }, { text: " after", start: 4, end: 4.5 }, { text: " last", start: 6.5, end: 8 }];
  expect(timelineWords(p, c, words, 2.1, 4.8)).toEqual([{ text: "after", start: 2.1, end: 2.5 }, { text: "last", start: 4.5, end: 4.8 }]);
});

// Film 5: Whisper repeated a word across a 28 s window boundary.
it("merges the reported planet overlap into one monotonic source word", () => {
  const h = merge(undefined, 0, 60, [w("planet.", 27.5, 28), w("planet", 27.77, 28.55), w("Next", 28.4, 29)]);
  expect(h.words.map(x => x.text)).toEqual(["planet.", "Next"]);
  expect(h.words.every((x, i) => x.end > x.start && (!i || x.start >= h.words[i - 1].end))).toBe(true);
});
