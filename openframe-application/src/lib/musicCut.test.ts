// A song cut on its bars and joined with a crossfade (film test 3.15,
// ADR-104): the cut, the exact jump, and the join the mixer then plays.

import { describe, expect, it } from "vitest";
import { audioCrossfade, clipGainAt, soundOverlaps } from "./audio";
import { runCommand } from "./commands";
import { cutMusic, MUSIC_CROSSFADE, nearestLine, setCrossfade } from "./musicCut";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, findClip, updateClip } from "./project/ops";
import type { Asset, AudioClip, Clip, Project } from "./project/types";

const song = (bpm = 120, firstDownbeat = 0): Asset => ({ id: "song", kind: "audio", name: "song.wav", src: "song.wav", duration: 56, hasVideo: false, hasAudio: true, musicGrid: { bpm, firstDownbeat } });

function withSong(asset = song()): { p: Project; id: string; track: string } {
  let p: Project = { ...createProject(), assets: [asset] };
  const t = createTrack("audio", "Music");
  p = addTrack(p, t);
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, track_id: t.id });
  return { p, id: p.tracks.find((x) => x.id === t.id)!.clips[0].id, track: t.id };
}
const clipsOf = (p: Project, track: string) => p.tracks.find((t) => t.id === track)!.clips as AudioClip[];

