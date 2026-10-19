// Keyed title styles in the plan (ADR-071): a title that is not centered
// grows from its aligned side. Its own file: it swaps in a text measure.
import { describe, expect, it } from "vitest";
import { createProject, createTextClip } from "../project/defaults";
import { addClip } from "../project/ops";
import type { Clip, TextStyle } from "../project/types";
import { planFrame, type Layer } from "./plan";
import { setTextMeasure } from "./size";

// Ten pixels a letter plus the spacing, at 1080p: enough to see the growth.
setTextMeasure((c) => ({ width: c.text.length * (10 + c.style.letterSpacing), height: c.style.size }));

const at = (style: Partial<TextStyle>, f: number, extra: Partial<Clip> = {}): Layer => {
  let p = createProject({ fps: { num: 30, den: 1 } });
  const clip = { ...createTextClip("TRACKING", 0, 30, style), id: "t", keyframes: { "style.letterSpacing": [{ f: 0, v: 0 }, { f: 10, v: 20 }] }, ...extra } as Clip;
  p = addClip(p, p.tracks[0].id, clip);
  const item = planFrame(p, f)[0];
  return (item.kind === "layer" ? item.layer : null)!;
};

describe("a keyed title's growth", () => {
  it("keeps a left-aligned title's left edge and a right-aligned one's right edge", () => {
    // Eight letters, 20 px wider each at the end: 160 px wider, 80 a side.
    expect(at({ align: "left" }, 0).x).toBeCloseTo(0, 9);
    expect(at({ align: "left" }, 10).x * 1920).toBeCloseTo(80, 6);
    expect(at({ align: "right" }, 10).x * 1920).toBeCloseTo(-80, 6);
    expect(at({ align: "center" }, 10).x).toBeCloseTo(0, 9);
  });

  it("turns, scales and mirrors with the title", () => {
    const l = at({ align: "left" }, 10, { transform: { x: 0, y: 0, scale: 2, rotation: 90, flipX: false, flipY: false } } as Partial<Clip>);
    expect(l.x * 1920).toBeCloseTo(0, 6);
    expect(l.y * 1080).toBeCloseTo(160, 6);
    const m = at({ align: "left" }, 10, { transform: { x: 0, y: 0, scale: 1, rotation: 0, flipX: true, flipY: false } } as Partial<Clip>);
    expect(m.x * 1920).toBeCloseTo(-80, 6);
  });
});
