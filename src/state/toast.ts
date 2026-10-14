// Small, transient notices ("Added to timeline", "Can't open file.mkv").
// CapCut shows them as dark pills near the top of the window.

import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "progress";
  /** 0..1 for progress toasts. */
  progress?: number;
}

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Toast["kind"] = "info", ms = kind === "error" ? 6000 : 2600): number {
  const id = next++;
  toasts = [...toasts.slice(-3), { id, text, kind }];
  emit();
  if (kind !== "progress") setTimeout(() => dismiss(id), ms);
  return id;
}

export function updateToast(id: number, patch: Partial<Toast>) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
}
