import { expect, it } from "vitest";
import { chunkCaptions, markBreaks, overLimit, voiceWordTimes } from "./captionWords";

// The film test's mission control line: Whisper heard "Station," at 0.46 s;
// the voice starts at 0.05 s and pauses at the comma from 0.55 to 0.68 s.
const heard = [
  { text: " station", start: 0.46, end: 0.74 },
  { text: " house", start: 0.74, end: 1.04 },
  { text: " the", start: 1.04, end: 1.26 },
  { text: " view.", start: 1.26, end: 1.44 },
];
const shape = { first: 0.05, last: 1.41, dips: [{ start: 0.55, end: 0.68 }] };

it("starts a line's first word on the voice's first sound, and a word after a pause where the voice comes back (ADR-115)", () => {
  const w = voiceWordTimes("Station, how's the view?", heard, shape);
  expect(w.map((x) => x.text)).toEqual(["Station,", "how's", "the", "view?"]);
  expect(w[0]).toEqual({ text: "Station,", start: 0.05, end: 0.55 });
  expect(w[1].start).toBe(0.68);
  expect(w[3].end).toBe(1.41);
  // In order, inside the phrase, each word ending where the next starts.
  expect(w[2].start).toBeGreaterThan(w[1].start);
  expect(w[3].start).toBeGreaterThan(w[2].start);
  expect(w[3].start).toBeLessThan(1.41);
  expect(w[1].end).toBe(w[2].start);
});

it("places a word inside a phrase halfway between where it was heard and where its letters put it", () => {
  // One phrase from 0.05 to 1.41 s: "how's the view?" after "Station,".
  const w = voiceWordTimes("Station how's the view?", heard, { first: 0.05, last: 1.41, dips: [] });
  // Letters: Station 7, how's 4, the 3, view 4 of 18 → how's at 0.05 + 1.36 * 7/18.
  const byLetters = 0.05 + (1.36 * 7) / 18;
  expect(w[1].start).toBeCloseTo((byLetters + 0.74) / 2, 3);
  // Heard by nothing (Whisper could not run): the letters alone.
  const alone = voiceWordTimes("Station how's the view?", [], { first: 0.05, last: 1.41, dips: [] });
  expect(alone[1].start).toBeCloseTo(byLetters, 3);
});

it("takes a pause mark as a pause the voice makes, where no punctuation says so", () => {
  expect(markBreaks("The one I meant [pause 0.4] was her.")).toEqual([4]);
  expect(markBreaks("Honestly? [pause 0.2] Mostly water.")).toEqual([1]);
  const text = "The one I meant was her.";
  const w = voiceWordTimes(text, [], { first: 0.1, last: 2.2, dips: [{ start: 1.0, end: 1.4 }] }, { marks: markBreaks("The one I meant [pause 0.4] was her.") });
  expect(w[3].end).toBe(1);
  expect(w[4].start).toBe(1.4);
});

it("leaves a pause the voice ran through to the phrase around it", () => {
  // No dip anywhere near the comma's place: the first word still starts on the sound.
  const w = voiceWordTimes("Station, how's the view?", heard, { first: 0.05, last: 1.41, dips: [] });
  expect(w[0].start).toBe(0.05);
  expect(w[1].start).toBeGreaterThan(0.05);
});

const timed = (spec: [string, number, number][]) => spec.map(([text, start, end]) => ({ text, start, end }));

