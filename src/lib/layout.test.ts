import { expect, it } from "vitest";
import { DEFAULT_LAYOUT, readLayout, toPixels } from "./layout";

it("keeps proportions, reads old pixel layouts, and falls back", () => {
  expect(readLayout({ left: 0.3, right: 0.2, top: 0.5 }, 1600, 950)).toEqual({ left: 0.3, right: 0.2, top: 0.5 });
  // Saved before proportions: 480 of a 1600 window is 0.3.
  expect(readLayout({ left: 480, right: 320, top: 475 }, 1600, 950)).toEqual({ left: 0.3, right: 0.2, top: 0.5 });
  expect(readLayout(null, 1600, 950)).toEqual(DEFAULT_LAYOUT);
  expect(readLayout({ left: "x", top: -1 }, 1600, 950)).toEqual(DEFAULT_LAYOUT);
  expect(toPixels({ left: 0.3, right: 0.2, top: 0.5 }, 2000, 1000)).toEqual({ left: 600, right: 400, top: 500 });
});
