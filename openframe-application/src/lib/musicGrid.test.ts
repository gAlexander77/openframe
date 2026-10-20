// A song's grid on edited clips (ADR-101): markers that follow their clip
// through moves, trims, speed changes and splits; a grid given by hand
// (set_music_grid) that analysis, the markers and check_project use.

import { describe, expect, it } from "vitest";
import { gridHints, gridStructure, mapMusic, readMusicGrid } from "./analysis/musicMap";
import type { MusicStructure } from "./analysis/beats";
import { describeProject, runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { markMusicClip } from "./epic";
import { followClips, markClip, updateMarker } from "./markers";
import { describeChanges } from "./mcp";
import { createProject, normalizeProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { AudioClip, Project } from "./project/types";

// 30 fps; a 41.25 s song at 128 BPM from 0 s (the promo's Liftoff): a beat
// every 0.46875 s, a bar every 1.875 s; intro, build at 7.5, drop at 15, outro at 33.75.
const BEAT = 60 / 128, BAR = 4 * BEAT;
const LIFTOFF = { bpm: 128, firstDownbeat: 0, sections: [{ at: 0, label: "intro" as const }, { at: 7.5, label: "build" as const }, { at: 15, label: "drop" as const }, { at: 33.75, label: "outro" as const }] };

function project(): { p: Project; id: string } {
  let p: Project = {
    ...createProject(),
    assets: [
      { id: "song", kind: "audio", name: "liftoff.m4a", src: "liftoff.m4a", duration: 41.25, hasVideo: false, hasAudio: true },
      { id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 60, hasVideo: true, hasAudio: false },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 40 });
  p = runCommand(p, "add_track", { kind: "audio", name: "Music", role: "music" });
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, track_id: p.tracks.find((t) => t.kind === "audio")!.id });
  const id = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!.id;
  return { p, id };
}

/** Each marker's distance to where the song's true grid plays, in frames (worst). */
function worst(p: Project, id: string, label: string, step: number): number {
  const c = findClip(p, id)!.clip as AudioClip;
  const ms = p.markers.filter((m) => m.label === label);
  expect(ms.length).toBeGreaterThan(0);
  return Math.max(
    ...ms.map((m) => {
      // The file second this frame plays, against the nearest grid line.
      const s = c.in + ((m.frame - c.start) / 30) * c.speed;
      return Math.abs(s - Math.round(s / step) * step) * (30 / c.speed);
    }),
  );
}

describe("markers that follow a song's clip", () => {
  it("stay on the song's beats through a trim, a move and a speed change", () => {
    let { p, id } = project();
    const s = gridStructure(LIFTOFF, 41.25);
    p = markMusicClip(p, id, s, ["beats", "bars", "drop"]);
    expect(p.markers.filter((m) => m.label === "Drop").map((m) => m.frame)).toEqual([450]);
    p = runCommand(p, "trim_clip", { clip_id: id, edge: "start", to: 3.2 });
    // The trimmed-off beats go with the trimmed-off song.
    expect(p.markers.every((m) => m.frame >= 96)).toBe(true);
    p = runCommand(p, "move_clip", { clip_id: id, start: 1 });
    p = runCommand(p, "set_speed", { clip_id: id, speed: 1.25 });
    // Within half a frame of the true grid, and the drop where 15 s now plays.
    expect(worst(p, id, "Beat", BEAT)).toBeLessThanOrEqual(0.5001);
    expect(worst(p, id, "Bar", BAR)).toBeLessThanOrEqual(0.5001);
    expect(p.markers.find((m) => m.label === "Drop")!.frame).toBe(Math.round((1 + (15 - 3.2) / 1.25) * 30));
    // Every marker still names the clip and the second of the file it marks.
    expect(p.markers.every((m) => m.follows?.clip === id)).toBe(true);
  });

  it("move to the other half of a split, and go when nothing plays their second", () => {
    let { p, id } = project();
    p = markMusicClip(p, id, gridStructure(LIFTOFF, 41.25), ["bars"]);
    const bars = p.markers.length;
    p = runCommand(p, "split", { clip_ids: [id], at: 20 });
    const right = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio" && c.id !== id)!.id;
    expect(p.markers).toHaveLength(bars);
    expect(p.markers.filter((m) => m.follows!.clip === right).every((m) => m.frame >= 600)).toBe(true);
    // The left half goes, its bars with it; the right half's stay where they play.
    p = runCommand(p, "delete_clips", { clip_ids: [id] });
    expect(p.markers.length).toBe(p.markers.filter((m) => m.follows!.clip === right).length);
    expect(p.markers.length).toBeGreaterThan(5);
    expect(p.markers.every((m) => m.frame >= 600)).toBe(true);
  });

  it("are the user's once moved by hand, and other markers never move", () => {
    let { p, id } = project();
    p = runCommand(p, "add_marker", { at: 2, label: "Note" });
    p = markMusicClip(p, id, gridStructure(LIFTOFF, 41.25), ["bars"]);
    const bar = p.markers.find((m) => m.label === "Bar" && m.frame > 100)!;
    p = updateMarker(p, bar.id, { frame: bar.frame + 3 });
    p = runCommand(p, "move_clip", { clip_id: id, start: 2 });
    expect(p.markers.find((m) => m.id === bar.id)!.frame).toBe(bar.frame + 3);
    expect(p.markers.find((m) => m.label === "Note")!.frame).toBe(60);
  });

  it("are replaced by a second reading instead of doubled", () => {
    let { p, id } = project();
    p = markClip(p, id, [{ label: "Beat", color: "#fff", at: [0.1, 0.6, 1.1] }]);
    p = runCommand(p, "add_markers", { times: [1], label: "Beat" });
    // Unlinked old markers on the new frames go too.
    p = markClip(p, id, [{ label: "Beat", color: "#fff", at: [0, 0.5, 1] }]);
    expect(p.markers.map((m) => m.frame)).toEqual([0, 15, 30]);
    expect(followClips(p)).toBe(p);
  });

  it("follow inside a compound, and survive saving", () => {
    let { p, id } = project();
    p = markMusicClip(p, id, gridStructure(LIFTOFF, 41.25), ["drop"]);
    const saved = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(saved.markers[0].follows).toEqual({ clip: id, at: 15 });
    expect(describeProject(saved).markers[0]).toMatchObject({ at: 15, label: "Drop", clip: id });
  });
});

