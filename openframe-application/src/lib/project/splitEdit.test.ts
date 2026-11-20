// J and L cuts (jl_cut, ADR-147).
import { describe, expect, it } from "vitest";
import { runAgentCommand, runCommand, type CommandReport } from "../commands";
import { createProject, createTrack } from "./defaults";
import { clipEnd, findClip, mainTrack } from "./ops";
import { currentOffset } from "./sync";
import type { AudioClip, Project, VideoClip } from "./types";

const fps = { num: 30, den: 1 };
const film = (): Project => ({
  ...createProject({ fps }),
  assets: [
    { id: "v", kind: "video", name: "interview.mp4", src: "interview.mp4", duration: 20, hasVideo: true, hasAudio: true },
    { id: "mute", kind: "video", name: "timelapse.mp4", src: "timelapse.mp4", duration: 20, hasVideo: true, hasAudio: false },
    { id: "song", kind: "audio", name: "song.mp3", src: "song.mp3", duration: 60, hasVideo: false, hasAudio: true },
  ],
});
/** Shots laid end to end from 0: [asset, in seconds, seconds] each. */
const shots = (...spec: [string, number, number][]) => {
  let p = film(), at = 0;
  for (const [asset, inS, d] of spec) {
    p = runCommand(p, "add_media_clip", { asset_id: asset, start: at, in: inS, duration: d });
    at += d;
  }
  return p;
};
const ids = (p: Project) => mainTrack(p).clips.map((c) => c.id);
const sounds = (p: Project) => p.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.clips.map((c) => ({ track: t.id, clip: c as AudioClip })));
/** A sound as [start, end, in] in seconds. */
const span = (c: AudioClip) => [c.start / 30, clipEnd(c) / 30, +c.in.toFixed(3)];

describe("jl_cut", () => {
  it("L cut: the outgoing sound runs on under the incoming picture, both in sync, nothing else moved", () => {
    const p = shots(["v", 0, 4], ["v", 10, 4]);
    const [a, b] = ids(p);
    const report: CommandReport = {};
    const q = runCommand(p, "jl_cut", { clip_id: a, by: 0.5 }, report);
    const [la, ra] = sounds(q);
    expect([span(la.clip), span(ra.clip)]).toEqual([[0, 4.5, 0], [4.5, 8, 10.5]]);
    expect(la.track).toBe(ra.track);
    // The join of two different sounds is crossfaded, as check_project asks of one (30 ms).
    expect([la.clip.crossfade, ra.clip.crossfade]).toEqual([0.03, undefined]);
    // The pictures keep their cut, give their sound away and stay grouped with it.
    for (const [video, sound] of [[a, la.clip], [b, ra.clip]] as const) {
      const v = findClip(q, video)!.clip as VideoClip;
      expect([v.start / 30, clipEnd(v) / 30, v.muted, v.group]).toEqual([video === a ? 0 : 4, video === a ? 4 : 8, true, sound.group]);
    }
    expect(report.notes![0]).toContain(`L cut: ${a}'s sound (${la.clip.id}) runs on 0.5 s under ${b}'s picture`);
  });

  it("J cut: the incoming sound starts under the outgoing picture; from the incoming clip's start edge too", () => {
    const p = shots(["v", 0, 4], ["v", 10, 4]);
    const [, b] = ids(p);
    const report: CommandReport = {};
    const q = runCommand(p, "jl_cut", { clip_id: b, edge: "start", by: -0.5 }, report);
    expect(sounds(q).map((s) => span(s.clip))).toEqual([[0, 3.5, 0], [3.5, 8, 9.5]]);
    expect(report.notes![0]).toContain("J cut");
  });

  it("measures from the picture's cut, so a second call moves the same sound cut and 0 straightens it", () => {
    const p = shots(["v", 0, 4], ["v", 10, 4]);
    const [a] = ids(p);
    const once = runCommand(p, "jl_cut", { clip_id: a, by: 0.5 });
    const again = runCommand(once, "jl_cut", { clip_id: a, by: -1 });
    expect(sounds(again).map((s) => span(s.clip))).toEqual([[0, 3, 0], [3, 8, 9]]);
    expect(sounds(again)).toHaveLength(2);
    const report: CommandReport = {};
    const straight = runCommand(again, "jl_cut", { clip_id: a, by: 0 }, report);
    expect(sounds(straight).map((s) => span(s.clip))).toEqual([[0, 4, 0], [4, 8, 10]]);
    expect(report.notes![0]).toContain("Straight cut");
  });

  it("stops where the growing sound's file ends, and says so", () => {
    // The incoming shot starts at its file's first frame: nothing earlier to hear.
    const p = shots(["v", 4, 4], ["v", 0, 4]);
    const report: CommandReport = {};
    const q = runCommand(p, "jl_cut", { clip_id: ids(p)[0], by: -0.5 }, report);
    expect(sounds(q).map((s) => span(s.clip))).toEqual([[0, 4, 4], [4, 8, 0]]);
    // No file before the incoming sound to rise over: a butt cut, not an error.
    expect(sounds(q)[0].clip.crossfade).toBeUndefined();
    expect(report.notes!.join(" ")).toMatch(/Stopped at 0 s, not 0\.5 s: .*the source starts there/);
    // And how to get the handle it lacks.
    expect(report.notes![1]).toContain(`To let it lead, start ${ids(p)[1]} later in its file first (trim_clip edge start, ripple true)`);
  });

  it("puts both sounds on one audio track when a song is in the way of one of them", () => {
    let p = shots(["v", 0, 4], ["v", 10, 4]);
    const music = createTrack("audio", "Music");
    p = { ...p, tracks: [...p.tracks, music] };
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 2, track_id: music.id });
    const q = runCommand(p, "jl_cut", { clip_id: ids(p)[0], by: 0.5 });
    const made = sounds(q).filter((s) => s.clip.assetId === "v");
    expect(made.map((s) => span(s.clip))).toEqual([[0, 4.5, 0], [4.5, 8, 10.5]]);
    expect(made[0].track).toBe(made[1].track);
    expect(made[0].track).not.toBe(music.id);
    expect(q.tracks.find((t) => t.id === music.id)!.clips).toHaveLength(1);
  });

  it("refuses a cut it cannot make, by name", () => {
    const p = shots(["v", 0, 4], ["mute", 0, 4]);
    const [a, b] = ids(p);
    expect(() => runCommand(p, "jl_cut", { clip_id: b, by: 0.5 })).toThrow("no clip touches");
    expect(() => runCommand(p, "jl_cut", { clip_id: a, by: 0.5 })).toThrow(`${b} has no sound`);
    const gap = runCommand(shots(["v", 0, 4]), "add_media_clip", { asset_id: "v", start: 5, in: 10, duration: 2 });
    expect(() => runCommand(gap, "jl_cut", { clip_id: ids(gap)[0], by: 0.5 })).toThrow("no clip touches");
  });
});

