import { describe, expect, it } from "vitest";
import { busEnvelope, isBus, soundBuses, soundEnvelope, soundGainAt, soundingClips, soundSpan } from "../audio";
import { describeProject, runCommand } from "../commands";
import { mediaUsage } from "../mediaLibrary";
import { toOtio } from "../interchange/otio";
import { canCrop } from "../crop";
import { planFrame, planLayers } from "../render/plan";
import {
  breakCompound,
  breakProblem,
  closePath,
  compoundProblem,
  compoundView,
  createCompound,
  nestsItself,
  newClipIds,
  openPath,
  pruneCompounds,
  withCompoundView,
} from "./compound";
import { clipForAsset, createProject, createTextClip, createTrack, normalizeProject } from "./defaults";
import { addClip, addTrack, findClip, findCompound, setFps, setSpeed, trimClip, updateClip } from "./ops";
import type { Asset, Clip, CompoundClip, Project, Track } from "./types";
import { PRESETS } from "../speed";

// 30 fps; one 10 s video with sound, one 10 s music file.
const video: Asset = { id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 10, hasVideo: true, hasAudio: true };
const music: Asset = { id: "m", kind: "audio", name: "m.wav", src: "m.wav", duration: 10, hasVideo: false, hasAudio: true };

/**
 * Main: A [0,60) in 0 s, B [60,120) in 4 s, C [120,180) in 8 s.
 * Overlay: title T [70,100). Audio: music M [60,120).
 */
function fixture(): Project {
  let p: Project = { ...createProject(), assets: [video, music] };
  const main = p.tracks[0].id;
  const clip = (id: string, start: number, inS: number) => ({ ...clipForAsset(video, start, p.fps), id, duration: 60, in: inS }) as Clip;
  p = addClip(p, main, clip("A", 0, 0));
  p = addClip(p, main, clip("B", 60, 4));
  p = addClip(p, main, clip("C", 120, 8));
  const overlay = createTrack("video", "Overlay");
  p = addTrack(p, overlay, 0);
  p = addClip(p, overlay.id, { ...createTextClip("Hi", 70, 30), id: "T" });
  const audio = createTrack("audio", "Music");
  p = addTrack(p, audio);
  p = addClip(p, audio.id, { ...clipForAsset(music, 60, p.fps), id: "M", duration: 60 } as Clip);
  return p;
}

const where = (p: Project) =>
  p.tracks.map((t) => t.clips.map((c) => [c.id, c.start, c.duration, "in" in c ? +c.in.toFixed(4) : null]));

const compoundClip = (p: Project): CompoundClip => p.tracks.flatMap((t) => t.clips).find((c): c is CompoundClip => c.type === "compound")!;

describe("create compound clip", () => {
  it("replaces the selection with one clip on the lowest video track, spanning it", () => {
    const { project: p, clipId } = createCompound(fixture(), ["B", "T", "M"]);
    expect(clipId).toBeTruthy();
    const k = compoundClip(p);
    expect(k.id).toBe(clipId);
    expect([k.start, k.duration, k.in, k.speed]).toEqual([60, 60, 0, 1]);
    // B, T and M are gone from the timeline, and their emptied tracks too.
    expect(where(p)).toEqual([[["A", 0, 60, 0], [clipId, 60, 60, 0], ["C", 120, 60, 8]]]);
    expect(p.tracks[0].main).toBe(true);
  });

  it("keeps the clips inside at their relative timing, one track per track", () => {
    const { project: p } = createCompound(fixture(), ["B", "T", "M"]);
    const inner = p.compounds![0];
    expect(inner.tracks.map((t) => [t.kind, !!t.main, t.clips.map((c) => [c.id, c.start, c.duration])])).toEqual([
      ["video", false, [["T", 10, 30]]],
      ["video", true, [["B", 0, 60]]],
      ["audio", false, [["M", 0, 60]]],
    ]);
  });

  it("keeps whole groups inside and lets go of a group it splits", () => {
    const p0 = fixture();
    const grouped = { ...p0, tracks: p0.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === "B" || c.id === "T" ? { ...c, group: "g1" } : c.id === "M" || c.id === "C" ? { ...c, group: "g2" } : c)) })) };
    const { project: p } = createCompound(grouped, ["B", "T", "M"]);
    const inner = p.compounds![0].tracks.flatMap((t) => t.clips);
    expect(inner.map((c) => [c.id, c.group])).toEqual([["T", "g1"], ["B", "g1"], ["M", undefined]]);
  });

  it("names why a selection cannot become one", () => {
    const p = fixture();
    expect(compoundProblem(p, [])).toMatch(/Select/);
    expect(compoundProblem(p, ["M"])).toMatch(/video track/);
    // A spans [0,60) on the main track: T [70,100) and A together would
    // take [0,100) there, where B is.
    expect(compoundProblem(p, ["A", "T"])).toMatch(/in the way/);
    expect(createCompound(p, ["A", "T"]).clipId).toBeNull();
  });
});

