import { textStyleAt } from "./textAnim";
import { versionProject } from "./versions";
import { describe, expect, it } from "vitest";
import { baselineShifts, cleanRuns, measureRuns, runBoxes, runStyle, shiftRuns, styleRange } from "./textRuns";
import { createProject, createTextClip, createTrack, normalizeProject } from "./project/defaults";

describe("inline runs", () => {
  it("cleans untrusted values and merges overlapping fields", () => {
    expect(cleanRuns([null, { start: -2, end: 99, weight: 999 }, { start: 2, end: 4, italic: true }, { start: 4, end: 2, color: "red" }], 6)).toEqual([
      { start: 0, end: 2, weight: 900 }, { start: 2, end: 4, weight: 900, italic: true }, { start: 4, end: 6, weight: 900 },
    ]);
    const p = normalizeProject({ tracks: [{ kind: "video", clips: [{ type: "text", start: 0, duration: 30, text: "hello", style: { runs: [{ start: 1, end: 99, color: "red", scale: 99 }] } }] }] });
    expect(p.tracks[0].clips[0]).toMatchObject({ style: { runs: [{ start: 1, end: 5, color: "red", scale: 4 }] } });
  });
  it("shifts insertion before, inherits within, excludes boundaries and trims deletion", () => {
    const runs = [{ start: 3, end: 8, color: "red" }];
    expect(shiftRuns(runs, "AI built in", "The AI built in")[0]).toMatchObject({ start: 7, end: 12 });
    expect(shiftRuns(runs, "AI built in", "AI buXXilt in")[0]).toMatchObject({ start: 3, end: 10 });
    expect(shiftRuns(runs, "AI built in", "AI XXbuilt in")[0]).toMatchObject({ start: 5, end: 10 });
    expect(shiftRuns(runs, "AI built in", "AI builtXX in")[0]).toMatchObject({ start: 3, end: 8 });
    expect(shiftRuns(runs, "AI built in", "AI bt in")[0]).toMatchObject({ start: 3, end: 5 });
    expect(shiftRuns(runs, "AI built in", "AI  in")).toEqual([]);
  });
  it("clears only a chosen range and lets solid color override gradient", () => {
    const runs = [{ start: 0, end: 6, gradient: { from: "red", to: "blue", angle: 0 } }];
    expect(styleRange("abcdef", runs, 2, 4, {}, true)).toEqual([{ ...runs[0], end: 2 }, { ...runs[0], start: 4 }]);
    expect(styleRange("abcdef", runs, 2, 4, { color: "green" })[1]).toEqual({ start: 2, end: 4, color: "green" });
  });
  it("measures each font segment once, at the correct offset", () => {
    const style = { ...createTextClip("abcdef", 0, 30).style, size: 10, weight: 400, runs: [{ start: 2, end: 4, weight: 800, scale: 2 }] };
    expect(measureRuns("abcdef", 0, style, (text, s) => text.length * s.size * s.weight! / 400)).toBe(120);
    expect(measureRuns("cd", 2, style, (text, s) => text.length * s.size)).toBe(40);
    const clip = createTextClip("abcdef", 0, 60, { ...style, runs: [{ start: 2, end: 4, scale: 2, color: "#00ff00" }] });
    clip.keyframes = { "style.size": [{ f: 0, v: 10 }, { f: 20, v: 30 }], "style.letterSpacing": [{ f: 0, v: 0 }, { f: 20, v: 10 }], "style.color": [{ f: 0, v: 0xff0000 }, { f: 20, v: 0x0000ff }] };
    const animated = textStyleAt(clip, 10);
    expect(runStyle(animated, 2)).toMatchObject({ size: 40, letterSpacing: 5, color: "#00ff00" });
    expect(runStyle(animated, 0)).toMatchObject({ size: 20, letterSpacing: 5, color: "#800080" });
  });
});

