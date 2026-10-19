import { expect, it } from "vitest";
import { animatedFrameAt } from "./animatedImage";
it("uses variable durations and repeats exact boundaries", () => {
  const d = [0.1, 0.3, 0.2];
  expect([0, 0.099, 0.1, 0.4, 0.6, 1.3, -0.1].map(t => animatedFrameAt(d, t))).toEqual([0, 0, 1, 2, 0, 1, 2]);
});
it("handles empty timing", () => expect(animatedFrameAt([], 5)).toBe(0));