describe("a song's grid given by hand (set_music_grid)", () => {
  it("is every beat, bar, phrase, part and drop of the song, in its file's seconds", () => {
    const g = gridStructure(LIFTOFF, 41.25);
    expect(g.beats).toHaveLength(88);
    expect(g.beats[3]).toBeCloseTo(3 * BEAT, 3);
    expect(g.downbeats.slice(0, 3)).toEqual([0, 1.875, 3.75]);
    // Phrases start where the parts do: 7.5 s is bar 4.
    expect(g.phrases.slice(0, 3)).toEqual([0, 7.5, 15]);
    expect(g.sections.map((x) => [x.label, x.start, x.end])).toEqual([["intro", 0, 7.5], ["build", 7.5, 15], ["drop", 15, 33.75], ["outro", 33.75, 41.25]]);
    expect([g.drops, g.drop]).toEqual([[15], 15]);
    // A downbeat late in the song still sets the phase from the start.
    expect(gridStructure({ bpm: 120, firstDownbeat: 4.25 }, 10).downbeats.slice(0, 2)).toEqual([0.25, 2.25]);
  });

  it("checks what it is given, and is read before analysis guesses", () => {
    expect(() => readMusicGrid({ bpm: 128 })).toThrow(/first_downbeat/);
    expect(() => readMusicGrid({ bpm: 300, first_downbeat: 0 })).toThrow(/bpm/);
    expect(readMusicGrid({ bpm: 128, first_downbeat: 0, sections: [{ at: 15, label: "drop" }, { at: 0, label: "intro" }] }).sections!.map((x) => x.at)).toEqual([0, 15]);
    // analyze_music's hints: the grid, a call's own hint winning.
    expect(gridHints(LIFTOFF, { bpm: 127 })).toMatchObject({ bpm: 127, firstDownbeat: 0, cues: LIFTOFF.sections });
    expect(gridHints(undefined, { bpm: 127 })).toEqual({ bpm: 127 });
  });

  it("is kept with the song, places its markers on the clip, and replaces a wrong reading's", () => {
    let { p, id } = project();
    // A wrong reading: bars half a beat late, and no drop.
    p = markClip(p, id, [{ label: "Bar", color: "#ff9f43", at: [0.234, 2.109, 3.984] }, { label: "Beat", color: "#f5c543", at: [0.234, 0.703] }]);
    const before = describeProject(p);
    const report = { notes: [] as string[] };
    p = runCommand(p, "set_music_grid", { clip_id: id, bpm: 128, first_downbeat: 0, sections: LIFTOFF.sections }, report);
    expect(p.assets.find((a) => a.id === "song")!.musicGrid).toEqual(LIFTOFF);
    // By default the kinds the clip was marked with, read from the grid.
    expect(worst(p, id, "Bar", BAR)).toBeLessThanOrEqual(0.5001);
    expect(p.markers.filter((m) => m.label === "Bar")).toHaveLength(22);
    expect(p.markers.filter((m) => m.label === "Beat")).toHaveLength(88);
    expect(report.notes[0]).toMatch(/128 BPM as it plays, a bar every 1\.875 s from 0 s, drop at 15 s; markers placed: bars, beats/);
    // The answer: the asset's grid, and the markers summed up, not listed.
    const ans = describeChanges(before, describeProject(p)) as Record<string, unknown>;
    expect(ans.changed_assets).toEqual([expect.objectContaining({ id: "song", music_grid: { bpm: 128, first_downbeat: 0, sections: LIFTOFF.sections } })]);
    expect(ans.added_markers).toMatchObject({ count: 110, by_label: { Bar: 22, Beat: 88 } });
    expect(JSON.stringify(ans).length).toBeLessThan(1500);
    // Drop markers on request; and the grid follows a sped-up clip.
    p = runCommand(p, "set_speed", { clip_id: id, speed: 1.25 });
    const sped = { notes: [] as string[] };
    p = runCommand(p, "set_music_grid", { clip_id: id, bpm: 128, first_downbeat: 0, sections: LIFTOFF.sections, markers: ["drop"] }, sped);
    expect(p.markers.filter((m) => m.label === "Drop").map((m) => m.frame)).toEqual([360]);
    expect(sped.notes[0]).toMatch(/160 BPM as it plays \(128 in the file\), a bar every 1\.5 s from 0 s, drop at 12 s/);
    // Forgotten on request; the markers stay until read again.
    p = runCommand(p, "set_music_grid", { clip_id: id, clear: true });
    expect(p.assets.find((a) => a.id === "song")!.musicGrid).toBeUndefined();
    expect(() => runCommand(p, "set_music_grid", { clip_id: id, bpm: 128, first_downbeat: 0, markers: ["drop"] })).toThrow(/sections/);
  });

  it("is the beat grid check_project judges an epic edit's cuts by", () => {
    let { p } = project();
    const id = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!.id;
    // Cuts on the bars of the music as it plays from 1 s.
    p = runCommand(p, "move_clip", { clip_id: id, start: 1 });
    p = runCommand(p, "split_at_times", { clip_id: p.tracks[0].clips[0].id, times: [1 + BAR * 2, 1 + BAR * 4] });
    const rules = (q: Project) => checkProject(q, "epic_edit").findings.map((f) => f.rule);
    expect(rules(p)).toContain("no_beat_grid");
    p = runCommand(p, "set_music_grid", { clip_id: id, bpm: 128, first_downbeat: 0, markers: [] });
    expect(p.markers).toHaveLength(0);
    expect(rules(p)).not.toContain("no_beat_grid");
    expect(rules(p)).not.toContain("cuts_off_beat");
    // Half a beat off the grid is off the beat.
    p = runCommand(p, "set_music_grid", { clip_id: id, bpm: 128, first_downbeat: BEAT / 4, markers: [] });
    expect(rules(p)).toContain("cuts_off_beat");
  });
});

