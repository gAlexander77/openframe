import { describe, expect, it } from "vitest";
import { clipForAsset, createColorClip, createProject, createTextClip, createTrack } from "./defaults";
import { layerAt } from "../render/plan";
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
  setFlip,
  liftRange,
  setUniformScale,
  setTransition,
  slideClip,
  slipClip,
  splitAt,
  splitClip,
  trimClip,
  settle,
  setFps,
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
  it("at a clip's last frame, the still takes that frame's place: no one-frame piece after it (ADR-113)", () => {
    // The Claude film: a freeze at 6.267 s of a shot ending at 6.3 s left
    // a one-frame clip of the same picture after the still.
    const p = freezeFrame(project([0, 189, 0], [240, 30, 0]), "c1", 188, 52);
    expect(clips(p).map((c) => c.slice(0, 2))).toEqual([[0, 188], [188, 52], [291, 30]]);
    expect((p.tracks[0].clips[1] as VideoClip).freeze).toBe(true);
  });
  it("overwrite lays the still over a gap left for it and moves nothing (ADR-113)", () => {
    const p = freezeFrame(project([0, 189, 0], [240, 30, 0]), "c1", 188, 52, "overwrite");
    expect(clips(p).map((c) => c.slice(0, 2))).toEqual([[0, 188], [188, 52], [240, 30]]);
    // Longer than the gap, it covers the next shot's head, which keeps its pictures in place.
    const q = freezeFrame(project([0, 189, 0], [240, 30, 0]), "c1", 188, 62, "overwrite");
    expect(clips(q)).toEqual([[0, 188, 0], [188, 62, 6.2667], [250, 20, 0.3333]]);
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

  /** Shots c1 [0,50), c2 [50,80), c3 [80,110) under: a music bed past the
   * end, a logo across all of them, a title and a sound effect on c1, and
   * a title that starts on c2's tail but mostly covers c3. */
  const scene = () => {
    const p = project([0, 50, 0], [50, 30, 0], [80, 30, 0]);
    const audio = (id: string, start: number, duration: number) => ({ ...clipForAsset(asset, start, p.fps), id, type: "audio", duration }) as Clip;
    const text = (id: string, start: number, duration: number) => ({ ...createTextClip(id, start, duration), id });
    return {
      ...p,
      tracks: [
        { ...createTrack("video", "Logo"), clips: [text("logo", 0, 110)] },
        { ...createTrack("video", "Titles"), clips: [text("t1", 5, 20), text("t3", 75, 30)] },
        ...p.tracks,
        { ...createTrack("audio", "Music"), clips: [audio("music", 0, 150)] },
        { ...createTrack("audio", "SFX"), clips: [audio("whoosh", 5, 20)] },
      ],
    };
  };
  const linked = { magnet: true, linkage: true };

  it("leaves a music bed alone when the first shot moves (UX-14)", () => {
    // Drag the second shot to the front: c1 moves 0 -> 30.
    const p = scene();
    const s = settle(p, moveClip(p, "c2", p.tracks[2].id, 0, { magnet: true }), linked);
    expect(s.tracks[2].clips.map((c) => [c.id, c.start])).toEqual([["c2", 0], ["c1", 30], ["c3", 80]]);
    expect(findClip(s, "music")!.clip.start).toBe(0);
    expect(findClip(s, "logo")!.clip.start).toBe(0);
    // What sits on c1 goes with it.
    expect(findClip(s, "t1")!.clip.start).toBe(35);
    expect(findClip(s, "whoosh")!.clip.start).toBe(35);
  });

  it("carries a title with the shot under most of it, even if it starts on another", () => {
    // Delete c2: c3 ripples 80 -> 50, and the title mostly over c3 follows.
    const p = scene();
    const s = settle(p, deleteClips(p, ["c2"]), linked);
    expect(findClip(s, "t3")!.clip.start).toBe(45);
    expect(findClip(s, "t1")!.clip.start).toBe(5);
    expect(findClip(s, "music")!.clip.start).toBe(0);
  });

  /** The Claude film (2026-10-20): a 7-frame breath on the main track,
   * [30, 37), before the drop; a picture-in-picture mostly over c2. */
  const breath = () => {
    const p = project([0, 30, 0], [37, 30, 0], [67, 30, 0]);
    const pip = { ...clipForAsset(asset, 40, p.fps), id: "pip", duration: 20 } as Clip;
    return { ...p, tracks: [{ ...createTrack("video", "PiP"), clips: [pip] }, ...p.tracks, { ...createTrack("audio", "Voice"), clips: [] }] };
  };

  it("keeps a gap that was there before the edit: an edit elsewhere moves nothing (ADR-102)", () => {
    // A voiceover added under the pictures (an audio track only) packed the
    // main track and moved the drop and everything after it 7 frames early.
    const p = breath();
    const voice = { ...clipForAsset(asset, 0, p.fps), id: "vo", type: "audio", duration: 40 } as Clip;
    const after = { ...p, tracks: p.tracks.map((t) => (t.kind === "audio" ? { ...t, clips: [voice] } : t)) };
    const s = settle(p, after, linked);
    expect(clips(s, 1).map((c) => c[0])).toEqual([0, 37, 67]);
    expect(findClip(s, "pip")!.clip.start).toBe(40);
  });

  it("closes only the gap an edit opens, keeping the one before it", () => {
    // Deleting c2 without ripple opens [37, 67); the magnet closes that and
    // c3 keeps the breath before it.
    const p = breath();
    const s = settle(p, deleteClips(p, ["c2"]), linked);
    expect(clips(s, 1).map((c) => c[0])).toEqual([0, 37]);
    // Trimming c1's tail by 5 frames opens 5 more: those close, the 7 stay.
    const t = settle(p, trimClip(p, "c1", "end", 25), linked);
    expect(clips(t, 1).map((c) => c[0])).toEqual([0, 32, 62]);
    expect(findClip(t, "pip")!.clip.start).toBe(35);
  });

  /** Shots c1 [0,30), c2 [30,60), c3 [60,90) with a caption on each, end
   * to end on one track. */
  const captioned = () => {
    const p = project([0, 30, 0], [30, 30, 0], [60, 30, 0]);
    const caps = [0, 30, 60].map((s, i) => ({ ...createTextClip(`cap${i}`, s, 28), id: `cap${i}` }));
    return { ...p, tracks: [{ ...createTrack("video", "Captions"), clips: caps }, ...p.tracks] };
  };
  const capStarts = (p: Project) => ["cap0", "cap1", "cap2"].map((id) => findClip(p, id)!.clip.start);

  it("carries a run of captions on one track with their shots through an insert (ADR-106)", () => {
    // A shot inserted at 0 moves every shot 30 frames later. Each caption,
    // moved in track order, found the next one's old spot taken: only the
    // last one followed its shot.
    const p = captioned();
    const ins = addClip(p, p.tracks[1].id, { ...clipForAsset(asset, 0, p.fps), id: "new", duration: 30 } as Clip, "insert");
    const s = settle(p, ins, { magnet: false, linkage: true });
    expect(capStarts(s)).toEqual([30, 60, 90]);
    expect(capStarts(settle(s, deleteClips(s, ["new"], true), { magnet: false, linkage: true }))).toEqual([0, 30, 60]);
  });

  it("keeps the captions after a shot deleted with its own caption on their shots (ADR-106)", () => {
    // Ripple-deleting c2 and its caption: the caption track rippled by the
    // caption's 28 frames, c3 by its 30, so c3's caption landed 2 frames
    // off its shot.
    const p = captioned();
    const s = settle(p, deleteClips(p, ["c2", "cap1"], true), { magnet: true, linkage: true });
    expect(clips(s, 1).map((c) => c[0])).toEqual([0, 30]);
    expect(findClip(s, "cap2")!.clip.start).toBe(30);
  });

  it("keeps the pause before a shot when a clip is inserted at its start (ADR-106)", () => {
    // The magnet took the inserted clip for one that keeps no gap, pulled it
    // onto c1 and the breath was gone; c2 and the PiP moved 7 frames early.
    const p = breath();
    const ins = addClip(p, p.tracks[1].id, { ...clipForAsset(asset, 37, p.fps), id: "new", duration: 10 } as Clip, "insert");
    const s = settle(p, ins, linked);
    expect(clips(s, 1).map((c) => c[0])).toEqual([0, 37, 47, 77]);
    expect(findClip(s, "pip")!.clip.start).toBe(50);
  });

  it("carries a voice line across several shots, and the lines before it, through a freeze (ADR-113)", () => {
    // The Claude film's freeze: shots after a pause all moved 52 frames.
    // A voice line over three of them had no shot under most of it and
    // stayed; the line before it found that spot taken and stayed too, and
    // only the last line, on one shot, followed its picture.
    let p = project([0, 189, 0], [240, 78, 0], [318, 51, 0], [369, 51, 0], [420, 60, 0], [480, 57, 0], [537, 51, 0], [588, 57, 0]);
    const audio = (id: string, start: number, duration: number) => ({ ...clipForAsset(asset, start, p.fps), id, type: "audio", duration }) as Clip;
    const lines = [audio("l2", 87, 135), audio("l3", 258, 102), audio("l4", 369, 46), audio("l5", 420, 48), audio("l6", 489, 121)];
    const bed = audio("song", 240, 345);
    p = { ...p, tracks: [...p.tracks, { ...createTrack("audio", "Voiceover"), role: "dialog", clips: lines }, { ...createTrack("audio", "Music"), role: "music", clips: [bed] }] };
    const s = settle(p, freezeFrame(p, "c1", 188, 52), { magnet: false, linkage: true });
    // Every shot after the freeze moved 51 frames (the hold less the frame it replaced).
    expect(clips(s).map((c) => c[0])).toEqual([0, 188, 291, 369, 420, 471, 531, 588, 639]);
    const at = (id: string) => findClip(s, id)!.clip.start;
    expect(["l2", "l3", "l4", "l5", "l6"].map(at)).toEqual([87, 309, 420, 471, 540]);
    // The song stays: it is the grid the picture is cut to.
    expect(at("song")).toBe(240);
  });

  it("carries a title over a pause between two shots that moved together", () => {
    // A black breath [30, 37) with a title over it; a shot inserted at 0
    // moves both shots and the breath 10 frames.
    const p0 = project([0, 30, 0], [37, 30, 0]);
    const p = { ...p0, tracks: [{ ...createTrack("video", "Titles"), clips: [{ ...createTextClip("breath", 31, 5), id: "t" }] }, ...p0.tracks] };
    const ins = addClip(p, p.tracks[1].id, { ...clipForAsset(asset, 0, p.fps), id: "new", duration: 10 } as Clip, "insert");
    expect(findClip(settle(p, ins, { magnet: false, linkage: true }), "t")!.clip.start).toBe(41);
  });

  it("carries clips with a shot that moved whole, not with one whose head was trimmed", () => {
    // An agent's trim (no magnet) of c1's head moves c1's start to 10 but
    // not where its pictures play: the title on it stays.
    const p = scene();
    const s = settle(p, trimClip(p, "c1", "start", 10), { magnet: false, linkage: true });
    expect(findClip(s, "c1")!.clip.start).toBe(10);
    expect(findClip(s, "t1")!.clip.start).toBe(5);
    expect(findClip(s, "whoosh")!.clip.start).toBe(5);
  });
});

