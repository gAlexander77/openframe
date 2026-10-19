import { expect, it } from "vitest";
import { layoutLines, speechText, trimSpeech } from "./tts";

it("reads each line of a title as a sentence", () => {
  expect(speechText("Big news\n\nWe ship today!")).toBe("Big news. We ship today!");
  expect(speechText("  Hello, ")).toBe("Hello,");
  expect(speechText("\n")).toBe("");
});

it("lays a voiceover's lines one after another at their real lengths", () => {
  const lines = [{ seconds: 5.07 }, { seconds: 3.2 }, { at: 12, seconds: 2 }, { at: 13, seconds: 1 }];
  expect(layoutLines(lines, 0.5, 0.4)).toEqual([
    { start: 0.5, end: 5.57 },
    { start: 5.97, end: 9.17 },
    // Pinned to 12; the next asks for 13 but waits for this one to end.
    { start: 12, end: 14 },
    { start: 14, end: 15 },
  ]);
});

it("trims a spoken line to its words, keeping a breath either side", () => {
  const rate = 1000;
  const audio = new Float32Array(2000);
  for (let i = 500; i < 1300; i++) audio[i] = Math.sin(i) * 0.5 + 0.3;
  audio[100] = 0.004; // noise under the floor
  const out = trimSpeech(audio, rate);
  expect(out.length).toBe(800 + 40 + 150);
  expect(out[40]).toBe(audio[500]);
  expect(trimSpeech(new Float32Array(10), rate).length).toBe(10);
});
