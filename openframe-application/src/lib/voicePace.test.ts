import { describe, expect, it } from "vitest";
import { AUTO_SPEED, firstSpeed, judgePace, nextSpeed, onPace, paceOf, readBand, targetBand } from "./voicePace";

describe("the band a line is read to", () => {
  it("comes from its kind, or as asked, moved for a slow or fast line", () => {
    expect(targetBand()).toEqual([2.3, 2.8]);
    expect(targetBand("ad")).toEqual([2.6, 3.1]);
    expect(targetBand("social")).toEqual([2.8, 3.4]);
    expect(targetBand("narration", [2, 2.4])).toEqual([2, 2.4]);
    expect(targetBand("narration", undefined, "slow")).toEqual([1.8, 2.3]);
    expect(targetBand("narration", undefined, "fast")).toEqual([2.8, 3.3]);
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