describe("setFps", () => {
  it("keeps clips at the same seconds and never overlaps", () => {
    const p = setFps(project([0, 30, 0], [30, 45, 0]), { num: 24, den: 1 });
    expect(clips(p).map((c) => [c[0], c[1]])).toEqual([
      [0, 24],
      [24, 36],
    ]);
    const ntsc = setFps(project([0, 10, 0], [10, 10, 0], [20, 10, 0]), { num: 30000, den: 1001 });
    const cs = ntsc.tracks[0].clips;
    cs.forEach((c, i) => i && expect(c.start).toBeGreaterThanOrEqual(cs[i - 1].start + cs[i - 1].duration));
  });
});

describe("setUniformScale", () => {
  it("separates the vertical scale with its keys, and joins it back", () => {
    const p = createProject();
    const c = createColorClip("#fff", 0, 60);
    c.transform.scale = 0.8;
    c.keyframes = { "transform.scale": [{ f: 0, v: 0.5 }, { f: 30, v: 0.8 }] };
    p.tracks[0].clips = [c];
    const apart = setUniformScale(p, [c.id], false);
    const a = apart.tracks[0].clips[0] as typeof c;
    expect(a.transform.scaleY).toBe(0.8);
    expect(a.keyframes?.["transform.scaleY"]).toEqual(c.keyframes["transform.scale"]);
    expect(a.keyframes?.["transform.scaleY"]).not.toBe(c.keyframes["transform.scale"]);
    expect(layerAt(apart, a, 0)?.scaleY).toBe(0.5);
    const joined = setUniformScale(apart, [c.id], true).tracks[0].clips[0] as typeof c;
    expect(joined.transform.scaleY).toBeUndefined();
    expect(joined.keyframes).toEqual(c.keyframes);
    expect(layerAt(p, c, 0)?.scaleY).toBeUndefined();
    expect(setUniformScale(p, [c.id], true)).toEqual(p);
  });
});

