// The join the timeline, the clip menu and the Audio tab offer to
// crossfade (ADR-109) agrees with set_crossfade and with what the mix plays.

import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { crossfadeJoin, newCrossfade } from "./crossfadeJoin";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, updateClip } from "./project/ops";
import type { Asset, AudioClip, Project } from "./project/types";

const asset = (id: string): Asset => ({ id, kind: "audio", name: `${id}.wav`, src: `${id}.wav`, duration: 60, hasVideo: false, hasAudio: true });

/** Song a 0-5 s, then `next` from 5 s on the same track. */
function joined(next: { asset_id: string; in: number }): { p: Project; a: string; b: string } {
  let p: Project = { ...createProject(), assets: [asset("one"), asset("two")] };
  const t = createTrack("audio", "Music");
  p = addTrack(p, t);
  p = runCommand(p, "add_media_clip", { asset_id: "one", start: 0, duration: 5, track_id: t.id });
  p = runCommand(p, "add_media_clip", { asset_id: next.asset_id, start: 5, in: next.in, duration: 5, track_id: t.id });
  const [a, b] = p.tracks.find((x) => x.id === t.id)!.clips;
  return { p, a: a.id, b: b.id };
}

describe("crossfadeJoin", () => {
  it("offers a join into another song, as long as its file has sound before its in-point", () => {
    const { p, a, b } = joined({ asset_id: "two", in: 0.8 });
    const j = crossfadeJoin(p, a)!;
    expect(j.next.id).toBe(b);
    expect(j.most).toBeCloseTo(0.8, 9);
    expect(j.plays).toBe(0);
    expect(j.why).toBeUndefined();
    // The menu's new crossfade: the transitions preference, cut to fit.
    expect(newCrossfade(j, 0.5)).toBe(0.5);
    expect(newCrossfade(j, 2)).toBeCloseTo(0.8, 9);
    // set_crossfade takes the most it offers, and the mix then plays it.
    const q = runCommand(p, "set_crossfade", { clip_id: a, seconds: j.most });
    expect(crossfadeJoin(q, a)!.plays).toBeCloseTo(0.8, 9);
    expect(() => runCommand(p, "set_crossfade", { clip_id: a, seconds: j.most + 0.01 })).toThrow(/at most/);
  });

  it("says why no crossfade fits: a song from its first second, a split, a retimed clip", () => {
    const fromStart = joined({ asset_id: "two", in: 0 });
    expect(crossfadeJoin(fromStart.p, fromStart.a)).toMatchObject({ most: 0, plays: 0, why: expect.stringMatching(/trim its start/) });
    expect(() => runCommand(fromStart.p, "set_crossfade", { clip_id: fromStart.a, seconds: 0.1 })).toThrow();

    const split = joined({ asset_id: "one", in: 5 });
    expect(crossfadeJoin(split.p, split.a)).toMatchObject({ most: 0, why: expect.stringMatching(/same file/) });

    // A clip at twice its speed that still meets the next one.
    const sped = joined({ asset_id: "two", in: 2 });
    const q = updateClip(sped.p, sped.a, (c) => ({ ...(c as AudioClip), speed: 2 }));
    expect(crossfadeJoin(q, sped.a)).toMatchObject({ most: 0, plays: 0, why: expect.stringMatching(/own speed/) });
    expect(() => runCommand(q, "set_crossfade", { clip_id: sped.a, seconds: 0.1 })).toThrow(/retimed/);
  });

  it("has no join where nothing meets, or the next clip is not sound", () => {
    let p: Project = { ...createProject(), assets: [asset("one")] };
    const t = createTrack("audio", "Music");
    p = addTrack(p, t);
    p = runCommand(p, "add_media_clip", { asset_id: "one", start: 0, duration: 5, track_id: t.id });
    p = runCommand(p, "add_media_clip", { asset_id: "one", start: 6, in: 10, duration: 5, track_id: t.id });
    const [a] = p.tracks.find((x) => x.id === t.id)!.clips;
    expect(crossfadeJoin(p, a.id)).toBeNull();
    const main = p.tracks.find((x) => x.main)!;
    p = runCommand(p, "add_color_clip", { color: "#000000", start: 0, duration: 2, track_id: main.id });
    expect(crossfadeJoin(p, main.id)).toBeNull();
    expect(crossfadeJoin(p, p.tracks.find((x) => x.main)!.clips[0].id)).toBeNull();
  });
});
