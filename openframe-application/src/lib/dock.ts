// The AI assistant docks as a full-height column at the editor's right
// (ADR-064), the way a side panel docks in Premiere or a chat panel in a
// code editor: the editor gives up the room instead of being covered. With
// it open, the editor lays out as if the window were narrower by the
// column, and when even that leaves too little, the library steps aside
// (as Scopes take its place) rather than squeezing the player or the
// inspector below the widths their controls need.

import type { Layout } from "./layout";

/** The narrowest each part still works at, measured on 2026-10-18 (the
 * dock drive checks them): the player's transport needs 454 px once its
 * timecodes hide (play controls 136, zoom/ratio/quality/frame/full-screen
 * 298, padding 20); the inspector is proven at 248 px, its width in the
 * 1100 px minimum window (the style sweep); the library's splitter stops at
 * 240 px; and the timeline toolbar fits in 748 px once its zoom slider
 * hides (timeline.css), so the editor keeps 760 px with the panel padding. */
export const DOCK = {
  gap: 6,
  /** The workspace's padding, both sides. */
  pad: 12,
  library: 240,
  player: 456,
  inspector: 248,
  /** The editor's narrowest: the timeline toolbar plus padding. */
  editor: 760,
  assistantMin: 300,
  assistantMax: 560,
  /** Default width, of the window: 300 px up to 1360, 422 at 1920. */
  assistantShare: 0.22,
};

export interface DockColumns {
  /** The assistant column, px. */
  assistant: number;
  /** The library column, px; 0 when the window has no room for it. */
  left: number;
  /** The inspector column, px. */
  right: number;
  /** How wide the editor is beside the column: the width the side panels'
   * shares and splitter drags are measured against. */
  editor: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The widest the column may be in this window: the editor keeps its
 * minimum (never less than the column's own minimum). */
export const assistantMax = (width: number) => Math.max(DOCK.assistantMin, Math.min(DOCK.assistantMax, width - DOCK.gap - DOCK.editor));

/** A column width in pixels, kept to what this window allows, as a share
 * of the window (what is saved, so it scales with the window). */
export const assistantShare = (px: number, width: number) => clamp(px, DOCK.assistantMin, assistantMax(width)) / width;

/** The editor's columns with the assistant open. `share` is the column's
 * saved width, of the window. */
export function dockColumns(shares: Layout, width: number, share = DOCK.assistantShare): DockColumns {
  const { gap, pad } = DOCK;
  // ponytail: below about 1066 px (a narrow browser tab; the desktop
  // window stops at 1100) the column keeps its minimum and the editor
  // squeezes, as it already does there without the panel.
  const assistant = Math.round(clamp(share * width, DOCK.assistantMin, assistantMax(width)));
  const editor = width - assistant - gap;
  const row = editor - pad;
  const right = Math.max(DOCK.inspector, Math.min(Math.round(shares.right * editor), row - gap - DOCK.player));
  // What the library can have once the player has its minimum.
  const room = row - 2 * gap - right - DOCK.player;
  const left = room >= DOCK.library ? clamp(Math.round(shares.left * editor), DOCK.library, room) : 0;
  return { assistant, left, right, editor };
}
