import { expect, it } from "vitest";
import { canCrop, cropToRatio, dragCrop, MIN_CROP, mirrorCrop, NO_CROP, ratioAspect, ratioCrop, validCrop } from "./crop";
import { clipForAsset, createColorClip, createProject, createTextClip } from "./project/defaults";
import type { Crop } from "./project/types";

const HD = { w: 1920, h: 1080 };
const close = (c: Crop) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, expect.closeTo(v, 5)]));

it("crops the largest centered area of a ratio", () => {
  expect(ratioCrop(1, 1920, 1080)).toEqual({ left: 0.21875, top: 0, right: 0.21875, bottom: 0 });
  expect(ratioCrop(9 / 16, 1920, 1080).left).toBeCloseTo((1 - 0.31640625) / 2, 6);
  expect(ratioCrop(21 / 9, 1920, 1080)).toMatchObject({ left: 0, top: expect.closeTo(5 / 42, 5) });
  // Original is the source's own shape: nothing to trim.
  expect(ratioCrop(ratioAspect("original", 1920, 1080)!, 1920, 1080)).toEqual(NO_CROP);
  expect(ratioAspect("free", 1920, 1080)).toBeNull();
  expect(ratioAspect("4:5", 1920, 1080)).toBe(0.8);
});

it("drags free edges and corners, inside the picture and apart", () => {
  expect(dragCrop(NO_CROP, "w", 0.2, 0, HD, null).left).toBe(0.2);
  expect(dragCrop(NO_CROP, "w", 2, 0, HD, null).left).toBeCloseTo(1 - MIN_CROP);
  expect(dragCrop(NO_CROP, "e", 0.3, 0, HD, null).right).toBe(0); // outward stops at the border
  expect(dragCrop(NO_CROP, "se", -0.1, -0.3, HD, null)).toEqual(close({ left: 0, top: 0, right: 0.1, bottom: 0.3 }));
  expect(dragCrop(NO_CROP, "n", 0.1, 0.25, HD, null)).toEqual({ left: 0, top: 0.25, right: 0, bottom: 0 });
});

it("slides the whole crop without leaving the picture", () => {
  const c = { left: 0.2, top: 0.2, right: 0.2, bottom: 0.2 };
  expect(dragCrop(c, "move", 0.5, -0.1, HD, null)).toEqual(close({ left: 0.4, top: 0.1, right: 0, bottom: 0.3 }));
});

it("keeps a ratio: corners pin the opposite corner, edges grow about the middle", () => {
  const square = ratioCrop(1, 1920, 1080);
  // The corner follows the pointer along the diagonal: (888 + 972) / 2 px.
  const c = dragCrop(square, "se", -0.1, -0.1, HD, 1);
  expect(c).toEqual(close({ left: 0.21875, top: 0, right: 1 - 0.21875 - 930 / 1920, bottom: 1 - 930 / 1080 }));
  expect((1 - c.left - c.right) * 1920).toBeCloseTo((1 - c.top - c.bottom) * 1080, 3);
  // Already full height: an edge cannot grow it further.
  expect(dragCrop(square, "e", 0.5, 0, HD, 1)).toEqual(close(square));
  // The bottom edge sets the height; the width follows about the middle.
  const s = dragCrop({ left: 0.3, top: 0.2, right: 0.3, bottom: 0.2 }, "s", 0, -0.1, HD, 1);
  expect(s).toEqual(close({ left: 0.359375, top: 0.2, right: 0.359375, bottom: 0.3 }));
  // At the border the grown axis slides inside instead of spilling out.
  const e = dragCrop({ left: 0.1, top: 0, right: 0.5, bottom: 0.6 }, "e", 0.3, 0, { w: 1000, h: 1000 }, 1);
  expect(e).toEqual(close({ left: 0.1, top: 0, right: 0.2, bottom: 0.3 }));
});

it("mirrors edges for a flipped picture and checks what is left", () => {
  const c = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 };
  expect(mirrorCrop(c, true, false)).toEqual({ left: 0.3, top: 0.2, right: 0.1, bottom: 0.4 });
  expect(mirrorCrop(mirrorCrop(c, true, true), true, true)).toEqual(c);
  expect(validCrop(c)).toBe(true);
  expect(validCrop({ ...c, left: 0.7 })).toBe(false);
  expect(validCrop({ ...c, top: -0.1 })).toBe(false);
});

it("crops each clip to a ratio of its own source", () => {
  const p = createProject();
  const asset = { id: "a", src: "a.png", name: "a", kind: "image" as const, duration: 0, width: 1000, height: 500, hasAudio: false, hasVideo: true };
  const img = clipForAsset(asset, 0, p.fps);
  p.assets = [asset];
  p.tracks[0].clips = [img];
  const crop = (q: typeof p) => (q.tracks[0].clips[0] as typeof img & { crop: Crop }).crop;
  expect(crop(cropToRatio(p, [img.id], "1:1"))).toEqual({ left: 0.25, top: 0, right: 0.25, bottom: 0 });
  expect(cropToRatio(p, [img.id], "free")).toBe(p);
  expect(cropToRatio(p, [img.id], "original")).toBe(p); // already uncropped: no edit
});

it("opens the crop mode on pictures and boxes on unlocked tracks", () => {
  const p = createProject();
  const asset = { id: "a", src: "a.png", name: "a", kind: "image" as const, duration: 0, width: 1000, height: 500, hasAudio: false, hasVideo: true };
  const img = clipForAsset(asset, 0, p.fps);
  const box = createColorClip("#fff", 200, 30);
  const title = createTextClip("Hi", 300, 30);
  p.assets = [asset];
  p.tracks[0].clips = [img, box, title];
  expect([img, box, title].map((c) => canCrop(p, c.id))).toEqual([true, true, false]);
  p.tracks[0].locked = true;
  expect(canCrop(p, img.id)).toBe(false);
  expect(canCrop(p, "missing")).toBe(false);
});
