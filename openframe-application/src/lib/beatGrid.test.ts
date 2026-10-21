// A song's beat grid for a person (ADR-119): taps to a tempo, the grid as
// the clip draws it, the playhead's file second, and the bars Cut bars
// takes out, each through the agent's own commands.

import { describe, expect, it } from "vitest";
import { barCut, firstBar, fitGrid, gridArgs, gridTicks, isSong, sourceAtFrame, tapTempo, withPart } from "./beatGrid";
import { runCommand } from "./commands";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, updateClip } from "./project/ops";
import type { Asset, AudioClip, Clip, Project } from "./project/types";

const song = (grid = true): Asset => ({ id: "song", kind: "audio", name: "Liftoff.wav", src: "song.wav", duration: 40, hasVideo: false, hasAudio: true, ...(grid ? { musicGrid: { bpm: 120, firstDownbeat: 0.25 } } : {}) });

function withSong(asset = song()): { p: Project; id: string; track: string } {
  let p: Project = { ...createProject(), assets: [asset] };
  const t = createTrack("audio", "Music");
  p = addTrack(p, t);
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, track_id: t.id });
  return { p, id: p.tracks.find((x) => x.id === t.id)!.clips[0].id, track: t.id };
}
const clipOf = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as AudioClip;

describe("isSong", () => {
  it("offers the grid to a song: a grid given, or music by its file or track, never a voice line", () => {
    const { p, id } = withSong(song(false));
    expect(isSong(p, id)).toBe(true);
    expect(isSong({ ...p, tracks: p.tracks.map((t) => (t.kind === "audio" ? { ...t, role: "dialog" as const } : t)) }, id)).toBe(false);
    const voice: Asset = { ...song(false), speech: { text: "Hello there." } as Asset["speech"] };
    const v = withSong(voice);
    expect(isSong(v.p, v.id)).toBe(false);
    // A grid wins over the track it sits on.
    const g = withSong(song(true));
    expect(isSong({ ...g.p, tracks: g.p.tracks.map((t) => (t.kind === "audio" ? { ...t, role: "effects" as const } : t)) }, g.id)).toBe(true);
  });
});

describe("tapTempo", () => {
  it("reads steady taps to a tenth of a beat a minute, from four", () => {
    const at = (n: number, ms: number, from = 1000) => Array.from({ length: n }, (_, i) => from + i * ms);
    expect(tapTempo(at(3, 500))).toBeNull();
    expect(tapTempo(at(4, 500))).toBe(120);
    // 128 BPM, each tap up to 15 ms off: the span's mean barely moves.
    const jitter = [0, 12, -9, 15, -14, 6, -3, 10, 0];
    expect(tapTempo(at(9, 468.75).map((t, i) => t + jitter[i]))).toBeCloseTo(128, 0);
  });

  it("starts again after a pause, and a stray tap does not drag it", () => {
    const run = [0, 500, 1000, 1500, 2000];
    // A pause over two seconds: the old run is forgotten.
    expect(tapTempo([...run, 6000, 6400, 6800])).toBeNull();
    expect(tapTempo([...run, 6000, 6400, 6800, 7200])).toBe(150);
    // One double tap among steady ones: the median holds.
    expect(tapTempo([0, 500, 1000, 1150, 1500, 2000, 2500])).toBe(120);
    expect(tapTempo([0, 100, 200, 300])).toBeNull();
  });
});

describe("the grid as a person edits it", () => {
  it("reads the first bar line whichever bar the grid was given, and gives set_music_grid's arguments", () => {
    expect(firstBar({ bpm: 120, firstDownbeat: 0.25 })).toBe(0.25);
    expect(firstBar({ bpm: 120, firstDownbeat: 16.25 })).toBe(0.25);
    expect(gridArgs("c_1", { bpm: 127.99999, firstDownbeat: 16.25, sections: [{ at: 0, label: "intro" }] })).toEqual({ clip_id: "c_1", bpm: 128, first_downbeat: 16.25, sections: [{ at: 0, label: "intro" }] });
  });

  it("adds a part at a time, relabeling one already there", () => {
    const parts = withPart([{ at: 0, label: "intro" }, { at: 16.25, label: "build" }], 16.26, "drop");
    expect(parts).toEqual([{ at: 0, label: "intro" }, { at: 16.26, label: "drop" }]);
    expect(withPart(undefined, 8, "drop")).toEqual([{ at: 8, label: "drop" }]);
  });

  it("finds the file second at the playhead through a trim and a speed change", () => {
    const { p, id } = withSong();
    const c = { ...clipOf(p, id), in: 2, start: 30 } as AudioClip;
    expect(sourceAtFrame(c, 30, p.fps)).toBe(2);
    expect(sourceAtFrame(c, 45, p.fps)).toBe(2.5);
    expect(sourceAtFrame({ ...c, speed: 2 }, 45, p.fps)).toBe(3);
    expect(sourceAtFrame(c, 29, p.fps)).toBeNull();
  });

  it("gives a corrected grid through set_music_grid, its markers placed again", () => {
    const { p: p0, id } = withSong();
    let p = runCommand(p0, "set_music_grid", { ...gridArgs(id, { bpm: 120, firstDownbeat: 0.2 }), markers: ["bars"] });
    const bars = () => p.markers.filter((m) => m.label === "Bar").map((m) => m.frame);
    expect(bars().slice(0, 2)).toEqual([6, 66]);
    // Nudged 100 ms later: the bars follow.
    p = runCommand(p, "set_music_grid", gridArgs(id, { bpm: 120, firstDownbeat: 0.3 }));
    expect(bars().slice(0, 2)).toEqual([9, 69]);
    expect(p.assets[0].musicGrid).toEqual({ bpm: 120, firstDownbeat: 0.3 });
  });
});

