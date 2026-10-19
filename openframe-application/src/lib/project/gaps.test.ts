import { expect, it } from "vitest";
import { closeAllGaps, closeGap, gapAt, nudgeClips } from "./gaps";
import { createColorClip, createProject, createTrack } from "./defaults";
import type { Project } from "./types";

const setup = () => {
  const p = createProject();
  const a = createColorClip("#111", 10, 20); // 10..30
  const b = createColorClip("#222", 50, 10); // 50..60
  const c = createColorClip("#333", 60, 10); // 60..70
  const t = { ...createTrack("video", "V"), clips: [a, b, c] };
  p.tracks = [t];
  return { p, a, b, c, t };
};
const starts = (p: Project) => p.tracks[0].clips.map((c) => c.start);

it("finds the gap under a frame, not a clip or the open end", () => {
  const { t } = setup();
  expect(gapAt(t, 5)).toEqual([0, 10]);
  expect(gapAt(t, 40)).toEqual([30, 50]);
  expect(gapAt(t, 30)).toEqual([30, 50]);
  expect(gapAt(t, 20)).toBeNull();
  expect(gapAt(t, 80)).toBeNull();
});

it("closes one gap by rippling what follows, or every gap", () => {
  const { p, t } = setup();
  expect(starts(closeGap(p, t.id, 40))).toEqual([10, 30, 40]);
  expect(starts(closeGap(p, t.id, 5))).toEqual([0, 40, 50]);
  expect(closeGap(p, t.id, 20)).toBe(p);
  expect(starts(closeAllGaps(p, t.id))).toEqual([0, 20, 30]);
  const locked = { ...p, tracks: [{ ...t, locked: true }] };
  expect(closeGap(locked, t.id, 40)).toBe(locked);
});

it("nudges selected clips by frames, all or nothing", () => {
  const { p, a, b, c } = setup();
  expect(starts(nudgeClips(p, [a.id], 5))).toEqual([15, 50, 60]);
  expect(starts(nudgeClips(p, [b.id, c.id], -10))).toEqual([10, 40, 50]);
  // b would cover c; a would pass frame 0.
  expect(nudgeClips(p, [b.id], 1)).toBe(p);
  expect(nudgeClips(p, [a.id, b.id], -11)).toBe(p);
});
