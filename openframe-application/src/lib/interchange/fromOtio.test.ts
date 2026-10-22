import { describe, expect, it } from "vitest";
import fixture from "./fixture.json";
import { normalizeProject } from "../project/defaults";
import { fromOtio, mediaPath } from "./fromOtio";
import { toOtio } from "./otio";
import type { Project } from "../project/types";

const structure = (p: Project) => ({
  tracks: p.tracks.map(t => ({ name: t.name, main: !!t.main, kind: t.kind, clips: t.clips.map(c => ({ type: c.type, start: c.start, duration: c.duration, in: "in" in c ? c.in : 0, transition: "transitionOut" in c ? c.transitionOut : undefined })) })),
  markers: p.markers.map(m => [m.frame, m.label]),
  compounds: p.compounds?.map(k => ({ name: k.name, tracks: k.tracks.map(t => t.clips.map(c => [c.type, c.start, c.duration, "in" in c ? c.in : 0])), markers: k.markers.map(m => [m.frame, m.label]) })),
});
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const rt = (value: number, rate = 24) => ({ OTIO_SCHEMA: "RationalTime.1", value, rate });
const range = (start: number, duration: number, rate = 24) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });
const timeline = (children: J[]) => ({ OTIO_SCHEMA: "Timeline.1", global_start_time: rt(0), tracks: { OTIO_SCHEMA: "Stack.1", children: [{ OTIO_SCHEMA: "Track.1", kind: "Video", children }] } });

