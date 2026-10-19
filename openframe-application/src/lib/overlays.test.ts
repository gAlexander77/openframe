import { describe, expect, it } from "vitest";
import { animationSpan, placeOnTop, revealSpan } from "./overlays";
import { createProject, createTextClip, createTrack } from "./project/defaults";
import { addClip, addTrack, findClip } from "./project/ops";
import type { Clip, Project } from "./project/types";

const text = (start: number, duration: number, id: string) => ({ ...createTextClip(id, start, duration), id });
const trackOf = (p: Project, id: string) => p.tracks.indexOf(findClip(p, id)!.track);

describe("placeOnTop", () => {
  it("puts the first overlay on a new track above the main track", () => {
    const p = placeOnTop(createProject(), text(0, 30, "a"), "Sticker");
    expect(p.tracks.map((t) => t.name)).toEqual(["Sticker", "Main"]);
    expect(trackOf(p, "a")).toBe(0);
  });

  it("reuses the overlay row when the range is free there", () => {
    let p = placeOnTop(createProject(), text(0, 30, "a"), "Sticker");
    p = placeOnTop(p, text(60, 30, "b"), "Sticker");
    expect(p.tracks).toHaveLength(2);
    expect(trackOf(p, "b")).toBe(trackOf(p, "a"));
  });

  it("stacks above whatever already shows at that time", () => {
    let p = placeOnTop(createProject(), text(0, 30, "a"), "Text");
    p = placeOnTop(p, text(10, 30, "b"), "Sticker");
    expect(trackOf(p, "b")).toBeLessThan(trackOf(p, "a"));
    p = placeOnTop(p, text(20, 5, "c"), "Sticker");
    expect(trackOf(p, "c")).toBeLessThan(trackOf(p, "b"));
  });

  it("goes above a busy track even when a free row sits lower", () => {
    // Top track busy at 0..30, a free overlay row under it: the new clip must
    // not hide under the busy one.
    let p = createProject();
    const low = createTrack("video", "Low");
    const high = createTrack("video", "High");
    p = addTrack(addTrack(p, low, 0), high, 0);
    p = addClip(p, high.id, text(0, 30, "busy"));
    p = placeOnTop(p, text(5, 10, "new"), "Sticker");
    expect(trackOf(p, "new")).toBe(0);
    expect(p.tracks[0].name).toBe("Sticker");
  });

  it("never lands on a locked track", () => {
    let p = createProject();
    const locked = { ...createTrack("video", "Locked"), locked: true };
    p = addTrack(p, locked, 0);
    p = placeOnTop(p, text(0, 30, "a"), "Sticker");
    expect(findClip(p, "a")!.track.locked).toBe(false);
    expect(p.tracks).toHaveLength(3);
  });

  it("chains a multi-layer template bottom to top", () => {
    let p = createProject();
    for (const id of ["box", "name", "role"]) p = placeOnTop(p, text(0, 60, id), "Template");
    expect(trackOf(p, "role")).toBeLessThan(trackOf(p, "name"));
    expect(trackOf(p, "name")).toBeLessThan(trackOf(p, "box"));
  });
});

describe("revealSpan", () => {
  const title = { ...createTextClip("Title", 100, 90), animIn: { type: "rise", duration: 15 } };
  it("plays a new clip's In animation when the playhead is inside it", () => {
    expect(revealSpan([title], 100)).toEqual({ from: 100, to: 115 });
    expect(revealSpan([title], 110)).toEqual({ from: 100, to: 115 });
  });
  it("leaves the playhead alone when the clip already shows there", () => {
    expect(revealSpan([title], 115)).toBeNull();
    expect(revealSpan([title], 40)).toBeNull();
    expect(revealSpan([createTextClip("Plain", 100, 90)], 100)).toBeNull();
  });
  it("covers every layer of a template, to the last one settled", () => {
    const late = { ...createTextClip("Sub", 108, 60), animIn: { type: "fade", duration: 20 } };
    expect(revealSpan([title, late, createTextClip("Plain", 100, 90)], 100)).toEqual({ from: 100, to: 128 });
  });
});

describe("animationSpan", () => {
  const clip = { ...createTextClip("Title", 100, 90), animIn: { type: "rise", duration: 15 }, animOut: { type: "fade", duration: 20 }, animLoop: { type: "pulse", duration: 30 } };
  it("plays the In from the clip's start to where it settles", () => {
    expect(animationSpan(clip, "in")).toEqual({ from: 100, to: 115 });
  });
  it("plays the Out to the clip's last frame", () => {
    expect(animationSpan(clip, "out")).toEqual({ from: 169, to: 189 });
  });
  it("plays one loop cycle after the In, or earlier when the clip has no room", () => {
    expect(animationSpan(clip, "loop")).toEqual({ from: 115, to: 145 });
    expect(animationSpan({ ...clip, duration: 40 }, "loop")).toEqual({ from: 109, to: 139 });
  });
  it("plays nothing for an empty slot, and never past a short clip", () => {
    expect(animationSpan(createTextClip("Plain", 0, 30), "in")).toBeNull();
    expect(animationSpan({ ...clip, duration: 10 }, "in")).toEqual({ from: 100, to: 109 });
  });
});

describe("placeOnTop with footage", () => {
  it("never shares a B-roll row, even one empty at that time, and goes above it", () => {
    let p = createProject();
    const broll = createTrack("video", "B-roll");
    p = addTrack(p, broll, 0);
    p = addClip(p, broll.id, { ...text(300, 60, "shot"), type: "video", assetId: "a1" } as unknown as Clip);
    p = placeOnTop(p, text(0, 30, "title"), "Text");
    expect(findClip(p, "title")!.track.id).not.toBe(broll.id);
    expect(trackOf(p, "title")).toBeLessThan(p.tracks.findIndex((t) => t.id === broll.id));
  });
});
