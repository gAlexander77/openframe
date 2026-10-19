import { expect, it } from "vitest";
import { trimFrames } from "./trimPreview";
import { clipForAsset, createProject } from "./project/defaults";
import { rollEdit, slipClip } from "./project/ops";
import type { VideoClip } from "./project/types";
const fixture = () => {
  const p = createProject(); p.assets = [{ id: "a", src: "a.mp4", name: "a", kind: "video", duration: 10, hasAudio: true, hasVideo: true }];
  const a = { ...clipForAsset(p.assets[0], 0, p.fps), id: "left", in: 1, duration: 60 } as VideoClip;
  const b = { ...a, id: "right", start: 60, in: 3 };
  p.tracks[0].clips = [a, b]; return p;
};
it("shows the actual last outgoing and first incoming frame after a roll", () => {
  const p = rollEdit(fixture(), "left", "right", 75);
  const frames = trimFrames(p, { kind: "roll", id: "left", edge: "end" });
  expect(frames.map((f) => f.frame)).toEqual([74, 75]);
  expect(frames[0].source).toBeCloseTo(1 + 74 / 30);
  expect(frames[1].source).toBeCloseTo(3.5);
  expect(frames[0].project.tracks[0].clips).toHaveLength(1);
});
it("shows clamped slip edges, including reverse and freeze mappings", () => {
  const p = slipClip(fixture(), "left", -1000);
  const [first, last] = trimFrames(p, { kind: "slip", id: "left" });
  expect(first.source).toBe(0); expect(last.source).toBeCloseTo(59 / 30);
  const c = p.tracks[0].clips[0] as VideoClip; c.reverse = true; c.in = 5;
  expect(trimFrames(p, { kind: "slip", id: "left" }).map((f) => f.source)).toEqual([5 - 1 / 30, 3]);
  c.freeze = true;
  expect(trimFrames(p, { kind: "trim", id: "left" }).map((f) => f.source)).toEqual([5, 5]);
});
