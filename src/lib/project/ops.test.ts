import { describe, expect, it } from "vitest";
import { clipForAsset, createProject, createTextClip, createTrack } from "./defaults";
import {
  addClip,
  deleteClips,
  detachAudio,
  findClip,
  freezeFrame,
  moveClip,
  rollEdit,
  setParam,
  setSpeed,
  setTransition,
  slideClip,
  slipClip,
  splitAt,
  splitClip,
  trimClip,
  settle,
} from "./ops";
import type { Asset, Clip, Project, VideoClip } from "./types";

// 30 fps, one 10 s source (300 frames of material).
const asset: Asset = {
  id: "a1",
  kind: "video",
  name: "a.mp4",
  src: "a.mp4",
  duration: 10,
  hasVideo: true,
  hasAudio: true,
};

/** Main track holding clips [start, duration, inSeconds] in order. */
function project(...spec: [number, number, number][]): Project {
  let p = { ...createProject(), assets: [asset] };
  const main = p.tracks[0].id;
  spec.forEach(([start, duration, inS], i) => {
    const c = { ...clipForAsset(asset, start, p.fps), id: `c${i + 1}`, duration, in: inS } as Clip;
    p = addClip(p, main, c);
  });
  return p;
}

const clips = (p: Project, t = 0) =>
  p.tracks[t].clips.map((c) => [c.start, c.duration, "in" in c ? +c.in.toFixed(4) : null]);

describe("split", () => {
  it("cuts at a frame and advances the right half's in-point", () => {
    const p = splitClip(project([0, 90, 1]), "c1", 30);
    expect(clips(p)).toEqual([
      [0, 30, 1],
      [30, 60, 2],
    ]);
  });
  it("splitAt cuts every clip under the playhead, skipping locked tracks", () => {
    let p = project([0, 90, 0]);
    const overlay = createTrack("video", "V2");
    p = { ...p, tracks: [{ ...overlay, locked: true, clips: [createTextClip("hi", 0, 60)] }, ...p.tracks] };
    p = splitAt(p, 45);
    expect(p.tracks[0].clips).toHaveLength(1);
    expect(p.tracks[1].clips).toHaveLength(2);
  });
});

describe("place", () => {
  it("overwrite clears exactly the range under the new clip", () => {
    const p0 = project([0, 90, 0]);
    const t = createTextClip("x", 30, 30);
    const p = addClip({ ...p0, tracks: [{ ...p0.tracks[0], clips: [p0.tracks[0].clips[0]] }] }, p0.tracks[0].id, {
      ...clipForAsset(asset, 30, p0.fps),
      duration: 30,
    } as Clip);
    expect(clips(p)).toEqual([
      [0, 30, 0],
      [30, 30, 0],
      [60, 30, 2],
    ]);
    expect(t.type).toBe("text");
  });
  it("insert ripples later clips and splits a straddler", () => {
    const p0 = project([0, 90, 0]);
    const c = { ...clipForAsset(asset, 30, p0.fps), duration: 15, in: 5 } as Clip;
    const p = addClip(p0, p0.tracks[0].id, c, "insert");
    expect(clips(p)).toEqual([
      [0, 30, 0],
      [30, 15, 5],
      [45, 60, 1],
    ]);
  });
});

describe("delete", () => {
  it("ripple delete closes the hole on that track only", () => {
    const p = deleteClips(project([0, 30, 0], [30, 30, 0], [60, 30, 0]), ["c2"], true);
    expect(clips(p)).toEqual([
      [0, 30, 0],
      [30, 30, 0],
    ]);
  });
  it("plain delete leaves a gap", () => {
    const p = deleteClips(project([0, 30, 0], [30, 30, 0]), ["c1"]);
    expect(clips(p)).toEqual([[30, 30, 0]]);
  });
});