describe("planning a compound clip", () => {
  it("draws the nested timeline at the inner frame, ids prefixed by the path", () => {
    const { project: p, clipId } = createCompound(fixture(), ["B", "T"]);
    // Frame 80 is inner frame 20: B (in 4 s) and T are on screen.
    const items = planFrame(p, 80);
    expect(items).toHaveLength(1);
    const top = items[0];
    if (top.kind !== "layer" || top.layer.source.kind !== "compound") throw new Error("expected a compound layer");
    expect(top.layer.clipId).toBe(clipId);
    expect(top.layer.source.frame).toBe(20);
    const inner = planLayers(top.layer.source.items);
    expect(inner.map((l) => l.clipId)).toEqual([`${clipId}/B`, `${clipId}/T`]);
    const b = inner[0].source;
    expect(b.kind === "video" && b.time).toBeCloseTo(4 + 20 / 30, 2);
  });

  it("crops like a video clip", () => {
    const { project: p, clipId } = createCompound(fixture(), ["B", "T"]);
    expect(canCrop(p, clipId!)).toBe(true);
  });

  it("follows the compound clip's trim and speed", () => {
    let { project: p, clipId } = createCompound(fixture(), ["B", "T"]);
    p = trimClip(p, clipId!, "start", 75); // starts 15 frames into the inner timeline
    let l = planFrame(p, 75)[0];
    expect(l.kind === "layer" && l.layer.source.kind === "compound" && l.layer.source.frame).toBe(15);
    p = setSpeed(p, clipId!, 2);
    l = planFrame(p, 80)[0];
    expect(l.kind === "layer" && l.layer.source.kind === "compound" && l.layer.source.frame).toBe(15 + 10);
  });

  it("is the same picture as the clips it holds, frame for frame", () => {
    const before = fixture();
    const { project: after } = createCompound(before, ["B", "T"]);
    for (const f of [60, 75, 99, 119]) {
      const flat = planLayers(planFrame(before, f)).map((l) => [l.clipId, l.source.kind === "video" ? +l.source.time.toFixed(4) : l.source.kind]);
      const nested = planLayers(planFrame(after, f)).filter((l) => l.source.kind !== "compound").map((l) => [l.clipId.split("/").pop(), l.source.kind === "video" ? +l.source.time.toFixed(4) : l.source.kind]);
      expect(nested).toEqual(flat);
    }
  });
});

