import { expect, it } from "vitest";
import { alignClips, distributeClips, frameClips, groupBoxes, otherBoxes, scaleClips, snapBox, snapLines, type Box } from "./align";
import { clipForAsset, createColorClip, createProject, createTrack } from "./project/defaults";
import type { Clip, Project } from "./project/types";

const at = (p: Project, id: string) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as Clip & { transform: { x: number; y: number } };
const color = (start = 0, scale = 0.5) => {
  const c = createColorClip("#fff", start, 60);
  c.transform.scale = scale;
  return c;
};

it("aligns one clip against each canvas edge and center", () => {
  const p = createProject(), c = color();
  p.tracks[0].clips = [c];
  // A 960x540 box (a color clip is canvas-sized at scale 1).
  expect(at(alignClips(p, [c.id], "left", 0), c.id).transform.x).toBeCloseTo(-0.25);
  expect(at(alignClips(p, [c.id], "right", 0), c.id).transform.x).toBeCloseTo(0.25);
  expect(at(alignClips(p, [c.id], "top", 0), c.id).transform.y).toBeCloseTo(-0.25);
  expect(at(alignClips(p, [c.id], "bottom", 0), c.id).transform.y).toBeCloseTo(0.25);
  c.transform.x = 0.3; c.transform.y = -0.1;
  expect(at(alignClips(p, [c.id], "center", 0), c.id).transform).toMatchObject({ x: 0, y: -0.1 });
  expect(at(alignClips(p, [c.id], "middle", 0), c.id).transform).toMatchObject({ x: 0.3, y: 0 });
});

it("measures fitted media, rotation and crop as the handles draw them", () => {
  const p = createProject();
  const img = clipForAsset({ id: "a", src: "a.png", name: "a", kind: "image", duration: 0, width: 1000, height: 1000, hasAudio: false, hasVideo: true }, 0, p.fps);
  const turned = color(200);
  turned.transform.rotation = 90; // 960x540 stands up: 540 wide
  const cropped = color(400, 1);
  cropped.crop = { left: 0.5, top: 0, right: 0, bottom: 0 }; // the right half shows
  p.assets = [{ id: "a", src: "a.png", name: "a", kind: "image", duration: 0, width: 1000, height: 1000, hasAudio: false, hasVideo: true }];
  p.tracks[0].clips = [img, turned, cropped];
  // Fits to 1080x1080, so its center lands 540 px in.
  expect(at(alignClips(p, [img.id], "left", 0), img.id).transform.x).toBeCloseTo((540 - 960) / 1920);
  expect(at(alignClips(p, [turned.id], "right", 200), turned.id).transform.x).toBeCloseTo((1920 - 270 - 960) / 1920);
  // The visible half starts at 960 px; flush left moves it 960 px.
  expect(at(alignClips(p, [cropped.id], "left", 400), cropped.id).transform.x).toBeCloseTo(-0.5);
});

it("aligns several clips to their combined bounds and distributes them", () => {
  const p = createProject();
  const [a, b, c] = [color(), color(), color()].map((k, i) => {
    k.transform.scale = 0.1; // 192x108
    k.transform.x = [-0.3, 0.1, 0.3][i];
    k.transform.y = [0, 0.2, -0.2][i];
    return k;
  });
  p.tracks = [{ ...createTrack("video", "Main", true), clips: [a] }, { ...createTrack("video", "B"), clips: [b] }, { ...createTrack("video", "C"), clips: [c] }];
  const left = alignClips(p, [a.id, b.id, c.id], "left", 0);
  expect([a, b, c].map((k) => at(left, k.id).transform.x)).toEqual([-0.3, -0.3, -0.3].map((v) => expect.closeTo(v)));
  const top = alignClips(p, [a.id, b.id, c.id], "top", 0);
  expect([a, b, c].map((k) => at(top, k.id).transform.y)).toEqual([-0.2, -0.2, -0.2].map((v) => expect.closeTo(v)));
  // Equal gaps between the outer two: b moves to the midpoint of a and c.
  const spread = distributeClips(p, [a.id, b.id, c.id], "horizontal", 0);
  expect(at(spread, b.id).transform.x).toBeCloseTo(0);
  expect(at(spread, a.id).transform.x).toBe(-0.3);
  // Two clips have nothing to distribute.
  expect(distributeClips(p, [a.id, b.id], "horizontal", 0)).toBe(p);
});

it("keys an animated position at the frame, and leaves locked clips alone", () => {
  const p = createProject(), c = color();
  c.keyframes = { "transform.x": [{ f: 0, v: 0 }, { f: 59, v: 0.2 }] };
  const locked = color(100);
  p.tracks = [{ ...createTrack("video", "Main", true), clips: [c] }, { ...createTrack("video", "L"), locked: true, clips: [locked] }];
  const next = alignClips(p, [c.id, locked.id], "left", 30);
  expect(at(next, c.id).keyframes?.["transform.x"]).toContainEqual({ f: 30, v: expect.closeTo(-0.25) });
  expect(at(next, locked.id)).toBe(locked);
});

