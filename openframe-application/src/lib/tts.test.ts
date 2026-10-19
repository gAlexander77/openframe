import { expect, it } from "vitest";
import { checkVoice, speechText, trimSpeech, VOICES } from "./tts";

it("reads each line of a title as a sentence", () => {
  expect(speechText("Big news\n\nWe ship today!")).toBe("Big news. We ship today!");
  expect(speechText("  Hello, ")).toBe("Hello,");
  // A line ending on a pause mark gets no period after the mark.
  expect(speechText("Wait [pause]")).toBe("Wait [pause]");
  expect(speechText("\n")).toBe("");
});

it("takes a voice or a blend of known voices, and names the ones there are", () => {
  expect(checkVoice("af_heart")).toBe("af_heart");
  expect(checkVoice("af_heart:60, af_bella:40")).toBe("af_heart:60,af_bella:40");
  expect(() => checkVoice("af_hart")).toThrow(/No voice af_hart.*af_heart/);
  expect(() => checkVoice("af_heart:0")).toThrow(/positive/);
});

it("describes every voice it offers, the most natural first", () => {
  expect(VOICES[0].id).toBe("af_heart");
  for (const v of VOICES) expect(v.character && v.suited, v.id).toBeTruthy();
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