describe("compound clip sound", () => {
  it("plays the inner clips at the outer times, through the compound clip's gain", () => {
    const { project: p0, clipId } = createCompound(fixture(), ["B", "T", "M"]);
    const p = updateClip(p0, clipId!, (c) => ({ ...c, volume: 0.5 }) as Clip);
    const has = () => true;
    const s = soundingClips(p, has).filter((x) => x.via);
    expect(s.map((x) => [x.clip.id, x.clip.start, x.clip.duration])).toEqual([
      ["B", 60, 60],
      ["M", 60, 60],
    ]);
    const m = s.find((x) => x.clip.id === "M")!;
    expect(soundSpan(m, p.fps)).toEqual([2, 4]);
    expect(soundGainAt(m, p.fps, 3)).toBeCloseTo(0.5);
    expect(soundGainAt(m, p.fps, 4.5)).toBe(0);
  });

  it("mixes through a bus when the compound clip has a compressor or an EQ: its volume and fades after it (ADR-100)", () => {
    const { project: p0, clipId } = createCompound(fixture(), ["B", "T", "M"]);
    const id = clipId!;
    // set_compressor took video and audio clips only: a compound's mix
    // could not be compressed, and its EQ was stored but never heard.
    let p = runCommand(p0, "set_compressor", { clip_ids: [id], preset: "voice" });
    p = updateClip(p, id, (c) => ({ ...c, volume: 0.5, fadeOut: 15 }) as Clip);
    expect(describeProject(p).tracks.flatMap((t) => t.clips).find((c) => c.id === id)).toMatchObject({ compressor: "voice" });
    const m = soundingClips(p, () => true).find((x) => x.clip.id === "M")!;
    const route = soundBuses(m);
    expect(route.through).toBe(0);
    expect(route.buses.map((b) => [b.key, b.clip.id, b.gains.map((g) => g.clip.id)])).toEqual([[id, id, [id]]]);
    // The clip's own envelope leaves the compound clip's gain to the bus.
    expect(soundEnvelope(m, p.fps, 2, 4, 10, route.through)[5]).toBeCloseTo(1);
    const bus = busEnvelope(route.buses[0], p.fps, 2, 4, 10);
    expect(bus[5]).toBeCloseTo(0.5);
    expect(bus[18]).toBeLessThan(0.25);
    // Without one, nothing changes: the compound clip's gain stays the clip's.
    expect(isBus(compoundClip(p0))).toBe(false);
    expect(soundBuses(soundingClips(p0, () => true).find((x) => x.clip.id === "M")!)).toEqual({ through: 1, buses: [] });
    // An EQ alone makes it a bus; a flat one does not.
    expect(isBus({ ...compoundClip(p0), eq: { high: -6 } })).toBe(true);
    expect(isBus({ ...compoundClip(p0), eq: { low: 0 } })).toBe(false);
  });

  it("keys each bus by its path: nested buses feed out in turn, and two uses of one compound are two buses", () => {
    const { project: p0, clipId: inner } = createCompound(fixture(), ["B", "T", "M"]);
    let p = runCommand(p0, "set_compressor", { clip_ids: [inner!], preset: "gentle" });
    const { project: p1, clipId: outer } = createCompound(p, [inner!, "C"]);
    // The outer compound is not a bus: the inner one's gains run out to the track.
    let m = soundingClips(p1, () => true).find((x) => x.clip.id === "M")!;
    expect(soundBuses(m).buses.map((b) => [b.key, b.gains.map((g) => g.clip.id)])).toEqual([[`${inner}/${outer}`, [inner, outer]]]);
    p = runCommand(p1, "set_compressor", { clip_ids: [outer!], preset: "strong" });
    m = soundingClips(p, () => true).find((x) => x.clip.id === "M")!;
    expect(soundBuses(m).buses.map((b) => [b.key, b.gains.map((g) => g.clip.id)])).toEqual([
      [`${inner}/${outer}`, [inner]],
      [outer, [outer]],
    ]);
    // The same compound played again is another bus.
    const twice = runCommand(p, "duplicate_clips", { clip_ids: [outer!], at: 20 });
    const keys = soundingClips(twice, () => true).filter((x) => x.clip.id === "M").map((x) => soundBuses(x).buses[1].key);
    expect(new Set(keys).size).toBe(2);
  });

  it("speeds up with the compound clip and is silent when it is muted", () => {
    const { project: p0, clipId } = createCompound(fixture(), ["B", "T", "M"]);
    const p = setSpeed(p0, clipId!, 2);
    const m = soundingClips(p, () => true).find((x) => x.clip.id === "M")!;
    expect([m.clip.start, m.clip.duration, m.clip.speed]).toEqual([60, 30, 2]);
    const muted = updateClip(p, clipId!, (c) => ({ ...c, muted: true }) as Clip);
    expect(soundingClips(muted, () => true).some((x) => x.clip.id === "M")).toBe(false);
  });
});

