import { expect, it } from "vitest";
import { clipForAsset, createProject } from "./defaults";
import { replaceClip, replaceProblem } from "./replace";
import type { Asset, VideoClip } from "./types";

const video = (id: string, duration: number): Asset => ({ id, src: `${id}.mp4`, name: id, kind: "video", duration, width: 1920, height: 1080, hasAudio: true, hasVideo: true });
const image: Asset = { id: "img", src: "img.png", name: "img", kind: "image", duration: 0, width: 800, height: 800, hasAudio: false, hasVideo: true };
const audio: Asset = { id: "aud", src: "a.wav", name: "a", kind: "audio", duration: 10, hasAudio: true, hasVideo: false };

it("keeps the clip's place, identity and look with the new source", () => {
  const p = createProject();
  const a = video("a", 10);
  const c = clipForAsset(a, 30, p.fps) as VideoClip;
  c.duration = 90;
  c.in = 2;
  c.transform.scale = 0.5;
  c.volume = 0.3;
  c.effects = [{ id: "fx", type: "blur", enabled: true, params: { amount: 10 } }];
  c.keyframes = { opacity: [{ f: 0, v: 0 }] };
  c.animIn = { type: "fade", duration: 10 };
  p.assets = [a];
  p.tracks[0].clips = [c];
  const next = replaceClip(p, c.id, video("b", 20)).tracks[0].clips[0] as VideoClip;
  expect(next).toMatchObject({ id: c.id, assetId: "b", start: 30, duration: 90, in: 0, volume: 0.3 });
  expect(next.transform.scale).toBe(0.5);
  expect(next.effects).toEqual(c.effects);
  expect(next.keyframes).toEqual(c.keyframes);
  expect(next.animIn).toEqual(c.animIn);
});

it("shortens to a shorter source, keeps a still's length, and checks the kind", () => {
  const p = createProject();
  const a = video("a", 10);
  const c = clipForAsset(a, 0, p.fps) as VideoClip;
  c.duration = 150;
  c.speed = 2;
  p.assets = [a];
  p.tracks[0].clips = [c];
  // 2 s of source at 2x lasts 30 frames.
  expect(replaceClip(p, c.id, video("short", 2)).tracks[0].clips[0].duration).toBe(30);
  expect(replaceClip(p, c.id, image).tracks[0].clips[0]).toMatchObject({ type: "image", duration: 150 });
  expect(replaceProblem(c, audio)).toMatch(/video or a picture/);
  expect(() => replaceClip(p, c.id, audio)).toThrow();
});
