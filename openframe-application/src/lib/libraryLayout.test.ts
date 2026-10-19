import { describe, expect, it } from "vitest";
import { ICON_TAB, LABELED_TAB, libraryLayout, STRIP_PAD } from "./libraryLayout";

// The library's default size at each window (29% of the width; the top
// row's height), as measured in the web build.
const at = (width: number, height: number) => libraryLayout(11, width, height);

describe("libraryLayout", () => {
  it("puts all eleven labeled tabs on one row when the panel is wide", () => {
    expect(at(742, 792)).toEqual({ columns: 11, labels: true, narrow: false }); // 2560 x 1440
  });

  it("balances two labeled rows (six and five), never one tab alone", () => {
    for (const [w, h] of [[371, 370], [396, 400], [418, 470], [464, 517], [557, 594]]) expect(at(w, h)).toEqual({ columns: 6, labels: true, narrow: false });
  });

  it("shows icons alone where labels would take a third row", () => {
    expect(at(319, 374)).toEqual({ columns: 11, labels: false, narrow: false }); // 1100 x 680
    expect(at(297, 352)).toEqual({ columns: 6, labels: false, narrow: true }); // 1024 x 640
    expect(at(240, 374)).toEqual({ columns: 6, labels: false, narrow: true }); // the splitter's minimum
  });

  it("drops the labels in a short panel rather than give them a quarter of it", () => {
    expect(at(464, 260).labels).toBe(false); // the top row at its 260 px minimum
    expect(at(742, 260)).toEqual({ columns: 11, labels: true, narrow: false }); // one labeled row still fits
  });

  it("never asks for more room than the panel has", () => {
    for (let w = 120; w <= 1200; w += 7)
      for (const h of [200, 300, 500, 900]) {
        const { columns, labels } = at(w, h);
        if (columns > 1) expect(columns * (labels ? LABELED_TAB : ICON_TAB)).toBeLessThanOrEqual(w - STRIP_PAD);
        // Balanced: the last row is never more than one tab short.
        const rows = Math.ceil(11 / columns);
        expect(columns * rows - 11).toBeLessThan(rows);
      }
  });
});