describe("break apart", () => {
  it("puts the clips back where they were, with their ids", () => {
    const before = fixture();
    const { project: p, clipId } = createCompound(before, ["B", "T", "M"]);
    expect(breakProblem(p, clipId!)).toBeNull();
    const back = pruneCompounds(breakCompound(p, clipId!));
    const sorted = (q: Project) => where(q).flat().sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(sorted(back)).toEqual(sorted(before));
    expect(back.compounds).toBeUndefined();
    expect(newClipIds(p, back).sort()).toEqual(["B", "M", "T"]);
  });

  it("keeps only what the trimmed compound clip showed", () => {
    let { project: p, clipId } = createCompound(fixture(), ["B", "T"]);
    p = trimClip(p, clipId!, "start", 80);
    const back = breakCompound(p, clipId!);
    const b = findClip(back, "B")!.clip as Clip & { in: number };
    expect([b.start, b.duration, +b.in.toFixed(4)]).toEqual([80, 40, +(4 + 20 / 30).toFixed(4)]);
    const t = findClip(back, "T")!.clip;
    expect([t.start, t.duration]).toEqual([80, 20]);
  });

  it("asks for 1x first", () => {
    const { project: p, clipId } = createCompound(fixture(), ["B", "T"]);
    expect(breakProblem(setSpeed(p, clipId!, 2), clipId!)).toMatch(/1x/);
  });
});

describe("opening a compound", () => {
  it("edits the nested timeline and writes it back", () => {
    const { project: doc, clipId } = createCompound(fixture(), ["B", "T"]);
    const id = compoundClip(doc).compoundId;
    const { view, levels } = openPath(doc, [id]);
    expect(levels.map((l) => l.id)).toEqual([id]);
    expect(view.tracks.flatMap((t) => t.clips.map((c) => c.id)).sort()).toEqual(["B", "T"]);
    const edited = updateClip(view, "T", (c) => ({ ...c, start: 0 }));
    const back = closePath(edited, levels);
    expect(findClip(back, clipId!)).toBeTruthy();
    expect(findCompound(back, id)!.tracks[0].clips[0].start).toBe(0);
    // Stops at a compound the timeline above no longer plays.
    expect(openPath(fixture(), [id]).levels).toEqual([]);
  });

  it("refuses an edit that makes a compound play itself", () => {
    const { project: doc } = createCompound(fixture(), ["B", "T"]);
    const k = compoundClip(doc);
    const { view, levels } = openPath(doc, [k.compoundId]);
    const self = addClip(view, view.tracks[0].id, { ...k, id: "loop", start: 200 });
    expect(nestsItself(self, levels)).toBe(true);
    expect(withCompoundView(doc, k.compoundId, self)).toBe(doc);
  });

  it("rescales the outer timeline once when the frame rate changes inside", () => {
    const { project: doc } = createCompound(fixture(), ["B", "T"]);
    const id = compoundClip(doc).compoundId;
    const { view, levels } = openPath(doc, [id]);
    const back = closePath(setFps(view, { num: 60, den: 1 }), levels);
    const direct = setFps(doc, { num: 60, den: 1 });
    expect(where(back)).toEqual(where(direct));
    expect(findCompound(back, id)!.tracks.map((t) => t.clips.map((c) => [c.start, c.duration]))).toEqual(
      findCompound(direct, id)!.tracks.map((t) => t.clips.map((c) => [c.start, c.duration])),
    );
  });

  it("compoundView keeps settings and assets", () => {
    const { project: doc } = createCompound(fixture(), ["B", "T"]);
    const v = compoundView(doc, compoundClip(doc).compoundId);
    expect([v.width, v.fps, v.assets]).toEqual([doc.width, doc.fps, doc.assets]);
  });
});

