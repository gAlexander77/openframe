import { expect, it } from "vitest";
import { centerKeys, inSource, onCanvas, pin, pinKeys, pointAt, smooth, type Path } from "./follow";
import { paramAt } from "./keyframes";
import { clipForAsset, createProject, createTextClip } from "./project/defaults";
import type { Asset, VideoClip } from "./project/types";
import { layerAt } from "./render/plan";

const asset: Asset = { id: "v", src: "v.mp4", name: "v", kind: "video", duration: 4, width: 1280, height: 720, fps: 30, hasAudio: false, hasVideo: true };
function setup() {
  const p = createProject();
  p.assets = [asset];
  const video = clipForAsset(asset, 0, p.fps) as VideoClip;
  const text = createTextClip("Hi", 0, 90);
  text.transform.x = -0.1;
  p.tracks[0].clips = [video];
  p.tracks.push({ ...p.tracks[0], id: "t2", clips: [text] });
  return { p, video, text };
}
// The subject crosses the picture's middle half in two seconds.
const path: Path = { times: [0, 2], x: [0.25, 0.75], y: [0.5, 0.5] };

it("maps picture points to the canvas and back through the clip's transform", () => {
  const { p, video } = setup();
  Object.assign(video.transform, { x: 0.2, y: -0.1, scale: 0.5, rotation: 30, flipX: true });
  const l = layerAt(p, video, 0)!;
  const q = onCanvas(p, video, l, 0.3, 0.8);
  const back = inSource(p, video, l, q.x, q.y);
  expect(back.u).toBeCloseTo(0.3, 6);
  expect(back.v).toBeCloseTo(0.8, 6);
  // The picture's center sits at the layer's position.
  expect(onCanvas(p, video, l, 0.5, 0.5)).toMatchObject({ x: 1920 * 0.7, y: 1080 * 0.4 });
});

it("smooths jitter but keeps a steady move and both ends", () => {
  const jitter = Array.from({ length: 20 }, (_, i) => i + (i % 2 ? 0.3 : -0.3));
  const s = smooth(jitter);
  expect(s[0]).toBe(jitter[0]);
  expect(s[19]).toBe(jitter[19]);
  for (let i = 2; i < 18; i++) expect(Math.abs(s[i] - i)).toBeLessThan(0.05);
  expect(smooth([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
});

it("reads the path between and past its samples", () => {
  expect(pointAt(path, 1).x).toBeCloseTo(0.5);
  expect(pointAt(path, -1).x).toBe(0.25);
  expect(pointAt(path, 9).x).toBe(0.75);
});

it("pins a layer to the subject with a few keyframes", () => {
  const { p, video, text } = setup();
  const keys = pinKeys(p, video, path, text, 0);
  // A steady move, then a hold past the path's end (2 s): the ends and a
  // handful around the smoothed turn, not one a frame.
  expect(keys.x.length).toBeLessThanOrEqual(8);
  expect([keys.x[0].f, keys.x.at(-1)!.f]).toEqual([0, 89]);
  const q = pin(p, text.id, keys);
  const t = q.tracks[1].clips[0];
  // The picture fills the canvas width: half of it is half the canvas.
  expect(paramAt(t, "transform.x", 0)).toBeCloseTo(-0.1);
  expect(paramAt(t, "transform.x", 30)).toBeCloseTo(-0.1 + 0.25, 3);
  expect(paramAt(t, "transform.y", 30)).toBeCloseTo(0);
  // A half-size picture moves the pin half as far.
  video.transform.scale = 0.5;
  expect(paramAt(pin(p, text.id, pinKeys(p, video, path, text, 0)).tracks[1].clips[0], "transform.x", 30)).toBeCloseTo(-0.1 + 0.125, 3);
});

it("starts from the playhead and keeps the keys before it", () => {
  const { p, video, text } = setup();
  text.keyframes = { "transform.x": [{ f: 0, v: -0.4 }, { f: 30, v: -0.1 }, { f: 80, v: 0.3 }] };
  const q = pin(p, text.id, pinKeys(p, video, path, text, 30));
  const keys = q.tracks[1].clips[0].keyframes!["transform.x"];
  expect(keys[0]).toEqual({ f: 0, v: -0.4 });
  expect(keys[1].f).toBe(30);
  expect(keys[1].v).toBeCloseTo(-0.1);
  // Past the path's end (2 s) the subject holds, so the pin does too.
  // (The source frame is read a quarter frame in: 1.008 s at frame 30.)
  expect(paramAt(q.tracks[1].clips[0], "transform.x", 85)).toBeCloseTo(-0.1 + 0.25, 2);
});

it("reframes a wide shot onto a tall canvas, following the subject but never past an edge", () => {
  const { p, video } = setup();
  // A 9:16 canvas with the 16:9 picture scaled to fill its height: 3.16
  // canvas widths wide.
  Object.assign(p, { width: 1080, height: 1920 });
  video.transform.scale = (1920 / 720) / (1080 / 1280);
  const keys = centerKeys(p, video, path, 0, 1);
  const q = pin(p, video.id, keys);
  const v = q.tracks[0].clips[0];
  // The subject starts a quarter in from the left: the picture slides right
  // to bring it to the center, and the shift is what a quarter of the
  // picture's width is in canvas widths.
  const shown = 1280 * (1080 / 1280) * video.transform.scale; // picture width on canvas
  expect(paramAt(v, "transform.x", 0)).toBeCloseTo((0.25 * shown) / 1080, 1);
  // Halfway (1 s), the subject is at the picture's center: no shift but
  // the quarter frame the plan reads ahead (7 canvas pixels here).
  expect(paramAt(v, "transform.x", 30)).toBeCloseTo(0, 1);
  // It never slides so far that an edge shows.
  const room = (shown - 1080) / 2160;
  for (const k of keys.x) expect(Math.abs(k.v)).toBeLessThanOrEqual(room + 1e-6);
  expect(keys.x.length).toBeLessThan(20);
});
