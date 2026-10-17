import { expect, it } from "vitest";
import { speechText } from "./tts";

it("reads each line of a title as a sentence", () => {
  expect(speechText("Big news\n\nWe ship today!")).toBe("Big news. We ship today!");
  expect(speechText("  Hello, ")).toBe("Hello,");
  expect(speechText("\n")).toBe("");
});
