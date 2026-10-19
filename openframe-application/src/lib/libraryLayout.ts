// The library panel at its size (the splitter, the window, the docked
// assistant all change it). CapCut's tabs are icons over labels; in a
// narrow or short panel those took three or four rows, a third of the
// panel at the desktop window's 1100 x 680 minimum, and at 2560 px the
// eleventh tab sat alone on a second row. Tabs now lay out in balanced
// rows: labeled while they fit in two rows and a modest share of the
// panel's height, else icons alone (named by tooltips) in as few rows as
// fit. Every destination stays visible either way.

/** The widest label (Adjustment, 56 px in Segoe UI at 11 px) and its padding. */
export const LABELED_TAB = 60;
/** A labeled tab's height: icon, label and padding. */
export const LABELED_ROW = 48;
/** An icon-only tab: the 18 px icon and its padding. */
export const ICON_TAB = 28;
/** The strip's own side padding, both sides. */
export const STRIP_PAD = 8;
/** Labeled rows may take this share of the panel's height. */
export const LABEL_SHARE = 0.27;
/** Below this panel width a category list (Effects, Stickers) moves from a
 * side column to wrapped chips above the cards, which then keep two
 * columns instead of one. */
export const NARROW = 300;

export interface LibraryLayout {
  /** Tabs per row. */
  columns: number;
  /** Labels under the icons, or icons alone. */
  labels: boolean;
  /** Category lists above the content rather than beside it. */
  narrow: boolean;
}

export function libraryLayout(count: number, width: number, height: number): LibraryLayout {
  const room = width - STRIP_PAD;
  const narrow = width < NARROW;
  for (let rows = 1; rows <= 2; rows++) {
    const columns = Math.ceil(count / rows);
    if (columns * LABELED_TAB <= room && rows * LABELED_ROW <= height * LABEL_SHARE) return { columns, labels: true, narrow };
  }
  for (let rows = 1; rows <= count; rows++) {
    const columns = Math.ceil(count / rows);
    if (columns * ICON_TAB <= room) return { columns, labels: false, narrow };
  }
  return { columns: 1, labels: false, narrow };
}
