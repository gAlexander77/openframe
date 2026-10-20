import { expect, it } from "vitest";
import { spokenWord, wordsToCaptions } from "./captions";
import { addCaptions } from "./commands";
import { splitCaption, splitClip } from "./project/ops";
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

it("never lights a caption's only word: it keeps the caption's color (ADR-115)", () => {
  // The film test's "THREE." and "STATION," drew in the highlight color
  // from start to end, so a cyan caption with a white highlight read white.
  expect(spokenWord("THREE.", [0], 0)).toBeUndefined();
  expect(spokenWord("THREE.", [0], 12)).toBeUndefined();
  expect(spokenWord("how's the", [0, 8], 9)).toBe(1);
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

it("splits a caption where the next word is spoken, each half with its words", () => {
  const p = addCaptions(createProject(), [{ start: 1, end: 3, text: "one two three", words: [1, 1.5, 2.5] }]);
  const c = p.tracks.flatMap((t) => t.clips)[0] as TextClip;
  // The caret after "one two ": "three" is spoken 1.5 s (45 frames) in.
  const { project, second } = splitCaption(p, c.id, 8);
  const [a, b] = project.tracks.flatMap((t) => t.clips) as TextClip[];
  expect([a.text, b.text]).toEqual(["one two", "three"]);
  expect(b.id).toBe(second);
  expect(b.start).toBe(c.start + 45);
  expect(a.wordTimes).toEqual([0, 15]);
  // "three" is spoken as its half starts (a lone word is never lit, ADR-115).
  expect(b.wordTimes).toEqual([0]);
  // At either end there is nothing to split off.
  expect(splitCaption(p, c.id, 0).project).toBe(p);
  expect(splitCaption(p, c.id, c.text.length).project).toBe(p);
});

it("splits an untimed caption as far in as the characters go", () => {
  const p = addCaptions(createProject(), [{ start: 0, end: 4, text: "abcd efgh" }]);
  const c = p.tracks.flatMap((t) => t.clips)[0] as TextClip;
  const { project } = splitCaption(p, c.id, 4);
  const b = project.tracks.flatMap((t) => t.clips)[1] as TextClip;
  expect(b.text).toBe("efgh");
  expect(b.start).toBe(Math.round((c.duration * 4) / 9));
});
