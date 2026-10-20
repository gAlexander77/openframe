import { expect, it } from "vitest";
import { groupFindings, markerMoves, oneDuck, reviewSummary, shareCommon, withShared } from "./answerSize";
import { addCaptions, describeProject } from "./commands";
import { describeChanges } from "./mcp";
import { createProject } from "./project/defaults";

const style = { font: "Arial Black", size: 60, color: "#ffffff", case: "upper" as const, highlight: "#ffd27a", stroke: { color: "#000000", width: 8 }, shadow: { color: "rgba(0,0,0,0.6)", blur: 18, x: 0, y: 6 }, lineHeight: 1, maxWidth: 0.62 };

it("gives what a long list of added captions shares once, losing nothing (ADR-115)", () => {
  const before = createProject({ width: 1080, height: 1920 });
  const caps = Array.from({ length: 46 }, (_, i) => ({ start: i * 0.6, end: i * 0.6 + 0.6, text: `word${i} and more`, words: [i * 0.6, i * 0.6 + 0.2, i * 0.6 + 0.4] }));
  const after = addCaptions(before, caps, style, 0.08);
  const full = describeChanges(describeProject(before), describeProject(after)) as { added_clips: Record<string, unknown>[]; added_clips_common?: Record<string, unknown> };
  // Every clip keeps its id, type and times; what all share is given once.
  expect(full.added_clips).toHaveLength(46);
  expect(Object.keys(full.added_clips[0]).sort()).toEqual(["end", "id", "start", "text", "type"]);
  expect(full.added_clips_common).toMatchObject({ case: "upper", size: 60, color: "#ffffff", outline: 8, style: { font: "Arial Black", highlight: "#ffd27a" }, transform: { y: 0.08 } });
  // Whole again with the common part merged back in.
  const one = describeProject(after).tracks.flatMap((t) => t.clips).find((c) => c.id === full.added_clips[5].id);
  expect(withShared(full.added_clips[5], full.added_clips_common)).toEqual({ ...one, track: after.tracks[0].id });
  // The answer the film test paid 14 KB for: under a third of that now.
  const size = JSON.stringify(full).length;
  const plain = JSON.stringify(describeProject(after).tracks[0].clips).length;
  expect(size).toBeLessThan(plain / 3);
});

it("keeps short lists and lists with nothing worth sharing as they are", () => {
  const three = [{ id: "a", type: "text", start: 0, end: 1, size: 60 }, { id: "b", type: "text", start: 1, end: 2, size: 60 }, { id: "c", type: "text", start: 2, end: 3, size: 60 }];
  expect(shareCommon(three)).toEqual({ items: three });
  const apart = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, type: "video", start: i, end: i + 1, in: i }));
  expect(shareCommon(apart).common).toBeUndefined();
});

it("shares the common part of objects that differ in one field", () => {
  const list = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, type: "text", start: i, end: i + 1, style: { font: "Arial Black", maxWidth: 0.62, lineHeight: 1, highlight: i < 2 ? "#ffffff" : "#ffd27a" }, track: "t_captions_track" }));
  const s = shareCommon(list);
  expect(s.common).toEqual({ style: { font: "Arial Black", maxWidth: 0.62, lineHeight: 1 }, track: "t_captions_track" });
  expect(s.items[0]).toEqual({ id: "c0", type: "text", start: 0, end: 1, style: { highlight: "#ffffff" } });
  expect(s.items.map((x) => withShared(x, s.common))).toEqual(list);
});

it("counts markers that moved together with their clip, and lists the rest", () => {
  const bar = (id: string, at: number, label = "Bar") => ({ id, frame: at * 30, at, label, color: "#ff9f43", clip: "c_song" });
  const was = new Map([bar("m1", 24), bar("m2", 26), bar("m3", 28), bar("m4", 36, "Drop"), { ...bar("m5", 30), color: "#000000" }].map((m) => [m.id, m]));
  // cut_music: the bars after the cut move 8 s earlier, onto the song's second piece.
  const now = [bar("m1", 16), bar("m2", 18), bar("m3", 20), bar("m4", 28, "Drop"), bar("m5", 30)].map((m) => (m.id === "m5" ? m : { ...m, clip: "c_song_2" }));
  const r = markerMoves(was, now);
  expect(r.moved).toEqual([{ clip: "c_song_2", by: -8, count: 4, labels: { Bar: 3, Drop: 1 }, from: 16, to: 28 }]);
  // A marker that changed more than its time is listed whole.
  expect(r.listed.map((m) => m.id)).toEqual(["m5"]);
});

