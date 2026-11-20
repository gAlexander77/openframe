// Credits rolls, caption keywords and the progress bar (ADR-147).
import { describe, expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { creditsRoll, creditsStyle, isRoll } from "./credits";
import { checkProject } from "./designCheck";
import { interpolate } from "./keyframes";
import { createProject } from "./project/defaults";
import { clipEnd } from "./project/ops";
import type { ColorClip, Project, TextClip } from "./project/types";

const fps = { num: 30, den: 1 };
const titles = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === "text");
/** A title's center, heights of the frame from its middle, at a timeline frame. */
const yAt = (c: TextClip, frame: number) => interpolate(c.keyframes!["transform.y"], frame - c.start);
/** Size 48 at line height 1.5: lines 72 px tall on a 1080 frame. */
const CREDITS_STYLE = { size: 48, bold: false, lineHeight: 1.5 };
const names = (n: number) => Array.from({ length: n }, (_, i) => `Name ${i + 1}`).join("\n");

describe("a credits roll", () => {
  it("travels from below the frame to above it, each line crossing in six seconds by default", () => {
    const p = createProject({ fps });
    const roll = creditsRoll(p, "Directed by\nJordan Lee", 300, CREDITS_STYLE);
    expect(roll.clips).toHaveLength(1);
    const [c] = roll.clips;
    // Two lines of size 48 at line height 1.5: 144 px of a 1080 frame.
    const h = 144 / 1080;
    expect([c.start, c.name, roll.lines, roll.lineSeconds]).toEqual([300, "Credits", 2, 6]);
    expect(yAt(c, c.start)).toBeCloseTo(0.5 + h / 2, 5);
    expect(yAt(c, clipEnd(c) - 1)).toBeLessThan(-0.5 - h / 2 + 0.01);
    expect(roll.frames).toBe(Math.ceil((1 + h) * 6 * 30));
    expect(isRoll(c)).toBe(true);
  });

  it("is cut into blocks that ride one line of motion, a gap for every empty line", () => {
    const p = createProject({ fps });
    const roll = creditsRoll(p, `${names(8)}\n${names(3)}\n\n\nThanks`, 0, CREDITS_STYLE);
    expect(roll.clips.map((c) => c.text.split("\n").length)).toEqual([8, 3, 1]);
    const [a, b, c] = roll.clips;
    const line = 72 / 1080;
    // Where two blocks are both up, their centers stay the same distance apart.
    for (const f of [b.start, b.start + 40, clipEnd(a) - 1]) expect(yAt(b, f) - yAt(a, f)).toBeCloseTo((8 * line) / 2 + (3 * line) / 2, 5);
    for (const f of [c.start, clipEnd(b) - 1]) expect(yAt(c, f) - yAt(b, f)).toBeCloseTo((3 * line) / 2 + 2 * line + line / 2, 5);
    // Each is a clip only while it crosses: the last enters after the first.
    expect(c.start).toBeGreaterThan(a.start + 60);
    expect(new Set(roll.clips.map((x) => x.group)).size).toBe(1);
  });

  it("takes the length given, and says how long a line is up", () => {
    const p = createProject({ fps });
    const roll = creditsRoll(p, names(4), 0, CREDITS_STYLE, { frames: 150 });
    expect(roll.frames).toBe(150);
    expect(roll.lineSeconds).toBeCloseTo(5 / (1 + (4 * 72) / 1080), 1);
    expect(clipEnd(roll.clips[0])).toBeLessThanOrEqual(151);
  });

  it("add_credits places the blocks on rows of their own, and the check does not call a roll too short or out of the safe area", () => {
    const report: CommandReport = {};
    const p = runCommand(createProject({ fps }), "add_credits", { text: names(20), start: 2 }, report);
    const made = titles(p);
    expect(made).toHaveLength(3);
    // Its own type passes the app's own check: a little over the readable floor (49 on 16:9, 31 on 9:16: 56 and 35).
    expect(made.every((c) => c.style.size === 56 && !c.style.bold && c.transform.x === 0)).toBe(true);
    expect(creditsStyle({ width: 1080, height: 1920 }).size).toBe(35);
    // Blocks on screen together never share a track.
    for (const t of p.tracks) for (const [i, c] of t.clips.entries()) for (const d of t.clips.slice(i + 1)) expect(c.start >= clipEnd(d) || d.start >= clipEnd(c)).toBe(true);
    expect(report.notes![0]).toMatch(/^20 lines roll for [\d.]+ s, each on screen 6 s\.$/);
    const rules = checkProject(p, "any").findings.map((f) => f.rule);
    expect(rules).not.toContain("text_too_short");
    expect(rules).not.toContain("text_outside_title_safe");
    expect(rules).not.toContain("text_too_small");
    expect(() => runCommand(createProject({ fps }), "add_credits", { text: " \n ", start: 0 })).toThrow("text has no lines");
    const fast: CommandReport = {};
    runCommand(createProject({ fps }), "add_credits", { text: names(30), start: 0, duration: 4 }, fast);
    expect(fast.notes![0]).toContain("too fast to read");
  });
});

