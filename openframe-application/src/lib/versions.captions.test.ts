// A version says when a picture or graphic crosses its burned captions
// (ADR-116): Claude film test 2's porthole picture-in-picture sat under the
// 16:9 version's captions, and the check sheet said nothing.
import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { Project, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { applyOverrides, boxOf, captionCollisions, versionProject } from "./versions";

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
  it("names the porthole a 16:9 version draws across its captions, with the override that clears it", () => {
    const { p, porthole, caption } = film();
    // The master is clear: the circle ends above the caption.
    expect(captionCollisions(p)).toEqual([]);
    const q = versionProject(p, { ratio: "16:9" });
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
