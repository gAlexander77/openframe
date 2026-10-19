import { expect, it } from "vitest";
import { moveMotionPoint } from "./motionPoint";
import { createColorClip, createProject, createTrack } from "./project/defaults";

it("moves both coordinates while preserving ease, other keys and the input", () => {
  const p = createProject(), c = createColorClip("red", 30, 90);
  c.keyframes = { "transform.x": [{ f: 0, v: 0 }, { f: 20, v: 0.2, ease: "easeOut" }], opacity: [{ f: 0, v: 0.5 }] };
  p.tracks = [{ ...createTrack("video", "Picture"), clips: [c] }];
  const out = moveMotionPoint(p, c.id, 50, -0.1, 0.3).tracks[0].clips[0];
  expect(out.keyframes).toEqual({ "transform.x": [{ f: 0, v: 0 }, { f: 20, v: -0.1, ease: "easeOut" }], "transform.y": [{ f: 20, v: 0.3 }], opacity: [{ f: 0, v: 0.5 }] });
  expect(c.keyframes["transform.x"][1].v).toBe(0.2);
  expect(() => moveMotionPoint(p, c.id, 51, 0, 0)).toThrow(/no position key/);
  p.tracks[0].locked = true;
  expect(() => moveMotionPoint(p, c.id, 50, 0, 0)).toThrow(/Unlock/);
});
