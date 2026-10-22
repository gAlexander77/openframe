import { describe, expect, it } from "vitest";
import { DEFAULT_MEDIA_BROWSER, filterMedia, mediaUsage } from "./mediaLibrary";
import { clipForAsset, createTrack } from "./project/defaults";
import type { Asset } from "./project/types";

const asset = (id: string, name: string, kind: Asset["kind"], duration: number): Asset => ({ id, name, kind, duration, src: name, hasVideo: kind === "video", hasAudio: kind === "audio" });
const assets = [asset("ten", "Shot10.mp4", "video", 4), asset("two", "shot2.mp4", "video", 8),
  asset("sound", "Music.wav", "audio", 30), asset("still", "Cover.png", "image", 0),
  { ...asset("sticker", "Sticker.png", "image", 0), sticker: "star" }];
const ids = (items: Asset[]) => items.map((a) => a.id);

describe("media library views", () => {
  it("intersects case-insensitive trimmed search, type and timeline usage", () => {
    const usage = new Map([["two", [{ clipId: "clip", start: 0 }]]]);
    expect(ids(filterMedia(assets, usage, { ...DEFAULT_MEDIA_BROWSER, query: " SHOT ", kind: "video", usage: "used" }))).toEqual(["two"]);
    expect(ids(filterMedia(assets, usage, { ...DEFAULT_MEDIA_BROWSER, usage: "unused" }))).toEqual(["ten", "sound", "still"]);
    expect(filterMedia(assets, usage, { ...DEFAULT_MEDIA_BROWSER, kind: "audio", usage: "used" })).toEqual([]);
  });

  it("sorts names numerically in both directions and leaves imports untouched", () => {
    const before = JSON.stringify(assets);
    expect(ids(filterMedia(assets, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "name" }))).toEqual(["still", "sound", "two", "ten"]);
    expect(ids(filterMedia(assets, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "name-desc" }))).toEqual(["ten", "two", "sound", "still"]);
    expect(ids(filterMedia(assets, new Map(), DEFAULT_MEDIA_BROWSER))).toEqual(["ten", "two", "sound", "still"]);
    expect(JSON.stringify(assets)).toBe(before);
  });

  it("can search and sort an asset whose display name is absent", () => {
    // An automation import used to save name: undefined before normalization.
    const unnamed = { ...assets[0], name: undefined } as unknown as Asset;
    const items = [unnamed, assets[1]];
    expect(ids(filterMedia(items, new Map(), { ...DEFAULT_MEDIA_BROWSER, query: "SHOT10" }))).toEqual(["ten"]);
    expect(ids(filterMedia(items, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "name" }))).toEqual(["two", "ten"]);
    expect(unnamed.name).toBeUndefined();
  });

  it("sorts source seconds, keeps ties stable and puts stills last in either direction", () => {
    const items = [assets[3], assets[1], assets[0], { ...assets[0], id: "tie" }];
    expect(ids(filterMedia(items, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "duration" }))).toEqual(["ten", "tie", "two", "still"]);
    expect(ids(filterMedia(items, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "duration-desc" }))).toEqual(["two", "ten", "tie", "still"]);
    expect(ids(items)).toEqual(["still", "two", "ten", "tie"]);
  });

  it("does not treat unknown duration as a measured shortest clip", () => {
    const items = [asset("unknown", "Unknown.mp4", "video", NaN), ...assets];
    expect(ids(filterMedia(items, new Map(), { ...DEFAULT_MEDIA_BROWSER, sort: "duration" }))).toEqual(["ten", "two", "sound", "unknown", "still"]);
  });

  it("counts all timeline references in chronological order, including inactive tracks", () => {
    const a = clipForAsset(assets[0], 90, { num: 30, den: 1 });
    const b = { ...clipForAsset(assets[0], 30, { num: 30, den: 1 }), disabled: true };
    const first = { ...createTrack("video", "Video"), hidden: true, locked: true, clips: [a] };
    const second = { ...createTrack("video", "Muted"), muted: true, clips: [b] };
    const before = JSON.stringify([first, second]);
    expect(mediaUsage([first, second]).get("ten")).toEqual([{ clipId: b.id, start: 30 }, { clipId: a.id, start: 90 }]);
    expect(mediaUsage([first]).get("ten")).toHaveLength(1);
    expect(mediaUsage([]).size).toBe(0);
    expect(JSON.stringify([first, second])).toBe(before);
  });
});
