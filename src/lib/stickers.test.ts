import { describe, expect, it } from "vitest";
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
