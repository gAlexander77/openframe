import { describe, expect, it } from "vitest";
import { compareScript, diffWords, judgeHearings, respell, tokens, verdict, type LineMeasure } from "./voiceReview";

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
      { kind: "extra", heard: "um", near: 4, minor: true },
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

  it("joins neighboring differences into one", () => {
    expect(diffWords(tokens("open source and free"), tokens("open sauce in free")).differences).toEqual([{ kind: "misheard", script: "source and", heard: "sauce in", near: 1 }]);
  });

  it("compares against the respelled words too, so a pronunciation fix is not a difference", () => {
    const r = compareScript("Kokoro speaks. [pause] Done.", "Coco row speaks. Done.", { Kokoro: "Coco row" });
    expect(r.differences).toEqual([]);
    expect(compareScript("Kokoro speaks.", "Coco row speaks.").differences).toHaveLength(1);
  });
});

describe("verdicts", () => {
  const ok: LineMeasure = { clipId: "c_1", start: 2, end: 6, text: "Meet OpenFrame, the editor.", voice: "af_heart", speed: 0.95, volume: 1, compressed: true, wps: 2.9, sps: 4.5, lead: 0.06, tail: 0.2, longestPause: 0.3, marks: [], lufs: -20, truePeak: -3, rangeSt: 6, overMusic: 12, differences: [] };

  it("passes a good line", () => {
    expect(verdict(ok, -20)).toEqual([]);
  });

  it("names the tool and the arguments that fix each problem", () => {
    const fixes = verdict({ ...ok, wps: 3.9, sps: 6.2, lead: 0.5, lufs: -23, overMusic: 5, musicClip: "c_m", rangeSt: 2, differences: [{ kind: "misheard", script: "openframe", heard: "open fame", near: 1 }] }, -20);
    expect(fixes.map((f) => f.tool)).toEqual(["retake_voiceover", "retake_voiceover", "trim_clip", "set_param", "duck_under_speech", "retake_voiceover"]);
    expect(fixes[0].args).toEqual({ clip_id: "c_1", pronounce: { OpenFrame: "Open Frame" } });
    // At most 15% slower at once.
    expect(fixes[1].args.speed).toBeCloseTo(0.95 * 0.85, 2);
    expect(fixes[2].args).toEqual({ clip_id: "c_1", edge: "start", to: 2.44 });
    expect(fixes[3].args).toEqual({ clip_ids: ["c_1"], path: "volume", value: 1.413 });
    // Ducked 7 dB lower than now: 12 LU over the music from 5.
    expect(fixes[4].args).toEqual({ clip_id: "c_m", depth: 7 });
  });

  it("ducks deeper by what the line lacks, and less where the music has all but gone", () => {
    expect(verdict({ ...ok, overMusic: 4, musicClip: "c_m", musicDuckDb: 6 }, -20)[0].args).toEqual({ clip_id: "c_m", depth: 14 });
    const under = verdict({ ...ok, overMusic: 38, musicClip: "c_m", musicDuckDb: 40 }, -20);
    expect(under[0].problem).toMatch(/nearly nothing/);
    expect(under[0].args).toEqual({ clip_id: "c_m", depth: 14 });
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

  it("holds a line to the pace it was meant to have", () => {
    const tagline = { ...ok, sps: 2.6 };
    expect(verdict(tagline, -20).map((f) => f.problem)).toEqual([expect.stringMatching(/^slow/)]);
    expect(verdict({ ...tagline, pace: "slow" }, -20)).toEqual([]);
    expect(verdict({ ...tagline, sps: 1.5, pace: "slow" }, -20)).toHaveLength(1);
    expect(verdict({ ...ok, sps: 6.4, pace: "fast" }, -20)).toEqual([]);
    expect(verdict({ ...ok, sps: 6.4 }, -20)).toHaveLength(1);
  });
});
