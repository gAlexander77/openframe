// A version says when a picture or graphic crosses its burned captions
// (ADR-116): Claude film test 2's porthole picture-in-picture sat under the
// 16:9 version's captions, and the check sheet said nothing.
import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import { minTextSize } from "./brandKit";
import { captionMax } from "./captionLooks";
import type { Project, TextClip, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { applyOverrides, boxOf, captionCollisions, versionProject, type CaptionCollision } from "./versions";

// About 0.55 em a character, wrapping at the style's width, as versions.test.ts measures.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080;
  const widest = Math.max(...c.text.split("\n").map((l) => l.length)) * size * 0.55;
  const lines = c.text.split("\n").length * Math.max(1, Math.ceil(widest / (c.style.maxWidth * w)));
  return { width: Math.min(widest, c.style.maxWidth * w) + 4, height: size * c.style.lineHeight * lines + 4 };
});

/** The film's middle, 9:16: the station behind a round porthole, mission
 * control's line captioned in the frame's middle, as the tester had it. */
function film(): { p: Project; porthole: string; caption: string } {
  let p: Project = {
    ...createProject({ name: "Field notes", fps: { num: 30, den: 1 }, width: 1080, height: 1920 }),
    assets: [
      { id: "earth", kind: "video", name: "earth.mp4", src: "earth.mp4", duration: 30, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false },
      { id: "station", kind: "video", name: "station.mp4", src: "station.mp4", duration: 30, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "earth", start: 0, duration: 20 });
  p = runCommand(p, "set_param", { clip_ids: [p.tracks[0].clips[0].id], path: "transform.scale", value: 3.1646 });
  p = runCommand(p, "add_track", { kind: "video", name: "Porthole" });
  p = runCommand(p, "add_media_clip", { asset_id: "station", start: 12, duration: 2, track_id: p.tracks[0].id });
  const porthole = p.tracks[0].clips[0].id;
  p = runCommand(p, "set_param", { clip_ids: [porthole], path: "transform.scale", value: 1.6 });
  p = runCommand(p, "set_param", { clip_ids: [porthole], path: "transform.y", value: -0.1905 });
  p = runCommand(p, "set_mask", { clip_ids: [porthole], shape: "circle", width: 0.44, aspect: 1, y: 0.08, feather: 0 });
  p = runCommand(p, "add_captions", { captions: [{ text: "Station, how's the view?", start: 12.4, end: 13.9 }] });
  const caption = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id;
  p = runCommand(p, "set_param", { clip_ids: [caption], path: "transform.y", value: 0.12 });
  return { p, porthole, caption };
}

/** The top of a masked picture's circle on the frame, pixels. */
function visibleTop(q: Project, id: string): number {
  const c = findClip(q, id)!.clip as VisualClip;
  const b = boxOf(q, c, 12);
  const m = (c as { mask: { y: number; height: number } }).mask;
  return b.top + (0.5 + m.y - m.height / 2) * (b.bottom - b.top);
}

describe("captions a version's overlays cross", () => {
  it("moves the porthole a 16:9 version would draw across its captions clear of them, and says so", () => {
    // ADR-118: the version now applies the override ADR-116 only named.
    const { p, porthole } = film();
    // The master is clear: the circle ends above the caption.
    expect(captionCollisions(p)).toEqual([]);
    const moved: CaptionCollision[] = [];
    const q = versionProject(p, { ratio: "16:9" }, undefined, undefined, undefined, moved);
    expect(captionCollisions(q)).toEqual([]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ clip_id: porthole, layer: "under" });
    expect(moved[0].note).toMatch(/was drawn under the caption .* where the master keeps it clear$/);
    expect(moved[0].done).toMatch(/^moved clear of the captions in this version: y -?[\d.]+/);
    // Whole, inside the frame, above the caption.
    expect(visibleTop(q, porthole)).toBeGreaterThanOrEqual(0);
    expect(moved[0].box.bottom).toBeLessThan(boxOf(q, findClip(q, moved[0].caption_clip_id)!.clip as VisualClip).top);
  });

  it("only names it where the version's overrides place it, with the override that clears it", () => {
    const { p, porthole, caption } = film();
    const moved: CaptionCollision[] = [];
    const q = versionProject(p, { ratio: "16:9", overrides: [{ clip_id: porthole, x: 0 }] }, undefined, undefined, undefined, moved);
    expect(moved).toEqual([]);
    const hits = captionCollisions(q);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ clip_id: porthole, caption_clip_id: caption, layer: "under" });
    expect(hits[0].note).toMatch(/is drawn under the caption .* an override \{clip_id: "c_\w+", y: -?[\d.]+(, scale: [\d.]+)?\} puts it above the caption/);
    // The override it names clears it, the circle still inside the frame.
    const y = Number(/y: (-?[\d.]+)/.exec(hits[0].note)![1]);
    const scale = Number(/scale: ([\d.]+)/.exec(hits[0].note)?.[1] ?? 1);
    const fixed = applyOverrides(q, [{ clip_id: porthole, y, scale }]);
    expect(captionCollisions(fixed)).toEqual([]);
    expect(visibleTop(fixed, porthole)).toBeGreaterThanOrEqual(0);
  });

  it("lays a group out as one above the captions, and leaves what the master itself draws across them", () => {
    // A group (a picture and its bar) is placed as one, in the room above
    // the captions the version placed (as tall versions keep it), not
    // moved by a picture's override.
    let { p, porthole } = film();
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 12, duration: 2, y: -0.19, width: 0.3, height: 0.05, color: "#ffffff" });
    const bar = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "color")!.id;
    p = runCommand(p, "group_clips", { clip_ids: [porthole, bar] });
    const moved: CaptionCollision[] = [];
    const q = versionProject(p, { ratio: "16:9" }, undefined, undefined, undefined, moved);
    expect(moved).toEqual([]);
    expect(captionCollisions(q)).toEqual([]);
    // A master that draws the porthole across its own caption: its design.
    let { p: low, porthole: id } = film();
    low = runCommand(low, "set_param", { clip_ids: [id], path: "transform.y", value: 0.0 });
    expect(captionCollisions(low).map((x) => x.clip_id)).toEqual([id]);
    const kept: CaptionCollision[] = [];
    versionProject(low, { ratio: "16:9" }, undefined, undefined, undefined, kept);
    expect(kept).toEqual([]);
  });

  it("measures a masked picture by its mask, not its whole frame", () => {
    let { p, porthole } = film();
    // Lower, its circle high in the picture: the whole picture (1728 by
    // 972 px) reaches the caption, its circle does not.
    p = runCommand(p, "set_param", { clip_ids: [porthole], path: "transform.y", value: -0.1 });
    p = runCommand(p, "set_mask", { clip_ids: [porthole], y: -0.15 });
    expect(findClip(p, porthole)!.clip.type).toBe("video");
    expect(captionCollisions(p)).toEqual([]);
    const unmasked = runCommand(p, "set_mask", { clip_ids: [porthole], shape: "none" });
    expect(captionCollisions(unmasked).map((x) => x.clip_id)).toEqual([porthole]);
  });
});