it("keeps ranges when version export reflows a title", () => {
  const clip = createTextClip("AI built in", 0, 120);
  clip.style.runs = [{ start: 9, end: 11, color: "#00ff00", weight: 800 }];
  const p = createProject(); p.tracks = [{ ...createTrack("video", "Titles"), clips: [clip] }];
  const q = versionProject(p, { ratio: "9:16" });
  expect(q.tracks[0].clips[0]).toMatchObject({ text: clip.text, style: { runs: clip.style.runs } });
  expect(p.width).not.toBe(q.width);
});

it("preserves a run between two equal-length replacements", () => {
  expect(shiftRuns([{ start: 4, end: 9, color: "red" }], "one STYLE end", "one\nSTYLE\nend")).toEqual([{ start: 4, end: 9, color: "red" }]);
});
it("maps surviving run characters across separate unequal edits", () => {
  expect(shiftRuns([{ start: 4, end: 9, color: "red" }], "one STYLE end", "first STYLE ending")).toEqual([{ start: 6, end: 11, color: "red" }]);
});

describe("run geometry (ADR-099)", () => {
  it("gives a run's gradient its own letters' box, across the lines it wraps onto", () => {
    // "Big SALE today / only at OpenFrame": OpenFrame (23..32) on line 2 and
    // a run wrapping from line 1 (9..18, "today only").
    const runs = [{ start: 9, end: 19, gradient: { from: "red", to: "blue", angle: 0 } }, { start: 23, end: 32, gradient: { from: "cyan", to: "violet", angle: 0 } }];
    const pieces = [
      { start: 0, x: 100, width: 300, y: 50 }, { start: 9, x: 400, width: 200, y: 50 },
      { start: 15, x: 120, width: 90, y: 150 }, { start: 19, x: 210, width: 120, y: 150 }, { start: 23, x: 330, width: 260, y: 150 },
    ];
    const boxes = runBoxes(runs, pieces, 100);
    // The word's own box: its first letter at the gradient's start, its last at the end.
    expect(boxes.get(runs[1])).toEqual({ left: 330, top: 100, right: 590, bottom: 200 });
    // A wrapped run: the box around both of its pieces.
    expect(boxes.get(runs[0])).toEqual({ left: 120, top: 0, right: 600, bottom: 200 });
    expect(boxes.size).toBe(2);
  });

  it("puts a line's pieces on one baseline: the tallest piece's", () => {
    // "Big SALE today" with SALE at 1.4x: centered alone, SALE's baseline
    // would sit 0.4 x 30 = 12 px lower than its neighbors'.
    const shifts = baselineShifts([{ y: 60, above: 30 }, { y: 60, above: 42 }, { y: 60, above: 30 }, { y: 160, above: 30 }]);
    expect(shifts).toEqual([12, 0, 12, 0]);
    // A smaller run moves down onto the line's baseline too.
    expect(baselineShifts([{ y: 0, above: 30 }, { y: 0, above: 15 }])).toEqual([0, 15]);
  });
});

describe("run geometry under letter spacing (ADR-108)", () => {
  it("ends a run's gradient on its last letter, not the spacing after it", () => {
    // "Big SALE today" tracked 30: each piece's width is its advance, which
    // counts 30 after its last letter too (canvas and CSS both do), so SALE's
    // gradient ended 30 px past its E and the E stopped short of `to`.
    const runs = [{ start: 4, end: 8, gradient: { from: "cyan", to: "violet", angle: 0 } }];
    const pieces = [{ start: 0, text: "Big ", x: 100, width: 230, y: 50 }, { start: 4, text: "SALE", x: 330, width: 520, y: 50 }, { start: 8, text: " today", x: 850, width: 400, y: 50 }];
    expect(runBoxes(runs, pieces, 100, 30).get(runs[0])).toEqual({ left: 330, top: 0, right: 820, bottom: 100 });
    // Untracked, the advance is the letters.
    expect(runBoxes(runs, pieces, 100).get(runs[0])!.right).toBe(850);
  });
});
