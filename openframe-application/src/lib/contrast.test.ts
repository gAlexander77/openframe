import { describe, expect, it } from "vitest";
import { boxPixels, contrastFixes, contrastRatio, endsByItself, hex, luminance, measureBackdrop, measureLook, tailLevels, titleLook, unevenFade } from "./contrast";
import { DEFAULT_TEXT_STYLE } from "./project/defaults";

/** A w x h RGBA picture, each pixel from `at(x, y)` (0..255 channels). */
function picture(w: number, h: number, at: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      px.set([r, g, b, 255], (y * w + x) * 4);
    }
  return px;
}

const WHITE = [1, 1, 1, 1];

describe("contrast", () => {
  it("follows WCAG 2.x: white on black is 21:1, mid gray on white about 4.5:1", () => {
    expect(contrastRatio(luminance([1, 1, 1]), luminance([0, 0, 0]))).toBeCloseTo(21, 5);
    expect(contrastRatio(luminance([0.463, 0.463, 0.463]), luminance([1, 1, 1]))).toBeCloseTo(4.54, 1);
    expect(hex([1, 0.5, 0])).toBe("#ff8000");
  });

  it("measures white type on a near-black ground with soft glows as high contrast", () => {
    // The launch film's ground (#05060a) with a dim blue glow in the middle.
    const px = picture(200, 100, (x, y) => {
      const d = Math.hypot(x - 100, y - 50) / 60, glow = Math.max(0, 1 - d) * 60;
      return [5 + glow * 0.3, 6 + glow * 0.5, 10 + glow];
    });
    const m = measureBackdrop([WHITE], px, 200, { left: 40, right: 160, top: 30, bottom: 70 })!;
    expect(m.ratio).toBeGreaterThan(10);
  });

  it("measures white type over a bright photo as low, judged by the bright part behind it", () => {
    // A sky: bright at the top, darker below; the title sits across both.
    const px = picture(200, 100, (_x, y) => (y < 60 ? [220, 230, 240] : [40, 60, 40]));
    const m = measureBackdrop([WHITE], px, 200, { left: 20, right: 180, top: 20, bottom: 80 })!;
    expect(m.ratio).toBeLessThan(1.5);
    expect(hex(m.backdrop)).toBe("#dce6f0");
    // Dark type over the same sky is judged by its dark part.
    const dark = measureBackdrop([[0.05, 0.05, 0.05, 1]], px, 200, { left: 20, right: 180, top: 20, bottom: 80 })!;
    expect(dark.ratio).toBeLessThan(2.5);
  });

  it("takes the worse end of a gradient and mixes a translucent color with what is behind", () => {
    const px = picture(10, 10, () => [0, 0, 0]);
    const box = { left: 0, right: 10, top: 0, bottom: 10 };
    expect(measureBackdrop([WHITE, [0.2, 0.2, 0.2, 1]], px, 10, box)!.ratio).toBeLessThan(2);
    expect(measureBackdrop([[1, 1, 1, 0.3]], px, 10, box)!.ratio).toBeLessThan(measureBackdrop([WHITE], px, 10, box)!.ratio);
    expect(measureBackdrop([WHITE], px, 10, { left: 20, right: 30, top: 0, bottom: 5 })).toBeNull();
  });

  it("tells a track that fades out by itself from one that stops dead, by its last second", () => {
    const rate = 1000;
    const tone = (gain: (t: number) => number, seconds = 4) => Float32Array.from({ length: seconds * rate }, (_, i) => Math.sin(i * 0.3) * gain(i / rate));
    const dead = tailLevels(tone(() => 0.5), rate);
    expect(dead.endDb).toBeCloseTo(dead.bodyDb, 0);
    expect(endsByItself(dead)).toBe(false);
    const fading = tailLevels(tone((t) => (t < 3 ? 0.5 : 0.5 * (4 - t) ** 3)), rate);
    expect(endsByItself(fading)).toBe(true);
    expect(endsByItself(tailLevels(tone((t) => (t < 3.7 ? 0.5 : 0)), rate))).toBe(true);
    // A one-second linear fade, the most common fade an editor writes: its
    // last quarter second is only 17 dB down, which was called abrupt.
    const linear = tailLevels(tone((t) => (t < 3 ? 0.5 : 0.5 * (4 - t))), rate);
    expect(linear.lastSecond!.every((v, i, a) => i === 0 || v < a[i - 1])).toBe(true);
    expect(endsByItself(linear)).toBe(true);
    // A 1.5 s fade the clip ends a quarter second early: still falling away.
    const early = tailLevels(tone((t) => (t < 2.75 ? 0.5 : 0.5 * Math.max(0, (4.25 - t) / 1.5))), rate);
    expect(early.endDb).toBeGreaterThan(early.bodyDb - 18);
    expect(endsByItself(early)).toBe(true);
    // Music that drops to a quieter bar and is cut there is not a fade.
    const step = tailLevels(tone((t) => (t < 3.5 ? 0.5 : 0.2)), rate);
    expect(endsByItself(step)).toBe(false);
  });

  it("measures what a title draws around its letters: a box, an outline, a shadow", () => {
    const bright = [[0.92, 0.9, 0.85]];
    const style = { ...DEFAULT_TEXT_STYLE, size: 40, color: "#ffffff" };
    const plain = measureLook(titleLook(style), bright)!;
    expect(plain.ratio).toBeLessThan(1.3);
    // A dark box behind the letters: its color is their backdrop.
    const boxed = measureLook(titleLook({ ...style, background: { color: "#000000a6", padding: 10, radius: 4 } }), bright)!;
    expect(boxed.ratio).toBeGreaterThan(4.5);
    // An outline 4% of the type size or wider rings every letter in black.
    const outlined = titleLook({ ...style, stroke: { color: "#000000", width: 2 } });
    expect(outlined.around).toEqual([{ what: "outline", rgba: [0, 0, 0, 1], cover: 1 }]);
    expect(measureLook(outlined, bright)!.ratio).toBeCloseTo(21, 0);
    // A hairline does less.
    expect(measureLook(titleLook({ ...style, stroke: { color: "#000000", width: 0.5 } }), bright)!.ratio).toBeLessThan(4);
    // Codex's soft shadow (blur 16 on size 40 type) barely darkens the edge;
    // a tight one does more.
    const soft = measureLook(titleLook({ ...style, shadow: { color: "#000000cc", blur: 16, x: 0, y: 0 } }), bright)!;
    const tight = measureLook(titleLook({ ...style, shadow: { color: "#000000", blur: 3, x: 0, y: 2 } }), bright)!;
    expect(soft.ratio).toBeGreaterThan(plain.ratio);
    expect(soft.ratio).toBeLessThan(2.5);
    expect(tight.ratio).toBeGreaterThan(soft.ratio * 1.5);
    // The clip's opacity fades the box and the letters alike.
    expect(measureLook(titleLook({ ...style, background: { color: "#000000", padding: 10, radius: 4 } }, 0.3), bright)!.ratio).toBeLessThan(boxed.ratio);
  });

  it("offers a box and an outline as fixes, in the colors that read", () => {
    const light = contrastFixes({ ...DEFAULT_TEXT_STYLE, size: 40, color: "#f4f3ec" });
    expect(light.map((f) => f.say)).toEqual(['style.background {color: "#000000a6", padding: 10, radius: 5}', 'style.stroke {color: "#000000", width: 2}']);
    const dark = contrastFixes({ ...DEFAULT_TEXT_STYLE, size: 100, color: "#101010" });
    expect(dark[0].say).toMatch(/#ffffffd9/);
    expect(dark[1].style.stroke).toEqual({ color: "#ffffff", width: 5 });
    // Each fix, measured over a bright backdrop, reads.
    for (const f of light) expect(measureLook(titleLook(f.style), [[0.95, 0.95, 0.9]])!.ratio).toBeGreaterThan(4.5);
  });

  it("judges by most of the letters: the 10th percentile, not a stray pixel", () => {
    const px = [...Array.from({ length: 95 }, () => [0.05, 0.05, 0.05]), ...Array.from({ length: 5 }, () => [1, 1, 1])];
    expect(measureLook(titleLook({ ...DEFAULT_TEXT_STYLE, color: "#ffffff" }), px)!.ratio).toBeGreaterThan(10);
    expect(boxPixels(new Uint8ClampedArray(4 * 4 * 4), 4, { left: 1, right: 3, top: 1, bottom: 3 })).toHaveLength(4);
  });
});

describe("a title's fade (ADR-118)", () => {
  // Claude film test 2's LAST NOTE: yellow on a box at 55%, its S over the
  // rocket's white nose, the rest over the sky.
  const label = (background: string) => titleLook({ ...DEFAULT_TEXT_STYLE, size: 44, color: "#ffd27a", background: { color: background, padding: 16, radius: 8 } });
  const nose = [1, 1, 1], sky = [0.45, 0.55, 0.68];
  const backdrop = (bright: number) => Array.from({ length: 100 }, (_, i) => (i < bright ? nose : sky));

  it("finds the part of a title a fade loses while the rest is still seen", () => {
    const u = unevenFade(label("rgba(0,0,0,0.55)"), backdrop(15))!;
    expect(u).not.toBeNull();
    // About a quarter of its opacity, as the frames showed: the S gone, the rest seen.
    expect(u.opacity).toBeGreaterThan(0.15);
    expect(u.opacity).toBeLessThan(0.4);
    expect(u.faint).toBeLessThan(1.35);
    expect(u.body).toBeGreaterThanOrEqual(1.6);
    expect(hex(u.backdrop)).toBe("#ffffff");
  });

  it("lets a title fade as one with a solid box or outline, or over an even backdrop", () => {
    expect(unevenFade(label("#000000"), backdrop(15))).toBeNull();
    expect(unevenFade(titleLook({ ...DEFAULT_TEXT_STYLE, size: 44, color: "#ffffff", stroke: { color: "#000000", width: 4 } }), backdrop(15))).toBeNull();
    expect(unevenFade(label("rgba(0,0,0,0.55)"), backdrop(0))).toBeNull();
    expect(unevenFade(label("rgba(0,0,0,0.55)"), [])).toBeNull();
  });
});
