import { describe, expect, it } from "vitest";
import { DEFAULT_LINES, parseSubtitles, quietCuts, rms10ms, toSrt, toVtt, wordsToCaptions, type Word } from "./captions";

const words = (s: string, step = 0.3, gapAfter: Record<number, number> = {}): Word[] => {
  let t = 0;
  return s.split(" ").map((text, i) => {
    const w = { text, start: t, end: t + step * 0.9 };
    t += step + (gapAfter[i] ?? 0);
    return w;
  });
};

describe("wordsToCaptions", () => {
  it("breaks at sentence ends", () => {
    const c = wordsToCaptions(words("Hello there. How are you?"));
    expect(c.map((x) => x.text)).toEqual(["Hello there.", "How are you?"]);
  });
  it("breaks at pauses", () => {
    const c = wordsToCaptions(words("one two three four", 0.3, { 1: 1 }));
    expect(c.map((x) => x.text)).toEqual(["one two", "three four"]);
  });
  it("keeps lines under the character limit", () => {
    const c = wordsToCaptions(words("the quick brown fox jumps over the lazy dog again and again", 0.2), { maxChars: 20, maxDuration: 10, pauseBreak: 9, minDuration: 0 });
    expect(c.every((x) => x.text.length <= 20)).toBe(true);
    expect(c.length).toBeGreaterThan(2);
  });
  it("holds a flash-by caption up to the minimum, without overlapping the next", () => {
    const c = wordsToCaptions([{ text: "Hi.", start: 0, end: 0.2 }, { text: "Next", start: 0.5, end: 0.9 }]);
    expect(c[0].end).toBe(0.5);
  });
  it("tidies punctuation tokens Whisper splits off", () => {
    expect(wordsToCaptions([{ text: " Wait", start: 0, end: 0.3 }, { text: " ,", start: 0.3, end: 0.35 }, { text: " what", start: 0.4, end: 0.6 }])[0].text).toBe("Wait, what");
  });
});

describe("readable breaks", () => {
  const w = (s: string) => s.split(" ").map((text, i) => ({ text, start: i * 0.25, end: i * 0.25 + 0.2 }));
  it("breaks after a comma once the line is half full, and never ends on a little word", () => {
    const c = wordsToCaptions(w("Welcome to the video editor, this sentence was spoken by a computer, captions should appear on screen."), { ...DEFAULT_LINES, maxDuration: 99 });
    expect(c.map((x) => x.text)).toEqual(["Welcome to the video editor,", "this sentence was spoken", "by a computer,", "captions should appear", "on screen."]);
    expect(c.every((x) => !/ (a|the|to|by)$/.test(x.text))).toBe(true);
  });
});

describe("SRT and VTT", () => {
  const caps = [
    { start: 1.5, end: 3.25, text: "First line" },
    { start: 3661.001, end: 3662, text: "Two\nlines" },
  ];
  it("round-trips SRT", () => {
    const srt = toSrt(caps);
    expect(srt).toContain("00:00:01,500 --> 00:00:03,250");
    expect(srt).toContain("01:01:01,001");
    expect(parseSubtitles(srt)).toEqual(caps);
  });
  it("round-trips VTT and ignores cue settings and tags", () => {
    expect(parseSubtitles(toVtt(caps))).toEqual(caps);
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.500 align:start\n<b>Bold</b> text\n";
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2.5, text: "Bold text" }]);
  });
});

describe("quietCuts", () => {
  it("cuts at the quiet spot before each target", () => {
    const rate = 1000;
    const pcm = new Float32Array(70 * rate).fill(0.5);
    // silences at 25.3 s and 51 s
    pcm.fill(0, 25.3 * rate, 25.4 * rate);
    pcm.fill(0, 51 * rate, 51.1 * rate);
    const cuts = quietCuts(rms10ms(pcm, rate), 70);
    expect(cuts.length).toBe(2);
    expect(cuts[0]).toBeCloseTo(25.3, 1);
    expect(cuts[1]).toBeCloseTo(51, 1);
  });
  it("does not cut short audio", () => {
    expect(quietCuts(new Float32Array(2000), 20)).toEqual([]);
  });
});
