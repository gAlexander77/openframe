import { describe, expect, it } from "vitest";
import { advise, bandOf, compareScript, diffWords, judgeHearings, matchShare, numberReadings, respell, sameNumber, scriptPace, tokens, verdict, type LineMeasure } from "./voiceReview";

describe("words to compare", () => {
  it("drops case and punctuation, spells numbers and says symbols", () => {
    expect(tokens("Meet OpenFrame, 20% off — today & tomorrow!")).toEqual(["meet", "openframe", "twenty", "percent", "off", "today", "and", "tomorrow"]);
    expect(tokens("It's 2026.")).toEqual(["it's", "two", "thousand", "twenty", "six"]);
  });
});

describe("script against what was heard", () => {
  it("finds nothing wrong in a faithful read, words run together or not", () => {
    const r = diffWords(tokens("Meet OpenFrame, it speaks MCP."), tokens("Meet Open Frame. It speaks M.C.P."));
    expect(r).toEqual({ matched: 5, differences: [] });
    expect(diffWords(tokens("open frame"), tokens("OpenFrame")).differences).toEqual([]);
  });

  it("names a skipped word, an extra one and a misheard one, with where they are", () => {
    const r = diffWords(tokens("the video editor that runs on your computer"), tokens("the editor that runs um on your commuter"));
    expect(r.differences).toEqual([
      { kind: "missing", script: "video", near: 1 },
      { kind: "extra", heard: "um", near: 4 },
      { kind: "misheard", script: "computer", heard: "commuter", near: 7 },
    ]);
    expect(r.matched).toBe(6);
  });

  it("marks a short word heard a letter off as minor, and passes it", () => {
    const r = diffWords(tokens("it trims and it syncs"), tokens("its trims an it syncs"));
    expect(r.differences.map((d) => [d.script, d.heard, d.minor])).toEqual([
      ["it", "its", true],
      ["and", "an", true],
    ]);
    expect(diffWords(tokens("the editor"), tokens("the edits")).differences[0].minor).toBeUndefined();
  });

  it("never passes a word heard that is not in the script as a slip: it is heard again (film test 3.10)", () => {
    // "You wake up..." for "Wake up...": Whisper's guess at a breath, or a
    // sound the voice made; only the second hearing tells which.
    const r = diffWords(tokens("Wake up where the water meets the light."), tokens("You wake up where the water meets the light."));
    expect(r.differences).toEqual([{ kind: "extra", heard: "you", near: 0 }]);
    expect(r.differences[0].minor).toBeUndefined();
    // Its match is under 1 while the difference is listed (it was 1).
    expect(r.matched).toBe(8);
    expect(matchShare(r.matched, r.differences)).toBe(0.89);
    expect(matchShare(8, [])).toBe(1);
    expect(matchShare(7, [{ script: "video" }])).toBe(0.88);
    // Heard again right: the recognizer's, no retake; heard again too: the voice's.
    const line = { ...okLine, text: "Wake up where the water meets the light." };
    const judged = judgeHearings(r.differences, []);
    expect(judged[0].likely).toBe("recognizer");
    expect(verdict({ ...line, differences: judged }, -20)).toEqual([]);
    const voiced = judgeHearings(r.differences, r.differences);
    expect(verdict({ ...line, differences: voiced }, -20)[0]).toMatchObject({ problem: expect.stringMatching(/"you" was heard but is not in the script.*likely the voice/), tool: "retake_voiceover" });
  });

  it("joins neighboring differences into one", () => {
    expect(diffWords(tokens("open source and free"), tokens("open sauce in free")).differences).toEqual([{ kind: "misheard", script: "source and", heard: "sauce in", near: 1 }]);
  });

  it("compares against the respelled words too, so a pronunciation fix is not a difference", () => {
    const r = compareScript("Kokoro speaks. [pause] Done.", "Coco row speaks. Done.", { Kokoro: "Coco row" });
    expect(r.differences).toEqual([]);
    expect(compareScript("Kokoro speaks.", "Coco row speaks.").differences).toHaveLength(1);
  });
});

