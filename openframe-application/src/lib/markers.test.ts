import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { addedMarkerCount, adjacentMarker, deleteMarkers, filterMarkers, updateMarker } from "./markers";
import { createProject, normalizeProject } from "./project/defaults";
import { projectDuration } from "./project/ops";

const project = () => ({ ...createProject(), markers: [
  { id: "later", frame: 90, label: "Fix audio", color: "red" },
  { id: "intro", frame: 0, label: "INTRO", color: "blue" },
  { id: "beat", frame: 30, label: "Beat", color: "red" },
] });

describe("timeline marker management", () => {
  it("retimes one marker, preserving identity, other markers, and clip duration", () => {
    const p = project();
    const changed = updateMarker(p, "beat", { frame: 1200, label: "Chapter", color: "green" });
    expect(changed.markers.map((m) => m.id)).toEqual(["intro", "later", "beat"]);
    expect(changed.markers[2]).toEqual({ id: "beat", frame: 1200, label: "Chapter", color: "green" });
    expect(changed.markers[1]).toBe(p.markers[0]);
    expect(changed.tracks).toBe(p.tracks);
    expect(projectDuration(changed)).toBe(0);
    expect(p.markers[2].frame).toBe(30);
  });

  it("does not create an edit for unchanged values and allows an empty note", () => {
    const p = project();
    expect(updateMarker(p, "beat", {})).toBe(p);
    expect(updateMarker(p, "beat", { frame: 30, label: "Beat" })).toBe(p);
    expect(updateMarker(p, "beat", { label: "" }).markers[1].label).toBe("");
    expect(deleteMarkers(p, [])).toBe(p);
  });

  it("rejects missing markers and unsafe positions before mutation", () => {
    const p = project();
    for (const frame of [-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => updateMarker(p, "beat", { frame })).toThrow(/integer frame/);
    expect(() => updateMarker(p, "missing", { label: "Test" })).toThrow(/No marker/);
    expect(() => deleteMarkers(p, ["intro", "missing"])).toThrow(/No marker/);
    expect(p.markers).toHaveLength(3);
  });

  it("deletes chosen ids once and round-trips existing saved JSON fields", () => {
    const p = deleteMarkers(project(), ["beat", "beat", "later"]);
    expect(p.markers.map((m) => m.id)).toEqual(["intro"]);
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).markers).toEqual(p.markers);
  });

  it("searches notes and timecodes, intersects color, and sorts without mutating", () => {
    const p = project();
    expect(filterMarkers(p.markers, p.fps, " intro ").map((m) => m.id)).toEqual(["intro"]);
    expect(filterMarkers(p.markers, p.fps, "00:00:01").map((m) => m.id)).toEqual(["beat"]);
    expect(filterMarkers(p.markers, p.fps, "", "red").map((m) => m.id)).toEqual(["beat", "later"]);
    expect(filterMarkers(p.markers, p.fps, "intro", "red")).toEqual([]);
    expect(p.markers[0].id).toBe("later");
  });

  it("detaches a marker from its clip where it stands, and finds following markers by their clip's name", () => {
    const p = { ...project(), markers: [...project().markers, { id: "bar", frame: 60, label: "Bar", color: "amber", follows: { clip: "c_song", at: 2 } }] };
    const free = updateMarker(p, "bar", { detach: true });
    expect(free.markers.find((m) => m.id === "bar")).toEqual({ id: "bar", frame: 60, label: "Bar", color: "amber" });
    // Nothing to detach: no edit.
    expect(updateMarker(free, "bar", { detach: true })).toBe(free);
    expect(updateMarker(p, "beat", { detach: true })).toBe(p);
    expect(runCommand(p, "update_marker", { marker_id: "bar", detach: true }).markers.find((m) => m.id === "bar")?.follows).toBeUndefined();
    const name = (id: string) => (id === "c_song" ? "Liftoff.wav" : undefined);
    expect(filterMarkers(p.markers, p.fps, "liftoff", "", name).map((m) => m.id)).toEqual(["bar"]);
    expect(filterMarkers(free.markers, p.fps, "liftoff", "", name)).toEqual([]);
  });

  it("navigates unsorted and coincident markers without getting stuck", () => {
    const markers = [...project().markers, { id: "duplicate", frame: 30, label: "Other note", color: "red" }];
    expect(adjacentMarker(markers, 0, 1)?.id).toBe("beat");
    expect(adjacentMarker(markers, 90, -1)?.frame).toBe(30);
    expect(adjacentMarker(markers, 30, 1)?.id).toBe("later");
    expect(adjacentMarker(markers, 0, -1)).toBeUndefined();
    expect(adjacentMarker(markers, 90, 1)).toBeUndefined();
  });

  it("exposes editable ids and colors to agents and snaps command seconds to frames", () => {
    let p = project();
    p = runCommand(p, "update_marker", { marker_id: "beat", at: 2.51, label: "Moved" });
    expect(describeProject(p).markers.find((m) => m.id === "beat")).toEqual({ id: "beat", frame: 75, at: 2.5, label: "Moved", color: "red" });
    expect(() => runCommand(p, "update_marker", { marker_id: "beat", at: -1 })).toThrow();
    p = runCommand(p, "delete_markers", { marker_ids: ["beat"] });
    expect(p.markers.map((m) => m.id)).not.toContain("beat");
  });
});

