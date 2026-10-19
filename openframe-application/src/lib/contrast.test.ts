import { describe, expect, it } from "vitest";
import { contrastRatio, endsByItself, hex, luminance, measureBackdrop, tailLevels } from "./contrast";

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

  it("tells a track that fades out by itself from one that stops dead", () => {
    const rate = 1000;
    const tone = (gain: (t: number) => number) => Float32Array.from({ length: 4 * rate }, (_, i) => Math.sin(i * 0.3) * gain(i / rate));
    const dead = tailLevels(tone(() => 0.5), rate);
    expect(dead.endDb).toBeCloseTo(dead.bodyDb, 0);
    expect(endsByItself(dead)).toBe(false);
    const fading = tailLevels(tone((t) => (t < 3 ? 0.5 : 0.5 * (4 - t) ** 3)), rate);
    expect(endsByItself(fading)).toBe(true);
    expect(endsByItself(tailLevels(tone((t) => (t < 3.7 ? 0.5 : 0)), rate))).toBe(true);
  });
});
