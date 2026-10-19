import { describe, expect, it } from "vitest";
import { createColorClip } from "./project/defaults";
import type { VisualClip } from "./project/types";
import { cleanShadow, resolveShadow, SHADOW_DEFAULT } from "./shadow";

const clip = (extra: Partial<VisualClip> = {}) => ({ ...createColorClip("#fff", 0, 30), ...extra }) as VisualClip;

describe("cleanShadow", () => {
  it("fills what is missing from the defaults and clamps the rest", () => {
    expect(cleanShadow({})).toEqual(SHADOW_DEFAULT);
    expect(cleanShadow({ color: "#ff000080", blur: 9000, x: -5000, y: 12, opacity: 3 })).toEqual({ color: "#ff000080", blur: 600, x: -2000, y: 12, opacity: 1 });
    expect(cleanShadow({ color: "not a color", blur: "big" })).toEqual(SHADOW_DEFAULT);
  });

  it("drops what is not a shadow", () => {
    expect(cleanShadow(undefined)).toBeUndefined();
    expect(cleanShadow("drop")).toBeUndefined();
    expect(cleanShadow([1, 2])).toBeUndefined();
  });
});

describe("resolveShadow", () => {
  it("reads keyed numbers at the frame", () => {
    const c = clip({ shadow: { color: "#000", blur: 40, x: 0, y: 10, opacity: 0.5 }, keyframes: { "shadow.y": [{ f: 0, v: 0 }, { f: 10, v: 40 }], "shadow.opacity": [{ f: 0, v: 0 }, { f: 10, v: 1 }] } });
    expect(resolveShadow(c, 5)).toEqual({ color: "#000", blur: 40, x: 0, y: 20, opacity: 0.5 });
  });

  it("is nothing when there is none, or it cannot be seen", () => {
    expect(resolveShadow(clip(), 0)).toBeUndefined();
    expect(resolveShadow(clip({ shadow: { ...SHADOW_DEFAULT, opacity: 0 } }), 0)).toBeUndefined();
    expect(resolveShadow(clip({ shadow: { ...SHADOW_DEFAULT, color: "#00000000" } }), 0)).toBeUndefined();
  });
});
