import { describe, expect, it } from "vitest";
import { AUTO_SPEED, bandSource, CHOSEN_MAX_SPS, firstSpeed, judgePace, landSpeed, nextSpeed, onPace, paceOf, readBand, readWps, speedBounds, syllableBand, targetBand, type ReadSpan } from "./voicePace";

describe("the band a line is read to", () => {
  it("comes from its kind, or as asked, moved for a slow or fast line", () => {
    expect(targetBand()).toEqual([2.3, 2.8]);
    expect(targetBand("ad")).toEqual([2.6, 3.1]);
    expect(targetBand("social")).toEqual([2.8, 3.4]);
    expect(targetBand("narration", [2, 2.4])).toEqual([2, 2.4]);
    expect(targetBand("narration", undefined, "slow")).toEqual([1.8, 2.3]);
    expect(targetBand("narration", undefined, "fast")).toEqual([2.8, 3.3]);
  });

  it("holds a band asked for exactly, whatever the pace (film test 3.7)", () => {
    // A slow end-card line retaken with words_per_second [1.8, 2.2] was
    // held to [1.3, 1.7] and read at 1.37 words a second, a 3.2 s drawl.
    expect(targetBand("ad", [1.8, 2.2], "slow")).toEqual([1.8, 2.2]);
    expect(targetBand("narration", [2.6, 3.1], "fast")).toEqual([2.6, 3.1]);
    expect(targetBand("ad", undefined, "slow")).toEqual([2.1, 2.6]);
  });

  it("tells a kind kept with a line from a band asked, for takes saved before the kind was kept", () => {
    expect(bandSource({ readAs: "ad", wps: [1.8, 2.2] })).toEqual({ readAs: "ad", wps: [1.8, 2.2] });
    // read_as ad used to be kept as its band: read as the kind again, so its pace still moves it.
    expect(bandSource({ wps: [2.6, 3.1] })).toEqual({ readAs: "ad" });
    expect(bandSource({ wps: [1.8, 2.2] })).toEqual({ wps: [1.8, 2.2] });
    expect(bandSource(undefined)).toEqual({});
  });

  it("reads a band from the tool's arguments, or says what it takes", () => {
    expect(readBand([2.3, 2.8])).toEqual([2.3, 2.8]);
    expect(readBand(undefined)).toBeUndefined();
    for (const bad of [2.5, [2.8, 2.3], [0.5, 2], [2, 2, 3], ["2", 3]]) expect(() => readBand(bad)).toThrow(/words_per_second/);
  });
});

describe("pace in two windows", () => {
  it("counts the written words and syllables over the speech and over the clip", () => {
    const p = paceOf("We leave the ground [pause 0.3] to see how far we can go.", 4.2, 4.4);
    expect(p.words).toBe(11);
    expect(p.syllables).toBe(11);
    expect(p.speech).toEqual({ words_per_second: 2.62, syllables_per_second: 2.62, seconds: 4.2 });
    expect(p.clip?.words_per_second).toBe(2.5);
    expect(paceOf("Hi.", 0.1, 0.5).speech).toBeNull();
  });
});

describe("judging a line's pace", () => {
  it("passes the band, advises a tenth outside it, and fails beyond", () => {
    expect(judgePace(2.5, 3.4, [2.3, 2.8])).toEqual([]);
    expect(judgePace(2.6, 3.4, [2.3, 2.8])).toEqual([]);
    expect(judgePace(2.9, 3.6, [2.3, 2.8])).toEqual([{ level: "advice", problem: expect.stringMatching(/^fast: 2.9/) }]);
    expect(judgePace(3.72, 4.5, [2.3, 2.8])).toEqual([{ level: "fix", problem: expect.stringMatching(/^fast: 3.72/) }]);
    expect(judgePace(2.1, 3, [2.3, 2.8])[0].level).toBe("advice");
    expect(judgePace(1.9, 3, [2.3, 2.8])[0].level).toBe("fix");
    expect(judgePace(null, null, [2.3, 2.8])).toEqual([]);
  });

  it("still catches long words rushed, and notes short words drawn out", () => {
    expect(judgePace(2.6, 6.1, [2.3, 2.8])).toEqual([{ level: "fix", problem: expect.stringMatching(/^rushed/) }]);
    expect(judgePace(2.4, 2.3, [2.3, 2.8])).toEqual([{ level: "advice", problem: expect.stringMatching(/^short words/) }]);
  });
});