// The fourth film test (ADR-124): "ten-eighty p" was said right, Whisper
// wrote "1080p", and the line was to fix, with a slower read.
describe("numbers said one way and written another", () => {
  const line = "Pick YouTube ten-eighty p, set loudness to minus fourteen, and hit Export.";
  const heard = "Pick YouTube 1080p, set loudness to minus 14, and hit export.";

  it("reads a recognizer's digits as the script says them", () => {
    const r = compareScript(line, heard);
    expect(r.differences).toEqual([]);
    expect(r.matched).toBe(r.words);
    // Before: a misheard "ten eighty p" the voice was blamed for.
    expect(diffWords(tokens(line), tokens(heard)).differences).toHaveLength(1);
  });

  it("compares with the line's caption too", () => {
    expect(compareScript("Set loudness to minus fourteen.", "Set loudness to -14.", undefined, "Set loudness to -14.").differences).toEqual([]);
    expect(compareScript("We cut it in four K.", "We cut it in 4K.", undefined, "We cut it in 4K.").differences).toEqual([]);
  });

  it("knows the usual readings of a number", () => {
    const said = (d: string) => numberReadings(d).map((w) => w.join(" "));
    expect(said("1080")).toEqual(expect.arrayContaining(["one thousand eighty", "ten eighty", "one thousand and eighty", "one oh eight oh"]));
    expect(said("2026")).toEqual(expect.arrayContaining(["two thousand twenty six", "twenty twenty six"]));
    expect(said("1905")).toContain("nineteen oh five");
    expect(said("3.5")[0]).toBe("three point five");
    expect(tokens("Bring $20, -14 LUFS, the 3rd 1,000.")).toEqual(["bring", "twenty", "dollars", "minus", "fourteen", "lufs", "the", "third", "one", "thousand"]);
  });

  it("a number written another way is not a difference, another number is", () => {
    expect(sameNumber({ kind: "misheard", script: "ten eighty", heard: "one thousand eighty" })).toBe(true);
    expect(sameNumber({ kind: "misheard", script: "nineteen oh five", heard: "one nine zero five" })).toBe(true);
    expect(sameNumber({ kind: "misheard", script: "fourteen", heard: "forty" })).toBe(false);
    const r = compareScript("Set it to fourteen.", "Set it to 40.");
    expect(r.differences).toEqual([expect.objectContaining({ kind: "misheard", script: "fourteen", heard: "forty" })]);
  });

  it("so the line passes, and no slower read is asked for", () => {
    const r = compareScript(line, heard);
    expect(verdict({ ...okLine, text: line, differences: r.differences }, null)).toEqual([]);
  });
});

const okLine: LineMeasure = { clipId: "c_1", start: 2, end: 6, text: "Meet OpenFrame, the editor.", voice: "af_heart", speed: 0.95, volume: 1, compressed: true, wps: 2.5, sps: 4.5, lead: 0.06, tail: 0.2, longestPause: 0.3, marks: [], lufs: -20, truePeak: -3, rangeSt: 6, overMusic: 12, differences: [] };

