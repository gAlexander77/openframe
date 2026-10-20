// Where new titles, graphics and beat hits land in a layered edit, rebuilt
// from the Claude film test 2 call log (ADR-116): a picture-in-picture
// track, a grade kept under the titles, a titles track with a title card
// built as a compound and a pill button.
import { describe, expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { adjustmentsOver } from "./overlays";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { Project } from "./project/types";

const fps = { num: 30, den: 1 };

function film(): Project {
  let p: Project = {
    ...createProject({ fps, width: 1080, height: 1920 }),
    assets: [
      { id: "launch", kind: "video", name: "launch.mp4", src: "launch.mp4", duration: 60, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
      { id: "station", kind: "video", name: "station.mp4", src: "station.mp4", duration: 20, width: 1920, height: 1080, hasVideo: true, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "launch", start: 0, duration: 46.5 });
  // The porthole: a picture-in-picture on a track of its own.
  p = runCommand(p, "add_track", { kind: "video", name: "Porthole" });
  const porthole = p.tracks[0].id;
  p = runCommand(p, "add_media_clip", { asset_id: "station", start: 12, duration: 2, track_id: porthole });
  // The grade under the titles, the titles track above it.
  p = runCommand(p, "add_track", { kind: "video", name: "Grade" });
  p = runCommand(p, "add_adjustment_clip", { start: 0, duration: 46.5, track_id: p.tracks[0].id });
  p = runCommand(p, "add_track", { kind: "video", name: "Titles" });
  const titles = p.tracks[0].id;
  // A title card built as a compound, then the end screen's pill.
  p = runCommand(p, "add_text", { text: "FIELD\nNOTES", start: 6.267, duration: 1.733, track_id: titles });
  const card = p.tracks[0].clips[0].id;
  p = runCommand(p, "create_compound_clip", { clip_ids: [card], name: "Title card" });
  p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 43.3, duration: 3.2, y: -0.2, width: 0.5, height: 0.07, radius: 1, color: "#ffd27a", track_id: titles });
  return p;
}

const trackOf = (p: Project, id: string) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
/** The film's own tracks by name (the last of a name: new rows a title
 * makes are named Titles too, and go above). */
const named = (p: Project, name: string) => p.tracks.findLastIndex((t) => t.name === name);
const newest = (before: Project, after: Project) => after.tracks.flatMap((t) => t.clips).find((c) => !findClip(before, c.id))!;

describe("new titles land above what shows then", () => {
  it("puts a title with no track above its button and the grade, not on a free track below them", () => {
    const p = film();
    const q = runCommand(p, "add_text", { text: "FOLLOW", start: 43.3, duration: 3.2, y: -0.2 });
    const follow = newest(p, q);
    // The old landing took the first free track from the top: the Porthole
    // track, under the grade and under the pill it labels.
    expect(q.tracks[trackOf(q, follow.id)].name).not.toBe("Porthole");
    expect(trackOf(q, follow.id)).toBeLessThan(named(q, "Titles"));
    expect(adjustmentsOver(q, follow.id)).toEqual([]);
    // The next one at the same time stacks above it; one at another time
    // shares the nearest free titles row above the grade.
    const r = runCommand(q, "add_text", { text: "for the next entry", start: 43.5, duration: 3, y: -0.12 });
    expect(trackOf(r, newest(q, r).id)).toBeLessThan(trackOf(r, follow.id));
    const s = runCommand(q, "add_text", { text: "DAY 001", start: 3, duration: 3, y: -0.38 });
    const day = newest(q, s);
    expect(trackOf(s, day.id)).toBe(named(s, "Titles"));
    expect(s.tracks.length).toBe(q.tracks.length);
    expect(adjustmentsOver(s, day.id)).toEqual([]);
  });

  it("never joins a row of adjustment layers or of captions", () => {
    let p = film();
    p = runCommand(p, "add_captions", { captions: [{ text: "Station, how's the view?", start: 12, end: 14 }] });
    const q = runCommand(p, "add_text", { text: "TITLE", start: 20, duration: 2 });
    const t = q.tracks[trackOf(q, newest(p, q).id)];
    expect(t.clips.some((c) => c.type === "adjustment" || (c.type === "text" && c.caption))).toBe(false);
    expect(t.name).toBe("Titles");
  });

  it("says so when a title or shape is put under an adjustment layer by track_id", () => {
    const p = film();
    const porthole = p.tracks[named(p, "Porthole")].id;
    const report: CommandReport = {};
    const q = runCommand(p, "add_text", { text: "FOLLOW", start: 43.3, duration: 3.2, track_id: porthole }, report);
    expect(report.notes?.join(" ")).toMatch(/under the adjustment layer c_\w+ on track t_\w+ "Grade" \(0-46\.5 s\)/);
    expect(adjustmentsOver(q, newest(p, q).id)).toHaveLength(1);
    const shape: CommandReport = {};
    runCommand(p, "add_shape", { kind: "rectangle", start: 1, duration: 1, track_id: porthole }, shape);
    expect(shape.notes?.join(" ")).toMatch(/\(a shape\) is under the adjustment layer/);
    // Above the grade: nothing to say.
    const fine: CommandReport = {};
    runCommand(p, "add_text", { text: "OK", start: 1, duration: 1, track_id: p.tracks[named(p, "Titles")].id }, fine);
    expect(fine.notes).toBeUndefined();
  });
});

describe("beat hits go under the titles", () => {
  it("puts the Hits track under a titles track holding a title card compound and a button", () => {
    const p = runCommand(film(), "add_beat_hits", { effects: ["zoom"], times: [0.05, 8, 40] });
    const hits = named(p, "Hits");
    // Above the footage it punches (the porthole is footage), below the
    // titles: the old placement counted the title card as footage and
    // went above it, so the punches zoomed the hook title.
    expect(hits).toBeGreaterThan(named(p, "Titles"));
    expect(hits).toBeLessThan(named(p, "Porthole"));
    const card = p.tracks[named(p, "Titles")].clips.find((c) => c.type === "compound")!;
    expect(adjustmentsOver(p, card.id).filter((x) => x.track.name === "Hits")).toEqual([]);
  });

  it("puts cinematic bars above the hits and footage, below the title card", () => {
    let p = runCommand(film(), "add_beat_hits", { effects: ["zoom"], times: [8] });
    p = runCommand(p, "add_cinematic_bars", { ratio: 2.39 });
    expect(named(p, "Bars")).toBeGreaterThan(named(p, "Titles"));
    expect(named(p, "Bars")).toBeLessThan(named(p, "Hits"));
  });
});
