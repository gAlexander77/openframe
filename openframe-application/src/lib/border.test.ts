import { describe, expect, it } from "vitest";
import { BORDER_DEFAULT, cleanBorder, floodSteps, resolveBorder } from "./border";
import { createColorClip } from "./project/defaults";
import type { VisualClip } from "./project/types";

const clip = (extra: Partial<VisualClip> = {}) => ({ ...createColorClip("#fff", 0, 30), ...extra }) as VisualClip;

describe("cleanBorder", () => {
  it("fills what is missing from the defaults and clamps the rest", () => {
    expect(cleanBorder({})).toEqual(BORDER_DEFAULT);
    expect(cleanBorder({ color: "#00000080", width: 900, opacity: -1 })).toEqual({ color: "#00000080", width: 200, opacity: 0 });
    expect(cleanBorder({ color: "chalk", width: "wide" })).toEqual(BORDER_DEFAULT);
  });

  it("is no border when it is not an object", () => {
    expect(cleanBorder(undefined)).toBeUndefined();
    expect(cleanBorder("white")).toBeUndefined();
    expect(cleanBorder([8])).toBeUndefined();
  });
});

describe("resolveBorder", () => {
  it("reads keyed width and opacity at the frame", () => {
    const c = clip({ border: { color: "#fff", width: 8, opacity: 1 }, keyframes: { "border.width": [{ f: 0, v: 0 }, { f: 10, v: 20 }] } });
    expect(resolveBorder(c, 5)).toEqual({ color: "#fff", width: 10, opacity: 1 });
  });

  it("is nothing when it would not show", () => {
    expect(resolveBorder(clip(), 0)).toBeUndefined();
    expect(resolveBorder(clip({ border: { ...BORDER_DEFAULT, width: 0 } }), 0)).toBeUndefined();
    expect(resolveBorder(clip({ border: { ...BORDER_DEFAULT, opacity: 0 } }), 0)).toBeUndefined();
    expect(resolveBorder(clip({ border: { ...BORDER_DEFAULT, color: "transparent" } }), 0)).toBeUndefined();
  });
});

describe("floodSteps", () => {
  it("halves down to 1 from a step that carries the edge past the border, then 1 again", () => {
    expect(floodSteps(8)).toEqual([8, 4, 2, 1, 1]);
    expect(floodSteps(30)).toEqual([16, 8, 4, 2, 1, 1]);
    expect(floodSteps(0.5)).toEqual([2, 1, 1]);
    // The steps add up past the reach: every pixel within it hears of the edge.
    for (const reach of [1, 7, 15, 16, 63, 200, 400]) {
      const steps = floodSteps(reach);
      expect(steps.slice(0, -1).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(reach + 1);
      expect(steps.at(-1)).toBe(1);
    }
  });
});
