import { describe, expect, it } from "vitest";
import { computeScopes, scopeLevel, SKIN_TONE_DEG, TARGETS, vectorPoint, type Frame } from "./scopes";

/** A frame of vertical bars, each `bw` pixels wide. */
function bars(colors: [number, number, number][], bw = 4, h = 3): Frame {
  const w = colors.length * bw;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = colors[Math.floor(x / bw)];
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}

const BARS_75: [number, number, number][] = [
  [191, 191, 191], [191, 191, 0], [0, 191, 191], [0, 191, 0], [191, 0, 191], [191, 0, 0], [0, 0, 191], [0, 0, 0],
];

describe("computeScopes", () => {
  it("puts a flat gray in one waveform level per column and the vectorscope's center", () => {
    const s = computeScopes(bars([[128, 128, 128]], 8, 2), 4, 65);
    for (let col = 0; col < 4; col++) expect(s.luma[128 * 4 + col]).toBe(4);
    expect(s.vector[32 * 65 + 32]).toBe(16);
    expect(s.hist.luma[128]).toBe(16);
    expect(s.perColumn).toBe(4);
  });

  it("draws 75% bars as a staircase on the waveform and separates channels on the parade", () => {
    const s = computeScopes(bars(BARS_75), 8);
    const levelOf = (arr: Uint32Array, col: number) => [...Array(256).keys()].find((l) => arr[l * 8 + col] > 0);
    // Rec.709 luma of each bar: white 191, yellow 177, cyan 150, green 137 ...
    expect([...Array(8).keys()].map((c) => levelOf(s.luma, c))).toEqual([191, 177, 150, 137, 54, 41, 14, 0]);
    expect([...Array(8).keys()].map((c) => levelOf(s.r, c))).toEqual([191, 191, 0, 0, 191, 191, 0, 0]);
    expect([...Array(8).keys()].map((c) => levelOf(s.b, c))).toEqual([191, 0, 191, 0, 191, 0, 191, 0]);
  });

  it("lands each 75% bar on its vectorscope target", () => {
    const size = 129;
    const s = computeScopes(bars(BARS_75), 8, size);
    for (const t of TARGETS) {
      const [x, y] = vectorPoint(t.rgb.map((v) => v * (191 / 255)) as [number, number, number], size);
      expect(s.vector[Math.round(y) * size + Math.round(x)]).toBe(12);
    }
  });

  it("counts the histogram per channel", () => {
    const s = computeScopes(bars([[255, 0, 10]], 2, 2));
    expect([s.hist.r[255], s.hist.g[0], s.hist.b[10]]).toEqual([4, 4, 4]);
  });
});

describe("vectorscope geometry", () => {
  it("puts red at about 103 degrees and the skin line between red and yellow", () => {
    const [x, y] = vectorPoint([1, 0, 0], 2);
    expect((Math.atan2(0.5 - y, x - 0.5) * 180) / Math.PI).toBeCloseTo(103, 0);
    const [yx, yy] = vectorPoint([1, 1, 0], 2);
    const yellow = (Math.atan2(0.5 - yy, yx - 0.5) * 180) / Math.PI;
    expect(SKIN_TONE_DEG).toBeGreaterThan(103);
    expect(SKIN_TONE_DEG).toBeLessThan(yellow);
  });
});

describe("scopeLevel", () => {
  it("is 0 for nothing, 1 at the reference, and log in between", () => {
    expect(scopeLevel(0, 50)).toBe(0);
    expect(scopeLevel(50, 50)).toBe(1);
    expect(scopeLevel(500, 50)).toBe(1);
    expect(scopeLevel(5, 50)).toBeGreaterThan(0.4);
  });
});
