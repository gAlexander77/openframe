// Saved text styles (CapCut's Save as preset for text, Premiere's Text
// Styles): a title's whole look under a name, kept in this viewer's
// storage like effect presets, applied to any title in one undo step.
// Not project data: a style saved once is there in every project.

import { useSyncExternalStore } from "react";
import { presetName } from "../lib/effectPresets";
import { DEFAULT_TEXT_STYLE, uid } from "../lib/project/defaults";
import type { Clip, Id, TextClip, TextStyle } from "../lib/project/types";
import { store } from "./store";

export interface SavedTextStyle {
  id: string;
  name: string;
  style: TextStyle;
}

const KEY = "ve.textStyles";
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** What storage holds, read leniently: a broken entry is skipped, and a
 * style missing fields gets the defaults, as old projects' titles do. */
function read(): SavedTextStyle[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return (Array.isArray(raw) ? raw : []).flatMap((e) =>
      isObj(e) && typeof e.id === "string" && typeof e.name === "string" && isObj(e.style) ? [{ id: e.id, name: e.name, style: { ...DEFAULT_TEXT_STYLE, ...(e.style as Partial<TextStyle>) } }] : [],
    );
  } catch {
    return [];
  }
}

let styles = read();
const listeners = new Set<() => void>();
const write = (next: SavedTextStyle[]) => {
  // Persist first: a failed write leaves the visible list as it was.
  localStorage.setItem(KEY, JSON.stringify(next));
  styles = next;
  listeners.forEach((l) => l());
};

export const useTextStyles = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => styles);

/** Save a title's style under a name (unique, ignoring case). */
export function saveTextStyle(style: TextStyle, name: string): string {
  const clean = presetName(name);
  if (styles.some((s) => s.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("A style with that name already exists.");
  const id = uid("style");
  write([...styles, { id, name: clean, style: structuredClone(style) }]);
  return id;
}

export function deleteTextStyle(id: string) {
  write(styles.filter((s) => s.id !== id));
}

/** Give titles a saved style, keeping their words; one undo step. */
export function applyTextStyle(id: string, clipIds: Id[]) {
  const saved = styles.find((s) => s.id === id);
  if (!saved) return;
  store.edit(`Text style ${saved.name}`, (p) => ({
    ...p,
    tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c): Clip => (clipIds.includes(c.id) && c.type === "text" ? ({ ...c, style: structuredClone(saved.style) } as TextClip) : c)) })),
  }));
}
