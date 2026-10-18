import { expect, it } from "vitest";
import { clipForAsset, createProject, createTrack } from "./defaults";
import { findClip } from "./ops";
import { currentOffset, syncClip, syncProblem } from "./sync";
import type { Asset, AudioClip, Project, VideoClip } from "./types";

const cam: Asset = { id: "cam", src: "cam.mp4", name: "cam", kind: "video", duration: 12, width: 1920, height: 1080, hasAudio: true, hasVideo: true };
const lav: Asset = { id: "lav", src: "lav.wav", name: "lav", kind: "audio", duration: 20, hasAudio: true, hasVideo: false };

/** The camera clip on the main track at `vStart` frames, the lav on an
 * audio track at `aStart`. */
function setup(vStart: number, aStart: number): { p: Project; v: VideoClip; a: AudioClip } {
  const p = createProject();
  const v = clipForAsset(cam, vStart, p.fps) as VideoClip;
  const a = clipForAsset(lav, aStart, p.fps) as AudioClip;
  const audio = createTrack("audio", "Audio");
  p.assets = [cam, lav];
  p.tracks[0].clips = [v];
  audio.clips = [a];
  p.tracks.push(audio);
  return { p, v, a };
}

const clip = (p: Project, id: string) => findClip(p, id)!.clip as AudioClip;

it("starts the clip on the nearest frame and takes up the rest of it in the in-point", () => {
  // Video on an overlay at 2 s; lav second t + 0.25 is camera second t.
  const { p, v, a } = setup(0, 0);
  const over = createTrack("video", "Overlay");
  p.tracks[0].clips = [];
  over.clips = [{ ...v, start: 60 }];
  p.tracks.unshift(over);
  const q = syncClip(p, a.id, v.id, 0.25);
  const c = clip(q, a.id);
  // Ideally at 2 - 0.25 = 1.75 s = frame 52.5: frame 53 (rounds half up),
  // with the in-point 1/60 s into the lav.
  expect(c.start).toBe(53);
  expect(c.in).toBeCloseTo(53 / 30 - 1.75, 9);
  expect(currentOffset(q, a.id, v.id)).toBeCloseTo(0.25, 9);
  // It keeps the source it ended on.
  expect(c.in + c.duration / 30).toBeCloseTo(a.duration / 30, 1);
});

it("trims the head that would fall before the timeline", () => {
  // The recorder started 1.37 s before the camera, which is at 0.
  const { p, v, a } = setup(0, 90);
  a.keyframes = { volume: [{ f: 60, v: 0.5 }] };
  const q = syncClip(p, a.id, v.id, 1.37);
  const c = clip(q, a.id);
  expect(c.start).toBe(0);
  expect(c.in).toBeCloseTo(1.37, 9);
  expect(currentOffset(q, a.id, v.id)).toBeCloseTo(1.37, 9);
  expect(c.duration).toBe(Math.floor((20 - 1.37) * 30));
  // Keyframes stay on the sound they were on: 41 frames were cut.
  expect(c.keyframes!.volume[0].f).toBe(60 - 41);
});

it("never reads past the end of the media", () => {
  const { p, v, a } = setup(30, 0);
  const q = syncClip(p, a.id, v.id, -0.51);
  const c = clip(q, a.id);
  expect(c.in).toBeGreaterThanOrEqual(0);
  expect(c.in + (c.duration * 1) / 30).toBeLessThanOrEqual(20 + 1e-9);
  expect(currentOffset(q, a.id, v.id)).toBeCloseTo(-0.51, 9);
});

it("goes to a new track when its spot is taken, and mutes the camera when asked", () => {
  const { p, v, a } = setup(0, 0);
  const other = clipForAsset(lav, 0, p.fps) as AudioClip;
  other.duration = 60;
  p.tracks[1].clips = [{ ...a, start: 600 }, other];
  p.tracks[1].clips.sort((x, y) => x.start - y.start);
  v.keyframes = { volume: [{ f: 0, v: 1 }], opacity: [{ f: 0, v: 1 }] };
  const q = syncClip(p, a.id, v.id, -0.5, true);
  expect(q.tracks).toHaveLength(3);
  expect(findClip(q, a.id)!.track.id).not.toBe(p.tracks[1].id);
  expect(findClip(q, other.id)!.clip).toEqual(other);
  const muted = findClip(q, v.id)!.clip as VideoClip;
  expect(muted.volume).toBe(0);
  expect(muted.keyframes).toEqual({ opacity: [{ f: 0, v: 1 }] });
});

it("refuses what cannot stay in sync", () => {
  const { p, v, a } = setup(0, 0);
  expect(syncProblem(p, a.id, a.id)).toMatch(/itself/);
  expect(syncProblem(p, v.id, a.id)).toMatch(/main track/);
  p.tracks[1].clips = [{ ...a, speed: 2 }];
  expect(syncProblem(p, a.id, v.id)).toMatch(/same speed/);
  p.tracks[1].clips = [{ ...a, reverse: true }];
  expect(syncProblem(p, a.id, v.id)).toMatch(/forward/);
  p.tracks[1].clips = [a];
  p.tracks[1].locked = true;
  expect(syncProblem(p, a.id, v.id)).toMatch(/locked/);
  expect(() => syncClip(p, a.id, v.id, 0)).toThrow(/locked/);
});

it("keeps sync at another speed", () => {
  const { p, v, a } = setup(0, 0);
  p.tracks[0].clips = [{ ...v, speed: 2, duration: 180 }];
  p.tracks[1].clips = [{ ...a, speed: 2, duration: 300 }];
  const over = createTrack("video", "Overlay");
  over.clips = [{ ...p.tracks[0].clips[0], start: 90 }];
  p.tracks[0].clips = [];
  p.tracks.unshift(over);
  const q = syncClip(p, a.id, v.id, 0.8);
  expect(currentOffset(q, a.id, v.id)).toBeCloseTo(0.8, 9);
});
