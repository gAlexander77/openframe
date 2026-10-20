// How a contact sheet's tiles wrap (export_versions check). A version's
// moments ran in one row: eight moments of a 16:9 version made a strip
// 3182 px wide that the client showed 2000 px wide, each frame 250 px,
// too small to judge framing by (ADR-115). Pure.

/** The widest a sheet is drawn: a client shows it at its own size. */
export const SHEET_MAX_WIDTH = 1600;
/** Frames are this tall unless a tile width is asked for. */
export const SHEET_TILE_HEIGHT = 220;

/** A frame's size on the sheet for a canvas of `w` x `h`: `tileWidth`
 * wide when asked, else SHEET_TILE_HEIGHT tall. */
export function tileSize(w: number, h: number, tileWidth?: number): { tw: number; th: number } {
  if (tileWidth) return { tw: Math.round(tileWidth), th: Math.round((tileWidth * h) / w) };
  return { tw: Math.round((SHEET_TILE_HEIGHT * w) / h), th: SHEET_TILE_HEIGHT };
}

/** Tiles a row and rows for `count` tiles `tw` wide, `gap` apart, so a
 * row stays inside `max` pixels (one tile a row at least). */
export function sheetGrid(tw: number, count: number, gap = 6, max = SHEET_MAX_WIDTH): { columns: number; rows: number } {
  const columns = Math.max(1, Math.min(count, Math.floor((max - gap) / (tw + gap))));
  return { columns, rows: Math.ceil(count / columns) };
}