describe("saved compounds", () => {
  it("round-trip through JSON, and older projects still load", () => {
    const { project: doc } = createCompound(fixture(), ["B", "T", "M"]);
    expect(normalizeProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(normalizeProject(JSON.parse(JSON.stringify(fixture()))).compounds).toBeUndefined();
  });

  it("refuse a clip of a missing compound and a compound that contains itself", () => {
    const { project: doc } = createCompound(fixture(), ["B", "T"]);
    const k = compoundClip(doc);
    const lost = JSON.parse(JSON.stringify(doc)) as Project;
    lost.compounds = [];
    expect(() => normalizeProject(lost)).toThrow(/not in compounds/);
    const loop = JSON.parse(JSON.stringify(doc)) as Project;
    const inner = loop.compounds![0].tracks.find((t: Track) => t.main)!;
    inner.clips.push({ ...k, id: "loop", start: 500 });
    expect(() => normalizeProject(loop)).toThrow(/contains itself/);
  });

  it("drop compounds nothing plays", () => {
    const { project: doc, clipId } = createCompound(fixture(), ["B", "T"]);
    const gone = { ...doc, tracks: doc.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })) };
    expect(pruneCompounds(gone).compounds).toBeUndefined();
    expect(pruneCompounds(doc)).toBe(doc);
  });
});

it("counts files used inside a compound clip as used there", () => {
  const { project: p, clipId } = createCompound(fixture(), ["B", "T", "M"]);
  const uses = mediaUsage(p.tracks, p.compounds);
  expect(uses.get("m")).toEqual([{ clipId, start: 60 }]);
  expect(uses.get("v")!.map((u) => u.clipId).sort()).toEqual(["A", "C", clipId].sort());
});

it("exports to OTIO as a nested stack trimmed to what it shows", () => {
  let { project: p, clipId } = createCompound(fixture(), ["B", "T", "M"]);
  p = trimClip(p, clipId!, "start", 66);
  const tracks = (toOtio(p).tracks as { children: { children: Record<string, unknown>[] }[] }).children;
  const stack = tracks[0].children.find((c) => c.OTIO_SCHEMA === "Stack.1")!;
  expect(stack.source_range).toMatchObject({ start_time: { value: 6 }, duration: { value: 54 } });
  const inner = (stack.children as { kind: string; children: { name: string }[] }[]).map((t) => [t.kind, t.children.map((c) => c.name)]);
  expect(inner).toEqual([
    ["Video", ["v.mp4"]],
    ["Video", ["", "Hi"]],
    ["Audio", ["v.mp4"]],
    ["Audio", ["m.wav"]],
  ]);
});

describe("commands for agents", () => {
  it("create, describe, edit inside, break apart", () => {
    let p = runCommand(fixture(), "create_compound_clip", { clip_ids: ["B", "T"], name: "Intro" });
    const d = describeProject(p);
    const clip = d.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!;
    expect(d.compounds).toHaveLength(1);
    expect(clip).toMatchObject({ start: 2, end: 4, compound: d.compounds![0].id });
    expect(d.compounds![0]).toMatchObject({ name: "Intro", duration: 2 });
    const k = d.compounds![0].id;
    p = runCommand(p, "edit_compound", { compound_id: k, command: "set_param", args: { clip_ids: ["T"], path: "opacity", value: 0.5 } });
    expect(findCompound(p, k)!.tracks[0].clips[0]).toMatchObject({ id: "T", opacity: 0.5 });
    p = runCommand(p, "break_compound_clip", { clip_id: clip.id });
    expect(findClip(p, "T")!.clip).toMatchObject({ start: 70, opacity: 0.5 });
  });

  it("explain what they cannot do", () => {
    expect(() => runCommand(fixture(), "create_compound_clip", { clip_ids: ["A", "T"] })).toThrow(/in the way/);
    const p = runCommand(fixture(), "create_compound_clip", { clip_ids: ["B", "T"] });
    const id = compoundClip(p).id;
    expect(() => runCommand(p, "set_reverse", { clip_id: id, reverse: true })).toThrow(/backward/);
    expect(() => runCommand(p, "set_speed_curve", { clip_id: id, preset: Object.keys(PRESETS)[0] })).toThrow(/constant speed/);
    expect(() => runCommand(p, "break_compound_clip", { clip_id: "A" })).toThrow(/compound clip/);
  });
});

