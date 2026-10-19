import { describe, expect, it } from "vitest";
import { createTextClip } from "./project/defaults";
import type { TextClip } from "./project/types";
import { colorAt, colorKey, keyColor, styleKeyed, textStyleAt } from "./textAnim";

const title = (keyframes?: TextClip["keyframes"]): TextClip => ({ ...createTextClip("Hello", 0, 60, { size: 80, color: "#ffffff" }), ...(keyframes ? { keyframes } : {}) });

describe("color keys", () => {
  it("are 0xRRGGBB numbers, read from any CSS color", () => {
    expect(colorKey("#ff3366")).toBe(0xff3366);
    expect(colorKey("#f36")).toBe(0xff3366);
    expect(colorKey("white")).toBe(0xffffff);
    expect(colorKey("rgb(0, 128, 255)")).toBe(0x0080ff);
    expect(colorKey("nope")).toBeUndefined();
    expect(keyColor(0xff3366)).toBe("#ff3366");
    expect(keyColor(0x80)).toBe("#000080");
    expect(keyColor(-5)).toBe("#000000");
    expect(keyColor(2 ** 30)).toBe("#ffffff");
  });

  it("move channel by channel in the key's ease, holding past the ends", () => {
    const keys = [{ f: 10, v: 0x000000 }, { f: 20, v: 0xff8040 }];
    expect(colorAt(keys, 0)).toBe("#000000");
    expect(colorAt(keys, 15)).toBe("#804020");
    expect(colorAt(keys, 30)).toBe("#ff8040");
    // Not the packed number's midpoint, which would be another hue.
    expect(colorAt([{ f: 0, v: 0x0000ff }, { f: 10, v: 0xff0000 }], 5)).toBe("#800080");
    const eased = colorAt([{ f: 0, v: 0, ease: "easeIn" }, { f: 10, v: 0xffffff }], 5);
    expect(parseInt(eased.slice(1, 3), 16)).toBeLessThan(0x80);
    // An overshooting ease stays a color.
    expect(colorAt([{ f: 0, v: 0xffffff, ease: "elastic" }, { f: 10, v: 0xfefefe }], 2)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("textStyleAt", () => {
  it("is the stored style itself when nothing is keyed", () => {
    const c = title({ opacity: [{ f: 0, v: 0 }, { f: 10, v: 1 }] });
    expect(styleKeyed(c)).toBe(false);
    expect(textStyleAt(c, 5)).toBe(c.style);
  });

  it("applies keyed size, spacing and color", () => {
    const c = title({
      "style.size": [{ f: 0, v: 80 }, { f: 10, v: 120 }],
      "style.letterSpacing": [{ f: 0, v: 0 }, { f: 20, v: 24 }],
      "style.color": [{ f: 0, v: 0xffffff }, { f: 10, v: 0xffd23f }],
    });
    expect(styleKeyed(c)).toBe(true);
    const s = textStyleAt(c, 5);
    expect(s.size).toBe(100);
    expect(s.letterSpacing).toBe(6);
    expect(s.color).toBe("#ffe99f");
    expect(textStyleAt(c, 40)).toMatchObject({ size: 120, letterSpacing: 24, color: "#ffd23f" });
    // The rest of the look is untouched, and the clip is not changed.
    expect(s.font).toBe(c.style.font);
    expect(c.style.size).toBe(80);
  });

  it("keeps sizes positive and round to hundredths", () => {
    const c = title({ "style.size": [{ f: 0, v: 3 }, { f: 3, v: -9 }] });
    expect(textStyleAt(c, 3).size).toBe(1);
    expect(textStyleAt(title({ "style.size": [{ f: 0, v: 80 }, { f: 3, v: 81 }] }), 1).size).toBe(80.33);
  });
});

describe("a color set as a number", () => {
  it("reads as 0xRRGGBB, keyed or not", () => {
    const c = { ...title(), style: { ...title().style, color: 0x00ff00 as unknown as string } };
    expect(textStyleAt(c, 0).color).toBe("#00ff00");
    expect(textStyleAt({ ...c, keyframes: { "style.size": [{ f: 0, v: 50 }] } }, 0).color).toBe("#00ff00");
  });
});
