import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ImageClip } from "./project/types";
import {
  addStickerClip,
  findSticker,
  searchStickers,
  STICKER_CATEGORIES,
  STICKER_SCALE,
  stickerAsset,
  STICKERS,
  withAsset,
} from "./stickers";

describe("sticker catalog", () => {
  it("has unique ids, known categories, and either an emoji or artwork", () => {
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length);
    for (const s of STICKERS) {
      expect(STICKER_CATEGORIES).toContain(s.category);
      expect(!!s.emoji !== !!s.art).toBe(true);
    }
    // Enough to feel like a library, in every category.
    expect(STICKERS.length).toBeGreaterThan(120);
    for (const c of STICKER_CATEGORIES) expect(STICKERS.some((s) => s.category === c)).toBe(true);
  });

  it("finds a sticker by id, label or the emoji itself", () => {
    expect(findSticker("fire")?.emoji).toBe("🔥");
    expect(findSticker("Thumbs up")?.id).toBe("thumbs-up");
    expect(findSticker("🔥")?.id).toBe("fire");
    expect(findSticker("SUBSCRIBE")?.art).toBe("pill");
    expect(findSticker("nope")).toBeUndefined();
  });

  it("searches every word across label, tags and category", () => {
    expect(searchStickers("arrow").every((s) => /arrow/i.test(`${s.label} ${s.tags} ${s.id}`))).toBe(true);
    expect(searchStickers("love heart").map((s) => s.id)).toContain("red-heart");
    expect(searchStickers("zzzz")).toEqual([]);
    // A category narrows only an empty query; typing searches everything.
    expect(searchStickers("", "Badges").every((s) => s.category === "Badges")).toBe(true);
    expect(searchStickers("fire", "Badges").map((s) => s.id)).toContain("fire");
  });
});

describe("addStickerClip", () => {
  const def = findSticker("fire")!;
  const asset = stickerAsset(def, { src: "abc-fire.png", size: 900 }, 480, 512, "a_fire");

  it("adds the asset once and places a scaled, animated image clip on top", () => {
    const { project: p, clipId } = addStickerClip(createProject(), asset, { start: 30 });
    expect(p.assets).toEqual([asset]);
    expect(asset).toMatchObject({ kind: "image", sticker: "fire", width: 480, height: 512, name: "Fire sticker.png" });
    const loc = findClip(p, clipId)!;
    const clip = loc.clip as ImageClip;
    expect(loc.track.name).toBe("Sticker");
    expect(loc.track.main).toBeUndefined();
    expect(clip).toMatchObject({ type: "image", assetId: "a_fire", start: 30, duration: 90 });
    expect(clip.transform.scale).toBe(STICKER_SCALE);
    expect(clip.animIn?.type).toBe("pop");
    expect(clip.animLoop).toEqual({ type: "float", duration: 60 });
  });

  it("reuses the asset when the same sticker is added again", () => {
    const first = addStickerClip(createProject(), asset, { start: 0 });
    const again = addStickerClip(first.project, asset, { start: 120, motion: "still", duration: 15 });
    expect(again.project.assets).toHaveLength(1);
    const clip = findClip(again.project, again.clipId)!.clip as ImageClip;
    expect(clip.duration).toBe(15);
    expect(clip.animIn).toBeUndefined();
    expect(clip.animLoop).toBeUndefined();
    // Free at that time, so it shares the first sticker's row.
    expect(again.project.tracks).toHaveLength(2);
  });
});

describe("add_sticker command", () => {
  const def = findSticker("thumbs-up")!;
  const asset = stickerAsset(def, { src: "x-thumbs.png", size: 1 }, 512, 500, "a_thumb");

  it("places the sticker by name, label or emoji once its image is in the project", () => {
    let p = withAsset(createProject(), asset);
    p = runCommand(p, "add_sticker", { name: "👍", start: 2, duration: 1.5, y: 0.3, motion: "pulse" });
    p = runCommand(p, "add_sticker", { name: "Thumbs up", start: 4 });
    const clips = p.tracks.flatMap((t) => t.clips) as ImageClip[];
    expect(clips.map((c) => [c.start, c.duration])).toEqual([[60, 45], [120, 90]]);
    expect(clips[0].transform.y).toBe(0.3);
    expect(clips[0].animLoop?.type).toBe("pulse");
    expect(p.assets).toHaveLength(1);
  });

  it("explains what is missing instead of guessing", () => {
    expect(() => runCommand(createProject(), "add_sticker", { name: "thumbs-up", start: 0 })).toThrow(/no image in this project yet/);
    expect(() => runCommand(createProject(), "add_sticker", { name: "arow", start: 0 })).toThrow(/no sticker named arow/);
    expect(() => runCommand(createProject(), "add_sticker", { name: "fire", start: 0, motion: "spin" })).toThrow(/motion must be one of/);
  });
});
