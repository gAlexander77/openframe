import { describe, expect, it } from "vitest";
import { adaptiveCuts, contentCuts, contentScore, flashFilter, LUMA_WEIGHTS, rgbaToHsv, sceneCuts } from "./scenes";

const px = (...rgb: number[]) => rgbaToHsv([rgb[0], rgb[1], rgb[2], 255]);

describe("rgbaToHsv", () => {
  it("uses OpenCV's 8-bit ranges (H 0..179)", () => {
    expect([...px(255, 0, 0)]).toEqual([0, 255, 255]);
    expect([...px(0, 255, 0)]).toEqual([60, 255, 255]);
    expect([...px(0, 0, 255)]).toEqual([120, 255, 255]);
    expect([...px(255, 0, 255)]).toEqual([150, 255, 255]);
    expect([...px(128, 128, 128)]).toEqual([0, 0, 128]);
    expect([...px(0, 0, 0)]).toEqual([0, 0, 0]);
    expect([...px(255, 1, 0)]).toEqual([0, 255, 255]);
    expect([...px(255, 0, 3)]).toEqual([0, 255, 255]); // 359.3 degrees wraps to 0
  });
});

describe("contentScore", () => {
  const solid = (r: number, g: number, b: number, n = 16) => rgbaToHsv(new Uint8Array(n * 4).map((_, i) => [r, g, b, 255][i % 4]));
  it("is 0 for identical frames and averages H, S and V differences", () => {
    expect(contentScore(solid(10, 20, 30), solid(10, 20, 30))).toBe(0);
    expect(contentScore(solid(0, 0, 0), solid(255, 255, 255))).toBeCloseTo(85, 6); // only V moves, by 255
    expect(contentScore(solid(0, 0, 0), solid(255, 255, 255), LUMA_WEIGHTS)).toBeCloseTo(255, 6);
    expect(contentScore(solid(255, 0, 0), solid(0, 0, 255))).toBeCloseTo(40, 6); // H moves 120
  });
});

/** A 32x18 picture: flat background with an 8x8 white square at `x`. */
function frame(bg: [number, number, number], x: number) {
  const w = 32;
  const h = 18;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let i = 0; i < w; i++) {
      const inSquare = i >= x && i < x + 8 && y >= 5 && y < 13;
      const c = inSquare ? [255, 255, 255] : bg;
      rgba.set([c[0], c[1], c[2], 255], (y * w + i) * 4);
    }
  return rgbaToHsv(rgba);
}

function scoresOf(frames: Uint8Array[]) {
  return frames.map((f, i) => (i ? contentScore(frames[i - 1], f) : 0));
}

describe("scene detection on synthetic video", () => {
  // Three shots with a square moving 1 px a frame: red (0..39), blue
  // (40..69), green (70..99).
  const bgs: [number, number, number][] = [
    [200, 30, 30],
    [30, 30, 200],
    [30, 160, 60],
  ];
  const bounce = (f: number) => (f % 48 < 24 ? f % 24 : 24 - (f % 24)); // never jumps
  const frames = Array.from({ length: 100 }, (_, f) => frame(bgs[f < 40 ? 0 : f < 70 ? 1 : 2], bounce(f)));
  const scores = scoresOf(frames);

  it("motion inside a shot scores low, a cut scores high", () => {
    expect(Math.max(...scores.slice(1, 40))).toBeLessThan(15);
    expect(scores[40]).toBeGreaterThan(27);
    expect(scores[70]).toBeGreaterThan(27);
  });

  it("both detectors find exactly the cuts", () => {
    expect(contentCuts(scores)).toEqual([40, 70]);
    expect(adaptiveCuts(scores)).toEqual([40, 70]);
  });

  it("reports cut times from frame timestamps", () => {
    const times = scores.map((_, i) => 10 + i / 30); // source starts at 10 s, 30 fps
    expect(sceneCuts(times, scores)).toEqual([10 + 40 / 30, 10 + 70 / 30]);
    expect(sceneCuts(times, scores, { detector: "content" })).toEqual([10 + 40 / 30, 10 + 70 / 30]);
    // A minimum scene longer than the second shot drops its cut.
    expect(sceneCuts(times, scores, { minScene: 1.2 })).toEqual([10 + 40 / 30]);
  });
});

describe("flash filter (minimum scene length)", () => {
  const flags = (n: number, on: number[]) => Array.from({ length: n }, (_, i) => on.includes(i));

  it("passes cuts that are far enough apart", () => {
    expect(flashFilter(flags(100, [20, 50, 80]), 15)).toEqual([20, 50, 80]);
  });

  it("the first cut must be a minimum scene length from the start", () => {
    expect(flashFilter(flags(60, [10, 40]), 15)).toEqual([40]);
  });

  it("merge emits a strobe burst once, at its last frame; suppress keeps the first", () => {
    const strobe = flags(120, [30, 35, 40, 45, 50]);
    expect(flashFilter(strobe, 15, "merge")).toEqual([30, 50]);
    expect(flashFilter(strobe, 15, "suppress")).toEqual([30, 45]);
  });

  it("length 0 disables the filter", () => {
    expect(flashFilter(flags(10, [1, 2, 3]), 0)).toEqual([1, 2, 3]);
  });
});

describe("adaptive vs content on camera motion", () => {
  // Calm (2), then a fast pan scoring ~30 for frames 40..60, then a real cut
  // (60) at 80: a fixed threshold of 27 sees the pan as cuts.
  const scores = Array.from({ length: 120 }, (_, i) => (i === 0 ? 0 : i === 80 ? 60 : i >= 40 && i <= 60 ? 30 : 2));

  it("content detector is fooled by the pan", () => {
    expect(contentCuts(scores)).toEqual([40, 60, 80]);
  });

  it("adaptive detector only finds the real cut", () => {
    expect(adaptiveCuts(scores)).toEqual([80]);
  });

  it("adaptive needs the minimum content value too", () => {
    const faint = scores.map((s) => (s === 60 ? 10 : s));
    expect(adaptiveCuts(faint)).toEqual([]);
    expect(adaptiveCuts(faint, { minContentVal: 8 })).toEqual([80]);
  });

  it("adaptive treats a spike after perfectly still frames as a cut", () => {
    const still = Array.from({ length: 40 }, (_, i) => (i === 20 ? 40 : 0));
    expect(adaptiveCuts(still)).toEqual([20]);
  });
});
