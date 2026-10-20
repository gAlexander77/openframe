import { expect, it } from "vitest";
import { SHEET_MAX_WIDTH, sheetGrid, tileSize } from "./sheetGrid";

it("wraps a version's moments into rows that stay inside the sheet's width (ADR-115)", () => {
  // The film test: eight moments of a 16:9 version, 391 px frames, in one 3182 px row.
  const { tw } = tileSize(1920, 1080);
  expect(tw).toBe(391);
  expect(sheetGrid(tw, 8)).toEqual({ columns: 4, rows: 2 });
  expect(6 + 4 * (tw + 6)).toBeLessThanOrEqual(SHEET_MAX_WIDTH);
  // Three moments of a tall version stay one row.
  expect(sheetGrid(tileSize(1080, 1920).tw, 3)).toEqual({ columns: 3, rows: 1 });
});

it("takes a tile width, the height following the frame's shape", () => {
  expect(tileSize(1920, 1080, 640)).toEqual({ tw: 640, th: 360 });
  expect(tileSize(1080, 1920, 300)).toEqual({ tw: 300, th: 533 });
  expect(sheetGrid(640, 8)).toEqual({ columns: 2, rows: 4 });
  // Never less than a tile a row.
  expect(sheetGrid(2000, 2)).toEqual({ columns: 1, rows: 2 });
});
