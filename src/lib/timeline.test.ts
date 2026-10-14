import { describe, expect, it } from "vitest";
import { fitZoom, rulerTicks, snapSpan } from "./timeline";

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