/** A 9:16 short with the film's word captions (Arial Black 60, a countdown
 * at 120), its captions where the tester put them (y 0.08), and a title. */
function short(): { p: Project; words: string[]; countdown: string; title: string } {
  let p: Project = {
    ...createProject({ name: "Field notes", fps: { num: 30, den: 1 }, width: 1080, height: 1920 }),
    assets: [{ id: "earth", kind: "video", name: "earth.mp4", src: "earth.mp4", duration: 30, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "earth", start: 0, duration: 12 });
  p = runCommand(p, "set_param", { clip_ids: [p.tracks[0].clips[0].id], path: "transform.scale", value: 3.1646 });
  const texts = ["Three.", "Day one.", "They strap", "you to a", "fire...", "and let go."];
  p = runCommand(p, "add_captions", {
    y: 0.08,
    style: { font: "Arial Black", size: 60, case: "upper", stroke: { color: "#000000", width: 8 }, shadow: { color: "rgba(0,0,0,0.6)", blur: 18, x: 0, y: 6 }, maxWidth: 0.62 },
    captions: texts.map((text, i) => ({ text, start: 0.5 + i, end: 1.4 + i })),
  });
  const caps = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").map((c) => c.id);
  p = runCommand(p, "set_text", { clip_ids: [caps[0]], style: { size: 120 } });
  p = runCommand(p, "add_text", { text: "MY DIARY FROM SPACE", start: 7, duration: 3, y: -0.2, style: { size: 70 } });
  const title = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && !c.caption)!.id;
  return { p, words: caps.slice(1), countdown: caps[0], title };
}

const text = (q: Project, id: string) => findClip(q, id)!.clip as TextClip;

describe("a tall short's captions on a version that is not tall (ADR-118)", () => {
  it("come down to a landscape caption's size on 16:9, at its caption place, a countdown staying twice the rest", () => {
    const { p, words, countdown } = short();
    const q = versionProject(p, { ratio: "16:9" });
    for (const id of words) {
      const c = text(q, id);
      // 72: the largest caption look on a wide frame (6.7% of its height),
      // not 107 (60 kept against the short side: a tenth of the height).
      expect(c.style.size, id).toBeCloseTo(captionMax(q), 1);
      expect(c.transform.x).toBe(0);
      expect(c.transform.y).toBeCloseTo(0.36, 2);
      expect(c.style.maxWidth).toBeCloseTo(0.84, 2);
      // Never under the readable size check_project judges by.
      expect(c.style.size).toBeGreaterThanOrEqual(minTextSize(1920, 1080));
      // Inside the title-safe area.
      expect(boxOf(q, c).bottom).toBeLessThanOrEqual(1080 * 0.95 + 0.5);
    }
    expect(text(q, countdown).style.size).toBeCloseTo(2 * captionMax(q), 1);
    expect(text(q, countdown).style.stroke!.width / text(q, countdown).style.size).toBeCloseTo(8 / 120, 3);
  });

  it("keep their size on a square, seen at a phone's width as the short is, at its caption place", () => {
    const { p, words } = short();
    const q = versionProject(p, { ratio: "1:1" });
    for (const id of words) {
      expect(text(q, id).style.size).toBeCloseTo((60 * 1920) / 1080, 1);
      expect(text(q, id).transform.y).toBeLessThanOrEqual(0.36);
      expect(text(q, id).transform.x).toBe(0);
    }
    // All at one height, not each placed as an overlay of its own.
    expect(new Set(words.map((id) => text(q, id).transform.y)).size).toBe(1);
  });

  it("keep add_captions' own size on 16:9, and titles keep their share of the short side", () => {
    let { p, words, title } = short();
    p = runCommand(p, "set_text", { clip_ids: words, style: { size: 36 } });
    const q = versionProject(p, { ratio: "16:9" });
    // 36 on 9:16 is add_captions' 64 on 16:9: under the landscape size, kept.
    for (const id of words) expect(text(q, id).style.size).toBeCloseTo(64, 1);
    // A headline keeps its share of the short side (the design rules size
    // 9:16 headlines 50-90 and 16:9 ones 90-160 alike).
    expect(text(q, title).style.size).toBeCloseTo((70 * 1920) / 1080, 0);
  });
});
