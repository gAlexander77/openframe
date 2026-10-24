import { describe, expect, it, vi } from "vitest";
import { COMMANDS, validate } from "./commands";
import { cutsFrom, describePending, momentGroups, silencesFrom, planMoments, describeOrder, measureMoment, momentPrompt, MOMENT_SCHEMA, parseMoment, screenplay, screenplayBlocks, pageBlocks, findMoments, editPoints, joinAdvice, parseShotLog, type Measures, type ShotLog } from "./shotlog";

const measures = (duration = 12): Measures => ({ duration, width: 1920, height: 1080, frame_rate: 10, scene: Array(duration * 10).fill(0.01), step: 0.5, luma: Array(duration * 2).fill(0.5), motion: Array(duration * 2).fill(0.02), dx: Array(duration * 2).fill(0), dy: Array(duration * 2).fill(0), rgb: Array.from({ length: duration * 2 }, () => [100, 120, 140]), audio_step: 0.1, audio_db: Array(duration * 10).fill(-18) });
const description = { shot_size: "medium", camera: "static", people: 1, on_screen_text: ["JPL"], action: "A man raises his arms; others clap.", mood: "excited", description: "A control room celebrates." };
function log(): ShotLog {
  const moments = planMoments(12, [5], 8);
  moments.forEach(m => { m.measured = measureMoment(m, measures()); m.described = parseMoment(JSON.stringify(description)); });
  return { version: 1, duration: 12, interval: 8, model: "test", measured_at: "2026-10-23", shots: [{ start: 0, end: 5 }, { start: 5, end: 12 }], moments, silences: [[9.6, 10.2]], complete: true };
}
describe("shot measurements", () => {
  it("detects a hard cut at its decoded frame, keeps the stronger near peak and ignores high neighborhoods", () => {
    const m = measures(); m.scene[50] = 0.8; m.scene[52] = 0.9; m.scene[70] = 0.34;
    for (let i = 90; i < 110; i++) m.scene[i] = 0.5;
    expect(cutsFrom(m)).toEqual([5.2]);
    expect(cutsFrom({ ...m, frame_rate: 0 })).toEqual([]);
  });
  it("finds absolute and relative silence, including a trailing pause, but rejects short dips", () => {
    const m = measures(); m.audio_db.fill(-60, 20, 24); m.audio_db.fill(-44, 40, 44); m.audio_db.fill(-90, 60, 62); m.audio_db.fill(-80, 117);
    const silence = silencesFrom(m);
    expect(silence).toHaveLength(3); expect(silence[0]).toEqual([2, 2.4000000000000004]); expect(silence[1][0]).toBe(4); expect(silence[2][1]).toBe(12);
    expect(silencesFrom({ ...m, audio_db: [] })).toEqual([]);
    expect(silencesFrom({ ...m, audio_db: m.audio_db.map(() => -48) })).toEqual([[0, 12]]);
  });
  it("measures horizontal and vertical pan, mean color and sound without inventing audio", () => {
    const m = measures(); m.dx.fill(-0.1);
    const moment = planMoments(12, [5])[0];
    expect(measureMoment(moment, m)).toMatchObject({ pan: "left", motion: expect.closeTo(0.02), luma: 0.5, loudness_db: -18, rgb: [100, 120, 140] });
    m.dy.fill(0.3); expect(measureMoment(moment, m).pan).toBe("down");
    m.dx.fill(0); m.dy.fill(0); m.audio_db = [];
    expect(measureMoment(moment, m)).toMatchObject({ pan: null, loudness_db: -90 });
  });
});
describe("moment planning and descriptions", () => {
  it("keeps short shots whole, evenly splits longer ones and selects frames in their interior", () => {
    const m = planMoments(21, [1, 5, 5, -3, 99], 8);
    expect(m.map(m => [m.start, m.end, m.shot])).toEqual([[0, 1, 0], [1, 5, 1], [5, 13, 2], [13, 21, 2]]);
    expect(m[0].frames).toEqual([0.5]); expect(m[1].frames).toEqual([1.6, 3, 4.4]);
    expect(planMoments(NaN, [])).toEqual([]); expect(planMoments(2, [], 0)).toEqual([]);
  });
  it("splits a fixed 30-minute stream layout and spreads every coarse pass over the file", () => {
    const m = planMoments(1800, []), order = describeOrder(m);
    expect(m).toHaveLength(225); expect(m.every(m => m.end - m.start <= 8 && m.shot === 0)).toBe(true);
    expect(order.slice(0, 29)).toEqual(Array.from({ length: 29 }, (_, i) => i * 8));
    expect(order[28]).toBe(224); expect(order.slice(29, 32)).toEqual([4, 12, 20]);
    expect(new Set(order).size).toBe(225); expect([...order].sort((a, b) => a - b)).toEqual(m.map((_, i) => i));
    for (let count = 0; count < 20; count++) expect([...describeOrder(m.slice(0, count))].sort((a, b) => a - b)).toEqual(m.slice(0, count).map((_, i) => i));
  });
  it("keeps the proven prompt, schema order and every string's length ceiling", () => {
    expect(momentPrompt(planMoments(5, [])[0])).toContain("3 frames");
    expect(momentPrompt(planMoments(5, [])[0])).toContain("0.75 s, 2.50 s, 4.25 s");
    expect(Object.keys(MOMENT_SCHEMA.properties).at(-1)).toBe("description");
    expect(MOMENT_SCHEMA.properties.action.maxLength).toBe(160); expect(MOMENT_SCHEMA.properties.description.maxLength).toBe(320);
    expect(MOMENT_SCHEMA.properties.on_screen_text.items.maxLength).toBe(60);
  });
  it("validates bad model answers, clamps enums/counts and trims strings", () => {
    expect(parseMoment("bad json")).toBeUndefined(); expect(parseMoment("null")).toBeUndefined(); expect(parseMoment("{}")).toBeUndefined();
    expect(parseMoment(JSON.stringify({ ...description, people: "1" }))).toBeUndefined();
    expect(parseMoment(JSON.stringify({ ...description, on_screen_text: [5] }))).toBeUndefined();
    const d = parseMoment('```json\n' + JSON.stringify({ ...description, shot_size: "bad", camera: "bad", people: -4, action: "  " + "a".repeat(200), on_screen_text: Array(9).fill("x".repeat(80)) }) + '\n```')!;
    expect(d).toMatchObject({ shot_size: "medium", camera: "unknown", people: 0 }); expect(d.action).toHaveLength(160); expect(d.on_screen_text).toHaveLength(6); expect(d.on_screen_text[0]).toHaveLength(60);
  });
});
describe("reading and finding the log", () => {
  it("writes cuts, visible text, sound, speech, and partial measured moments within the requested window", () => {
    const l = log(); delete l.moments[1].described;
    const text = screenplay(l, { from: 2, to: 11, words: [{ start: 3, end: 4, text: "Touchdown confirmed." }, { start: 11.5, end: 11.9, text: "hidden" }] });
    expect(text).toContain('On screen: "JPL"'); expect(text).toContain('Speech: "Touchdown confirmed."'); expect(text).toContain("00:05.00          CUT"); expect(text).toContain("not described yet"); expect(text).toContain("silence 00:09.60-00:10.20"); expect(text).not.toContain("hidden");
    expect(screenplay(l, { from: 5.1, to: 7 })).not.toContain("CUT");
  });
  it("ranks on-screen text and actions over prose, stems case-insensitively and requires quoted phrases", () => {
    const a = log(), b = log();
    a.moments[0].described!.on_screen_text = ["ROCKET LAUNCH"]; a.moments[0].described!.action = "Launches a rocket";
    b.moments[0].described!.description = "rocket launch";
    const results = findMoments([{ asset: "a", log: a }, { asset: "b", log: b }], '"rocket launch"');
    expect(results[0]).toMatchObject({ asset: "a", start: 0, matched_words: ["rocket", "launch"] }); expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(findMoments([{ asset: "a", log: a }], "launching")[0].start).toBe(0);
    expect(findMoments([{ asset: "a", log: a }], '"launch rocket"')).toEqual([]);
    expect(findMoments([{ asset: "a", log: a }], "")).toEqual([]); expect(findMoments([{ asset: "a", log: a }], "JPL", 1)).toHaveLength(1);
  });
  it("validates disk logs, rejects invalid measures/spans, and repairs an unearned complete flag", () => {
    expect(parseShotLog(JSON.stringify(log()))).toEqual(log());
    for (const mutate of [(l: ShotLog) => { l.moments[0].measured.luma = 2; }, (l: ShotLog) => { l.shots[1].start = 4; }, (l: ShotLog) => { l.moments[0].frames = [100]; }, (l: ShotLog) => { l.silences = [[0, 100]]; }, (l: ShotLog) => { l.moments[0].shot = 9; }]) { const l = log(); mutate(l); expect(parseShotLog(JSON.stringify(l))).toBeUndefined(); }
    const partial = log(); delete partial.moments[0].described; expect(parseShotLog(JSON.stringify(partial))!.complete).toBe(false);
    expect(parseShotLog("null")).toBeUndefined(); expect(parseShotLog("{")).toBeUndefined();
  });
});
describe("edit decisions", () => {
  it("chooses the cut for In, silence for Out, and explains alternatives", () => {
    const points = editPoints(log(), { start: 5.1, end: 9.8 }, {});
    expect(points.in.best?.time).toBe(5); expect(points.in.best?.reasons.join()).toContain("shot cut");
    expect(points.out.best?.time).toBe(9.6); expect(points.out.best?.reasons.join()).toContain("0.6 s of silence");
    expect(points.in.alternatives.length).toBeLessThanOrEqual(2);
    expect(editPoints(log(), { start: 2, end: 5 }, { window: 0 }).out.best?.time).toBe(5);
  });
  it("never puts an Out at or before its In (a cut near both edges)", () => {
    // The cut at 5 s is within the window of both edges of 5.1..6.8.
    const points = editPoints(log(), { start: 5.1, end: 6.8 }, {});
    expect(points.in.best?.time).toBe(5);
    expect(points.out.best!.time).toBeGreaterThanOrEqual(5.5);
  });
  it("never suggests inside a word and prefers a sentence end for Out", () => {
    const l = log(); l.shots = [{ start: 0, end: 12 }]; l.silences = [];
    const words = [{ start: 4.5, end: 5.3, text: "Landing." }, { start: 5.4, end: 5.8, text: "Confirmed" }];
    const p = editPoints(l, { start: 5, end: 5.6 }, { words, window: 1 });
    // 5..5.6 straddles both words: the whole first one, ending its sentence, is the valid range.
    expect(p.in.best?.time).toBe(4.5); expect(p.out.best).toMatchObject({ time: 5.3, reasons: ["after a sentence"] });
    for (const point of [p.in.best, p.out.best, ...p.in.alternatives, ...p.out.alternatives]) expect(words.some(w => point && point.time > w.start && point.time < w.end)).toBe(false);
  });
  it("finds a sound onset and the end of an action", () => {
    const l = log(); l.moments[0].measured.motion = 0.5; l.moments[1].measured.motion = 0.01; l.shots = [{ start: 0, end: 12 }];
    expect(editPoints(l, { start: 5.1, end: 8 }, {}).in.best).toMatchObject({ time: 5, reasons: ["end of an action (motion drops)"] });
    expect(editPoints(l, { start: 10, end: 11 }, {}).in.best?.time).toBe(10.2);
  });
  it("warns of a jump cut, brightness and running sound using real tool names and argument keys", () => {
    const l = log();
    const advice = joinAdvice(l, { start: 0, end: 2 }, l, { start: 3, end: 4 });
    expect(advice.map(a => a.kind)).toEqual(["jump_cut", "L_cut", "J_cut"]);
    for (const tool of advice.flatMap(a => a.tools)) {
      const cmd = COMMANDS.find(c => c.name === tool.name)!; expect(cmd).toBeDefined();
      const args = { ...tool.arguments, ...(tool.name === "trim_clip" ? { to: 10 } : {}) };
      expect(validate(args, cmd.input)).toEqual([]);
    }
    const b = log(); b.moments[0].measured.luma = 0.95; l.moments[0].measured.luma = 0.2;
    expect(joinAdvice(l, { start: 0, end: 2 }, b, { start: 0, end: 3 }).find(a => a.kind === "brightness")!.tools[0].arguments.type).toBe("dipBlack");
  });
  it("matches motion and falls back to a hard cut for quiet distinct shots", () => {
    const a = log(), b = log();
    a.moments[0].measured.pan = b.moments[0].measured.pan = "right";
    expect(joinAdvice(a, { start: 0, end: 2 }, b, { start: 0, end: 2 }).some(a => a.kind === "match_motion")).toBe(true);
    delete a.moments[0].described; delete b.moments[0].described;
    a.moments[0].measured.pan = null; a.moments[0].measured.loudness_db = b.moments[0].measured.loudness_db = -90;
    expect(joinAdvice(a, { start: 0, end: 2 }, b, { start: 0, end: 2 }).map(a => a.kind)).toEqual(["hard_cut"]);
  });
});
describe("reading a long log", () => {
  it("folds alike moments of one shot in the brief view and keeps a cut's moment apart", () => {
    // 60 s in one shot read alike (a stream's fixed layout), then a cut.
    const moments = planMoments(80, [60], 8);
    moments.forEach(m => { m.measured = measureMoment(m, measures()); m.described = parseMoment(JSON.stringify(description)); });
    const l: ShotLog = { version: 1, duration: 80, interval: 8, model: "test", measured_at: "2026-10-23", shots: [{ start: 0, end: 60 }, { start: 60, end: 80 }], moments, silences: [], complete: true };
    const brief = screenplayBlocks(l, { detail: "brief" });
    expect(brief).toHaveLength(2);
    expect(brief[0].text).toMatch(/^00:00\.00-01:00\.00 .*\(alike ×\d+\)$/);
    expect(brief[1].text).toContain("CUT ");
    expect(screenplayBlocks(l, { detail: "full" }).length).toBeGreaterThan(brief.length);
  });
  it("pages blocks and says where the next page starts, never splitting a block", () => {
    const blocks = [{ at: 0, text: "a".repeat(30) }, { at: 5, text: "b".repeat(30) }, { at: 9, text: "c".repeat(30) }];
    expect(pageBlocks(blocks, 70)).toEqual({ text: `${"a".repeat(30)}\n${"b".repeat(30)}`, next: 9 });
    expect(pageBlocks(blocks, 1000).next).toBeUndefined();
    // A block larger than the page still goes out alone.
    expect(pageBlocks(blocks, 10)).toEqual({ text: "a".repeat(30), next: 5 });
    expect(screenplay(log())).toBe(screenplayBlocks(log()).map(b => b.text).join("\n"));
  });
});


