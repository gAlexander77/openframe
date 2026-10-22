import { describe, expect, it } from "vitest";
import { clipCaptions, clipSubjects, placeClipText, prepareClipText } from "./clipTemplate";
import { captionReading } from "./captions";
import { checkProject, seenLetters, seenTexts } from "./designCheck";
import { planClips } from "./clipProjects";
import { runCommand } from "./commands";
import { clipForAsset, createProject } from "./project/defaults";
import type { Asset, VideoClip } from "./project/types";
import { streamBands } from "./streamLayout";
import { measureLook, titleLook } from "./contrast";

const asset: Asset = { id: "vod", name: "VOD", kind: "video", src: "vod.mp4", width: 1920, height: 1080, duration: 10, hasAudio: true, hasVideo: true };
const text = (p: ReturnType<typeof createProject>, value: string) => seenTexts(p).find(s => s.c.text === value)!;
const box = (p: ReturnType<typeof createProject>, value: string) => seenLetters(p, text(p, value))!.box;
const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe("clip template checks", () => {
  it("puts a stream hook below the facecam even when the split changes", () => {
    for (const split of [0.2, 0.35, 0.5]) {
      const template = { layout: "stream" as const, facecam: { x: 0, y: 0, w: 0.25, h: 0.35 }, split };
      const plan = planClips(asset, [{ start: 0, end: 10, title: "Watch this" }], template)[0];
      let p = createProject({ width: 1080, height: 1920 });
      p = runCommand(p, "add_text", { text: plan.title, role: "headline", start: 0, duration: 2.5 });
      p = prepareClipText(p, plan);
      const r = placeClipText(p, text(p, plan.title).c.id, "hook", template);
      expect(r.findings).toEqual([]);
      expect(box(r.project, plan.title).top).toBeGreaterThanOrEqual(streamBands(1080, 1920, template).facecam!.h);
    }
  });

  it("omits an impossible hook and returns its finding rather than covering the facecam", () => {
    const template = { layout: "stream" as const, facecam: { x: 0, y: 0, w: 0.25, h: 0.35 }, split: 0.9 };
    const plan = planClips(asset, [{ start: 0, end: 10 }], template)[0];
    let p = runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: plan.title, start: 0, duration: 2.5 });
    p = prepareClipText(p, plan);
    const r = placeClipText(p, text(p, plan.title).c.id, "hook", template);
    expect(r.findings[0].rule).toBe("hook_no_clear_room");
    expect(seenTexts(r.project)).toHaveLength(0);
  });

  it("clears a known subject box in both full-frame shapes, or uses a boxed upper third", () => {
    for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
      const plan = planClips(asset, [{ start: 0, end: 10, title: "A hook" }])[0];
      let p = runCommand(createProject({ width, height }), "add_text", { text: plan.title, start: 0, duration: 2.5 });
      p = prepareClipText(p, plan);
      const subject = { left: width * 0.2, right: width * 0.8, top: height * 0.15, bottom: height * 0.4 };
      const r = placeClipText(p, text(p, plan.title).c.id, "hook", { layout: "vertical_fill" }, [subject]);
      expect(r.findings).toEqual([]);
      expect(overlap(box(r.project, plan.title), subject)).toBe(false);
      const fallback = placeClipText(p, text(p, plan.title).c.id, "hook", { layout: "vertical_fill" }).project;
      const b = box(fallback, plan.title);
      expect((b.top + b.bottom) / 2).toBeCloseTo(height / 3);
      expect(text(fallback, plan.title).c.style.background?.color).toBe("#000000");
    }
  });

  it("maps the subject only inside the clip's framed source region", () => {
    const p = createProject({ width: 1080, height: 1920 }); p.assets = [asset];
    const c = clipForAsset(asset, 0, p.fps) as VideoClip;
    c.transform.scale = 3.2; c.crop = { left: 0.3, right: 0.3, top: 0, bottom: 0 };
    const v = new Float32Array(100);
    for (let y = 2; y < 5; y++) for (let x = 4; x < 6; x++) v[y * 10 + x] = 1;
    v[20] = 10; // a stronger distraction cropped out of this shot
    const subjects = clipSubjects(p, c, { assetId: asset.id, times: [0], maps: [{ w: 10, h: 10, v }] });
    expect(subjects).toHaveLength(1);
    expect(subjects[0].left).toBeGreaterThan(0);
    expect(subjects[0].right).toBeLessThan(p.width);
  });

  it("keeps credit and all end-card text in the 9:16 clear column with measured contrast", () => {
    const template = { credit: { name: "Fixture streamer", handle: "@fixture", platform: "twitch" as const } };
    const plan = planClips(asset, [{ start: 0, end: 10 }], template)[0];
    let p = createProject({ width: 1080, height: 1920 });
    p = runCommand(p, "add_text", { text: "Fixture streamer · @fixture · twitch", start: 0, duration: 3, role: "label", y: 0.12 });
    p = runCommand(p, "add_ad_element", { element: "end_card", start: 10, duration: 2, headline: "Follow Fixture streamer on twitch", cta: "@fixture", url: "", logo: "none" });
    p = prepareClipText(p, plan);
    const credit = seenTexts(p).find(s => s.start === 0)!;
    p = placeClipText(p, credit.c.id, "credit", template).project;
    for (const s of seenTexts(p)) {
      const b = seenLetters(p, s)!.box;
      expect(b.left).toBeGreaterThanOrEqual(0.11 * p.width - 0.5);
      expect(b.right).toBeLessThanOrEqual(0.81 * p.width + 0.5);
      expect(b.top).toBeGreaterThanOrEqual(0.14 * p.height - 0.5);
      expect(b.bottom).toBeLessThanOrEqual(0.65 * p.height + 0.5);
      for (const px of [[1, 1, 1], [0, 0, 0], [0.5, 0.8, 0.2]] as [number, number, number][]) expect(measureLook(titleLook(s.c.style), [px])!.ratio).toBeGreaterThanOrEqual(4.5);
    }
    expect(checkProject(p, "social_short").findings.filter(f => ["text_under_app_buttons", "text_too_short", "text_too_small"].includes(f.rule))).toEqual([]);
  });

  it("keeps two-word chunks when possible and joins rapid or isolated short chunks without losing words", () => {
    const words = ["Welcome", "to", "the", "video", "editor", "today"].map((text, i) => ({ text, start: i * 0.18, end: i * 0.18 + 0.15 }));
    const caps = clipCaptions(words, 4);
    expect(caps.map(c => c.text).join(" ")).toBe(words.map(w => w.text).join(" "));
    expect(caps.every(c => captionReading(c).met)).toBe(true);
    expect(caps.flatMap(c => c.words!)).toEqual(words.map(w => w.start));
    const slow = clipCaptions(words.map((w, i) => ({ ...w, start: i * 0.6, end: i * 0.6 + 0.2 })), 5);
    expect(slow.map(c => c.text.split(" ").length)).toEqual([2, 2, 2]);
    const p = runCommand(createProject(), "add_captions", { captions: caps });
    expect(checkProject(p, "social_short").findings.filter(f => /caption.*fast|reading/.test(f.rule))).toEqual([]);
  });
});
