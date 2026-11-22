import { describe, expect, it } from "vitest";
import { captionClips, captionReading, captionsInRange, dropPhantoms, growToRead, readableCaptions, casedText, currentCaptions, DEFAULT_LINES, parseSubtitles, quietCuts, replaceText, rms10ms, toSrt, toVtt, withoutCaptions, wordsToCaptions, type Word } from "./captions";
import { checkProject } from "./designCheck";
import { runCommand } from "./commands";
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


it("groups short captions by word count, keeping every word start", () => {
  const words = ["Save", "20%", "off", "today"].map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const caps = wordsToCaptions(words, { ...DEFAULT_LINES, maxWords: 2, minDuration: 0.25 });
  expect(caps.map((c) => c.text)).toEqual(["Save 20%", "off today"]);
  expect(caps.map((c) => c.words)).toEqual([[0, 0.4], [0.8, 1.2000000000000002]]);
});

it("film 5: readable automatic captions merge shaft and other orphan cues", () => {
  const ws = words("on how to rappel and ascend in and out of a cave shaft. And CAVES is one of those tools that will help you prepare to go to the Moon, do research exploration stay on the Moon and have a permanent presence there.", 0.29);
  const caps = readableCaptions(ws);
  expect(caps.every(c => c.end - c.start >= 5 / 6 - 1e-6 && c.text.length / (c.end - c.start) <= 20 + 1e-6)).toBe(true);
  expect(caps.every(c => c.text.split("\n").length <= 2 && c.text.split("\n").every(l => l.length <= 32))).toBe(true);
  expect(caps.some(c => c.text === "shaft.")).toBe(false);
  const p = runCommand(createProject(), "add_captions", { captions: caps });
  expect(checkProject(p).findings.filter(f => f.rule === "caption_too_fast")).toEqual([]);
  expect(caps.every((c, i) => !i || c.start >= caps[i - 1].end)).toBe(true);
});

// The blind documentary test: "We have seen an increase in the / surface", and
// "century and a half. And that / temperature continues to rise." (ADR-148).
it("ends a cue with its sentence, and balances two lines where a phrase begins", () => {
  const said = "We have seen an increase in the surface temperature averaged over the whole globe over the past century and a half. And that temperature continues to rise. That's global warming.";
  // Said at an easy pace (2.5 words a second): faster, a short cue reads too fast and joins its neighbor.
  const ws = said.split(" ").map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.36 }));
  const caps = readableCaptions(ws).map((c) => c.text);
  // No cue runs on from one sentence into the next.
  expect(caps.filter((c) => /[.!?] \S|[.!?]\n\S/.test(c))).toEqual([]);
  expect(caps.slice(-2)).toEqual(["And that temperature\ncontinues to rise.", "That's global warming."]);
  // No word alone on a second line, no line over the limit, every word kept in order.
  for (const c of caps) for (const line of c.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
  expect(caps.filter((c) => c.includes("\n") && c.split("\n")[1].split(" ").length < 2)).toEqual([]);
  expect(caps.join(" ").replace(/\n/g, " ")).toBe(said);
});

it("grows a cue too fast to read into the quiet before the next one, never over it", () => {
  // The last cue of a cut piece, held to its clip's end though the next line began 0.17 s later.
  const caps = [{ start: 10.067, end: 11.3, text: "So what's global warming?" }, { start: 11.47, end: 14.2, text: "On a global scale, the Earth's\nsurface is heating up" }];
  const grown = growToRead(caps, 60);
  expect(grown[0].end).toBeCloseTo(10.067 + 25 / 19, 2);
  expect(captionReading(grown[0]).met).toBe(true);
  expect(grown[1]).toBe(caps[1]);
  // No room: it stops at the next cue, and at the end of the film.
  expect(growToRead([{ start: 0, end: 0.5, text: "A much longer line than half a second holds" }, { start: 0.6, end: 3, text: "Next." }])[0].end).toBe(0.6);
  expect(growToRead([{ start: 5, end: 5.2, text: "The end of the film." }], 5.5)[0].end).toBe(5.5);
});

it("reads a cue exactly at the limit the same way whichever way its length is measured (ADR-149)", () => {
  const text = "x".repeat(42);
  // 63 frames at 30 a second, as two timeline seconds subtracted and as a length: both 20 characters a second.
  const start = 373 / 30, end = 436 / 30;
  expect(end - start).not.toBe(2.1);
  expect(captionReading({ start, end, text }).met).toBe(true);
  expect(captionReading({ start: 0, end: 2.1, text }).met).toBe(true);
  expect(captionReading({ start: 0, end: 2.05, text }).met).toBe(false);
});

it("drops what the recognizer writes over music, and keeps the same words where they are said (ADR-149)", () => {
  const w = (text: string, start: number, end = start + 0.3): Word => ({ text, start, end });
  // A b-roll reel, music only: the blind test's captions read "you" and "Thanks" over the interview.
  expect(dropPhantoms([w("you", 12.6), w("Thanks.", 41), w("♪", 60), w("[Music]", 75), w("Thank", 110), w("you.", 110.4), w("Music", 142.58, 145.96)])).toEqual([]);
  // The same words inside speech, or closing it, stay.
  const talk = [w("So", 1), w("thank", 1.4), w("you", 1.8), w("all.", 2.2), w("Thank", 4), w("you.", 4.4)];
  expect(dropPhantoms(talk)).toEqual(talk);
  // A lone word that is not a phantom stays, and so does music that is a word in a sentence.
  const said = [w("Wait.", 3), w("The", 20), w("music", 20.4), w("stopped.", 20.8)];
  expect(dropPhantoms(said)).toEqual(said);
});

it("does not leave a subject alone at the end of a line when a comma offers the break", () => {
  const said = "or hundreds of years, but it includes all types of changes".split(" ");
  const [cue] = readableCaptions(said.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.38 })), { ...DEFAULT_LINES, maxChars: 37, maxDuration: 6 });
  expect(cue.text).toBe("or hundreds of years,\nbut it includes all types of changes");
});
