import { describe, expect, it } from "vitest";
import { cutRanges, framesOfRanges, splitAtSourceTimes } from "./cut";
import { clipForAsset, createProject, createTextClip, createTrack } from "./defaults";
import { addClip, addTrack, detachAudio, findClip, mainTrack, setSpeed, updateTrack } from "./ops";
import type { Project, VideoClip } from "./types";

const FPS = { num: 25, den: 1 };

/** A 20 s talking-head video on the main track from 0 s, then a 4 s clip
 * after it, and a title over the second clip. */
function setup(): { p: Project; id: string; nextId: string } {
  let p: Project = {
    ...createProject({ fps: FPS }),
    assets: [
      { id: "talk", kind: "video", name: "talk.mp4", src: "talk.mp4", duration: 20, hasVideo: true, hasAudio: true },
      { id: "broll", kind: "video", name: "broll.mp4", src: "broll.mp4", duration: 4, hasVideo: true, hasAudio: false },
    ],
  };
  const main = mainTrack(p).id;
  const talk = clipForAsset(p.assets[0], 0, FPS);
  const broll = clipForAsset(p.assets[1], 500, FPS);
  p = addClip(addClip(p, main, talk), main, broll);
  return { p, id: talk.id, nextId: broll.id };
}

const spans = (p: Project, trackId = mainTrack(p).id) =>
  p.tracks.find((t) => t.id === trackId)!.clips.map((c) => [c.start, c.start + c.duration, "in" in c ? +c.in.toFixed(3) : null]);

describe("framesOfRanges", () => {
  it("maps source seconds to clip frames, clamped, merged and sorted", () => {
    const { p, id } = setup();
    const c = findClip(p, id)!.clip as VideoClip;
    expect(framesOfRanges(c, [{ start: 4, end: 5 }, { start: 1, end: 2 }, { start: 1.5, end: 3 }, { start: 19, end: 30 }, { start: -3, end: -1 }], FPS)).toEqual([
      [25, 75],
      [100, 125],
      [475, 500],
    ]);
  });

  it("accounts for the in-point and speed", () => {
    const { p, id } = setup();
    // Trimmed to start 2 s into the source, played at 2x.
    const c = { ...(findClip(p, id)!.clip as VideoClip), in: 2, speed: 2, duration: 200 };
    expect(framesOfRanges(c, [{ start: 4, end: 6 }], FPS)).toEqual([[25, 50]]);
  });
});

describe("cutRanges", () => {
  it("removes the ranges and ripples the rest of the track", () => {
    const { p, id, nextId } = setup();
    const res = cutRanges(p, id, [
      { start: 2, end: 3 },
      { start: 10, end: 12.5 },
    ]);
    expect(res.removed).toBe(2);
    expect(res.frames).toBe(25 + 63); // 10 s = frame 250, 12.5 s rounds to frame 313
    // Pieces: 0-2 s, 3-10 s, 12.5-20 s of the source, end to end.
    expect(spans(res.project)).toEqual([
      [0, 50, 0],
      [50, 225, 3],
      [225, 412, 12.52], // the piece starts at frame 313's source time
      [412, 512, 0],
    ]);
    expect(findClip(res.project, id)!.clip.start).toBe(0); // the original id keeps the first piece
    expect(findClip(res.project, nextId)!.clip.start).toBe(412);
  });

  it("without ripple leaves holes", () => {
    const { p, id } = setup();
    const res = cutRanges(p, id, [{ start: 2, end: 3 }], false);
    expect(spans(res.project).slice(0, 2)).toEqual([
      [0, 50, 0],
      [75, 500, 3],
    ]);
  });

  it("removes a leading or trailing range without leaving a sliver", () => {
    const { p, id } = setup();
    const res = cutRanges(p, id, [
      { start: 0, end: 1 },
      { start: 18, end: 20 },
    ]);
    expect(spans(res.project)).toEqual([
      [0, 425, 1],
      [425, 525, 0],
    ]);
  });

  it("removing the whole clip removes the clip", () => {
    const { p, id } = setup();
    const res = cutRanges(p, id, [{ start: 0, end: 20 }]);
    expect(findClip(res.project, id)).toBeNull();
    expect(spans(res.project)).toEqual([[0, 100, 0]]);
  });

  it("cuts the detached audio with the video so they stay in sync", () => {
    const { p: p0, id } = setup();
    const p = detachAudio(p0, id);
    const audioTrack = p.tracks.find((t) => t.kind === "audio")!.id;
    const res = cutRanges(p, id, [{ start: 5, end: 6 }]);
    expect(spans(res.project).slice(0, 2)).toEqual([
      [0, 125, 0],
      [125, 475, 6],
    ]);
    expect(spans(res.project, audioTrack)).toEqual([
      [0, 125, 0],
      [125, 475, 6],
    ]);
  });

  it("leaves the partner alone when its track is locked, and refuses a locked clip", () => {
    const { p: p0, id } = setup();
    let p = detachAudio(p0, id);
    const audioTrack = p.tracks.find((t) => t.kind === "audio")!.id;
    p = updateTrack(p, audioTrack, { locked: true });
    const res = cutRanges(p, id, [{ start: 5, end: 6 }]);
    expect(spans(res.project, audioTrack)).toEqual([[0, 500, 0]]);
    const locked = updateTrack(p, mainTrack(p).id, { locked: true });
    expect(cutRanges(locked, id, [{ start: 5, end: 6 }]).project).toBe(locked);
  });

  it("ignores ranges outside the clip's source window and non-media clips", () => {
    const { p, id } = setup();
    expect(cutRanges(p, id, [{ start: 25, end: 30 }]).project).toBe(p);
    const t = createTrack("video", "Titles");
    const title = createTextClip("Hi", 0, 50);
    const q = addClip(addTrack(p, t), t.id, title);
    expect(cutRanges(q, title.id, [{ start: 0, end: 1 }]).project).toBe(q);
  });

  it("works on a sped-up clip", () => {
    const { p: p0, id } = setup();
    const p = setSpeed(p0, id, 2); // 20 s of source in 250 frames
    const res = cutRanges(p, id, [{ start: 4, end: 8 }]);
    expect(spans(res.project).slice(0, 2)).toEqual([
      [0, 50, 0],
      [50, 200, 8],
    ]);
  });
});

describe("splitAtSourceTimes", () => {
  it("splits at each time, in any order, ignoring the edges and outside", () => {
    const { p, id } = setup();
    const q = splitAtSourceTimes(p, id, [12, 4, 0, 20, 33, 4]);
    expect(spans(q)).toEqual([
      [0, 100, 0],
      [100, 300, 4],
      [300, 500, 12],
      [500, 600, 0],
    ]);
    expect(splitAtSourceTimes(p, id, [0, 20])).toBe(p);
  });

  it("splits the detached audio at the same frames", () => {
    const { p: p0, id } = setup();
    const p = detachAudio(p0, id);
    const q = splitAtSourceTimes(p, id, [8]);
    const audioTrack = q.tracks.find((t) => t.kind === "audio")!.id;
    expect(spans(q, audioTrack)).toEqual([
      [0, 200, 0],
      [200, 500, 8],
    ]);
  });
});
