import { expect, it } from "vitest";
import { classifyAudioRole } from "./audioRole";

const rate = 8000;
const signal = (seconds: number, envelope: (t: number) => number) => Float32Array.from({ length: seconds * rate }, (_, i) => envelope(i / rate) * Math.sin(2 * Math.PI * 180 * i / rate));

it("recognizes irregular speech-like syllables and pauses independently of level", () => {
  const syllables = [0.11, 0.43, 0.7, 1.12, 1.31, 1.63, 2.4, 2.66, 2.88, 3.4, 3.64, 4.3, 4.48, 4.73, 5.1, 5.36, 5.61, 6.4, 6.65, 6.92, 7.24, 7.51];
  const pcm = signal(8, t => syllables.reduce((sum, s) => sum + 0.35 * Math.exp(-(((t - s) / 0.07) ** 2)), 0));
  expect(classifyAudioRole(pcm, rate).role).toBe("dialog");
  expect(classifyAudioRole(pcm.map(x => x * 0.1), rate).role).toBe("dialog");
});

it("recognizes sustained music and a regular beat, including a beat with silence", () => {
  for (const envelope of [() => 0.3, (t: number) => 0.3 * (0.6 + 0.4 * Math.sin(2 * Math.PI * 2 * t)), (t: number) => 0.3 * Math.exp(-8 * (t % 0.5))]) expect(classifyAudioRole(signal(10, envelope), rate).role).toBe("music");
});

it("leaves silence, brief clips and uncertain content unset, and bounds work to a minute", () => {
  expect(classifyAudioRole(new Float32Array(rate * 8), rate).role).toBeUndefined();
  expect(classifyAudioRole(signal(1, () => 0.3), rate).role).toBeUndefined();
  const uncertain = signal(8, t => 0.3 * (0.6 + 0.4 * Math.sin(2 * Math.PI * (2 * t + t * t * 0.15))));
  expect(classifyAudioRole(uncertain, rate).role).toBeUndefined();
  expect(classifyAudioRole(signal(65, () => 0.3), rate).seconds).toBe(60);
});