describe("shot log edge regressions", () => {
  it("labels absent sound and never uses stale sound evidence", () => {
    const l = { ...log(), has_audio: false };
    expect(screenplay(l)).toContain("Sound: no audio");
    expect(screenplay(l)).not.toContain("silence");
    expect(screenplay(l, { detail: "brief" })).toContain("[no audio]");
    const points = editPoints(l, { start: 9, end: 10 }, {});
    expect(JSON.stringify(points)).not.toContain("silence");
    const kinds = joinAdvice(l, { start: 0, end: 2 }, l, { start: 3, end: 4 }).map(a => a.kind);
    expect(kinds).not.toContain("L_cut"); expect(kinds).not.toContain("J_cut");
    expect(parseShotLog(JSON.stringify(l))).toMatchObject({ has_audio: false });
    expect(parseShotLog(JSON.stringify({ ...l, has_audio: "false" }))).toBeUndefined();
  });
  it("does not label a cut before the brief window", () => {
    expect(screenplay(log(), { from: 5.1, detail: "brief" })).not.toContain("CUT");
    expect(screenplay(log(), { from: 5, detail: "brief" })).toContain("CUT");
  });
  it("keeps literal text and drops object descriptions in on-screen text", () => {
    const keep = ["MARS 2020 PERSEVERANCE", "UTC: 2021-02-18 20:52:48", "WE LANDED!", "CAM: MC CHASE"];
    const d = parseMoment(JSON.stringify({ ...description, on_screen_text: ["NASA logo on astronaut's suit", "American flag and NASA insignia behind astronaut", ...keep] }));
    expect(d!.on_screen_text).toEqual(keep);
    expect(momentPrompt({ frames: [1, 2, 3] })).toContain("copied exactly");
  });
  it("matches editing synonyms with lower weight and reports the matched word", () => {
    const l = log(); l.moments.forEach(m => { m.described!.action = "People cheering"; m.described!.description = "A room"; m.described!.mood = "calm"; });
    const direct = findMoments([{ asset: "a", log: l }], "cheer");
    const synonym = findMoments([{ asset: "a", log: l }], "celebrate");
    expect(synonym[0]).toMatchObject({ start: 0, matched_words: ["cheer"] });
    expect(synonym[0].score).toBeLessThan(direct[0].score);
  });
});