describe("choosing the speed", () => {
  it("scales the voiced part of the span, not the pauses the finish set", () => {
    // 9 words in 2.87 s at 0.9 (3.1 words a second), 0.3 s of it a set pause: 2.55 is the aim.
    const s = nextSpeed(0.9, 2.87, 0.3, 9, 2.55);
    const voicedAfter = ((2.87 - 0.3) * 0.9) / s;
    expect(9 / (voicedAfter + 0.3)).toBeCloseTo(2.55, 1);
    expect(s).toBeCloseTo(0.72, 2);
  });

  it("holds the speed inside the voice's natural range", () => {
    expect(nextSpeed(0.9, 1.0, 0, 12, 2.55)).toBe(AUTO_SPEED[0]);
    expect(nextSpeed(0.9, 10, 0, 12, 2.55)).toBe(AUTO_SPEED[1]);
    // Pauses alone longer than the aim: as fast as allowed.
    expect(nextSpeed(0.9, 4, 3, 5, 2.55)).toBe(AUTO_SPEED[1]);
  });

  it("guesses a first speed from the syllables at Heart's rate", () => {
    // The documentary's first line: 11 one-syllable words at 2.55 a second
    // wants 4.3 s, slower than the voice goes (Codex landed it at 0.61).
    expect(firstSpeed(11, 11, 0, 2.55)).toBe(AUTO_SPEED[0]);
    // 20 syllables in 12 words, a sentence pause set: 4.16 s voiced, 20 / 4.6 / 4.16.
    expect(firstSpeed(20, 12, 0.55, 2.55)).toBeCloseTo(1.05, 2);
    expect(onPace(2.5, [2.3, 2.8])).toBe(true);
    expect(onPace(2.9, [2.3, 2.8])).toBe(false);
  });
});

describe("landing a line on its band (film test 3.7, 3.8)", () => {
  // Heart reading "Northbound. [pause 0.4] Find your north.": 1.52 s of
  // voice at speed 1 (measured: 1.17 s at 1.3), the mark's 0.4 s set to a
  // length whatever the speed. Its four words read at a speed take
  // 1.52 / speed seconds, the pause on top.
  const tagline = (speed: number): Promise<ReadSpan> => Promise.resolve({ span: 1.521 / speed + 0.4, fixed: 0.4, directed: 0.4 });
  const words = 4, syllables = 5;

  it("leaves a pause mark out of the pace, so a slow line is not sped up to fill it", async () => {
    // With the mark counted, speed 1.3 measured 2.55 words a second, inside
    // the slow ad band [2.1, 2.6]: the words were rushed to fit around it.
    expect(+(words / (1.521 / 1.3 + 0.4)).toFixed(2)).toBe(2.55);
    expect(readWps(words, { span: 1.521 / 1.3 + 0.4, fixed: 0.4, directed: 0.4 })).toBeCloseTo(3.42, 2);
    const band = targetBand("ad", undefined, "slow");
    const r = await landSpeed(tagline, { words, syllables, natural: 0, band, bounds: speedBounds("slow", false) });
    expect(r.speed).toBeLessThanOrEqual(1);
    expect(r.speed).toBeCloseTo(0.89, 2);
    expect(onPace(r.wps, band)).toBe(true);
  });

  it("never reads a slow line faster than the voice's own pace unless a band is asked", async () => {
    expect(speedBounds("slow", false)).toEqual([AUTO_SPEED[0], 1]);
    expect(speedBounds("slow", true)).toEqual(AUTO_SPEED);
    expect(speedBounds("normal", false)).toEqual(AUTO_SPEED);
    // A band only a fast read could reach: the slow line stops at speed 1.
    const r = await landSpeed(tagline, { words, syllables, natural: 0, band: [3.4, 3.8], bounds: speedBounds("slow", false) });
    expect(r.speed).toBe(1);
  });

  it("lands an asked band over a slow line's pace", async () => {
    const r = await landSpeed(tagline, { words, syllables, natural: 0, band: targetBand("ad", [1.8, 2.2], "slow"), bounds: speedBounds("slow", true) });
    expect(onPace(r.wps, [1.8, 2.2])).toBe(true);
    expect(r.reads).toBeLessThanOrEqual(3);
  });

  it("keeps the reader's own pauses in the pace: a line with no mark lands as before", async () => {
    // 12 words, 1 s of them set sentence pauses: the band holds them in.
    const read = (speed: number) => Promise.resolve({ span: 4.2 / speed + 1, fixed: 1, directed: 0 });
    const r = await landSpeed(read, { words: 12, syllables: 16, natural: 1, band: [2.3, 2.8], bounds: AUTO_SPEED });
    expect(r.wps).toBeCloseTo(12 / (4.2 / r.speed + 1), 2);
    expect(onPace(r.wps, [2.3, 2.8])).toBe(true);
  });
});