it("edits range duration and chapter without detaching a following start", () => {
  const p = createProject();
  p.markers = [{ id: "range", frame: 10, label: "Range", color: "red", follows: { clip: "song", at: 1 } }];
  const q = updateMarker(p, "range", { duration: 30, chapter: true });
  expect(q.markers[0]).toMatchObject({ duration: 30, chapter: true, follows: { clip: "song", at: 1 } });
  expect(updateMarker(q, "range", { duration: 30, chapter: true })).toBe(q);
  expect(() => updateMarker(p, "range", { duration: -1 })).toThrow();
});

it("range markers follow a moved clip by their start and preserve chapter metadata", () => {
  let p = createProject();
  p.assets = [{ id: "song", name: "Song", src: "song.wav", kind: "audio", duration: 10, hasVideo: false, hasAudio: true }];
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0 });
  const clip = p.tracks.flatMap((t) => t.clips)[0];
  p.markers = [{ id: "range", frame: 30, label: "Verse", color: "red", duration: 60, chapter: true, follows: { clip: clip.id, at: 1 } }];
  const q = runCommand(p, "move_clip", { clip_id: clip.id, start: 2 });
  expect(q.markers[0]).toMatchObject({ frame: 90, duration: 60, chapter: true, follows: { clip: clip.id, at: 1 } });
});

it("marker commands snap range seconds and describe duration and chapter for agents", () => {
  let p = runCommand(createProject(), "add_marker", { at: 1, duration: 1.5, chapter: true, label: "Chapter" });
  const id = p.markers[0].id;
  expect(describeProject(p).markers[0]).toMatchObject({ duration: 1.5, duration_frames: 45, chapter: true });
  p = runCommand(p, "update_marker", { marker_id: id, duration: 0, chapter: false });
  expect(p.markers[0]).toMatchObject({ duration: 0, chapter: false });
  expect(() => runCommand(p, "update_marker", { marker_id: id, duration: -1 })).toThrow();
});

it("counts additions separately from removed beats when replacing a shorter grid", () => {
  const p = project();
  expect(addedMarkerCount(p, { ...p, markers: p.markers.slice(0, 2) })).toBe(0);
  expect(addedMarkerCount(p, { ...p, markers: [{ ...p.markers[0], id: "replacement" }] })).toBe(0);
  expect(addedMarkerCount(p, { ...p, markers: [{ ...p.markers[0], frame: 95 }] })).toBe(1);
});