describe("OTIO import", () => {
  it("round trips cuts, gaps, overlays, sound, transitions, markers and a compound without duplicate companion audio", () => {
    const p = normalizeProject(fixture);
    const r = fromOtio(JSON.stringify(toOtio(p)));
    expect(r.warnings).toEqual([]);
    expect(structure(r.project)).toEqual(structure(p));
    expect(r.project.assets.map(a => [a.src.replace(/\\/g, "/"), a.hasAudio])).toEqual(p.assets.map(a => [a.src, a.hasAudio]));
    expect(r.project.tracks[1].clips[0]).toMatchObject({ muted: false });
    expect(r.project.id).not.toBe(p.id);
  });
  it("reads Clip.2 active references and converts mixed rational rates once", () => {
    const r = fromOtio(timeline([
      { OTIO_SCHEMA: "Gap.1", source_range: range(0, 12) },
      { OTIO_SCHEMA: "Clip.2", name: "Shot", source_range: range(48, 48, 48), active_media_reference_key: "source", media_references: { source: { OTIO_SCHEMA: "ExternalReference.1", target_url: "file:///media/a%20%23%3F.mov" } } },
    ]));
    expect(r.project.tracks[0].clips[0]).toMatchObject({ start: 12, duration: 24, in: 1 });
    expect(r.project.assets[0].src).toBe("/media/a #?.mov");
  });
  it("uses available ranges when untrimmed, and respects a trimmed track's clock and markers", () => {
    const t = timeline([{ OTIO_SCHEMA: "Clip.1", source_range: null, media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "/a.mov", available_range: range(0, 72) }, markers: [{ OTIO_SCHEMA: "Marker.2", name: "Inside", marked_range: range(24, 0) }] }]);
    Object.assign(t.tracks.children[0], { source_range: range(12, 24) });
    const r = fromOtio(t);
    expect(r.project.tracks[0].clips[0]).toMatchObject({ start: 0, in: 0.5, duration: 24 });
    expect(r.project.markers[0]).toMatchObject({ frame: 12, label: "Inside" });
  });
  it("recovers legacy OpenFrame companion audio without extra tracks or losing sound", () => {
    const p = normalizeProject(fixture);
    const stripTags = (value: unknown): unknown => Array.isArray(value) ? value.map(stripTags) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([k]) => k !== "openframe").map(([k, v]) => [k, stripTags(v)])) : value;
    const r = fromOtio(stripTags(toOtio(p)));
    expect(r.project.tracks.map(t => [t.kind, t.clips.length])).toEqual(p.tracks.map(t => [t.kind, t.clips.length]));
    expect(r.project.assets.find(a => a.kind === "video")?.hasAudio).toBe(true);
    expect(r.project.tracks.find(t => t.main)?.clips[0]).toMatchObject({ muted: false });
  });
  it("subtracts nonzero available-range source timecode from media in-points", () => {
    const r = fromOtio(timeline([{ OTIO_SCHEMA: "Clip.1", source_range: range(86402, 2, 1), media_reference: { OTIO_SCHEMA: "ExternalReference.1", target_url: "/a.mov", available_range: range(86400, 10, 1) } }]));
    expect(r.project.tracks[0].clips[0]).toMatchObject({ in: 2, duration: 48 });
    expect(r.project.assets[0].duration).toBe(10);
  });
  it("keeps repeated compound references shared", () => {
    const p = normalizeProject(fixture);
    const c = p.tracks[0].clips[1];
    p.tracks[0].clips.push({ ...c, id: "repeated", start: 200 });
    const r = fromOtio(toOtio(p));
    expect(r.project.compounds).toHaveLength(1);
    expect(r.project.tracks[0].clips.slice(1).map(c => c.type === "compound" && c.compoundId)).toEqual([r.project.compounds![0].id, r.project.compounds![0].id]);
  });
  it("reports effects, ramps, unknown schemas and missing references while preserving time", () => {
    const t = timeline([
      { OTIO_SCHEMA: "Unknown.1", source_range: range(0, 12) },
      { OTIO_SCHEMA: "Clip.1", name: "Offline", source_range: range(0, 24), media_reference: { OTIO_SCHEMA: "MissingReference.1" }, effects: [{ OTIO_SCHEMA: "TimeEffect.1", name: "Ramp" }] },
      { OTIO_SCHEMA: "Transition.1", transition_type: "Fancy wipe", in_offset: rt(2), out_offset: rt(3) },
      { OTIO_SCHEMA: "Clip.1", source_range: range(24, 24), media_reference: { OTIO_SCHEMA: "MissingReference.1" } },
    ]);
    const r = fromOtio(t);
    expect(r.warnings.join(" ")).toMatch(/Unknown.1.*Ramp.*Missing media.*Fancy wipe/);
    expect(r.project.tracks[0].clips[0]).toMatchObject({ start: 12, transitionOut: { type: "dissolve", duration: 5 } });
    expect(r.project.tracks[0].clips[1].start).toBe(36);
  });
  it("rejects invalid roots and rational clocks", () => {
    expect(() => fromOtio({})).toThrow(/Timeline.1/);
    expect(() => fromOtio(timeline([{ OTIO_SCHEMA: "Gap.1", source_range: range(0, 2, 0) }]))).toThrow(/RationalTime/);
  });
  it("reports retiming, effects and keys carried only in OpenFrame metadata", () => {
    const p = normalizeProject(fixture), c = p.tracks[1].clips[0];
    if (c.type === "video") { c.speedCurve = { preset: "montage", points: [{ f: 0, speed: 1 }, { f: 50, speed: 2 }] }; c.effects = [{ id: "fx", type: "blur", enabled: true, params: { radius: 10 } }]; c.keyframes = { opacity: [{ f: 0, v: 0 }] }; }
    const r = fromOtio(toOtio(p));
    expect(r.warnings.join(" ")).toMatch(/speed ramps.*effect blur.*Keyframes/);
  });
  it("decodes Windows, POSIX and UNC file URLs", () => {
    expect(mediaPath("file:///C:/a%20b.mov")).toBe("C:/a b.mov");
    expect(mediaPath("file://server/share/a.mov")).toBe("//server/share/a.mov");
    expect(mediaPath("https://x/a.mov")).toBe("https://x/a.mov");
  });
});
