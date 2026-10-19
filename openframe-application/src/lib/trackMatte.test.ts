import { describe, expect, it } from "vitest";
import { createColorClip, createTextClip, createTrack } from "./project/defaults";
import type { Clip, Track } from "./project/types";
import { cleanTrackMatte, dropDanglingMattes, matteClip, mattesAt } from "./trackMatte";

const track = (clips: Clip[], extra: Partial<Track> = {}): Track => ({ ...createTrack("video", "V"), clips, ...extra });
const color = (id: string, start: number, duration: number, extra: object = {}) => ({ ...createColorClip("#fff", start, duration), id, ...extra }) as Clip;

describe("matteClip", () => {
  const text = { ...createTextClip("O", 10, 20), id: "t" } as Clip;
  const named = color("v", 0, 60, { trackMatte: { clipId: "t", mode: "alpha" } });
  const above = color("w", 0, 60, { trackMatte: { mode: "luma" } });
  const tracks = [track([text]), track([named]), track([above])];

  it("finds a named matte where it shows, and says empty where it does not", () => {
    expect(matteClip(tracks, 1, named, 15)?.id).toBe("t");
    expect(matteClip(tracks, 1, named, 5)).toBeNull();
  });

  it("reads the track directly above for a matte with no name", () => {
    expect(matteClip(tracks, 2, above, 15)?.id).toBe("v");
    // The top track has nothing above it.
    expect(matteClip([track([above])], 0, above, 15)).toBeNull();
  });

  it("is undefined for no matte, a missing one, or itself", () => {
    expect(matteClip(tracks, 0, text, 15)).toBeUndefined();
    expect(matteClip(tracks, 1, color("x", 0, 9, { trackMatte: { clipId: "gone", mode: "alpha" } }), 2)).toBeUndefined();
    expect(matteClip(tracks, 1, color("y", 0, 9, { trackMatte: { clipId: "y", mode: "alpha" } }), 2)).toBeUndefined();
  });
});

describe("mattesAt", () => {
  it("hides a named matte at every frame", () => {
    const tracks = [track([color("m", 50, 10)]), track([color("v", 0, 20, { trackMatte: { clipId: "m", mode: "alpha" } })])];
    expect([...mattesAt(tracks, 55)]).toEqual(["m"]);
    expect([...mattesAt(tracks, 5)]).toEqual(["m"]);
  });

  it("hides what is above a track-above matte only while that clip shows", () => {
    const tracks = [track([color("a", 0, 100)]), track([color("v", 10, 20, { trackMatte: { mode: "alpha" } })])];
    expect([...mattesAt(tracks, 15)]).toEqual(["a"]);
    expect([...mattesAt(tracks, 50)]).toEqual([]);
    expect([...mattesAt([tracks[0], { ...tracks[1], hidden: true }], 15)]).toEqual([]);
    expect([...mattesAt([tracks[0], track([color("v", 10, 20, { trackMatte: { mode: "alpha" }, disabled: true })])], 15)]).toEqual([]);
  });
});

describe("loading", () => {
  it("cleans a matte", () => {
    expect(cleanTrackMatte({ clipId: "c", mode: "luma" })).toEqual({ clipId: "c", mode: "luma" });
    expect(cleanTrackMatte({ mode: "alphaInverted", clipId: "" })).toEqual({ mode: "alphaInverted" });
    expect(cleanTrackMatte({ clipId: "c", mode: "chroma" })).toBeUndefined();
  });

  it("drops named mattes that point nowhere, keeps the rest", () => {
    const tracks = [
      track([color("a", 0, 10, { trackMatte: { clipId: "b", mode: "alpha" } }), color("c", 20, 10, { trackMatte: { clipId: "zzz", mode: "alpha" } })]),
      track([color("b", 0, 10), color("d", 20, 10, { trackMatte: { clipId: "d", mode: "alpha" } }), color("e", 40, 10, { trackMatte: { mode: "luma" } })]),
    ];
    const out = dropDanglingMattes(tracks).flatMap((t) => t.clips);
    const has = (id: string) => "trackMatte" in out.find((c) => c.id === id)!;
    expect([has("a"), has("c"), has("d"), has("e")]).toEqual([true, false, false, true]);
  });
});