describe("move", () => {
  it("magnetic main track reorders by center and stays gapless", () => {
    const p0 = project([0, 30, 0], [30, 60, 0], [90, 30, 0]);
    const p = moveClip(p0, "c1", p0.tracks[0].id, 100, { magnet: true });
    expect(p.tracks[0].clips.map((c) => c.id)).toEqual(["c2", "c3", "c1"]);
    expect(clips(p).map((c) => c[0])).toEqual([0, 60, 90]);
  });
  it("CapCut collision makes a new track instead of overwriting", () => {
    const p0 = project([0, 30, 0], [30, 30, 0]);
    const p = moveClip(p0, "c2", p0.tracks[0].id, 10, { collision: "newTrack" });
    expect(p.tracks).toHaveLength(2);
    expect(p.tracks[0].clips.map((c) => c.id)).toEqual(["c2"]);
    expect(p.tracks[1].clips.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("trim", () => {
  it("is limited by source handles", () => {
    // c1 plays source 1s..4s; there is 1 s (30 f) of handle before it.
    const p = trimClip(project([60, 90, 1]), "c1", "start", 0);
    expect(clips(p)).toEqual([[30, 120, 0]]);
    const q = trimClip(project([0, 30, 8]), "c1", "end", 500);
    expect(clips(q)).toEqual([[0, 60, 8]]);
  });
  it("is limited by the neighbor unless rippling", () => {
    const p0 = project([0, 30, 0], [30, 30, 3]);
    expect(clips(trimClip(p0, "c1", "end", 50))).toEqual(clips(p0));
    expect(clips(trimClip(p0, "c1", "end", 50, true))).toEqual([
      [0, 50, 0],
      [50, 30, 3],
    ]);
  });
  it("ripple trim at the head keeps the start and pulls later clips", () => {
    const p = trimClip(project([0, 60, 0], [60, 30, 0]), "c1", "start", 20, true);
    expect(clips(p)).toEqual([
      [0, 40, 0.6667],
      [40, 30, 0],
    ]);
  });
  it("roll moves the cut only, both clips within their handles", () => {
    const p = rollEdit(project([0, 30, 0], [30, 30, 2]), "c1", "c2", 40);
    expect(clips(p)).toEqual([
      [0, 40, 0],
      [40, 20, 2.3333],
    ]);
  });
  it("slip changes the source window, not position", () => {
    const p = slipClip(project([0, 60, 1]), "c1", 15);
    expect(clips(p)).toEqual([[0, 60, 1.5]]);
    expect(clips(slipClip(project([0, 60, 1]), "c1", -100))).toEqual([[0, 60, 0]]);
  });
  it("slide moves a clip between neighbors that absorb it", () => {
    const p = slideClip(project([0, 30, 0], [30, 30, 0], [60, 30, 2]), "c2", 10);
    expect(clips(p)).toEqual([
      [0, 40, 0],
      [40, 30, 0],
      [70, 20, 2.3333],
    ]);
  });
});

describe("speed, freeze, detach", () => {
  it("2x halves the length and ripples the rest", () => {
    const p = setSpeed(project([0, 60, 0], [60, 30, 0]), "c1", 2);
    expect(clips(p)).toEqual([
      [0, 30, 0],
      [30, 30, 0],
    ]);
  });
  it("freeze holds the frame at the playhead and ripples", () => {
    const p = freezeFrame(project([0, 60, 0]), "c1", 30, 90);
    const [a, f, b] = p.tracks[0].clips as VideoClip[];
    expect([a.duration, f.start, f.duration, f.freeze, f.in, b.start]).toEqual([30, 30, 90, true, 1, 120]);
  });
  it("detach moves sound to an audio track and mutes the video", () => {
    const p = detachAudio(project([0, 60, 0]), "c1");
    const v = findClip(p, "c1")!.clip as VideoClip;
    expect(v.muted).toBe(true);
    const audio = p.tracks.find((t) => t.kind === "audio")!;
    expect(audio.clips[0]).toMatchObject({ type: "audio", start: 0, duration: 60, in: 0 });
  });
});

describe("params", () => {
  it("auto-keys a keyframed path and sets a plain one", () => {
    let p = project([0, 60, 0]);
    p = setParam(p, ["c1"], "opacity", 0.5);
    expect((findClip(p, "c1")!.clip as VideoClip).opacity).toBe(0.5);
    p = setParam(
      { ...p, tracks: [{ ...p.tracks[0], clips: [{ ...p.tracks[0].clips[0], keyframes: { opacity: [{ f: 0, v: 1 }] } }] }] },
      ["c1"],
      "opacity",
      0.2,
      30,
    );
    expect(findClip(p, "c1")!.clip.keyframes!.opacity).toEqual([
      { f: 0, v: 1 },
      { f: 30, v: 0.2 },
    ]);
  });
  it("transitions need an adjacent clip and fit the shorter side", () => {
    const p = project([0, 60, 0], [60, 10, 0], [100, 30, 0]);
    expect(findClip(setTransition(p, "c2", { type: "dissolve", duration: 30 }), "c2")!.clip).not.toHaveProperty(
      "transitionOut",
    );
    const q = setTransition(p, "c1", { type: "dissolve", duration: 30 });
    expect((findClip(q, "c1")!.clip as VideoClip).transitionOut).toEqual({ type: "dissolve", duration: 10 });
  });
});

describe("settle", () => {
  it("magnet packs the main track; linkage carries titles with their shot", () => {
    let p = project([0, 30, 0], [30, 30, 0], [60, 30, 0]);
    const overlay = createTrack("video", "Titles");
    p = { ...p, tracks: [{ ...overlay, clips: [{ ...createTextClip("on c3", 70, 10), id: "t" }] }, ...p.tracks] };
    const after = deleteClips(p, ["c2"]);
    const settled = settle(p, after, { magnet: true, linkage: true });
    expect(clips(settled, 1).map((c) => c[0])).toEqual([0, 30]);
    expect(findClip(settled, "t")!.clip.start).toBe(40);
    const unlinked = settle(p, after, { magnet: true, linkage: false });
    expect(findClip(unlinked, "t")!.clip.start).toBe(70);
  });
});