it("shows a line a few words at a time: even chunks inside each phrase, each with its words' times", () => {
  const words = timed([
    ["Day", 0.33, 0.6], ["one.", 0.6, 1.1], ["They", 1.21, 1.4], ["strap", 1.4, 1.75], ["you", 1.75, 1.9], ["to", 1.9, 2.0], ["a", 2.0, 2.15], ["fire...", 2.15, 2.7], ["and", 3.16, 3.35], ["let", 3.35, 3.6], ["go.", 3.6, 4.09],
  ]);
  const caps = chunkCaptions(words, 3, 4.3);
  expect(caps.map((c) => c.text)).toEqual(["Day one.", "They strap you", "to a fire...", "and let go."]);
  expect(caps[1]).toEqual({ start: 1.21, end: 1.9, text: "They strap you", words: [1.21, 1.4, 1.75] });
  // Up until the next chunk shows, across the pauses (0.11 s, 0.46 s); the last to the take's end.
  expect(caps.map((c) => c.end)).toEqual([1.21, 1.9, 3.16, 4.3]);
  // Two at a time: four words make two and two; a little word moves on.
  expect(chunkCaptions(timed([["the", 0, 0.2], ["whole", 0.2, 0.5], ["blue", 0.5, 0.8], ["thing.", 0.8, 1.2]]), 3, 1.3).map((c) => c.text)).toEqual(["the whole", "blue thing."]);
  expect(chunkCaptions(timed([["Home", 0, 0.3], ["was", 0.3, 0.5], ["never", 0.5, 0.8], ["a", 0.8, 0.9], ["place.", 0.9, 1.4]]), 2, 1.5).map((c) => c.text)).toEqual(["Home was", "never", "a place."]);
  // One at a time.
  expect(chunkCaptions(timed([["Three.", 0.4, 0.7], ["Two.", 0.9, 1.2]]), 1, 1.5).map((c) => [c.text, c.start, c.end])).toEqual([["Three.", 0.4, 0.9], ["Two.", 0.9, 1.5]]);
});

it("lets a chunk go after its last word across a long pause, and never flashes one by", () => {
  const caps = chunkCaptions(timed([["Day", 0, 0.3], ["one.", 0.3, 0.8], ["Later", 2, 2.4], ["on.", 2.4, 2.9]]), 3, 3);
  expect(caps.map((c) => [c.start, c.end])).toEqual([[0, 1.1], [2, 3]]);
  // "go." up 0.2 s before "Now" shows would flash: it joins the chunk before.
  const quick = chunkCaptions(timed([["Ready,", 0, 0.4], ["go.", 0.5, 0.62], ["Now", 0.7, 1.2]]), 1, 1.5);
  expect(quick.map((c) => c.text)).toEqual(["Ready, go.", "Now"]);
  expect(quick.every((c) => c.end - c.start >= 0.3)).toBe(true);
});

// The third film test's line 2, timed as get_transcript heard it: three
// words at a time made "and it runs on" (four), because "your" moved on
// from "on your", leaving "on" up 0.12 s, which then joined the chunk
// before past the limit (ADR-121).
it("holds the word limit when a chunk would flash by, and says when it cannot", () => {
  const line = timed([["OpenFrame", 0.6, 0.98], ["gives", 0.98, 1.2], ["you", 1.2, 1.46], ["both.", 1.46, 1.88], ["It's", 2.08, 2.4], ["free,", 2.4, 2.86], ["open", 3.24, 3.56], ["source,", 3.56, 3.98], ["and", 4.16, 4.24], ["it", 4.24, 4.5], ["runs", 4.5, 4.76], ["on", 4.76, 4.88], ["your", 4.88, 5.06], ["own", 5.06, 5.5], ["computer.", 5.5, 5.84]]);
  const caps = chunkCaptions(line, 3, 6);
  expect(caps.every((c) => c.text.split(" ").length <= 3)).toBe(true);
  expect(caps.every((c) => c.end - c.start >= 0.3 - 1e-9)).toBe(true);
  expect(caps.map((c) => c.text).join(" ")).toBe(line.map((w) => w.text).join(" "));
  expect(caps.map((c) => c.text)).not.toContain("and it runs on");
  expect(overLimit(caps, 3)).toEqual([]);
  // One word at a time, two words spoken in 0.12 s cannot both stay up:
  // they join, and overLimit names the chunk for the answer's note.
  const quick = chunkCaptions(timed([["Ready,", 0, 0.4], ["go.", 0.5, 0.62], ["Now", 0.7, 1.2]]), 1, 1.5);
  expect(overLimit(quick, 1).map((c) => c.text)).toEqual(["Ready, go."]);
});
