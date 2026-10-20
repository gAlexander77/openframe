import { expect, it } from "vitest";
import { clipForAsset, createProject } from "./defaults";
import { slipBySource } from "./ops";
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
it("takes back the file a whole-file clip was made from (ADR-117)", () => {
  // A sound's clip runs to the frame its last sample plays in (ADR-113), a
  // picture's to the nearer frame: 30.024 s is 901 frames (30.033 s),
  // 6.435 s 194 (6.467 s), 5.021 s 151 (5.033 s). Each was refused its own
  // file, "must be at least 30.033 seconds".
  const files: Asset[] = [
    { id: "s", name: "Song", src: "song.mp3", kind: "audio", duration: 30.024, hasAudio: true, hasVideo: false },
    { id: "v", name: "Voice", src: "voice.wav", kind: "audio", duration: 6.435, hasAudio: true, hasVideo: false },
    { id: "m", name: "Movie", src: "movie.mkv", kind: "video", duration: 5.021, hasAudio: true, hasVideo: true },
  ];
  for (const a of files) {
    const p = createProject(); p.assets = [a];
    const clip = clipForAsset(a, 0, p.fps) as AudioClip | VideoClip;
    expect(clip.duration / 30).toBeGreaterThan(a.duration);
    p.tracks[0].clips = [clip];
    expect(relinkAsset(p, a.id, { ...a, src: `moved/${a.src}` }).assets[0].src).toBe(`moved/${a.src}`);
    // Played backward, sped up and slipped to the end, it reads as far.
    p.tracks[0].clips = [{ ...clip, reverse: true, in: a.duration }];
    expect(relinkAsset(p, a.id, { ...a, src: "b" }).assets[0].src).toBe("b");
    p.tracks[0].clips = [{ ...clip, speed: 2, duration: Math.ceil(clip.duration / 2) }];
    expect(relinkAsset(p, a.id, { ...a, src: "c" }).assets[0].src).toBe("c");
  }
  // Its last frame starts at 30.000 s: a file that ends before it does not
  // cover it; one that runs past it does, as a clip made from it would.
  // (The original's length unknown, so only the clips decide.)
  const [song] = files;
  const p = createProject(); p.assets = [{ ...song, duration: 0 }];
  p.tracks[0].clips = [clipForAsset(song, 0, p.fps)];
  expect(() => relinkAsset(p, "s", { ...song, duration: 29.99 })).toThrow("cover the clips");
  expect(relinkAsset(p, "s", { ...song, duration: 30.01 }).assets[0].duration).toBe(30.01);
  expect(clipForAsset({ ...song, duration: 30.01 }, 0, p.fps).duration).toBe(901);
});
it("does not slip a whole-file sound back past its start (ADR-117)", () => {
  // Its 901 frames read to 30.033 s of a 30.024 s file: the room past its
  // end was -0.009 s, and a slip either way moved it to in -0.009.
  const a: Asset = { id: "s", name: "Song", src: "song.mp3", kind: "audio", duration: 30.024, hasAudio: true, hasVideo: false };
  const p = createProject(); p.assets = [a];
  const c = clipForAsset(a, 0, p.fps);
  p.tracks[0].clips = [c];
  for (const by of [1, -1]) {
    const { project, moved } = slipBySource(p, c.id, by);
    expect(moved).toBe(0);
    expect((project.tracks[0].clips[0] as AudioClip).in).toBe(0);
  }
  // Trimmed, it slips as far as the file goes.
  p.tracks[0].clips = [{ ...c, duration: 600 }];
  expect(slipBySource(p, c.id, 20).moved).toBeCloseTo(10.024, 6);
});
