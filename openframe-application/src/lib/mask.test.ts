import { expect, it } from "vitest";
import { dragMask, handleAt, maskFrame, maskHandles, maskOutline, newMask, toMask } from "./mask";
import type { Mask } from "./project/types";

const rect: Mask = { shape: "rectangle", x: 0.1, y: -0.2, width: 0.5, height: 0.4, rotation: 0, feather: 0.1, invert: false };
const LW = 1920, LH = 1080;

it("places a mask in layer pixels and reads points in its own frame", () => {
  const f = maskFrame({ ...rect, rotation: 90 }, LW, LH);
  expect(f).toMatchObject({ cx: 192, cy: -216, hw: 480, hh: 216 });
  // A quarter turn clockwise: the mask's own +x points down the layer.
  const p = toMask(f, 192, -216 + 100);
  expect(p.x).toBeCloseTo(100);
  expect(p.y).toBeCloseTo(0);
});

it("starts hearts and stars square on the layer", () => {
  const h = newMask("heart", LW / LH);
  expect(h.width * LW).toBeCloseTo(h.height * LH);
  expect(newMask("circle", LW / LH)).toMatchObject({ width: 0.6, height: 0.6 });
});

it("moves, sizes, turns, feathers and rounds by its handles", () => {
  const grab = { x: 192, y: -216 };
  expect(dragMask(rect, "move", grab, { x: 192 + 96, y: -216 + 54 }, LW, LH)).toMatchObject({ x: 0.15, y: -0.15 });
  // An edge sets the half-size about the center.
  expect(dragMask(rect, "e", grab, { x: 192 + 384, y: 0 }, LW, LH).width).toBe(0.4);
  expect(dragMask(rect, "n", grab, { x: 0, y: -216 - 270 }, LW, LH).height).toBe(0.5);
  // Rotation: the pointer's turn around the center, catching 90 within 3 degrees.
  const right = { x: 192 + 100, y: -216 }, down = { x: 192 + 2, y: -216 + 100 };
  expect(dragMask(rect, "rotate", right, down, LW, LH).rotation).toBe(90);
  expect(dragMask(rect, "rotate", right, down, LW, LH, true).rotation).toBeCloseTo(88.85, 1);
  // Feather follows the arrow below the shape: half its travel is 0.5.
  const at = handleAt(rect, maskFrame(rect, LW, LH), "feather", LH);
  expect(at.y).toBeCloseTo(216 + 1080 * 0.06 + 0.1 * 540);
  expect(dragMask(rect, "feather", grab, { x: 192, y: -216 + 216 + 64.8 + 270 }, LW, LH).feather).toBe(0.5);
  // Corners round toward the center: 108 px in is half the shorter half-size.
  expect(dragMask(rect, "radius", grab, { x: 192 - 480 + 108, y: -216 - 216 + 108 }, LW, LH).radius).toBe(0.5);
});

it("gives each shape its handles and outline", () => {
  expect(maskHandles("linear")).toEqual(["move", "rotate", "feather"]);
  expect(maskHandles("rectangle")).toContain("radius");
  expect(maskHandles("star")).not.toContain("radius");
  const f = maskFrame(rect, LW, LH);
  expect(maskOutline(rect, f, 1, 2000)).toBe("M -480 -216 H 480 A 0 0 0 0 1 480 -216 V 216 A 0 0 0 0 1 480 216 H -480 A 0 0 0 0 1 -480 216 V -216 A 0 0 0 0 1 -480 -216 Z");
  // The star's top point reaches the top of its box; the heart's tip the bottom.
  expect(maskOutline({ ...rect, shape: "star" }, f, 1, 0)).toMatch(/^M 0 -216 L /);
  expect(maskOutline({ ...rect, shape: "heart" }, f, 1, 0)).toMatch(/^M 0 216 L /);
  expect(maskOutline({ ...rect, shape: "linear" }, f, 0.5, 2000)).toBe("M -1000 0 H 1000");
});
