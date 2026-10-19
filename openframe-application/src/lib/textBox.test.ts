import { describe, expect, it } from "vitest";
import { editBox, type TextLayout } from "./textBox";

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
    const c = editBox(layout, "center", still, viewer, 1920);
    expect(c.textWidth).toBe(wrap);
    expect(c.left + c.textWidth / 2).toBe(c.width / 2); // centered on the box
    const l = editBox(layout, "left", still, viewer, 1920);
    expect(l.left).toBe(10); // the pad: lines start where the raster's do
    const r = editBox(layout, "right", still, viewer, 1920);
    expect(r.left + r.textWidth).toBe(r.width - 10);
  });

  it("trims the wrap-wide text area to half an em past the box", () => {
    const c = editBox(layout, "center", still, viewer, 1920); // 48 px type
    expect([c.clipLeft, c.clipRight]).toEqual([224 - 24, 224 - 24]);
    const l = editBox(layout, "left", still, viewer, 1920);
    expect([l.clipLeft, l.clipRight]).toEqual([0, 10 + 768 - 320 - 24]);
    const wide = editBox({ ...layout, width: 1600, textWidth: 1560 }, "center", still, viewer, 1920);
    expect([wide.clipLeft, wide.clipRight]).toEqual([0, 0]);
  });

  it("widens the text area to a word longer than the wrap width", () => {
    const b = editBox({ ...layout, width: 2040, textWidth: 2000 }, "left", still, viewer, 1920);
    expect(b.textWidth).toBe(1000);
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
