import { useSyncExternalStore } from "react";
import { readEffectPreset, readPresetLibrary, presetName, type EffectPreset } from "../lib/effectPresets";
import { copyEffectStack } from "../lib/effectStack";
import { uid } from "../lib/project/defaults";
import { store } from "./store";

const KEY = "video-editor.effect-presets.v1";
let presets: EffectPreset[] = [];
/** Stored entries this version cannot read; every write keeps them. */
let unreadable: unknown[] = [];
let loadError = "";
try {
  ({ presets, unreadable } = readPresetLibrary(JSON.parse(localStorage.getItem(KEY) ?? "[]")));
  if (unreadable.length) loadError = `${unreadable.length} saved effect preset${unreadable.length === 1 ? "" : "s"} could not be read and ${unreadable.length === 1 ? "is" : "are"} kept in storage.`;
} catch { loadError = "Saved effect presets could not be read. Existing storage is preserved until you save a new preset."; }
const listeners = new Set<() => void>();
export function useEffectPresets() { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => presets); }
export const presetLoadError = () => loadError;
function write(next: EffectPreset[]) {
  // Persist before changing the visible list; failed writes stay recoverable.
  localStorage.setItem(KEY, JSON.stringify([...next, ...unreadable]));
  presets = next; if (!unreadable.length) loadError = ""; listeners.forEach((l) => l());
}
export function saveEffectPreset(clipId: string, name: string) {
  const clean = presetName(name);
  if (presets.some((p) => p.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("A preset with that name already exists.");
  const preset = readEffectPreset({ id: uid("preset"), name: clean, stack: copyEffectStack(store.get().project, clipId) });
  write([...presets, preset]); return preset.id;
}
export function renameEffectPreset(id: string, name: string) {
  const clean = presetName(name);
  if (presets.some((p) => p.id !== id && p.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error("A preset with that name already exists.");
  write(presets.map((p) => p.id === id ? { ...p, name: clean } : p));
}
export function deleteEffectPreset(id: string) { write(presets.filter((p) => p.id !== id)); }
