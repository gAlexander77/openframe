import { expect, it } from "vitest";
import { layoutLines, speechText } from "./tts";

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
