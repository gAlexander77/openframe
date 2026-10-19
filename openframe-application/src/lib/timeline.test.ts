import { describe, expect, it } from "vitest";
import { createTrack } from "./project/defaults";
import { fitZoom, refitTimeline, rulerTicks, snapSpan, trackHeight } from "./timeline";

describe("snapSpan", () => {
  const targets = [0, 100, 250];
  it("snaps whichever edge is closest", () => {
    // span of 40 frames dragged to 57: its end (97) is 3 from 100
    expect(snapSpan(57, [0, 40], targets, 5)).toEqual({ frame: 60, target: 100 });
    // its start (98) is 2 from 100: start wins
    expect(snapSpan(98, [0, 40], targets, 5)).toEqual({ frame: 100, target: 100 });
  });
  it("leaves the position alone outside the threshold", () => {
    expect(snapSpan(170, [0, 40], targets, 5)).toEqual({ frame: 170, target: null });
  });
});

describe("rulerTicks", () => {
  const fps = { num: 30, den: 1 };
  it("spaces labeled ticks at least ~90 px apart", () => {
    const ticks = rulerTicks(0, 900, 2, fps).filter((t) => t.major);
    expect(ticks[1].frame - ticks[0].frame).toBeGreaterThanOrEqual(45);
    expect(ticks[0].label).toBe("00:00");
  });
  it("labels frames when zoomed below a second", () => {
    const ticks = rulerTicks(0, 60, 40, fps).filter((t) => t.major);
    expect(ticks[1].label).toBe("00:00:05");
  });
});

it("fits short timelines as if they were 10 s long", () => {
  expect(fitZoom(30, 1000, { num: 30, den: 1 })).toBeCloseTo(920 / 300);
});

it("sizes a track row by its kind and its chosen height", () => {
  const a = createTrack("audio", "A");
  expect(trackHeight(a)).toBe(46);
  expect(trackHeight({ ...a, height: "small" })).toBe(30);
  expect(trackHeight({ ...a, height: "large" })).toBe(78);
});

it("keeps the visible frame interval when the dock changes the lane width", () => {
  const next = refitTimeline(2, 200, 1000, 700);
  expect(next.left / next.zoom).toBe(100);
  expect(700 / next.zoom).toBeCloseTo(500);
  const restored = refitTimeline(next.zoom, next.left, 700, 1000);
  expect(restored.zoom).toBeCloseTo(2);
  expect(restored.left).toBeCloseTo(200);
  expect(refitTimeline(2, 200, 0, 700)).toEqual({ zoom: 2, left: 200 });
  expect(refitTimeline(60, 200, 700, 1000).zoom).toBe(60);
});