describe("long words are not rushed to make a band (film test 2, ADR-114)", () => {
  // Heart reading "Honestly? [pause 0.2] Mostly water.": three words, seven
  // syllables, 1.17 s of speech at speed 1.29 (2.56 words, 6.0 syllables a
  // second: the review called it rushed), the mark's 0.2 s on top.
  const honestly = (speed: number): Promise<ReadSpan> => Promise.resolve({ span: (1.172 * 1.29) / speed + 0.2, fixed: 0.2, directed: 0.2 });
  const sps = (wps: number) => (wps * 7) / 3;

  it("moves a band down, keeping its width, until its top says 5 syllables a second", () => {
    expect(syllableBand([2.3, 2.8], 3, 7)).toEqual([1.64, 2.14]);
    // The review's own fix band, as the tester asked it: its top was 5.6.
    expect(syllableBand([1.9, 2.4], 3, 7)).toEqual([1.64, 2.14]);
    // Short words: as it was.
    expect(syllableBand([2.3, 2.8], 11, 13)).toEqual([2.3, 2.8]);
    expect(syllableBand([2.3, 2.8], 0, 0)).toEqual([2.3, 2.8]);
  });

  it("lands the tester's line slower than the band in words alone did", async () => {
    const old = await landSpeed(honestly, { words: 3, syllables: 7, natural: 0, band: [2.3, 2.8], bounds: AUTO_SPEED });
    expect(old.speed).toBe(1.29);
    expect(sps(old.wps)).toBeGreaterThan(5.9);
    const r = await landSpeed(honestly, { words: 3, syllables: 7, natural: 0, band: syllableBand([2.3, 2.8], 3, 7), bounds: AUTO_SPEED });
    expect(sps(r.wps)).toBeLessThanOrEqual(CHOSEN_MAX_SPS);
    expect(r.speed).toBeLessThan(1);
    // The retake asked for 1.9-2.4 read 2.36 (5.5 syllables a second).
    const asked = await landSpeed(honestly, { words: 3, syllables: 7, natural: 0, band: syllableBand([1.9, 2.4], 3, 7), bounds: AUTO_SPEED });
    expect(sps(asked.wps)).toBeLessThanOrEqual(CHOSEN_MAX_SPS);
  });

  it("judges the line against its moved band, saying why it aims lower", () => {
    expect(judgePace(2.56, 5.97, [1.64, 2.14])).toEqual([{ level: "fix", problem: "fast: 2.56 words a second over the speech, 5.97 syllables (aim 1.64-2.14 words a second: long words, at most 5 syllables a second)" }]);
  });
});
