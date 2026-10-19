import { expect, it } from "vitest";
import { MIN_MOVE, ScrubGate } from "./scrub";

it("sounds one snippet at a time, then the latest place the playhead reached", () => {
  const g = new ScrubGate();
  expect(g.request(1)).toBe(true);
  expect(g.request(1.1)).toBe(false);
  expect(g.request(1.2)).toBe(false);
  expect(g.request(1.3)).toBe(false);
  expect(g.done()).toBe(1.3);
  expect(g.done()).toBe(null);
  expect(g.request(2)).toBe(true);
});

it("stays quiet for moves too small to hear", () => {
  const g = new ScrubGate();
  expect(g.request(1)).toBe(true);
  expect(g.done()).toBe(null);
  expect(g.request(1 + MIN_MOVE / 2)).toBe(false);
  expect(g.request(1 - MIN_MOVE * 2)).toBe(true);
  g.request(1 - MIN_MOVE * 2 + MIN_MOVE / 4);
  expect(g.done()).toBe(null);
});

it("forgets what waited when the drag ends", () => {
  const g = new ScrubGate();
  g.request(1);
  g.request(3);
  g.reset();
  expect(g.done()).toBe(null);
  expect(g.request(1)).toBe(true);
});