describe("a picture and its detached sound through later edits", () => {
  const straight = () => {
    const p = shots(["v", 0, 4], ["v", 10, 4]);
    return { p: runAgentCommand(p, "jl_cut", { clip_id: ids(p)[0], by: 0 }), a: ids(p)[0], b: ids(p)[1] };
  };
  const pictures = (p: Project) => mainTrack(p).clips.map((c) => [c.start / 30, clipEnd(c) / 30]);

  it("trim_clip on the picture takes its sound's edge along, and the next shot's sound follows its picture", () => {
    const { p, a } = straight();
    const report: CommandReport = {};
    const q = runAgentCommand(p, "trim_clip", { clip_id: a, edge: "end", to: 3.5, ripple: true }, report);
    expect(pictures(q)).toEqual([[0, 3.5], [3.5, 7.5]]);
    expect(sounds(q).map((s) => span(s.clip))).toEqual([[0, 3.5, 0], [3.5, 7.5, 10]]);
    expect(report.notes).toBeUndefined();
    // The trim jl_cut names when the source runs out now leaves it room: an L cut of the trimmed 0.5 s.
    expect(sounds(runAgentCommand(q, "jl_cut", { clip_id: a, by: 0.5 })).map((s) => span(s.clip))).toEqual([[0, 4, 0], [4, 7.5, 10.5]]);
  });

  it("keeps an L cut's offset through the picture's trim, at either edge", () => {
    const { p, a, b } = straight();
    const l = runAgentCommand(p, "jl_cut", { clip_id: a, by: 0.5 });
    const end = runAgentCommand(l, "trim_clip", { clip_id: a, edge: "end", to: 3, ripple: true });
    expect([pictures(end), sounds(end).map((s) => span(s.clip))]).toEqual([[[0, 3], [3, 7]], [[0, 3.5, 0], [3.5, 7, 10.5]]]);
    // The incoming shot's head trimmed a second, without ripple: its sound's head goes with it.
    const head = runAgentCommand(l, "trim_clip", { clip_id: b, edge: "start", to: 5 });
    expect([pictures(head), sounds(head).map((s) => span(s.clip))]).toEqual([[[0, 4], [5, 8]], [[0, 4.5, 0], [5.5, 8, 11.5]]]);
    for (const q of [end, head]) for (const [v, s] of [[a, 0], [b, 1]] as const) expect(Math.abs(currentOffset(q, sounds(q)[s].clip.id, v))).toBeLessThan(1e-6);
  });

  it("says when an edit leaves a detached sound out of sync, with the call that lines it up", () => {
    const { p, b } = straight();
    const rb = sounds(p)[1].clip.id;
    const report: CommandReport = {};
    const off = runAgentCommand(p, "slip_clip", { clip_id: rb, by: 1 }, report);
    expect(report.notes!.join(" ")).toContain(`${rb}, the sound of ${b}, is now 1 s out of sync with its picture`);
    expect(report.notes!.join(" ")).toContain(`sync_to_clip {clip_id: "${rb}", to_clip_id: "${b}", offset: 0}`);
    const fixed: CommandReport = {};
    const q = runAgentCommand(off, "sync_to_clip", { clip_id: rb, to_clip_id: b, offset: 0 }, fixed);
    expect(Math.abs(currentOffset(q, rb, b))).toBeLessThan(1e-6);
    // An edit that keeps them together says nothing.
    const quiet: CommandReport = {};
    runAgentCommand(p, "set_param", { clip_ids: [rb], path: "volume", value: 0.8 }, quiet);
    expect(quiet.notes).toBeUndefined();
  });
});
