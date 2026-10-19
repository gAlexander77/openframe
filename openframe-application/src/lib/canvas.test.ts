import { expect, it } from "vitest";
import { canvasSize, ratioOf } from "./canvas";

it("keeps the short side and evens the long one", () => {
  expect(canvasSize(16, 9, 1080)).toEqual([1920, 1080]);
  expect(canvasSize(9, 16, 1080)).toEqual([1080, 1920]);
  expect(canvasSize(21, 9, 1080)).toEqual([2520, 1080]);
  expect(canvasSize(4, 5, 1080)).toEqual([1080, 1350]);
  expect(canvasSize(16, 9, 721)[0] % 2).toBe(0);
  expect(ratioOf(1080, 1350)?.label).toBe("4:5");
  expect(ratioOf(1000, 300)).toBeUndefined();
});