describe("a compound clip as a template (duplicate_clips unique)", () => {
  /** A styled window: footage with a mask and a border shape, as one compound clip. */
  function window(): { p: Project; clipId: string; compoundId: string } {
    const shot2: Asset = { ...video, id: "v2", name: "v2.mp4" };
    let p: Project = { ...createProject(), assets: [video, shot2] };
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 2 });
    const ui = p.tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "set_mask", { clip_ids: [ui], shape: "rectangle", radius: 0.2 });
    p = runCommand(p, "add_shape", { kind: "rounded_rectangle", start: 0, duration: 2, fill: false, stroke_width: 2 });
    const border = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "color")!.id;
    p = runCommand(p, "set_track_matte", { clip_id: border, matte_clip_id: ui });
    const made = createCompound(p, [ui, border], "Window");
    const clip = findClip(made.project, made.clipId!)!.clip as CompoundClip;
    return { p: made.project, clipId: clip.id, compoundId: clip.compoundId };
  }

  it("shares the nested timeline by default, as before", () => {
    const { p, clipId, compoundId } = window();
    const q = runCommand(p, "duplicate_clips", { clip_ids: [clipId] });
    const copies = q.tracks.flatMap((t) => t.clips).filter((c): c is CompoundClip => c.type === "compound");
    expect(copies.map((c) => c.compoundId)).toEqual([compoundId, compoundId]);
    expect(q.compounds).toHaveLength(1);
  });

  it("gives a unique copy its own timeline under fresh ids, that takes other footage without touching the original", () => {
    const { p, clipId, compoundId } = window();
    let q = runCommand(p, "duplicate_clips", { clip_ids: [clipId], unique: true });
    const copy = q.tracks.flatMap((t) => t.clips).find((c): c is CompoundClip => c.type === "compound" && c.id !== clipId)!;
    expect(copy.compoundId).not.toBe(compoundId);
    const [orig, mine] = [findCompound(q, compoundId)!, findCompound(q, copy.compoundId)!];
    expect(mine.name).toBe("Window copy");
    const ids = (k: typeof orig) => k.tracks.flatMap((t) => [t.id, ...t.clips.map((c) => c.id)]);
    expect(ids(mine).some((id) => ids(orig).includes(id))).toBe(false);
    // The border's track matte follows the copy's footage.
    const inner = mine.tracks.flatMap((t) => t.clips);
    const ui = inner.find((c) => c.type === "video")!;
    expect((inner.find((c) => c.type === "color") as Clip & { trackMatte?: { clipId?: string } }).trackMatte?.clipId).toBe(ui.id);
    // Other footage in the copy: the original keeps its own.
    q = runCommand(q, "edit_compound", { compound_id: copy.compoundId, command: "replace_clip", args: { clip_id: ui.id, asset_id: "v2" } });
    const asset = (id: string) => (findCompound(q, id)!.tracks.flatMap((t) => t.clips).find((c) => c.type === "video") as Clip & { assetId: string }).assetId;
    expect([asset(compoundId), asset(copy.compoundId)]).toEqual(["v", "v2"]);
    // A second unique copy is numbered.
    q = runCommand(q, "duplicate_clips", { clip_ids: [clipId], unique: true });
    expect(q.compounds!.map((k) => k.name)).toEqual(["Window", "Window copy", "Window copy 2"]);
    expect(describeProject(q).compounds!.map((k) => k.name)).toContain("Window copy 2");
  });
});