it("runs two descriptions, publishes out of order, stops admission and drains on cancel", async () => {
  const moments = planMoments(48, []), controller = new AbortController();
  const pending = new Map<number, (d: ReturnType<typeof parseMoment>) => void>();
  const done: number[] = [];
  const result = describePending(moments, controller.signal, m => new Promise(resolve => { pending.set(m.start, resolve); }), async n => { done.push(n); });
  const checked = expect(result).rejects.toThrow();
  expect([...pending.keys()]).toEqual([0, 32]);
  pending.get(32)!(parseMoment(JSON.stringify(description)));
  await vi.waitFor(() => expect(pending.size).toBe(3));
  expect(moments[4].described).toBeDefined(); expect(done).toEqual([1]);
  controller.abort();
  pending.get(0)!(parseMoment(JSON.stringify(description))); pending.get(16)!(parseMoment(JSON.stringify(description)));
  await checked;
  expect(done).toEqual([1, 2, 3]); expect(pending.size).toBe(3);
  const resumed: number[] = [];
  await describePending(moments, new AbortController().signal, async m => { resumed.push(m.start); return parseMoment(JSON.stringify(description)); }, async () => {});
  expect(resumed).toEqual([8, 24, 40]);
});
it("drains the other worker before surfacing an inference failure", async () => {
  const moments = planMoments(32, []);
  let finish!: (d: ReturnType<typeof parseMoment>) => void, settled = false, calls = 0;
  const result = describePending(moments, new AbortController().signal, async () => {
    if (++calls === 2) throw new Error("inference failed");
    return new Promise(resolve => { finish = resolve; });
  }, async () => {});
  const checked = expect(result).rejects.toThrow("inference failed");
  void result.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false);
  finish(parseMoment(JSON.stringify(description))); await checked;
  expect(calls).toBe(2); expect(moments[0].described).toBeDefined();
});
it("uses the brief view's same-shot groups for the panel", () => {
  const l = log(); l.moments = planMoments(12, [5], 3);
  l.moments.forEach(m => { m.described = parseMoment(JSON.stringify(description)); });
  const groups = momentGroups(l);
  expect(groups.map(g => g.moments.length)).toEqual([2, 3]);
  expect(groups.map(g => g.start)).toEqual(screenplayBlocks(l, { detail: "brief" }).map(b => b.at));
});
