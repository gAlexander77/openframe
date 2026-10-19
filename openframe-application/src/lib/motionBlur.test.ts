import { describe, expect, it } from "vitest";
import { samplesFor, shutterOffsets, STILL_PX, travel } from "./motionBlur";

describe("shutterOffsets", () => {
  it("spreads samples evenly over the open shutter, centered on the frame", () => {
    // 180 degrees: half a frame, -0.25..0.25, at the strata's centers.
    expect(shutterOffsets(4, 180)).toEqual([-0.1875, -0.0625, 0.0625, 0.1875]);
    const o = shutterOffsets(9, 360);
    expect(o[4]).toBeCloseTo(0, 12);
    expect(o[0]).toBeCloseTo(-0.5 + 0.5 / 9, 12);
    expect(o.reduce((s, v) => s + v, 0)).toBeCloseTo(0, 12);
  });

  it("draws once with one sample or a shut shutter", () => {
    expect(shutterOffsets(1, 180)).toEqual([0]);
    expect(shutterOffsets(8, 0)).toEqual([0]);
  });
});

describe("travel", () => {
  const still = { x: 0, y: 0, scale: 1, rotation: 0 };

  it("is how far the farthest corner moves along the path", () => {
    // 0.1 of a 1000 px canvas to the right, then back: 200 px.
    const path = [still, { ...still, x: 0.1 }, still];
    expect(travel(path, 100, 100, 1000, 500)).toBeCloseTo(200, 6);
  });

  it("counts turning and scaling at the corners", () => {
    // A 200 x 0 picture turned 90 degrees: each end moves along the chord
    // from (100, 0) to (0, 100), as the path is measured between samples.
    expect(travel([still, { ...still, rotation: 90 }], 200, 0, 1000, 1000)).toBeCloseTo(Math.hypot(100, 100), 6);
    // Scaled from 1 to 2: a 100 px square's corners move 50 px each way.
    expect(travel([still, { ...still, scale: 2 }], 100, 100, 1000, 1000)).toBeCloseTo(Math.hypot(50, 50), 6);
  });

  it("is zero for a still picture", () => {
    expect(travel([still, still, still], 100, 100, 1000, 1000)).toBe(0);
  });
});

describe("samplesFor", () => {
  it("is one for a still picture, about one per two pixels moving, capped", () => {
    expect(samplesFor(STILL_PX / 2, 32)).toBe(1);
    expect(samplesFor(1, 32)).toBe(2);
    expect(samplesFor(20, 32)).toBe(10);
    expect(samplesFor(500, 32)).toBe(32);
    expect(samplesFor(500, 6)).toBe(6);
    expect(samplesFor(500, 1)).toBe(1);
  });
});