describe("highlight_words", () => {
  const captioned = () => runCommand(createProject({ fps }), "add_captions", { captions: [{ start: 0, end: 2, text: "It is free today" }, { start: 2, end: 4, text: "Freedom is not FREE" }] });

  it("styles each whole-word match in every caption, in any case", () => {
    const report: CommandReport = {};
    const p = runCommand(captioned(), "highlight_words", { words: ["free", "Today", "never"], color: "#ff0", scale: 1.2 }, report);
    const [a, b] = titles(p);
    expect(a.style.runs!.map((r) => [a.text.slice(r.start, r.end), r.color, r.scale])).toEqual([["free", "#ff0", 1.2], ["today", "#ff0", 1.2]]);
    // "Freedom" holds free but is another word.
    expect(b.style.runs!.map((r) => b.text.slice(r.start, r.end))).toEqual(["FREE"]);
    expect(report.notes![0]).toBe('Styled "free" 2 times, "Today" 1 time. Nothing says "never".');
  });

  it("uses a marker yellow when no style is given, and clear takes it off", () => {
    const p = runCommand(captioned(), "highlight_words", { words: ["free"] });
    expect(titles(p)[0].style.runs).toEqual([{ start: 6, end: 10, color: "#ffd84d" }]);
    expect(titles(runCommand(p, "highlight_words", { words: ["free"], clear: true })).flatMap((c) => c.style.runs)).toEqual([]);
  });

  it("styles titles by clip_ids, and says when there is nothing to style", () => {
    const p = runCommand(createProject({ fps }), "add_text", { text: "Save 20% now", start: 0, duration: 2 });
    expect(() => runCommand(p, "highlight_words", { words: ["now"] })).toThrow("there are no captions");
    const id = titles(p)[0].id;
    expect(titles(runCommand(p, "highlight_words", { words: ["20%"], clip_ids: [id], weight: 900 }))[0].style.runs).toEqual([{ start: 5, end: 8, weight: 900 }]);
    expect(() => runCommand(captioned(), "highlight_words", { words: ["never"] })).toThrow('no caption says "never"');
  });
});

describe("add_progress_bar", () => {
  it("draws a line along the bottom edge that fills over the whole video", () => {
    let p: Project = { ...createProject({ fps }), assets: [{ id: "v", kind: "video", name: "talk.mp4", src: "talk.mp4", duration: 20, hasVideo: true, hasAudio: true }] };
    expect(() => runCommand(p, "add_progress_bar", {})).toThrow("the timeline is empty");
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 6 });
    p = runCommand(p, "add_progress_bar", { color: "#ff3366", thickness: 12 });
    const bar = p.tracks.flatMap((t) => t.clips).find((c): c is ColorClip => c.type === "color")!;
    expect([bar.start, bar.duration, bar.shape, bar.name]).toEqual([0, 180, { kind: "line", width: 1, height: 0.1, stroke: { color: "#ff3366", width: 12 } }, "Progress bar"]);
    expect(bar.keyframes).toEqual({ "shape.draw": [{ f: 0, v: 0 }, { f: 179, v: 1 }] });
    expect(bar.transform.y).toBeCloseTo(0.5 - 6 / 1080, 6);
    const top = runCommand(p, "add_progress_bar", { edge: "top", start: 1, end: 3 });
    const made = top.tracks.flatMap((t) => t.clips).filter((c): c is ColorClip => c.type === "color").find((c) => c.id !== bar.id)!;
    expect([made.start, made.duration, made.transform.y < 0]).toEqual([30, 60, true]);
  });
});