describe("a song's tempo as its clip plays it", () => {
  it("is the file's tempo times the clip's speed", () => {
    const m: MusicStructure = { bpm: 128, beats: [0, BEAT], downbeats: [0], phrases: [0], energy: [1, 1], hits: [], sections: [], drop: null, drops: [], rises: [], confidence: { tempo: 1, bars: 1, sections: 1 } };
    const clip = (speed: number) => ({ id: "c", type: "audio", assetId: "a", start: 0, duration: 300, in: 0, speed, volume: 1 }) as unknown as AudioClip;
    expect(mapMusic(m, clip(1), { num: 30, den: 1 })).toMatchObject({ bpm: 128 });
    expect(mapMusic(m, clip(1), { num: 30, den: 1 })).not.toHaveProperty("file_bpm");
    expect(mapMusic(m, clip(1.25), { num: 30, den: 1 })).toMatchObject({ bpm: 160, file_bpm: 128 });
  });
});

describe("a song's markers through the edits that hid or cut its clip (ADR-106)", () => {
  const beats = (p: Project) => p.markers.filter((m) => m.label === "Beat");
  const marked = () => {
    const { p, id } = project();
    return { p: markMusicClip(p, id, gridStructure(LIFTOFF, 41.25), ["beats"]), id };
  };

  it("follow the song into a compound clip, its moves, and out again", () => {
    // Every marker went: the song's clip was no longer on the timeline.
    let { p, id } = marked();
    const frames = beats(p).map((m) => m.frame);
    p = runCommand(p, "create_compound_clip", { clip_ids: [p.tracks.find((t) => t.main)!.clips[0].id, id] });
    expect(beats(p).map((m) => m.frame)).toEqual(frames);
    const k = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!.id;
    p = runCommand(p, "move_clip", { clip_id: k, start: 2 });
    expect(beats(p).map((m) => m.frame)).toEqual(frames.map((f) => f + 60));
    p = runCommand(p, "break_compound_clip", { clip_id: k });
    expect(beats(p).map((m) => m.frame)).toEqual(frames.map((f) => f + 60));
    expect(beats(p).every((m) => m.follows!.clip === id)).toBe(true);
  });

  it("follow the song two compounds deep, and out again (ADR-110)", () => {
    // One compound deep only: a song in a compound inside a compound lost
    // every root marker.
    let { p, id } = marked();
    const frames = beats(p).map((m) => m.frame);
    p = runCommand(p, "create_compound_clip", { clip_ids: [p.tracks.find((t) => t.main)!.clips[0].id, id] });
    const inner = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!.id;
    p = runCommand(p, "create_compound_clip", { clip_ids: [inner] });
    expect(p.compounds).toHaveLength(2);
    expect(beats(p).map((m) => m.frame)).toEqual(frames);
    const outer = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!.id;
    p = runCommand(p, "move_clip", { clip_id: outer, start: 2 });
    expect(beats(p).map((m) => m.frame)).toEqual(frames.map((f) => f + 60));
    p = runCommand(p, "break_compound_clip", { clip_id: outer });
    p = runCommand(p, "break_compound_clip", { clip_id: inner });
    expect(beats(p).map((m) => m.frame)).toEqual(frames.map((f) => f + 60));
    expect(beats(p).every((m) => m.follows!.clip === id)).toBe(true);
  });

  it("are a unique copy's own inside it", () => {
    // The copy's markers named the original's clip, so all of them went.
    let { p, id } = project();
    p = runCommand(p, "create_compound_clip", { clip_ids: [p.tracks.find((t) => t.main)!.clips[0].id, id] });
    const k = p.compounds![0];
    p = runCommand(p, "edit_compound", { compound_id: k.id, command: "set_music_grid", args: { clip_id: id, bpm: 128, first_downbeat: 0, markers: ["bars"] } });
    expect(p.compounds![0].markers).toHaveLength(22);
    p = runCommand(p, "duplicate_clips", { clip_ids: [p.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!.id], unique: true, at: 45 });
    const copy = p.compounds!.find((x) => x.id !== k.id)!;
    expect(copy.markers).toHaveLength(22);
    const inner = new Set(copy.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    expect(copy.markers.every((m) => inner.has(m.follows!.clip))).toBe(true);
  });

  it("are not doubled on another clip of the song when one is trimmed", () => {
    // Two uses of the song, each read: trimming the first one's tail moved
    // its beats onto the second, which had its own on those frames.
    let { p, id } = project();
    const music = p.tracks.find((t) => t.kind === "audio")!.id;
    p = runCommand(p, "trim_clip", { clip_id: id, edge: "end", to: 10 });
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 20, duration: 10, track_id: music });
    const other = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio" && c.id !== id)!.id;
    p = markMusicClip(markMusicClip(p, id, gridStructure(LIFTOFF, 41.25), ["beats"]), other, gridStructure(LIFTOFF, 41.25), ["beats"]);
    const theirs = beats(p).filter((m) => m.follows!.clip === other).length;
    p = runCommand(p, "trim_clip", { clip_id: id, edge: "end", to: 5 });
    expect(beats(p).filter((m) => m.follows!.clip === other)).toHaveLength(theirs);
    expect(new Set(beats(p).map((m) => m.frame)).size).toBe(beats(p).length);
  });

  it("stay on the song when a cut takes its intro, which then starts on the bar line", () => {
    // cut_music from 0 deleted the clip's id with its first piece: all 88
    // beats went, and the piece left started half a frame before the bar.
    let { p, id } = marked();
    p = { ...p, assets: p.assets.map((a) => (a.id === "song" ? { ...a, musicGrid: { bpm: 128, firstDownbeat: 0 } } : a)) };
    p = runCommand(p, "cut_music", { clip_id: id, from: 0, to: 3.75 });
    expect(findClip(p, id)!.clip).toMatchObject({ start: 0, in: 3.75 });
    expect(beats(p)).toHaveLength(80);
    expect(beats(p).slice(0, 3).map((m) => m.frame)).toEqual([0, 14, 28]);
  });

  it("stand on the frame a command given the beat's second lands on", () => {
    // At 30 fps every eighth beat of a 128 BPM song falls between two
    // frames: 3.75 s is frame 112.5. add_markers, cut_to_beats' beats and
    // add_beat_hits' times take 112 (ADR-102); the marker took 113.
    const { p } = marked();
    const eighth = beats(p).find((m) => Math.abs(m.follows!.at - 3.75) < 1e-6)!;
    expect(eighth.frame).toBe(runCommand(p, "add_markers", { times: [3.75], label: "Mine" }).markers.find((m) => m.label === "Mine")!.frame);
    expect(eighth.frame).toBe(112);
  });
});
