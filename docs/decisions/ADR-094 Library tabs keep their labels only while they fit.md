# ADR-094: Library tabs keep their labels only while they fit

**Date:** 2026-10-19. **Status:** accepted.

## Context

The library has eleven tabs, CapCut's icons over labels. The owner asked
for the UI to fit every window size. The sweep found the tab strip taking
three or four rows in a narrow or short library: a third of the panel at
the desktop window's 1100 x 680 minimum, and with the top row at its
shortest, no card showed at all. At 2560 px the eleventh tab sat alone on
a second row.

## Decision

`libraryLayout` (`src/lib/libraryLayout.ts`, tested) lays the tabs out in
balanced rows from the panel's measured size:

- **Labeled** while they fit in one or two rows (11, or 6 + 5) and those
  rows take at most 27% of the panel's height.
- **Icons only** otherwise, in as few rows as fit, each named by its
  tooltip. This is the case at 1100 x 680, and whenever the docked
  assistant narrows the library.
- Below a 300 px panel, the category lists (Effects, Stickers) move from a
  side column to wrapped chips above the cards, which keep two or three
  columns.

Every destination stays one click away at every size.

## Consequences

- A small window gives the cards the room, at the cost of reading the
  tab names from the tooltips.
- A twelfth tab, or a longer label than Adjustment, changes the measured
  constants (`LABELED_TAB`, `ICON_TAB`): remeasure them.
- `scripts/drive/sizes-library.js` checks the strip and every tab at nine
  window sizes, the splitter's limits and the docked assistant.