describe("setFlip", () => {
  it("sets the directions asked and keeps the other", () => {
    const p = createProject();
    const c = createColorClip("#fff", 0, 60);
    p.tracks[0].clips = [c];
    const h = setFlip(p, [c.id], { horizontal: true }).tracks[0].clips[0] as typeof c;
    expect(h.transform).toMatchObject({ flipX: true, flipY: false });
    const v = setFlip({ ...p, tracks: [{ ...p.tracks[0], clips: [h] }] }, [c.id], { vertical: true }).tracks[0].clips[0] as typeof c;
    expect(v.transform).toMatchObject({ flipX: true, flipY: true });
    expect(setFlip(p, [c.id], { horizontal: false })).toEqual(p);
  });
});

describe("liftRange", () => {
  it("lifts a range out of every unlocked track, leaving a gap, or extracts it", () => {
    const p = createProject();
    const a = createColorClip("#111", 0, 100);
    const b = createColorClip("#222", 100, 50);
    const o = createColorClip("#333", 40, 40);
    p.tracks = [{ ...p.tracks[0], clips: [a, b] }, { ...createTrack("video", "O"), clips: [o] }];
    const lifted = liftRange(p, 30, 60, false);
    expect(lifted.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[0, 30], [60, 40], [100, 50]]);
    expect(lifted.tracks[1].clips.map((c) => [c.start, c.duration])).toEqual([[60, 20]]);
    const extracted = liftRange(p, 30, 60, true);
    expect(extracted.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[0, 30], [30, 40], [70, 50]]);
    expect(extracted.tracks[1].clips.map((c) => [c.start, c.duration])).toEqual([[30, 20]]);
    const locked = { ...p, tracks: [p.tracks[0], { ...p.tracks[1], locked: true }] };
    expect(liftRange(locked, 30, 60, true).tracks[1]).toBe(locked.tracks[1]);
  });
});