describe("cut_music", () => {
  it("cuts the film's splice on its bars and joins it with a crossfade", () => {
    const { p, id, track } = withSong();
    // The film test's cut, 14-30 s of the 120 BPM promo, asked a little off the bars.
    const q = runCommand(p, "cut_music", { clip_id: id, from: 13.9, to: 30.2 });
    const [a, b] = clipsOf(q, track);
    expect([a.in, a.start, a.duration]).toEqual([0, 0, 420]);
    expect([b.in, b.start]).toEqual([30, 420]);
    expect(a.crossfade).toBe(MUSIC_CROSSFADE);
    // The mixer crossfades it: b rises over the 30 ms before the cut, a falls.
    const o = soundOverlaps(q);
    expect(o.get(a.id)).toEqual({ pre: 0, post: 0, fall: MUSIC_CROSSFADE });
    expect(o.get(b.id)).toEqual({ pre: MUSIC_CROSSFADE, post: 0, rise: true });
  });

  it("keeps the beat when the bars do not fall on frames: the jump is whole bars", () => {
    // 128 BPM: a bar is 1.875 s, 56.25 frames at 30 fps.
    const { p, id, track } = withSong(song(128, 0.1));
    const r = cutMusic(p, { clip_id: id, from: 8, to: 16 });
    expect(r.from).toBeCloseTo(7.6, 6);
    expect(r.to).toBeCloseTo(15.1, 6);
    const [a, b] = clipsOf(r.project, track);
    const stop = a.in + a.duration / 30;
    // Four bars exactly, though a ends on a whole frame.
    expect(b.in - stop).toBeCloseTo(4 * 1.875, 6);
    expect(r.join).toMatchObject({ clips: [a.id, b.id], crossfade: MUSIC_CROSSFADE });
  });

  it("stops before the bar line and starts before the downbeat when the bar falls between frames", () => {
    // 128 BPM from 0.004 s: the bar at 3.754 s is frame 112.6, which rounds
    // late. The first piece played 13 ms of the next downbeat as it fell, and
    // the second came in 13 ms into its own: the cut's downbeat lost its attack.
    const { p, id, track } = withSong(song(128, 0.004));
    const r = cutMusic(p, { clip_id: id, from: 3.754, to: 9.379 });
    const [a, b] = clipsOf(r.project, track);
    const stop = a.in + a.duration / 30;
    expect(stop).toBeLessThanOrEqual(3.754 + 1e-9);
    expect(stop).toBeGreaterThan(3.754 - 1 / 30);
    expect(b.in).toBeLessThanOrEqual(9.379 + 1e-9);
    expect(b.in - stop).toBeCloseTo(3 * 1.875, 6);
    // A cut at the head leaves the song starting on its bar line, not a frame after.
    const head = cutMusic(p, { clip_id: id, from: 0, to: 3.754 });
    const [first] = clipsOf(head.project, track);
    expect(first.start).toBe(0);
    expect(first.in).toBeCloseTo(3.754, 6);
  });

  it("snaps to beats, or not at all, and needs a grid to snap", () => {
    expect(nearestLine({ bpm: 120, firstDownbeat: 0 }, 14.3, "beat")).toBe(14.5);
    expect(nearestLine({ bpm: 120, firstDownbeat: 0 }, 14.3, "bar")).toBe(14);
    const bare = withSong({ ...song(), musicGrid: undefined });
    expect(() => runCommand(bare.p, "cut_music", { clip_id: bare.id, from: 14, to: 30 })).toThrow(/no grid.*set_music_grid/);
    const q = runCommand(bare.p, "cut_music", { clip_id: bare.id, from: 14.3, to: 30.3, snap: "none", crossfade: 0 });
    const [a, b] = clipsOf(q, bare.track);
    expect(b.in - (a.in + a.duration / 30)).toBeCloseTo(16, 6);
    expect(a.crossfade).toBeUndefined();
  });

  it("says what it cut", () => {
    const { p, id } = withSong();
    const report: { notes?: string[] } = {};
    runCommand(p, "cut_music", { clip_id: id, from: 14, to: 30 }, report);
    expect(report.notes?.[0]).toMatch(/Cut 14-30 s of the song's file, 8 bars at 120 BPM; the pieces meet at 14 s on the timeline with a 0.03 s crossfade/);
  });
});

describe("set_crossfade", () => {
  it("crossfades a butt splice at equal power, ending at the cut", () => {
    const { p, id, track } = withSong();
    const cut = runCommand(p, "cut_ranges", { clip_id: id, ranges: [{ start: 14, end: 30 }] });
    const [a0, b0] = clipsOf(cut, track);
    // A butt cut: each side ramps to nothing over 4 ms at the cut.
    expect(soundOverlaps(cut).get(a0.id)).toBeUndefined();
    const t = cut.tracks.find((x) => x.id === track)!;
    expect(clipGainAt(a0, t, cut.fps, 14 - 0.001)).toBeCloseTo(0.25, 2);
    expect(clipGainAt(b0, t, cut.fps, 14 + 0.001)).toBeCloseTo(0.25, 2);
    const q = runCommand(cut, "set_crossfade", { clip_id: a0.id, seconds: 0.05 });
    const [a, b] = clipsOf(q, track);
    const o = soundOverlaps(q);
    const g = (c: AudioClip, at: number) => clipGainAt(c, t, q.fps, at, o.get(c.id));
    for (const at of [13.95, 13.96, 13.975, 13.99, 13.999]) expect(g(a, at) ** 2 + g(b, at) ** 2).toBeCloseTo(1, 6);
    // Before the crossfade only a sounds, from the cut only b: no hole.
    expect([g(a, 13.9), g(b, 13.9)]).toEqual([1, 0]);
    expect(g(a, 14)).toBe(0);
    expect(g(b, 14.0005)).toBe(1);
    // 0 makes it a butt cut again.
    expect((findClip(runCommand(q, "set_crossfade", { clip_id: a.id, seconds: 0 }), a.id)!.clip as AudioClip).crossfade).toBeUndefined();
  });

  it("refuses a join that is not one: nothing after it, a split, no file before the next clip", () => {
    const { p, id, track } = withSong();
    expect(() => setCrossfade(p, id, 0.03)).toThrow(/nothing starts where/);
    const split = runCommand(p, "split", { clip_ids: [id], at: 10 });
    expect(() => setCrossfade(split, clipsOf(split, track)[0].id, 0.03)).toThrow(/goes on in the same file/);
    // The next clip plays its file from 0.01 s: there is 0.01 s to rise over.
    const cut = runCommand(p, "cut_ranges", { clip_id: id, ranges: [{ start: 14, end: 30 }] });
    const [a, b] = clipsOf(cut, track);
    const head = updateClip(cut, b.id, (c) => ({ ...c, in: 0.01 }) as Clip);
    expect(() => setCrossfade(head, a.id, 0.03)).toThrow(/at most 0.01 s here: .* 0.01 s of its file before its in-point/);
    // Nor more than half of either clip.
    expect(() => setCrossfade(cut, a.id, 1.5)).not.toThrow();
    expect(() => setCrossfade(runCommand(cut, "trim_clip", { clip_id: a.id, edge: "start", to: 13.9, ripple: false }), a.id, 0.2)).toThrow(/half of either clip/);
  });

  it("stays with the clip's end when the clip is split", () => {
    // The left half's join is a split: a crossfade kept there showed in
    // describe_project where none plays, and came back if the right half went.
    const { p, id, track } = withSong();
    const q = runCommand(runCommand(p, "cut_music", { clip_id: id, from: 14, to: 30 }), "split", { clip_ids: [id], at: 7 });
    const [left, right, after] = clipsOf(q, track);
    expect(left.crossfade).toBeUndefined();
    expect(right.crossfade).toBe(MUSIC_CROSSFADE);
    expect(audioCrossfade(right, after, q.fps)).toBe(MUSIC_CROSSFADE);
  });

  it("plays no crossfade where the clips no longer meet", () => {
    const { p, id, track } = withSong();
    const q = runCommand(p, "cut_music", { clip_id: id, from: 14, to: 30 });
    const [a, b] = clipsOf(q, track);
    expect(audioCrossfade(a, b, q.fps)).toBe(MUSIC_CROSSFADE);
    expect(audioCrossfade(a, { ...b, start: b.start + 3 }, q.fps)).toBe(0);
  });
});
