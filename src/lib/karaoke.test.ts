import { expect, it } from "vitest";
import { spokenWord, wordsToCaptions } from "./captions";
import { addCaptions } from "./commands";
import { splitClip } from "./project/ops";
import { createProject } from "./project/defaults";
import type { TextClip } from "./project/types";

it("keeps each caption's word start times, punctuation joined to its word", () => {
  const caps = wordsToCaptions([
    { text: " Hello", start: 1, end: 1.4 },
    { text: ",", start: 1.4, end: 1.45 },
    { text: " world", start: 1.5, end: 2 },
    { text: ".", start: 2, end: 2.05 },
  ]);
  expect(caps[0]).toMatchObject({ text: "Hello, world.", words: [1, 1.5] });
});

it("names the word being spoken, and gives up when the text was edited", () => {
  expect(spokenWord("one two three", [0, 10, 20], 0)).toBe(0);
  expect(spokenWord("one two three", [0, 10, 20], 15)).toBe(1);
  expect(spokenWord("one two three", [5, 10, 20], 2)).toBe(-1);
  expect(spokenWord("one two", [0, 10, 20], 15)).toBeUndefined();
  expect(spokenWord("one", undefined, 0)).toBeUndefined();
});

it("stores times on caption clips that follow splits", () => {
  let p = addCaptions(createProject(), [{ start: 1, end: 3, text: "one two three", words: [1, 1.5, 2.5] }]);
  const c = p.tracks.flatMap((t) => t.clips)[0] as TextClip;
  expect(c.wordTimes).toEqual([0, 15, 45]);
  p = splitClip(p, c.id, c.start + 20);
  const right = p.tracks.flatMap((t) => t.clips).find((x) => x.id !== c.id) as TextClip;
  expect(right.wordTimes).toEqual([-20, -5, 25]);
  expect(spokenWord(right.text, right.wordTimes, 0)).toBe(1);
});
