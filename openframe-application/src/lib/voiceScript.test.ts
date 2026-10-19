import { describe, expect, it } from "vitest";
import { applyPronounce, asksEmphasis, breaksOf, chunkSentences, EMPHASIS_NOTE, layoutLines, matchPauses, numberWords, parseLine, pauseAfter, syllables, writtenWords } from "./voiceScript";

describe("pause marks", () => {
  it("takes marks out of the caption and puts the pause where the mark was", () => {
    const l = parseLine("Meet OpenFrame, [pause 0.4] the editor that runs on your machine.");
    expect(l.written).toBe("Meet OpenFrame, the editor that runs on your machine.");
    expect(l.spoken).toBe(l.written);
    expect(l.pauses).toHaveLength(1);
    expect(l.spoken.slice(0, l.pauses[0].at)).toBe("Meet OpenFrame,");
    expect(l.pauses[0].seconds).toBe(0.4);
    // 13 of the line's 43 letters come before it.
    expect(l.pauses[0].share).toBeCloseTo(13 / 43, 5);
  });

  it("reads every spelling of a pause: seconds, milliseconds, a beat and SSML's break", () => {
    const l = parseLine("One [pause] two [pause 300ms] three [beat] four <break time=\"1.5s\"/> five [PAUSE 2] six.");
    expect(l.pauses.map((p) => p.seconds)).toEqual([0.5, 0.3, 1, 1.5, 2]);
    expect(l.written).toBe("One two three four five six.");
  });

  it("gives the voice a comma where a mark falls between words, so it phrases a break and keeps its pitch up", () => {
    const l = parseLine("Faster [pause 0.3] than you think.");
    expect(l.spoken).toBe("Faster, than you think.");
    expect(l.written).toBe("Faster than you think.");
  });

  it("moves punctuation written after a mark in front of it", () => {
    const l = parseLine("Wait [pause]. Now look.");
    expect(l.spoken).toBe("Wait. Now look.");
    expect(l.spoken.slice(0, l.pauses[0].at)).toBe("Wait.");
  });

  it("turns marks before the first word and after the last into silence around the line", () => {
    const l = parseLine("[pause 1] Ready? [beat]");
    expect(l).toMatchObject({ written: "Ready?", spoken: "Ready?", pauses: [], before: 1, after: 1 });
  });

  it("keeps pauses to 0.05-5 s", () => {
    expect(parseLine("a [pause 9] b").pauses[0].seconds).toBe(5);
    expect(parseLine("a [pause 1ms] b").pauses[0].seconds).toBe(0.05);
  });

  it("counts the words as written", () => {
    expect(writtenWords("It's free, [pause] and it's ready — today.")).toEqual(["It's", "free,", "and", "it's", "ready", "today."]);
  });
});

describe("the pronunciation map", () => {
  const map = { MCP: "M C P", OpenFrame: "Open Frame", "Node.js": "node jay ess" };

  it("respells whole words for the voice only, the caption keeps them", () => {
    const l = parseLine("OpenFrame speaks MCP. OpenFrame's agents use Node.js too.", map);
    expect(l.spoken).toBe("Open Frame speaks M C P. Open Frame's agents use node jay ess too.");
    expect(l.written).toBe("OpenFrame speaks MCP. OpenFrame's agents use Node.js too.");
  });

  it("leaves parts of other words and other cases alone", () => {
    expect(applyPronounce("MCPs and mcp and xMCP", map)).toBe("MCPs and mcp and xMCP");
    expect(applyPronounce("no map", undefined)).toBe("no map");
  });

  it("keeps a mark's place when a respelling changes the line's length", () => {
    const l = parseLine("MCP [pause 0.6] OpenFrame.", map);
    expect(l.spoken).toBe("M C P, Open Frame.");
    expect(l.spoken.slice(0, l.pauses[0].at)).toBe("M C P,");
  });
});

describe("emphasis", () => {
  it("drops *word* stars from the voice and the caption, and says so", () => {
    const l = parseLine("I never said *she* took it. [pause] Not *any day*.");
    expect(l.spoken).toBe("I never said she took it. Not any day.");
    expect(l.written).toBe("I never said she took it. Not any day.");
    expect(writtenWords("We could go *or* stay.")).toEqual(["We", "could", "go", "or", "stay."]);
    expect(asksEmphasis("We could go *or* stay.")).toBe(true);
    expect(asksEmphasis("Five * stars")).toBe(false);
    expect(EMPHASIS_NOTE).toMatch(/not voiced.*last in its phrase.*\[pause 0\.2\]/);
  });

  it("respells a starred word as respelled, and drops a stray star", () => {
    expect(parseLine("It speaks *MCP*.", { MCP: "M C P" }).spoken).toBe("It speaks M C P.");
    expect(parseLine("Five * stars").spoken).toBe("Five stars");
  });
});

