import { describe, expect, it } from "vitest";
import { captionClips, captionsInRange, casedText, currentCaptions, DEFAULT_LINES, parseSubtitles, quietCuts, replaceText, rms10ms, toSrt, toVtt, withoutCaptions, wordsToCaptions, type Word } from "./captions";
import { createProject, createTextClip } from "./project/defaults";

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

it("one word at a time: a caption per word, each at its own time", () => {
  const ws = [
    { text: " So", start: 0, end: 0.2 },
    { text: " we", start: 0.25, end: 0.4 },
    { text: " go.", start: 0.45, end: 0.9 },
  ];
  const caps = wordsToCaptions(ws, { ...DEFAULT_LINES, maxChars: 1, minDuration: 0.25 });
  expect(caps.map((c) => [c.text, c.start])).toEqual([["So", 0], ["we", 0.25], ["go.", 0.45]]);
  // Too short to read, extended into the gap only up to the next word.
  expect(caps[0].end).toBe(0.25);
});

it("finds and replaces in caption text, whole words and case as asked", () => {
  expect(replaceText("Jon met jon and Jonathan", "jon", "John")).toEqual(["John met John and Johnathan", 3]);
  expect(replaceText("Jon met jon and Jonathan", "jon", "John", { wholeWord: true })).toEqual(["John met John and Jonathan", 2]);
  expect(replaceText("Jon met jon", "jon", "John", { matchCase: true, wholeWord: true })).toEqual(["Jon met John", 1]);
  // Regex characters are literal; "don't" is one word.
  expect(replaceText("a.b a+b don't", "a.b", "x")).toEqual(["x a+b don't", 1]);
  expect(replaceText("don't do it", "don", "will", { wholeWord: true })).toEqual(["don't do it", 0]);
  expect(replaceText("anything", "", "x")).toEqual(["anything", 0]);
});

it("shows text in a style's case and keeps the typed text", () => {
  expect(casedText("hello wörld, it's me", "upper")).toBe("HELLO WÖRLD, IT'S ME");
  expect(casedText("Hello World", "lower")).toBe("hello world");
  expect(casedText("hello wörld\nnew LINE", "title")).toBe("Hello Wörld\nNew LINE");
  expect(casedText("as typed", undefined)).toBe("as typed");
});

describe("captions on export", () => {
  it("times captions from the export's start and cuts them at its ends", () => {
    const caps = [
      { start: 0, end: 1.5, text: "before" },
      { start: 1.5, end: 3, text: "across the start" },
      { start: 3, end: 5, text: "inside" },
      { start: 5.5, end: 7, text: "across the end" },
      { start: 8, end: 9, text: "after" },
    ];
    expect(captionsInRange(caps, 2, 6)).toEqual([
      { start: 0, end: 1, text: "across the start" },
      { start: 1, end: 3, text: "inside" },
      { start: 3.5, end: 4, text: "across the end" },
    ]);
  });

  it("switches caption clips off and leaves other titles drawn", () => {
    const p = createProject();
    const cap = { ...createTextClip("Hi", 30, 30), caption: true };
    const title = createTextClip("Title", 0, 30);
    p.tracks[0] = { ...p.tracks[0], clips: [title, cap].sort((a, b) => a.start - b.start) };
    expect(currentCaptions(p)).toEqual([{ start: 1, end: 2, text: "Hi" }]);
    const q = withoutCaptions(p);
    expect(captionClips(q)[0].disabled).toBe(true);
    expect(q.tracks[0].clips.find((c) => c.id === title.id)!.disabled).toBeUndefined();
  });
});
