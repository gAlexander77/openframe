import { expect, it } from "vitest";
import { clipForAsset, createProject } from "./defaults";
import { stretchClip } from "./stretch";
import type { Asset, VideoClip } from "./types";

const asset: Asset = { id: "a", src: "a.mp4", name: "a", kind: "video", duration: 20, width: 1920, height: 1080, hasAudio: true, hasVideo: true };
const setup = () => {
  const p = createProject();
  p.assets = [asset];
  const a = { ...(clipForAsset(asset, 0, p.fps) as VideoClip), duration: 60 };
  const b = { ...(clipForAsset(asset, 60, p.fps) as VideoClip), duration: 30 };
  p.tracks[0].clips = [a, b];
  return { p, a, b };
};
const clips = (p: ReturnType<typeof setup>["p"]) => p.tracks[0].clips as VideoClip[];

it("stretches the end: the same source over a new length, later clips ripple", () => {
  const { p, a } = setup();
  const [x, y] = clips(stretchClip(p, a.id, "end", 120));
  expect(x).toMatchObject({ start: 0, duration: 120, speed: 0.5, in: 0 });
  expect(y.start).toBe(120);
  expect(clips(stretchClip(p, a.id, "end", 30))[0]).toMatchObject({ duration: 30, speed: 2 });
});

it("stretches the start up to the clip before, keeping the end", () => {
  const { p, b } = setup();
  // b's start can only come back to a's end (60): it may only shrink.
  expect(stretchClip(p, b.id, "start", 40)).toBe(p);
  const [, y] = clips(stretchClip(p, b.id, "start", 75));
  expect(y).toMatchObject({ start: 75, duration: 15, speed: 2 });
});

it("keeps speeds within the panel's limits and leaves curves alone", () => {
  const { p, a } = setup();
  expect(clips(stretchClip(p, a.id, "end", 100000))[0].speed).toBeCloseTo(0.1);
  const curved = { ...p, tracks: [{ ...p.tracks[0], clips: [{ ...a, speedCurve: { points: [{ f: 0, speed: 1 }, { f: 59, speed: 2 }] } }] }] };
  expect(stretchClip(curved as never, a.id, "end", 90)).toBe(curved);
});
