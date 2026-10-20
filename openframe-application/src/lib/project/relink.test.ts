import { expect, it } from "vitest";
import { clipForAsset, createProject } from "./defaults";
import { relinkAsset, relinkProblem } from "./relink";
import type { Asset, AudioClip, VideoClip } from "./types";

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
it("checks the clips' source range when the original's length is unknown", () => {
  const unknown = { ...asset, duration: 0 };
  const p = createProject(); p.assets = [unknown];
  p.tracks[0].clips = [{ ...(clipForAsset(asset, 0, p.fps) as VideoClip), in: 4 }];
  expect(() => relinkAsset(p, "a", { ...asset, duration: 5 })).toThrow("cover the clips");
  expect(relinkAsset(p, "a", { ...asset, duration: 20 }).assets[0].duration).toBe(20);
});
it("takes an MP3 back that its gapless trim made shorter (ADR-112)", () => {
  // Imported before: 30.024 s, delay and padding counted. The same file now
  // reads 30.000 s with 23.0 ms and 1.0 ms trimmed, and its clips cover it.
  const old: Asset = { id: "m", name: "Song", src: "song.mp3", kind: "audio", duration: 30.024, hasAudio: true, hasVideo: false };
  const now: Asset = { ...old, src: "moved/song.mp3", duration: 30, gapless: { start: 1105 / 48000, end: 47 / 48000 } };
  const p = createProject(); p.assets = [old];
  // 30 s of it from 0.02 s: past the file's trimmed end.
  p.tracks[0].clips = [{ ...(clipForAsset(old, 0, p.fps) as AudioClip), in: 0.02, duration: 900 }];
  expect(relinkProblem(old, now)).toBeNull();
  expect(relinkAsset(p, "m", now).assets[0]).toMatchObject({ src: "moved/song.mp3", duration: 30, gapless: now.gapless });
  // A file that is shorter still is refused.
  expect(relinkProblem(old, { ...now, duration: 29.99 })).toContain("handles");
});
