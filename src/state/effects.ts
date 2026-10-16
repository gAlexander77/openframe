// The effect clipboard is session-only and independent of clips/keyframes.
import { useSyncExternalStore } from "react";
import { copyEffectStack, pasteEffectStack, type EffectClipboard } from "../lib/effectStack";
import type { Id } from "../lib/project/types";
import { store } from "./store";
import { toast } from "./toast";

let copied: EffectClipboard | null = null;
const listeners = new Set<() => void>();
export function useCopiedEffects() {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => copied,
  );
}

export function copyEffects(id: Id) {
  copied = copyEffectStack(store.get().project, id);
  listeners.forEach(l => l());
  toast(`${copied.effects.length} effect${copied.effects.length === 1 ? "" : "s"} copied`);
}

export function pasteEffects(ids: Id[]) {
  if (!copied || !ids.length) return;
  const snapshot = copied;
  store.edit("Paste effects", p => pasteEffectStack(p, ids, snapshot));
}
