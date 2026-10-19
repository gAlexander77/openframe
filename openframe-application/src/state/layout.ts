// The panel layout, per viewer (src/lib/layout.ts): a tiny store so the
// splitters in App and the View menu's presets share it.

import { useSyncExternalStore } from "react";
import { DEFAULT_LAYOUT, LAYOUT_PRESETS, readLayout, type Layout, type LayoutPreset } from "../lib/layout";

const KEY = "layout";
let layout: Layout = (() => {
  try {
    return readLayout(JSON.parse(localStorage.getItem(KEY) ?? "null"), innerWidth, innerHeight);
  } catch {
    return DEFAULT_LAYOUT;
  }
})();
const listeners = new Set<() => void>();

export function setLayout(next: Layout | ((l: Layout) => Layout)) {
  layout = typeof next === "function" ? next(layout) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* private window: the layout lasts this session */
  }
  listeners.forEach((l) => l());
}

export const applyLayoutPreset = (p: LayoutPreset) => setLayout({ ...LAYOUT_PRESETS[p].layout });
export const currentLayout = () => layout;
export const useLayout = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => layout);
