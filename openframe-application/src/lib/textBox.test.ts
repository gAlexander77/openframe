import { describe, expect, it } from "vitest";
import { editBox, letterWidth, lineStart, type TextLayout } from "./textBox";

// A two-line title laid out for a 1920x1080 canvas: 96 px type, 600 px of
// text in a 640 px raster, wrapping at 80% of the width.
const layout: TextLayout = {
  width: 640,
  height: 270,
  pad: 20,
  textWidth: 600,
  wrapWidth: 1536,
  size: 96,
  lineHeight: 115,
  letterSpacing: 4,
  baselineShift: 10,
};
// The same, untracked: where the area goes for wrapping alone.
const flat: TextLayout = { ...layout, letterSpacing: 0 };
const still = { x: 0, y: 0, scale: 1, rotation: 0 };
const viewer = { width: 960, height: 540 }; // the canvas at half size

describe("editBox", () => {
  it("centers the raster's box where the layer's center is", () => {
    const b = editBox(layout, "center", still, viewer, 1920);
    expect([b.cx, b.cy, b.width, b.height]).toEqual([480, 270, 320, 135]);
    expect(editBox(layout, "center", { ...still, x: 0.25, y: -0.1 }, viewer, 1920)).toMatchObject({ cx: 720, cy: 216 });
  });

  it("scales type, line pitch and spacing with the viewer zoom and the layer's scale", () => {
    const b = editBox(layout, "center", { ...still, scale: 1.5 }, viewer, 1920);
    expect([b.fontSize, b.lineHeight, b.letterSpacing]).toEqual([72, 86.25, 3]);
    expect(b.width).toBe(480);
  });

  it("anchors the wrap-wide text area the way the alignment anchors the lines", () => {
    const wrap = 1536 / 2;
    const c = editBox(flat, "center", still, viewer, 1920);
    expect(c.textWidth).toBe(wrap);
    expect(c.left + c.textWidth / 2).toBe(c.width / 2); // centered on the box
    const l = editBox(flat, "left", still, viewer, 1920);
    expect(l.left).toBe(10); // the pad: lines start where the raster's do
    const r = editBox(flat, "right", still, viewer, 1920);
    expect(r.left + r.textWidth).toBe(r.width - 10);
  });

  it("trims the wrap-wide text area to half an em past the box", () => {
    const c = editBox(flat, "center", still, viewer, 1920); // 48 px type
    expect([c.clipLeft, c.clipRight]).toEqual([224 - 24, 224 - 24]);
    const l = editBox(flat, "left", still, viewer, 1920);
    expect([l.clipLeft, l.clipRight]).toEqual([0, 10 + 768 - 320 - 24]);
    const wide = editBox({ ...flat, width: 1600, textWidth: 1560 }, "center", still, viewer, 1920);
    expect([wide.clipLeft, wide.clipRight]).toEqual([0, 0]);
  });

  it("widens the text area to a word longer than the wrap width", () => {
    const b = editBox({ ...flat, width: 2040, textWidth: 2000 }, "left", still, viewer, 1920);
    expect(b.textWidth).toBe(1000);
    // Tracked, the area is as wide as CSS lays the word: its letters and
    // the spacing after the last one, so the word never wraps in the editor.
    expect(editBox({ ...layout, width: 2040, textWidth: 2000 }, "left", still, viewer, 1920).textWidth).toBe((2000 + 4) / 2);
  });

  it("drops the text area by the baseline shift, under the pad, and spans the lines", () => {
    const b = editBox(layout, "center", still, viewer, 1920);
    expect(b.top).toBe(10 + 5);
    expect(b.textHeight).toBe((270 - 40) / 2);
  });

  it("keeps the turn, and sizes a mirrored scale as its magnitude", () => {
    const b = editBox(layout, "center", { ...still, rotation: -30, scale: -1 }, viewer, 1920);
    expect(b.rotation).toBe(-30);
    expect(b.width).toBe(320);
  });
});

// The Claude film test's NORTHBOUND, tracked 34 at 1080p, drew about 16 px
// left of center: the canvas measures and centers a line's advance, which
// ends with one spacing after the last letter (measured in Edge: NORTH in
// 100 px Arial tracked 34 advanced 5 x 34 further, and drew 17 px left).
describe("tracked lines (ADR-105)", () => {
  const advance = 1000, ls = 34, pad = 20;
  const lw = letterWidth(advance, ls, "NORTHBOUND");

  it("measures a line on its letters, without the spacing after the last", () => {
    expect(lw).toBe(966);
    expect(letterWidth(advance, -4, "AB")).toBe(1004);
    expect(letterWidth(0, ls, "")).toBe(0);
  });

  it("centers a line's letters on the raster, and ends a right-aligned one at the pad", () => {
    const w = lw + pad * 2;
    expect(lineStart("center", lw, w, pad) + lw / 2).toBe(w / 2);
    expect(lineStart("right", lw, w, pad) + lw).toBe(w - pad);
    expect(lineStart("left", lw, w, pad)).toBe(pad);
  });

  it("puts the editor's typed letters on the drawn ones, though CSS aligns the trailing spacing", () => {
    const tracked: TextLayout = { ...layout, width: lw + pad * 2, textWidth: lw, letterSpacing: ls };
    const k = viewer.width / 1920;
    for (const align of ["center", "right", "left"] as const) {
      const b = editBox(tracked, align, still, viewer, 1920);
      // Where CSS starts the line: its whole advance aligned in the area.
      const css = align === "left" ? b.left : align === "right" ? b.left + b.textWidth - advance * k : b.left + (b.textWidth - advance * k) / 2;
      expect(css, align).toBeCloseTo(lineStart(align, lw, tracked.width, pad) * k, 9);
    }
  });
});
