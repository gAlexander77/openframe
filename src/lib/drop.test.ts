import { describe, expect, it } from "vitest";
import { landing, nearestCut, placeAsset, transitionCut, visualDrop } from "./drop";
import { clipForAsset, createProject, createTextClip, createTrack } from "./project/defaults";
import * as ops from "./project/ops";
import type { Asset, Project, Track } from "./project/types";

describe("drops", () => {
  // Main track [0,30) [30,90); a text track above it; audio below.
  const main: Track = { ...createTrack("video", "Main", true), clips: [createTextClip("a", 0, 30), createTextClip("b", 30, 60)] };
  const text: Track = { ...createTrack("video", "Text"), clips: [createTextClip("t", 10, 20)] };
  const tracks = [text, main, createTrack("audio", "Audio")];

  it("nearestCut picks the closest cut, the earlier on a tie", () => {
    expect(nearestCut(main, 12)).toBe(0);
    expect(nearestCut(main, 20)).toBe(30);
    expect(nearestCut(main, 60)).toBe(30);
    expect(nearestCut(main, 61)).toBe(90);
    expect(nearestCut(main, 400)).toBe(90);
    expect(nearestCut(createTrack("video", "Main", true), 50)).toBe(0);
  });

  it("above the top track makes an overlay at the drop time (UX-12)", () => {
    expect(visualDrop(tracks, -1, 47, true)).toEqual({ row: -1, frame: 47, insert: false });
    // Nothing to overlay yet: the first clip goes on the main track.
    expect(visualDrop([createTrack("video", "Main", true)], -1, 47, true)).toEqual({ row: 0, frame: 0, insert: true });
  });

  it("the magnetic main track inserts at the nearest cut (UX-13)", () => {
    expect(visualDrop(tracks, 1, 47, true)).toEqual({ row: 1, frame: 30, insert: true });
    expect(visualDrop(tracks, 1, 47, false)).toEqual({ row: 1, frame: 47, insert: false });
    // Audio rows, locked rows and the space below the tracks mean the main track.
    expect(visualDrop(tracks, 2, 80, true)).toEqual({ row: 1, frame: 90, insert: true });
    expect(visualDrop(tracks, 3, 80, true)).toEqual({ row: 1, frame: 90, insert: true });
    expect(visualDrop([{ ...text, locked: true }, main], 0, 5, true)).toEqual({ row: 1, frame: 0, insert: true });
  });

  it("an overlay track takes the clip where it is dropped", () => {
    expect(visualDrop(tracks, 0, 47, true)).toEqual({ row: 0, frame: 47, insert: false });
  });

  it("a transition goes on the nearest touching cut, on the main track when the row has none", () => {
    expect(transitionCut(tracks, 1, 70)).toEqual({ clipId: main.clips[0].id, row: 1, frame: 30 });
    expect(transitionCut(tracks, 0, 70)).toEqual({ clipId: main.clips[0].id, row: 1, frame: 30 });
    expect(transitionCut([createTrack("video", "Main", true)], 0, 10)).toBeNull();
  });
});

describe("landing", () => {
  const photo: Asset = { id: "photo", kind: "image", name: "photo.png", src: "photo.png", duration: 0, width: 1920, height: 1080, hasVideo: true, hasAudio: false };
  const music: Asset = { id: "music", kind: "audio", name: "music.mp3", src: "music.mp3", duration: 10, hasVideo: false, hasAudio: true };
  const fps = { num: 30, den: 1 };
  const still = clipForAsset(photo, 0, fps).duration;
  /** Two shots [0,90) [90,150), a title over the second, a bed under both. */
  const project = (): Project => {
    let p = createProject();
    const m = ops.mainTrack(p).id;
    p = ops.addClip(p, m, { ...createTextClip("one", 0, 90), id: "s1" });
    p = ops.addClip(p, m, { ...createTextClip("two", 90, 60), id: "s2" });
    const titles = createTrack("video", "Text");
    p = ops.addClip(ops.addTrack(p, titles, 0), titles.id, { ...createTextClip("title", 100, 30), id: "title" });
    const bed = createTrack("audio", "Audio");
    return ops.addClip(ops.addTrack(p, bed), bed.id, { ...clipForAsset(music, 0, fps), id: "bed" });
  };
  const drop = (p: Project, asset: Asset, start: number, to: string | undefined, magnet = true) => {
    const r = placeAsset(p, asset, start, to, magnet);
    return landing(p, ops.settle(p, r.project, { magnet, linkage: true }), r.clipId);
  };

  it("a main-track insert opens a gap: later shots and what is linked to them move", () => {
    const p = project();
    const l = drop(p, photo, 90, ops.mainTrack(p).id)!;
    expect(l).toMatchObject({ row: 1, newTrack: false, frame: 90, duration: still });
    expect(Object.fromEntries(l.shifts)).toEqual({ s2: still, title: still });
  });

  it("Insert splits the shot at the playhead and pushes the rest; Overwrite covers it", () => {
    const p = project();
    const span = (q: Project) => ops.mainTrack(q).clips.map((c) => [c.id === "s1" || c.id === "s2" ? c.id : "new", c.start, c.duration]);
    const ins = placeAsset(p, photo, 40, undefined, true, undefined, "insert");
    expect(span(ins.project)).toEqual([["s1", 0, 40], ["new", 40, still], ["s1", 40 + still, 50], ["s2", 90 + still, 60]].map((x, i) => (i === 2 ? [expect.any(String), x[1], x[2]] : x)));
    // A 5 s still from frame 40 covers the rest of s1 and all of s2 (to 150).
    const over = placeAsset(p, photo, 40, undefined, true, undefined, "overwrite");
    expect(span(over.project)).toEqual([["s1", 0, 40], ["new", 40, still]]);
    const short = placeAsset(p, photo, 100, undefined, true, undefined, "overwrite");
    expect(span(short.project)).toEqual([["s1", 0, 90], ["s2", 90, 10], ["new", 100, still]]);
  });

  it("an overlay is a new track at the top", () => {
    expect(drop(project(), photo, 40, "overlay")).toMatchObject({ row: 0, newTrack: true, frame: 40, shifts: new Map() });
  });

  it("an occupied spot opens a new track just above it (below it for audio)", () => {
    const p = project();
    expect(drop(p, photo, 110, p.tracks[0].id)).toMatchObject({ row: 0, newTrack: true, frame: 110 });
    expect(drop(p, photo, 140, p.tracks[0].id)).toMatchObject({ row: 0, newTrack: false, frame: 140 });
    expect(drop(p, photo, 20, ops.mainTrack(p).id, false)).toMatchObject({ row: 1, newTrack: true, frame: 20 });
    expect(drop(p, music, 20, p.tracks[2].id)).toMatchObject({ row: 3, newTrack: true, frame: 20 });
    expect(drop(p, music, 400, p.tracks[2].id)).toMatchObject({ row: 2, newTrack: false, frame: 400 });
  });

  it("audio with no room anywhere goes on a new track at the bottom", () => {
    expect(drop(project(), music, 20, undefined)).toMatchObject({ row: 3, newTrack: true });
  });

  it("is null when the drop places nothing", () => {
    const p = project();
    const locked = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, locked: true } : t)) };
    expect(drop(locked, photo, 140, locked.tracks[0].id)).toBeNull();
  });
});