describe("verdicts", () => {
  const ok: LineMeasure = { clipId: "c_1", start: 2, end: 6, text: "Meet OpenFrame, the editor.", voice: "af_heart", speed: 0.95, volume: 1, compressed: true, wps: 2.5, sps: 4.5, lead: 0.06, tail: 0.2, longestPause: 0.3, marks: [], lufs: -20, truePeak: -3, rangeSt: 6, overMusic: 12, differences: [] };

  it("passes a good line", () => {
    expect(verdict(ok, -20)).toEqual([]);
    expect(advise(ok)).toEqual([]);
  });

  it("names the tool and the arguments that fix each problem", () => {
    const fixes = verdict({ ...ok, wps: 3.9, sps: 6.2, lead: 0.5, lufs: -23, overMusic: 5, musicClip: "c_m", rangeSt: 2, differences: [{ kind: "misheard", script: "openframe", heard: "open fame", near: 1 }] }, -20);
    expect(fixes.map((f) => f.tool)).toEqual(["retake_voiceover", "retake_voiceover", "trim_clip", "set_param", "duck_under_speech", "retake_voiceover"]);
    expect(fixes[0].args).toEqual({ clip_id: "c_1", pronounce: { OpenFrame: "Open Frame" } });
    // Read again to land on narration's words a second (the retake measures its speed).
    expect(fixes[1]).toMatchObject({ problem: expect.stringMatching(/^fast: 3.9 words a second/), args: { clip_id: "c_1", words_per_second: [2.3, 2.8] } });
    expect(fixes[2].args).toEqual({ clip_id: "c_1", edge: "start", to: 2.44 });
    expect(fixes[3].args).toEqual({ clip_ids: ["c_1"], path: "volume", value: 1.413 });
    // Every line held to a minimum over the music, each dipping as it needs.
    expect(fixes[4]).toMatchObject({ problem: expect.stringMatching(/this line/), args: { clip_id: "c_m", min_line_lu: 10 } });
  });

  it("holds every line to a minimum over the music, the music's present dip kept as the least", () => {
    expect(verdict({ ...ok, overMusic: 4, musicClip: "c_m", musicDuckDb: 6 }, -20)[0].args).toEqual({ clip_id: "c_m", min_line_lu: 10, depth: 6 });
    const under = verdict({ ...ok, overMusic: 38, musicClip: "c_m", musicDuckDb: 40 }, -20);
    expect(under[0].problem).toMatch(/nearly nothing/);
    expect(under[0].args).toEqual({ clip_id: "c_m", min_line_lu: 12 });
  });

  it("passes minor slips", () => {
    expect(verdict({ ...ok, differences: [{ kind: "misheard", script: "it", heard: "its", near: 0, minor: true }] }, -20)).toEqual([]);
  });

  it("lets a long pause pass when a mark asked for it", () => {
    expect(verdict({ ...ok, longestPause: 1.5, marks: [1.5] }, -20)).toEqual([]);
    expect(verdict({ ...ok, longestPause: 1.5 }, -20)).toHaveLength(1);
  });

  it("respells CamelCase apart, capitals letter by letter, and words as they sound", () => {
    expect(respell("OpenFrame")).toBe("Open Frame");
    expect(respell("MCP")).toBe("M C P");
    expect(respell("APIs")).toBe("A P Is");
    // Spelled against their sound, by the table and by the rules.
    expect(respell("does")).toBe("duz");
    expect(respell("Does")).toBe("duz");
    expect(respell("home")).toBe("hohm");
    expect(respell("phone")).toBe("fohn");
    expect(respell("station")).toBe("stashun");
    // A long word in syllables; a short regular one has nothing to change.
    expect(respell("Olivet")).toBe("o-li-vet");
    expect(respell("hello")).toBe("hel-lo");
    expect(respell("cat")).toBeNull();
  });

  it("gives a concrete fix for every misheard word, never a placeholder", () => {
    const line = { ...ok, text: "It does it all, home or away." };
    const heard = (script: string, h: string, pronounce?: Record<string, string>) => verdict({ ...line, pronounce, differences: [{ kind: "misheard", script, heard: h, near: 1 }] }, -20);
    expect(heard("does", "this")[0].args).toEqual({ clip_id: "c_1", pronounce: { does: "duz" } });
    expect(heard("home", "helmed")[0].args).toEqual({ clip_id: "c_1", pronounce: { home: "hohm" } });
    // Respelled already and still wrong: a slower read, and say to reword.
    const again = heard("does", "this", { does: "duz" })[0];
    expect(again.args).toEqual({ clip_id: "c_1", speed: 0.85 });
    expect(again.problem).toMatch(/reword the line without "does"/);
    // Nothing reads differently ("it", one short regular word): slower.
    expect(heard("all", "on")[0].args).toEqual({ clip_id: "c_1", speed: 0.85 });
    for (const f of [heard("does", "this"), heard("all", "on"), heard("it does", "its")].flat()) expect(JSON.stringify(f)).not.toMatch(/[<>]/);
  });

  it("says whether the voice or the recognizer is likely wrong, from a second hearing", () => {
    const first = [{ kind: "misheard" as const, script: "does", heard: "this", near: 1 }, { kind: "misheard" as const, script: "home", heard: "helmed", near: 4 }, { kind: "misheard" as const, script: "it", heard: "its", near: 0, minor: true }];
    const second = [{ kind: "misheard" as const, script: "home", heard: "hold", near: 4 }];
    const judged = judgeHearings(first, second);
    expect(judged.map((d) => d.likely)).toEqual(["recognizer", "voice", undefined]);
    // The recognizer's mistake needs no retake; the voice's names it.
    const fixes = verdict({ ...ok, text: "It does it all, home or away.", differences: judged }, -20);
    expect(fixes).toHaveLength(1);
    expect(fixes[0].problem).toMatch(/home.*likely the voice/);
  });

  it("judges pace in words a second against the line's band, not syllables", () => {
    // The documentary's lines: 2.33-2.76 words a second at 3-3.6 syllables, asked for and passed.
    for (const [wps, sps] of [[2.33, 3.1], [2.64, 3.4], [2.76, 3.6]]) {
      expect(verdict({ ...ok, wps, sps }, -20)).toEqual([]);
      expect(advise({ ...ok, wps, sps })).toEqual([]);
    }
    // Read at the help's old narrator speed: 4.17 words a second, a fix.
    expect(verdict({ ...ok, wps: 4.17, sps: 5.2 }, -20)[0].problem).toMatch(/^fast: 4.17/);
  });

  it("holds a line to the pace it was meant to have", () => {
    const tagline = { ...ok, wps: 1.9, sps: 2.6 };
    expect(verdict(tagline, -20).map((f) => f.problem)).toEqual([expect.stringMatching(/^slow: 1.9 words a second/)]);
    expect(verdict({ ...tagline, pace: "slow" }, -20)).toEqual([]);
    expect(verdict({ ...tagline, wps: 1.5, pace: "slow" }, -20)).toHaveLength(1);
    expect(verdict({ ...ok, wps: 3.3, pace: "fast" }, -20)).toEqual([]);
    expect(verdict({ ...ok, wps: 3.3 }, -20)).toHaveLength(1);
    // As asked: an ad's band.
    expect(verdict({ ...ok, wps: 3.0, asked: [2.6, 3.1] }, -20)).toEqual([]);
  });

  it("holds a band asked for exactly, whatever the pace; a kind's band moves for it (film test 3.7)", () => {
    expect(bandOf({ asked: [1.8, 2.2], pace: "slow" })).toEqual([1.8, 2.2]);
    expect(bandOf({ readAs: "ad", pace: "slow" })).toEqual([2.1, 2.6]);
    expect(verdict({ ...ok, wps: 2.0, sps: 2.6, asked: [1.8, 2.2], pace: "slow" }, -20)).toEqual([]);
    // The fix for a miss keeps the line's own band, its pace in it.
    expect(verdict({ ...ok, wps: 3.2, readAs: "ad", pace: "slow" }, -20)[0].args).toEqual({ clip_id: "c_1", words_per_second: [2.1, 2.6] });
  });

  it("tells advice from a miss", () => {
    // A tenth outside the band passes, with a retake to try.
    // (Syllables in step with the words: a band moves down for long words.)
    expect(verdict({ ...ok, wps: 2.2, sps: 3.3 }, -20)).toEqual([]);
    expect(advise({ ...ok, wps: 2.2, sps: 3.3 })[0]).toMatchObject({ note: expect.stringMatching(/passes/), tool: "retake_voiceover", args: { clip_id: "c_1", words_per_second: [2.3, 2.8] } });
    // A speed already chosen for the band: the voice's limit, advice without a retake.
    const limit = { ...ok, wps: 3.2, speedChosen: true };
    expect(verdict(limit, -20)).toEqual([]);
    expect(advise(limit)[0].note).toMatch(/natural speeds.*fewer words/);
    // Short words read on target sound drawn out: a note.
    expect(advise({ ...ok, wps: 2.4, sps: 2.4 })[0].note).toMatch(/^short words/);
    // Long words read at narration's words a second (6 syllables a second):
    // held to the band moved down for them, its top at 5 syllables a second,
    // as the speed chooser holds it (ADR-114), even for a speed chosen before.
    const rushed = verdict({ ...ok, wps: 2.7, sps: 6, speedChosen: true }, -20)[0];
    expect(rushed).toMatchObject({ problem: expect.stringMatching(/^fast: 2.7 words a second over the speech, 6 syllables .*long words/), args: { clip_id: "c_1", words_per_second: [1.75, 2.25] } });
    // A band asked moves down for long words too.
    expect(verdict({ ...ok, wps: 2.7, sps: 6, asked: [2.3, 2.8] }, -20)[0]).toMatchObject({ problem: expect.stringMatching(/^fast/) });
  });
});

describe("the script's pace (ADR-121)", () => {
  it("is given only over lines in a row", () => {
    // The third film test's two retakes, 16 s apart: 1.03 words a second,
    // eight lines' words between them left out.
    const retakes = [{ first: 19.97, last: 23.9, words: 11 }, { first: 36.07, last: 40.35, words: 10 }];
    const between = [{ start: 24.73, end: 30.28 }, { start: 31.58, end: 35.87 }];
    const r = scriptPace(retakes, between);
    expect(r.words_per_second).toBeNull();
    expect(r.window).toMatch(/2 other lines speak between the lines reviewed/);
    // Lines in a row, or all of them: as before.
    expect(scriptPace(retakes, [{ start: 50, end: 54 }]).words_per_second).toBe(1.03);
    expect(scriptPace([{ first: 0.6, last: 4.6, words: 9 }, { first: 5.1, last: 11, words: 15 }], []).words_per_second).toBe(2.31);
  });
});
