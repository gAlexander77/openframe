import { describe, expect, it } from "vitest";
import { duckKeys } from "./duck";

const O = { depthDb: 20, attack: 3, release: 12, hold: 15 };
const LOW = 0.1; // -20 dB of 1

const keys = (speech: [number, number][], start = 100, end = 400) => duckKeys(speech, start, end, 1, O).map((k) => [k.f, +k.v.toFixed(6)]);

describe("duckKeys", () => {
  it("dips under one stretch of speech with attack and release", () => {
    expect(keys([[150, 200]])).toEqual([
      [47, 1],
      [50, LOW],
      [100, LOW],
      [112, 1],
    ]);
  });

  it("bridges a short pause and comes back up for a long one", () => {
    // gap 25 <= 3 + 12 + 15: one dip
    expect(keys([[150, 200], [225, 260]])).toHaveLength(4);
    // gap 31 > 30: two dips
    expect(keys([[150, 200], [231, 260]])).toHaveLength(8);
  });

  it("starts ducked when speech starts with the clip, ends ducked when it runs past", () => {
    expect(keys([[90, 150]])).toEqual([
      [0, LOW],
      [50, LOW],
      [62, 1],
    ]);
    expect(keys([[380, 500]])).toEqual([
      [277, 1],
      [280, LOW],
      [299, LOW],
    ]);
  });

  it("ignores speech outside the clip and scales from the clip's volume", () => {
    expect(keys([[0, 50], [450, 500]])).toEqual([]);
    expect(duckKeys([[150, 200]], 100, 400, 0.5, O)[1].v).toBeCloseTo(0.05, 9);
  });

  it("dips each line to its own depth, moving between them in the pause they share", () => {
    const k = (depths: number[]) => duckKeys([[150, 200], [220, 260], [330, 360]], 100, 400, 1, O, depths).map((x) => [x.f, +x.v.toFixed(4)]);
    // The first two share a dip (a 20-frame pause); the level moves from -20 to -26 dB inside it.
    expect(k([20, 26, 10])).toEqual([
      [47, 1],
      [50, 0.1],
      [100, 0.1],
      [120, 0.0501],
      [160, 0.0501],
      [172, 1],
      [227, 1],
      [230, 0.3162],
      [260, 0.3162],
      [272, 1],
    ]);
    // The same depths everywhere: the same keys as one depth.
    expect(duckKeys([[150, 200], [220, 260]], 100, 400, 1, O, [20, 20])).toEqual(duckKeys([[150, 200], [220, 260]], 100, 400, 1, O));
  });

  it("takes the deeper depth where two lines overlap", () => {
    expect(duckKeys([[150, 200], [190, 230]], 100, 400, 1, O, [10, 20]).map((x) => +x.v.toFixed(2))).toEqual([1, 0.1, 0.1, 1]);
  });
});