describe("fitGrid", () => {
  it("draws one line through tracked beats: a tempo read 0.5% off, a missed beat and jitter", () => {
    // 128 BPM from 0.1 s, bars on the first beat, two minutes; beat 40 missed.
    const beats = Array.from({ length: 256 }, (_, i) => 0.1 + i * 0.46875 + (i % 3 === 0 ? 0.004 : -0.002)).filter((_, i) => i !== 40);
    const downbeats = beats.filter((t) => Math.round((t - 0.1) / 0.46875) % 4 === 0);
    expect(fitGrid(beats, downbeats, 127.4)).toEqual({ bpm: 128, firstDownbeat: 0.1 });
    // Bars on the third beat: the first bar line at 1.0375.
    const late = downbeats.map((t) => t + 2 * 0.46875);
    expect(fitGrid(beats, late, 128).firstDownbeat).toBeCloseTo(1.0375, 3);
    // Too few beats to fit: the reading as it was.
    expect(fitGrid([0.5, 1, 1.5], [0.5], 120)).toEqual({ bpm: 120, firstDownbeat: 0.5 });
  });
});

describe("gridTicks", () => {
  it("draws beats where they play, bars marked, thinned as the timeline zooms out", () => {
    const { p, id } = withSong();
    const c = clipOf(p, id);
    // 30 fps, 120 BPM: a beat is 15 frames. At 1 px a frame, beats.
    const near = gridTicks(c, p.assets[0].musicGrid!, 40, p.fps, 1, 0, 100);
    expect(near.map((t) => t.x)).toEqual([7.5, 22.5, 37.5, 52.5, 67.5, 82.5, 97.5]);
    expect(near.filter((t) => t.bar).map((t) => t.x)).toEqual([7.5, 67.5]);
    // At a third of a pixel a frame a beat is 5 px: bars only.
    const far = gridTicks(c, p.assets[0].musicGrid!, 40, p.fps, 1 / 3, 0, 100);
    expect(far.every((t) => t.bar)).toBe(true);
    expect(far.map((t) => t.x).slice(0, 2)).toEqual([2.5, 22.5]);
    // Further out, every fourth bar; and only what is in view.
    expect(gridTicks(c, p.assets[0].musicGrid!, 40, p.fps, 0.1, 0, 1000).map((t) => t.x)).toEqual([0.75, 24.75, 48.75, 72.75, 96.75]);
    expect(gridTicks(c, p.assets[0].musicGrid!, 40, p.fps, 1, 30, 60).map((t) => t.x)).toEqual([37.5, 52.5]);
  });

  it("follows a trim and a speed change", () => {
    const { p, id } = withSong();
    const c = { ...clipOf(p, id), in: 1, speed: 2 } as AudioClip;
    // From file 1 s at double speed: the bar at 2.25 s plays 0.625 s in.
    const bars = gridTicks(c, p.assets[0].musicGrid!, 40, p.fps, 1, 0, 200).filter((t) => t.bar);
    expect(bars[0].x).toBeCloseTo(18.75, 6);
  });
});

describe("barCut", () => {
  it("takes the bars between In and Out to the nearest bar lines, as cut_music does", () => {
    const { p, id, track } = withSong();
    // 120 BPM from 0.25 s: bars at 2.25, 4.25 ... In at 2.2 s, Out at 10.3 s.
    const r = barCut(p, id, 66, 309);
    expect(r).toEqual({ from: 2.25, to: 10.25, bars: 4 });
    const { from, to } = r as { from: number; to: number };
    const q = runCommand(p, "cut_music", { clip_id: id, from, to });
    const [a, b] = q.tracks.find((t) => t.id === track)!.clips as AudioClip[];
    expect(b.in - (a.in + a.duration / 30)).toBeCloseTo(8, 6);
    expect(a.crossfade).toBe(0.03);
  });

  it("says what to change when it cannot", () => {
    const { p, id } = withSong();
    expect(barCut(p, id, null, null)).toEqual({ why: "Mark In and Out around the bars to cut first." });
    expect(barCut(p, id, 66, 80)).toEqual({ why: "Less than half a bar lies between In and Out: mark at least one bar." });
    const moved = updateClip(p, id, (c) => ({ ...c, start: 600 }) as Clip);
    expect(barCut(moved, id, 0, 300)).toEqual({ why: "The In and Out marks are not over this clip." });
    expect(barCut(updateClip(p, id, (c) => ({ ...c, speed: 1.5 }) as Clip), id, 0, 300)).toMatchObject({ why: /own speed/ });
    const bare = withSong(song(false));
    expect(barCut(bare.p, bare.id, 0, 300)).toMatchObject({ why: /Detect beat grid/ });
    // In alone runs to the clip's end, as Extract reads it.
    expect(barCut(p, id, 1146, null)).toEqual({ from: 38.25, to: 40, bars: 1 });
  });
});