it("moves the last equal-length shot to the very front with magnet", () => {
  const p = project([0, 120, 0], [120, 120, 0], [240, 120, 0]);
  expect(moveClip(p, "c3", p.tracks[0].id, 0, { magnet: true }).tracks[0].clips.map(c => c.id)).toEqual(["c3", "c1", "c2"]);
});

it("keeps a bed spanning two unequal shots fixed when inserting at the front", () => {
  const p = project([0, 180, 0], [180, 240, 0]);
  const bed = { ...clipForAsset(asset, 0, p.fps), type: "audio", id: "bed", duration: 420 } as Clip;
  p.tracks.push({ ...createTrack("audio", "Music"), clips: [bed] });
  const after = { ...p, tracks: p.tracks.map(t => t.main ? { ...t, clips: [createColorClip("#fff", 0, 150), ...t.clips.map(c => ({ ...c, start: c.start + 150 }))] } : t) };
  expect(findClip(settle(p, after, { magnet: true, linkage: true }), "bed")!.clip.start).toBe(0);
});


it("inserts unequal clips before the first shot and resolves center ties before", () => {
  const p = project([0, 60, 0], [60, 120, 0], [180, 240, 0]);
  for (const start of [0, -90]) {
    expect(moveClip(p, "c3", p.tracks[0].id, start, { magnet: true }).tracks[0].clips.map(c => c.id)).toEqual(["c3", "c1", "c2"]);
  }
  const equal = project([0, 120, 0], [120, 120, 0], [240, 120, 0]);
  expect(moveClip(equal, "c3", equal.tracks[0].id, 120, { magnet: true }).tracks[0].clips.map(c => c.id)).toEqual(["c1", "c3", "c2"]);
});
