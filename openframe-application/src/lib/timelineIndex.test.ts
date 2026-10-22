import { describe, expect, it } from "vitest";
import { createColorClip, createCompoundClip, createProject, createTextClip, createTrack } from "./project/defaults";
import { compoundView } from "./project/compound";
import { clipForAsset } from "./project/defaults";
import { filterTimelineRows, findClips, timelineRows } from "./timelineIndex";

function fixture() {
  const p = createProject();
  const asset = { id: "a", kind: "video" as const, name: "Sunrise.mov", src: "sun", duration: 10, hasVideo: true, hasAudio: true };
  p.assets = [asset];
  const title = { ...createTextClip("Sale now\nSecond line", 60, 30), id: "title" };
  const caption = { ...createTextClip("Hello", 30, 30), id: "caption", caption: true };
  const video = { ...clipForAsset(asset, 0, p.fps), id: "video", name: "Hero" };
  const media = { ...clipForAsset(asset, 0, p.fps), id: "media" };
  const color = { ...createColorClip("#fff", 30, 60), id: "color" };
  p.tracks = [{ ...createTrack("video", "Titles"), clips: [title, caption] }, { ...p.tracks[0], clips: [video, media, color] }];
  return p;
}

describe("timeline index", () => {
  it("names a clip by its name, first text line, media name, then kind", () => {
    const rows = timelineRows(fixture());
    expect(rows.map((r) => r.name)).toEqual(["Sale now", "Hello", "Hero", "Sunrise.mov", "color"]);
  });
  it("searches case-insensitively in media names, all text lines and types", () => {
    const rows = timelineRows(fixture());
    expect(filterTimelineRows(rows, "SUNRISE").map((r) => r.clip.id)).toEqual(["media", "video"]);
    expect(filterTimelineRows(rows, "second LINE").map((r) => r.clip.id)).toEqual(["title"]);
    expect(filterTimelineRows(rows, "text")).toHaveLength(2);
    expect(filterTimelineRows(rows, "caption")).toHaveLength(1);
    expect(filterTimelineRows(rows, "  ")).toHaveLength(5);
  });
  it("separates titles and captions, and groups color, adjustment and compound", () => {
    const rows = timelineRows(fixture());
    expect(filterTimelineRows(rows, "", "text").map((r) => r.clip.id)).toEqual(["title"]);
    expect(filterTimelineRows(rows, "", "caption").map((r) => r.clip.id)).toEqual(["caption"]);
    expect(filterTimelineRows(rows, "", "other").map((r) => r.clip.id)).toEqual(["color"]);
  });
  it("sorts by start and track order, or name and track; leaves input intact", () => {
    const rows = timelineRows(fixture());
    const copy = [...rows];
    expect(filterTimelineRows(rows).map((r) => r.clip.id)).toEqual(["media", "video", "caption", "color", "title"]);
    expect(filterTimelineRows(rows, "", "all", "track").map((r) => r.clip.id)).toEqual(["caption", "title", "media", "video", "color"]);
    expect(filterTimelineRows(rows, "", "all", "name").map((r) => r.name)).toEqual(["color", "Hello", "Hero", "Sale now", "Sunrise.mov"]);
    expect(rows).toEqual(copy);
  });
  it("follows a compound view, and finds nested hits with their containing clip", () => {
    const p = fixture();
    const inner = { id: "k", name: "Nested", tracks: p.tracks, markers: [] };
    p.compounds = [inner];
    p.tracks = [{ ...createTrack("video", "Main", true), clips: [{ ...createCompoundClip("k", 300, 300), id: "outer" }] }];
    expect(timelineRows(p)).toHaveLength(1);
    expect(timelineRows(compoundView(p, inner.id))).toHaveLength(5);
    expect(findClips(p, { query: "sale" })).toEqual({ clips: [{ clip_id: "title", kind: "text", name: "Sale now", track_id: inner.tracks[0].id, track: "Titles", start: 2, end: 3, compound_clip_id: "outer" }], total: 1, shown: 1 });
    inner.tracks[0].clips.push(createCompoundClip("k", 0, 30));
    expect(timelineRows(p, true).length).toBe(7); // malformed cycles cannot recurse forever
  });
  it("narrows track, kind and end-exclusive stretch, with a default limit of 50", () => {
    const p = fixture();
    expect(findClips(p, { kind: "caption", start: 2, end: 3 }).shown).toBe(0);
    expect(findClips(p, { kind: "caption", start: 1, end: 1 }).shown).toBe(1);
    expect(findClips(p, { track_id: p.tracks[0].id, limit: 1 })).toMatchObject({ total: 2, shown: 1 });
    p.tracks[0].clips = Array.from({ length: 1000 }, (_, i) => ({ ...createTextClip(`Title ${i}`, i * 30, 30), id: `c${i}` }));
    expect(findClips(p, { kind: "text" })).toMatchObject({ total: 1000, shown: 50 });
  });
});