describe("timing between lines", () => {
  it("pauses after a line by how it ends: a comma runs on, a sentence rests, an ellipsis and a paragraph rest longer", () => {
    expect(pauseAfter("Cut, color and mix,")).toBe(0.1);
    expect(pauseAfter("Then let an agent do it.")).toBe(0.4);
    expect(pauseAfter("Ready?")).toBe(0.4);
    expect(pauseAfter("And then…")).toBe(0.6);
    expect(pauseAfter("Wait for it...")).toBe(0.6);
    expect(pauseAfter("It ends here.", true)).toBe(0.8);
    expect(pauseAfter("A mark at the end [pause]")).toBe(0.4);
  });

  it("lays lines one after another at their real lengths, each with its own gap", () => {
    const lines = [{ seconds: 5.07 }, { seconds: 3.2, gap: 0.1 }, { at: 12, seconds: 2 }, { at: 13, seconds: 1 }, { seconds: 1, before: 0.5 }];
    expect(layoutLines(lines, 0.5, 0.4)).toEqual([
      { start: 0.5, end: 5.57 },
      { start: 5.97, end: 9.17 },
      // Pinned to 12; the next asks for 13 but waits for this one to end.
      { start: 12, end: 14 },
      { start: 14, end: 15 },
      { start: 15.9, end: 16.9 },
    ]);
    // The second line's own gap (0.1) sets where the third would start.
    expect(layoutLines([{ seconds: 1, gap: 0.1 }, { seconds: 1 }], 0)[1].start).toBe(1.1);
  });
});

describe("where the voice pauses", () => {
  it("finds the commas, dashes and sentence ends inside a line, not its last", () => {
    const b = breaksOf("Cut, color — and mix. Then ship it.");
    expect(b.map((x) => x.sentence)).toEqual([false, false, true]);
    expect(b[0].share).toBeCloseTo(3 / 24, 5);
    expect(breaksOf("No breaks here.")).toEqual([]);
  });

  it("matches each break to the voice's pause at the same place in the read, in order", () => {
    // Speech 0.3-4.3 s with pauses after a quarter and after two thirds of the voiced time.
    const pauses = [
      { start: 1.2, end: 1.4 },
      { start: 2.5, end: 2.55 }, // a stop consonant's closure, too short to be a pause
      { start: 3.0, end: 3.4 },
    ];
    const voiced = 4.0 - 0.65;
    expect(matchPauses(pauses, 0.3, 4.3, [(1.2 - 0.3) / voiced, (3.0 - 0.3 - 0.25) / voiced])).toEqual([0, 2]);
    // A break with no pause near it stays unmatched; the pauses keep their order.
    expect(matchPauses(pauses, 0.3, 4.3, [0.27, 0.45, 0.74])).toEqual([0, -1, 2]);
    // A long pause a little off beats a short closure right on the place.
    expect(matchPauses([{ start: 1, end: 1.05 }, { start: 1.5, end: 1.9 }], 0, 4, [0.3])).toEqual([1]);
    expect(matchPauses([], 0, 1, [0.5])).toEqual([-1]);
  });
});

it("splits a line too long for one read at sentence ends only", () => {
  const s = "First sentence is here. Second one follows it. Third closes.";
  expect(chunkSentences(s, 1000)).toEqual([s]);
  expect(chunkSentences(s, 50)).toEqual(["First sentence is here. Second one follows it.", "Third closes."]);
  expect(chunkSentences(s, 10)).toEqual(["First sentence is here.", "Second one follows it.", "Third closes."]);
});

it("counts syllables well enough to judge a pace, numbers spelled out", () => {
  expect(numberWords(115)).toEqual(["one", "hundred", "fifteen"]);
  const cases: [string, number][] = [["a", 1], ["the", 1], ["film", 1], ["made", 1], ["makes", 1], ["asked", 1], ["wanted", 2], ["asking", 2], ["very", 2], ["editor", 3], ["computer", 3], ["little", 2], ["open", 2], ["source", 1], ["agent", 2], ["voices", 2], ["24", 3], ["24,", 3]];
  for (const [w, n] of cases) expect(syllables(w), w).toBe(n);
});