it("snaps the nearest edge or center within tolerance", () => {
  const p = createProject();
  const other: Box = { cx: 500, cy: 500, w: 200, h: 200, hw: 100, hh: 100 };
  const lines = snapLines(p, [other]);
  // Left edge at 604 is 4 px from the other box's right edge (600).
  // Its center at 543 is 3 px below the canvas center; its edges are 7 px off.
  const moving: Box = { cx: 654, cy: 543, w: 100, h: 100, hw: 50, hh: 50 };
  expect(snapBox(moving, lines, 6)).toEqual({ dx: -4, dy: -3, gx: 600, gy: 540 });
  expect(snapBox(moving, lines, 2)).toMatchObject({ dx: 0, dy: 0, gx: undefined, gy: undefined });
});

it("mirrors a crop with a flipped picture, as the compositor draws it", () => {
  const p = createProject(), c = color(0, 1);
  c.crop = { left: 0.5, top: 0, right: 0, bottom: 0 }; // the source's right half
  c.transform.flipX = true; // which a mirror shows on the canvas's left
  p.tracks[0].clips = [c];
  // Flush right moves the visible half 960 px; unflipped it would already be there.
  expect(at(alignClips(p, [c.id], "right", 0), c.id).transform.x).toBeCloseTo(0.5);
  c.transform.flipX = false;
  c.transform.flipY = true;
  c.crop = { left: 0, top: 0.5, right: 0, bottom: 0 };
  expect(at(alignClips(p, [c.id], "bottom", 0), c.id).transform.y).toBeCloseTo(0.5);
});

it("measures a stretched picture by its own vertical scale", () => {
  const p = createProject(), c = color(0, 1);
  c.transform.scaleY = 0.5; // full width, half height
  p.tracks[0].clips = [c];
  expect(at(alignClips(p, [c.id], "top", 0), c.id).transform.y).toBeCloseTo(-0.25);
  expect(at(alignClips(p, [c.id], "left", 0), c.id).transform.x).toBe(0);
});

it("fits, fills and stretches a picture to the canvas, centered", () => {
  const p = createProject();
  const asset = { id: "a", src: "a.png", name: "a", kind: "image" as const, duration: 0, width: 1000, height: 1000, hasAudio: false, hasVideo: true };
  const img = clipForAsset(asset, 0, p.fps) as Clip & { transform: { x: number; y: number; scale: number; scaleY?: number } };
  img.transform.scale = 0.3; img.transform.x = 0.2;
  p.assets = [asset];
  p.tracks[0].clips = [img];
  const get = (q: Project) => at(q, img.id) as typeof img;
  // Fitted to 1080x1080: fit is scale 1, fill widens to 1920 (16/9).
  expect(get(frameClips(p, [img.id], "fit", 0)).transform).toMatchObject({ scale: 1, x: 0, y: 0 });
  expect(get(frameClips(p, [img.id], "fill", 0)).transform.scale).toBeCloseTo(16 / 9, 5);
  const s = get(frameClips(p, [img.id], "stretch", 0)).transform;
  expect(s.scale).toBeCloseTo(16 / 9, 5);
  expect(s.scaleY).toBe(1);
  expect(get(frameClips(frameClips(p, [img.id], "stretch", 0), [img.id], "fit", 0)).transform.scaleY).toBeUndefined();
});

it("boxes a multi-selection's showing pictures and scales them about its center", () => {
  const p = createProject();
  const [a, b, later, hidden] = [color(0, 0.1), color(0, 0.1), color(100, 0.1), color(0, 0.1)];
  a.transform.x = -0.3;
  b.transform.x = 0.1;
  b.transform.y = 0.2;
  p.tracks = [
    { ...createTrack("video", "Main", true), clips: [a, later] },
    { ...createTrack("video", "B"), clips: [b] },
    { ...createTrack("video", "H"), hidden: true, clips: [hidden] },
  ];
  const ids = [a.id, b.id, later.id, hidden.id];
  // 192x108 boxes centered at (384, 540) and (1152, 756); the others are not showing.
  const g = groupBoxes(p, ids, 10)!;
  expect(g.items.map((i) => i.clip.id)).toEqual([a.id, b.id]);
  expect(g.box).toMatchObject({ cx: 768, cy: 648, hw: 480, hh: 162 });
  const q = scaleClips(p, ids, 2, 10);
  expect(at(q, a.id).transform).toMatchObject({ x: -0.5, y: expect.closeTo(-0.1), scale: 0.2 });
  expect(at(q, b.id).transform).toMatchObject({ x: 0.3, y: expect.closeTo(0.3), scale: 0.2 });
  expect(groupBoxes(q, ids, 10)!.box).toMatchObject({ cx: expect.closeTo(768), cy: expect.closeTo(648), hw: expect.closeTo(960), hh: expect.closeTo(324) });
  expect(at(q, later.id)).toBe(later);
  // Never below 1%.
  expect(at(scaleClips(p, ids, 0.001, 10), a.id).transform).toMatchObject({ scale: 0.01 });
  expect(groupBoxes(p, [later.id], 10)).toBeNull();
});

it("lists the other showing pictures' boxes for snapping", () => {
  const p = createProject();
  const [a, b] = [color(0, 0.1), color(0, 0.2)];
  p.tracks = [{ ...createTrack("video", "Main", true), clips: [a] }, { ...createTrack("video", "B"), clips: [b] }];
  expect(otherBoxes(p, 10, [a.id]).map((x) => x.w)).toEqual([384]);
  expect(otherBoxes(p, 10, [a.id, b.id])).toEqual([]);
});
