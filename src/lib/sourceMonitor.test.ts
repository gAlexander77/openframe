import { expect, it } from "vitest";
import { sourceFrames, sourceProject, withSourceRange } from "./sourceMonitor";
import type { Asset } from "./project/types";
const asset: Asset = { id: "a", name: "a", src: "a.mp4", kind: "video", duration: 10, fps: 60, hasVideo: true, hasAudio: true };
it("makes an isolated source timeline without changing source metadata", () => {
  const p = sourceProject(asset);
  expect(p.fps).toEqual({ num: 60000, den: 1000 });
  expect(p.tracks[0].clips[0].duration).toBe(600);
  expect(sourceFrames({ ...asset, duration: 0.001 })).toBe(1);
});
it("converts exclusive ranges across frame rates without exceeding the out point", () => {
  const clip = sourceProject(asset).tracks[0].clips[0];
  const selected = withSourceRange(clip, asset, { in: 1, out: 2.05 }, { num: 30, den: 1 });
  expect(selected).toMatchObject({ in: 1, duration: 31 });
  expect(clip).toMatchObject({ in: 0, duration: 600 });
  expect(() => withSourceRange(clip, asset, { in: 2, out: 1 }, { num: 30, den: 1 })).toThrow();
  expect(() => withSourceRange(clip, asset, { in: 0, out: 11 }, { num: 30, den: 1 })).toThrow();
  expect(() => withSourceRange(clip, asset, { in: 0, out: 0.01 }, { num: 30, den: 1 })).toThrow();
});
