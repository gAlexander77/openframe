import { describe, expect, it } from "vitest";
import { createTextClip, createTrack } from "./project/defaults";
import type { Track } from "./project/types";
import { fitZoom, nearestCut, rulerTicks, snapSpan, visualDrop } from "./timeline";

describe("drops", () => {
  // Main track [0,30) [30,90); a text track above it; audio below.
  const main: Track = { ...createTrack("video", "Main", true), clips: [createTextClip("a", 0, 30), createTextClip("b", 30, 60)] };
  const text: Track = { ...createTrack("video", "Text"), clips: [createTextClip("t", 10, 20)] };
  const tracks = [text, main, createTrack("audio", "Audio")];

  it("nearestCut picks the closest cut, the earlier on a tie", () => {
    expect(nearestCut(main, 12)).toBe(0);
    expect(nearestCut(main, 20)).toBe(30);
    expect(nearestCut(main, 60)).toBe(30);
    expect(nearestCut(main, 61)).toBe(90);
    expect(nearestCut(main, 400)).toBe(90);
    expect(nearestCut(createTrack("video", "Main", true), 50)).toBe(0);
  });

  it("above the top track makes an overlay at the drop time (UX-12)", () => {
    expect(visualDrop(tracks, -1, 47, true)).toEqual({ row: -1, frame: 47, insert: false });
    // Nothing to overlay yet: the first clip goes on the main track.
    expect(visualDrop([createTrack("video", "Main", true)], -1, 47, true)).toEqual({ row: 0, frame: 0, insert: true });
  });

  it("the magnetic main track inserts at the nearest cut (UX-13)", () => {
    expect(visualDrop(tracks, 1, 47, true)).toEqual({ row: 1, frame: 30, insert: true });
    expect(visualDrop(tracks, 1, 47, false)).toEqual({ row: 1, frame: 47, insert: false });
    // Audio rows, locked rows and the space below the tracks mean the main track.
    expect(visualDrop(tracks, 2, 80, true)).toEqual({ row: 1, frame: 90, insert: true });
    expect(visualDrop(tracks, 3, 80, true)).toEqual({ row: 1, frame: 90, insert: true });
    expect(visualDrop([{ ...text, locked: true }, main], 0, 5, true)).toEqual({ row: 1, frame: 0, insert: true });
  });

  it("an overlay track takes the clip where it is dropped", () => {
    expect(visualDrop(tracks, 0, 47, true)).toEqual({ row: 0, frame: 47, insert: false });
  });
});

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
