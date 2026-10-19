import { expect, it } from "vitest";
import { groupPoint, transformGroup } from "./groupTransform";
import { createColorClip, createProject, createTrack } from "./project/defaults";
import { boxesAt } from "./align";
import { paramAt } from "./keyframes";

it("rotates in pixels on portrait and landscape, then translates", () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    const result = groupPoint({ x: 300, y: 100 }, { x: 100, y: 100 }, w, h, { rotation: 90, scale: 2, x: 0.1, y: -0.1 });
    expect(result.x).toBeCloseTo(100 + w * 0.1); expect(result.y).toBeCloseTo(500 - h * 0.1);
  }
});
function fixture() {
  const p = createProject();
  const a = createColorClip("red", 0, 90), b = createColorClip("blue", 15, 90);
  a.transform.x = -0.2; b.transform.x = 0.2; a.transform.scale = b.transform.scale = 0.2;
  p.tracks = [a, b].map(c => ({ ...createTrack("video", "Picture"), clips: [c] }));
  return { p, a, b, ids: [a.id, b.id] };
}
it("keeps rotated cropped anchored members in their relative layout", () => {
  const { p, a, b, ids } = fixture();
  a.crop.left = 0.3; a.transform.anchorX = 0.2; a.transform.rotation = 20; b.transform.scaleY = 0.3;
  const before = boxesAt(p, ids, 30);
  const after = boxesAt(transformGroup(p, ids, { rotation: 90, scale: 1.5 }, 30), ids, 30);
  const dx = before[1].box.cx - before[0].box.cx, dy = before[1].box.cy - before[0].box.cy;
  expect(after[1].box.cx - after[0].box.cx).toBeCloseTo(-dy * 1.5);
  expect(after[1].box.cy - after[0].box.cy).toBeCloseTo(dx * 1.5);
  expect(after[1].box.w).toBeCloseTo(before[1].box.w * 1.5);
});
it("keys every path using each member's relative frame and preserves other keys", () => {
  const { p, a, b, ids } = fixture();
  a.keyframes = { "transform.x": [{ f: 0, v: -0.2 }, { f: 60, v: 0.2 }] };
  const q = transformGroup(p, ids, { x: 0.1 }, 30, true);
  const clips = q.tracks.flatMap(t => t.clips);
  expect(clips[0].keyframes?.["transform.x"]).toHaveLength(3);
  expect(clips[0].keyframes?.["transform.x"]?.[1].f).toBe(30);
  expect(clips[0].keyframes?.["transform.x"]?.[1].v).toBeCloseTo(0.1);
  expect(clips[1].keyframes?.["transform.rotation"]?.[0].f).toBe(15);
  expect(paramAt(clips[1], "transform.x", 15)).toBeCloseTo(b.transform.x + 0.1);
  expect(a.keyframes["transform.x"]).toHaveLength(2);
});
it("rejects missing members and locked tracks without changing the input", () => {
  const { p, ids } = fixture(); p.tracks[0].locked = true;
  expect(() => transformGroup(p, ids, { scale: 2 })).toThrow(/Unlock/);
  expect(() => transformGroup(p, ["missing"], {})).toThrow(/Unknown/);
});
