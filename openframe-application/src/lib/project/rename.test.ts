import { expect, it } from "vitest";
import { runCommand } from "../commands";
import { clipForAsset, createColorClip, createProject, createTrack } from "./defaults";
import { findClip } from "./ops";
import { changesName, cleanName, NAME_MAX, renameClips, renameMedia } from "./rename";
import type { Asset } from "./types";

const setup = () => {
  const p = createProject();
  const asset: Asset = { id: "a1", src: "beach.mp4", name: "beach.mp4", kind: "video", duration: 10, width: 640, height: 360, fps: 30, hasAudio: true, hasVideo: true };
  p.assets = [asset];
  const v = clipForAsset(asset, 0, p.fps);
  const c = createColorClip("#fff", 0, 30);
  p.tracks = [{ ...createTrack("video", "V", true), clips: [v] }, { ...createTrack("video", "W"), clips: [c] }];
  return { p, v, c };
};

it("cleans typed names: one space between words, too long refused", () => {
  expect(cleanName("  Opening \n shot  ")).toBe("Opening shot");
  expect(cleanName("   ")).toBe("");
  expect(cleanName("x".repeat(NAME_MAX))).toHaveLength(NAME_MAX);
  expect(() => cleanName("x".repeat(NAME_MAX + 1))).toThrow("at most");
  expect(changesName("beach.mp4", " beach.mp4 ")).toBe(false);
  expect(changesName("beach.mp4", "Beach")).toBe(true);
  expect(changesName("beach.mp4", "")).toBe(true);
});

it("names clips, and an empty name gives the media's name back", () => {
  const { p, v, c } = setup();
  const named = renameClips(p, [v.id, c.id], " Hero shot ");
  expect(findClip(named, v.id)!.clip.name).toBe("Hero shot");
  expect(findClip(named, c.id)!.clip.name).toBe("Hero shot");
  const cleared = renameClips(named, [v.id], "");
  expect("name" in findClip(cleared, v.id)!.clip).toBe(false);
  expect(findClip(cleared, c.id)!.clip.name).toBe("Hero shot");
  expect(() => renameClips(p, ["nope"], "x")).toThrow("No clip");
});

it("refuses clips on a locked track", () => {
  const { p, v } = setup();
  p.tracks[0] = { ...p.tracks[0], locked: true };
  expect(() => renameClips(p, [v.id], "x")).toThrow("locked");
});

it("renames media in the project only, and media always keeps a name", () => {
  const { p } = setup();
  const q = renameMedia(p, "a1", "Beach at dawn");
  expect(q.assets[0]).toMatchObject({ name: "Beach at dawn", src: "beach.mp4" });
  expect(renameMedia(q, "a1", "Beach at dawn")).toBe(q);
  expect(() => renameMedia(p, "a1", "  ")).toThrow("needs a name");
  expect(() => renameMedia(p, "zz", "x")).toThrow("No media");
});

it("serves agents as rename_clip and rename_media", () => {
  const { p, v } = setup();
  const q = runCommand(p, "rename_clip", { clip_ids: [v.id], name: "Intro" });
  expect(findClip(q, v.id)!.clip.name).toBe("Intro");
  const r = runCommand(q, "rename_media", { asset_id: "a1", name: "Dawn" });
  expect(r.assets[0].name).toBe("Dawn");
  expect(() => runCommand(p, "rename_media", { asset_id: "a1", name: "" })).toThrow("needs a name");
});