it("gives alike check findings once with every clip and time, and leaves the rest", () => {
  const f = (id: string, at: number) => ({ rule: "text_under_app_buttons", level: "warning", clip_id: id, at, message: `"${id}" reaches into the top 14%`, fix: "move it" });
  const answer = { ok: true, findings: [f("a", 1), { rule: "too_many_fonts", level: "warning", message: "3 fonts", fix: "one font" }, f("b", 2), f("c", 3)] };
  const g = groupFindings(answer);
  expect(g.findings).toEqual([{ rule: "text_under_app_buttons", level: "warning", count: 3, message: '3 alike; the first: "a" reaches into the top 14%', fix: "move it", clip_ids: ["a", "b", "c"], at: [1, 2, 3] }, answer.findings[1]]);
  // Two alike stay apart.
  const two = { findings: [f("a", 1), f("b", 2)] };
  expect(groupFindings(two)).toBe(two);
});

it("turns each line's duck of the music clip under it into one duck of the music track", () => {
  const line = (id: string, music: string, lu: number) => ({ voice_clip: id, start: 0, end: 1, verdict: `only ${lu} LU over the music`, fixes: [{ problem: `only ${lu} LU over the music`, tool: "duck_under_speech", args: { clip_id: music, min_line_lu: 10 } }] });
  const review = { lines: [line("v1", "c_song_a", 3.4), line("v2", "c_song_a", 0.8), line("v3", "c_song_b", -3.4), { voice_clip: "v4", start: 2, end: 3, verdict: "ok" }], summary: { ok: 1 } };
  const r = oneDuck(review, (id) => (id.startsWith("c_song") ? "t_music" : undefined));
  expect(r.summary.fixes).toEqual([{ problem: "3 lines short of their margin over the music: one duck on the music track holds every line", tool: "duck_under_speech", args: { track_id: "t_music", min_line_lu: 10 }, lines: ["v1", "v2", "v3"] }]);
  expect(r.lines[0].fixes).toEqual([{ problem: "only 3.4 LU over the music", tool: "duck_under_speech", see: "summary.fixes" }]);
  expect(r.lines[3]).toBe(review.lines[3]);
});

it("answers each reviewed line with what decides its verdict", () => {
  const full = {
    voice_clip: "v1", start: 2.9, end: 7.367, voice: "af_heart", script: "Day one.", heard: "Day one,", match: 1, differences: [],
    pace: { target_words_per_second: [2.3, 2.8], over_speech: { words_per_second: 2.56, syllables_per_second: 2.56 }, over_clip: { words_per_second: 2.46, syllables_per_second: 2.46 }, on_target: true },
    lead_silence: 0.05, tail_silence: 0.12, longest_pause: 0.53, loudness_lufs: -17.3, true_peak_dbtp: -4.9, pitch: { median_hz: 204, range_st: 7.5 }, voice_above_music_lu: 14.7, verdict: "ok",
  };
  const r = reviewSummary({ lines: [full], summary: {} });
  expect(r.lines[0]).toEqual({ voice_clip: "v1", start: 2.9, end: 7.367, verdict: "ok", words_per_second: 2.56, target_words_per_second: [2.3, 2.8], loudness_lufs: -17.3, voice_above_music_lu: 14.7 });
  // A line heard differently keeps what was heard.
  const off = reviewSummary({ lines: [{ ...full, heard: "Day won,", match: 0.5, differences: [{ kind: "misheard", script: "one", heard: "won" }] }], summary: {} });
  expect(off.lines[0]).toMatchObject({ script: "Day one.", heard: "Day won,", match: 0.5 });
  // A line to fix says so once: its problems are in its fixes.
  const fix = { problem: "quieter than the other lines by 3.2 LU", tool: "set_param", args: { clip_ids: ["v1"], path: "volume", value: 1.445 } };
  const failing = reviewSummary({ lines: [{ ...full, verdict: fix.problem, fixes: [fix] }], summary: {} });
  expect(failing.lines[0]).toMatchObject({ verdict: "to fix", fixes: [fix] });
});
