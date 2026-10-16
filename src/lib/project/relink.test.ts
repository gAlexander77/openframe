import { expect, it } from "vitest";
import { clipForAsset, createProject } from "./defaults";
import { relinkAsset, relinkProblem } from "./relink";
import type { Asset } from "./types";

const asset: Asset = { id: "a", name: "Original", src: "gone.mp4", proxy: "old-proxy.mp4", kind: "video", duration: 10, hasAudio: true, hasVideo: true };
it("relinks all uses without changing edits or mutating the original", () => {
  const p = createProject(); p.assets = [asset];
  p.tracks[0].clips = [clipForAsset(asset, 0, p.fps)];
  const result = relinkAsset(p, "a", { ...asset, id: "b", name: "Moved", src: "new.mp4", proxy: undefined });
  expect(result.tracks).toBe(p.tracks);
  expect(result.assets[0]).toMatchObject({ id: "a", name: "Original", src: "new.mp4", proxy: undefined });
  expect(p.assets[0].src).toBe("gone.mp4");
});
it("rejects mismatched streams, short sources and stale identities", () => {
  expect(relinkProblem(asset, { ...asset, kind: "audio" })).toContain("video");
  expect(relinkProblem(asset, { ...asset, hasAudio: false })).toContain("audio");
  expect(relinkProblem(asset, { ...asset, duration: 9.9 })).toContain("handles");
  expect(() => relinkAsset(createProject(), "a", asset)).toThrow();
});
