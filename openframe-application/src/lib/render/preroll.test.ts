import { describe, expect, it } from "vitest";
import { clipForAsset, createProject } from "../project/defaults";
import { addClip, setTransition } from "../project/ops";
import { choose, DEFAULT_DECODE_RATE, entryTargets, heldBytes, leadFor, MAX_LEAD, MIN_LEAD, nextDecodeRate, upcomingEntries, workFor, type Target } from "./preroll";

const target: Target = { kind: "video", clipId: "b", assetId: "a", lane: 0, time: 7, reverse: false, pixels: 1920 * 1080, fps: 30 };
describe("decoder preroll", () => {
  it("prepares the transition handle, before the nominal cut", () => {
    let p = createProject({ fps: { num: 30, den: 1 } });
    p.assets = [{ id: "a", kind: "video", name: "fixture", src: "fixture.mp4", duration: 10, fps: 30, hasVideo: true, hasAudio: false }];
    const base = clipForAsset(p.assets[0], 0, p.fps);
    p = addClip(p, p.tracks[0].id, { ...base, id: "a", duration: 90 });
    p = addClip(p, p.tracks[0].id, { ...base, id: "b", start: 90, duration: 60, in: 7 } as typeof base);
    p = setTransition(p, "a", { type: "zoomPunch", duration: 10 });
    const [entry] = upcomingEntries(p, 0, 150);
    expect(entry.at).toBe(85);
    expect(entryTargets(p, entry)[0].time).toBeCloseTo(7 - 5 / 30 + 1 / 120, 6);
    expect(upcomingEntries(p, 85, 150)).toEqual([]);
    expect(upcomingEntries({ ...p, tracks: p.tracks.map(t => ({ ...t, hidden: true })) }, 0, 150)).toEqual([]);
  });
  it("scales lead with GOP work, limits it, and learns slow decodes faster", () => {
    const work = workFor([target], [7]);
    expect(work).toBe(210 * target.pixels);
    expect(leadFor(work, DEFAULT_DECODE_RATE)).toBeGreaterThan(MIN_LEAD);
    expect(leadFor(0, DEFAULT_DECODE_RATE)).toBe(MIN_LEAD);
    expect(leadFor(work, 1)).toBe(MAX_LEAD);
    expect(nextDecodeRate(100, 50, 1000, 20)).toBe(65);
    expect(nextDecodeRate(100, 150, 1000, 20)).toBe(115);
    expect(nextDecodeRate(100, 50, 1000, 2)).toBe(100);
  });
  it("admits only due entries within the byte budget, including the first", () => {
    const bytes = heldBytes([target]);
    const a = { at: 30, lead: 2, bytes, active: false };
    const b = { ...a, at: 40 };
    expect(choose([a, b], 0, 30, bytes)).toEqual([a]);
    const held = { ...b, active: true };
    expect(choose([a, held], 0, 30, bytes)).toEqual([held]);
    expect(choose([a], 0, 30, bytes - 1)).toEqual([]);
    expect(choose([{ ...a, at: 100 }], 0, 30)).toEqual([]);
    expect(choose([{ ...a, at: 100, active: true }], 0, 30)).toHaveLength(1);
    expect(heldBytes([{ ...target, reverse: true }])).toBeGreaterThan(bytes);
  });
});
