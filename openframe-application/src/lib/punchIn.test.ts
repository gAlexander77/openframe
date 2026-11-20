// Punch-ins on jump cuts and the slideshow (punch_in_cuts, add_slideshow, ADR-148).
import { describe, expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { createProject, normalizeProject } from "./project/defaults";
import { clipEnd, mainTrack } from "./project/ops";
import type { ImageClip, Project, VideoClip } from "./project/types";

const fps = { num: 30, den: 1 };
const film = (): Project => ({
  ...createProject({ fps }),
  assets: [
    { id: "v", kind: "video", name: "talk.mp4", src: "talk.mp4", duration: 60, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
    { id: "b", kind: "video", name: "broll.mp4", src: "broll.mp4", duration: 1, width: 1920, height: 1080, hasVideo: true, hasAudio: false },
    { id: "p1", kind: "image", name: "one.jpg", src: "one.jpg", duration: 0, width: 1600, height: 1200, hasVideo: true, hasAudio: false },
    { id: "p2", kind: "image", name: "two.jpg", src: "two.jpg", duration: 0, width: 1600, height: 1200, hasVideo: true, hasAudio: false },
    { id: "song", kind: "audio", name: "song.mp3", src: "song.mp3", duration: 30, hasVideo: false, hasAudio: true },
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
const main = (p: Project) => mainTrack(p).clips as VideoClip[];
/** Each main clip's scale, x and y. */
const framing = (p: Project) => main(p).map((c) => [+c.transform.scale.toFixed(4), +c.transform.x.toFixed(4), +c.transform.y.toFixed(4)]);

describe("punch_in_cuts", () => {
  // One take with two stretches cut out of it: two jump cuts.
  const talk = () => shots(["v", 0, 2], ["v", 3, 2], ["v", 6, 2]);

  it("draws every other piece larger about where a face sits, and says what it did", () => {
    const report: CommandReport = {};
    const q = runCommand(talk(), "punch_in_cuts", {}, report);
    // 15% larger about a point a tenth of the frame above its middle: the picture moves down 1.5% to hold it.
    expect(framing(q)).toEqual([[1, 0, 0], [1.15, 0, 0.015], [1, 0, 0]]);
    expect(main(q).map((c) => c.punch?.scale)).toEqual([undefined, 1.15, undefined]);
    expect(report.notes).toEqual(["2 jump cuts: 1 of 3 pieces punched in to 1.15x."]);
    // The focus named stays where it is: a speaker right of center.
    expect(framing(runCommand(talk(), "punch_in_cuts", { scale: 1.2, focus: { x: 0.7, y: 0.5 } }))[1]).toEqual([1.2, -0.04, 0]);
  });

  it("starts from each piece's own framing, so a second call never compounds, and off takes it away", () => {
    const once = runCommand(talk(), "punch_in_cuts", {});
    expect(framing(runCommand(once, "punch_in_cuts", { scale: 1.2 }))[1]).toEqual([1.2, 0, 0.02]);
    const off = runCommand(once, "punch_in_cuts", { off: true });
    expect(framing(off)).toEqual([[1, 0, 0], [1, 0, 0], [1, 0, 0]]);
    expect(main(off).some((c) => c.punch)).toBe(false);
    // After the first piece is cut away the pattern starts over: the piece that was punched in is the plain one now.
    const fewer = runCommand(runCommand(once, "delete_clips", { clip_ids: [main(once)[0].id], ripple: true }), "punch_in_cuts", {});
    expect(framing(fewer)).toEqual([[1, 0, 0], [1.15, 0, 0.015]]);
  });

  it("knows a jump cut from a split and from a cutaway between two pieces", () => {
    // Split with nothing removed: the file goes on, nothing to hide.
    expect(() => runCommand(shots(["v", 0, 2], ["v", 2, 2]), "punch_in_cuts", {})).toThrow("no jump cuts on the main track");
    expect(() => runCommand(shots(["v", 0, 2], ["b", 0, 1], ["v", 5, 2]), "punch_in_cuts", {})).toThrow("no jump cuts");
    // Only the clips named are considered.
    const p = talk();
    expect(framing(runCommand(p, "punch_in_cuts", { clip_ids: main(p).slice(1).map((c) => c.id) }))).toEqual([[1, 0, 0], [1, 0, 0], [1.15, 0, 0.015]]);
  });

  it("scales keyed framing key by key, and takes it back exactly", () => {
    // A slow push into the right half of the picture, as frame_region or auto_reframe keys it.
    const p = talk();
    const keyed = runCommand(p, "frame_region", { clip_id: main(p)[1].id, region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.4, y: 0.2, w: 0.6, h: 0.6 } });
    const keys = (q: Project, path: string) => main(q)[1].keyframes![path].map((k) => +k.v.toFixed(5));
    const q = runCommand(keyed, "punch_in_cuts", { focus: { x: 0.5, y: 0.5 } });
    // About the picture's middle: every scale key 1.15 times, and each position key 1.15 times as far from the center.
    expect(keys(q, "transform.scale")).toEqual(keys(keyed, "transform.scale").map((v) => +(v * 1.15).toFixed(5)));
    expect(keys(q, "transform.x")).toEqual(keys(keyed, "transform.x").map((v) => +(v * 1.15).toFixed(5)));
    const back = runCommand(q, "punch_in_cuts", { off: true });
    for (const path of ["transform.scale", "transform.x", "transform.y"]) expect(keys(back, path)).toEqual(keys(keyed, path));
    expect(main(back)[1].punch).toBeUndefined();
  });

  it("forgets a punch-in that was reframed since, and survives a save", () => {
    const p = talk();
    const once = runCommand(p, "punch_in_cuts", {});
    // The piece is framed again by hand: that framing is its own now, not 1.15 of something.
    const reframed = runCommand(once, "set_param", { clip_ids: [main(once)[1].id], path: "transform.scale", value: 1.3 });
    expect(framing(runCommand(reframed, "punch_in_cuts", { off: true }))[1][0]).toBe(1.3);
    expect(framing(runCommand(reframed, "punch_in_cuts", { focus: { x: 0.5, y: 0.5 } }))[1][0]).toBe(1.495);
    const saved = normalizeProject(JSON.parse(JSON.stringify(once)));
    expect((mainTrack(saved).clips[1] as VideoClip).punch).toEqual({ scale: 1.15, fx: 0.5, fy: 0.4, to: 1.15 });
    // A lone piece no longer meets a jump cut: its punch-in goes.
    const lone = runCommand(runCommand(once, "delete_clips", { clip_ids: [main(once)[0].id, main(once)[2].id] }), "punch_in_cuts", { off: true });
    expect(framing(lone)).toEqual([[1, 0, 0]]);
  });
});

describe("add_slideshow", () => {
  const stills = (p: Project) => mainTrack(p).clips as ImageClip[];

  it("lays the pictures end to end, each moving its own way, a dissolve at every cut", () => {
    const report: CommandReport = {};
    const p = runCommand(film(), "add_slideshow", { asset_ids: ["p1", "p2", "p1"], seconds_each: 2 }, report);
    expect(stills(p).map((c) => [c.assetId, c.start, c.duration])).toEqual([["p1", 0, 60], ["p2", 60, 60], ["p1", 120, 60]]);
    // A steady move across the whole clip: two keys, linear, on scale and position.
    for (const c of stills(p)) expect(c.keyframes!["transform.scale"].map((k) => [k.f, k.ease])).toEqual([[0, undefined], [59, undefined]]);
    const scales = stills(p).map((c) => c.keyframes!["transform.scale"].map((k) => k.v));
    expect(scales[0][1]).toBeGreaterThan(scales[0][0]); // a push in
    expect(scales[1][1]).toBeCloseTo(scales[1][0], 6); // a drift
    expect(scales[2][1]).toBeLessThan(scales[2][0]); // a pull out
    expect(stills(p)[1].keyframes!["transform.x"][0].v).not.toBeCloseTo(stills(p)[1].keyframes!["transform.x"][1].v, 4);
    expect(stills(p).map((c) => c.transitionOut)).toEqual([{ type: "dissolve", duration: 15 }, { type: "dissolve", duration: 15 }, undefined]);
    expect(report.notes).toEqual(["3 pictures from 0 to 6 s on Main."]);
  });

  it("shares a length, goes after what is there, and can sit still without transitions", () => {
    const p = runCommand(shots(["v", 0, 2]), "add_slideshow", { asset_ids: ["p1", "p2", "p1", "p2"], duration: 6, motion: "none", transition: "none" });
    expect(mainTrack(p).clips.map((c) => [c.start, c.duration])).toEqual([[0, 60], [60, 45], [105, 45], [150, 45], [195, 45]]);
    expect(stills(p).slice(1).every((c) => !c.keyframes && !c.transitionOut)).toBe(true);
    // Filling the frame: a 4:3 picture on a 16:9 canvas is scaled up to cover it.
    expect(stills(p)[1].transform.scale).toBeCloseTo(4 / 3, 6);
  });

  it("leaves no gap after a video shorter than its turn, and a short picture gets a short transition", () => {
    const p = runCommand(film(), "add_slideshow", { asset_ids: ["b", "p1"], seconds_each: 1.2, transition_seconds: 1 });
    const [video, still] = mainTrack(p).clips;
    expect([video.duration, still.start, clipEnd(still)]).toEqual([30, 30, 66]);
    expect((video as VideoClip).transitionOut).toEqual({ type: "dissolve", duration: 10 });
  });

  it("refuses what is not a picture, by name", () => {
    expect(() => runCommand(film(), "add_slideshow", { asset_ids: ["p1", "song"] })).toThrow("song.mp3 is sound only");
    expect(() => runCommand(film(), "add_slideshow", { asset_ids: ["nope"] })).toThrow("no asset with id nope");
    expect(() => runCommand(film(), "add_slideshow", { asset_ids: ["p1"], seconds_each: 2, duration: 4 })).toThrow("not both");
  });
});
