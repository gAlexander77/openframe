// Small, transient notices ("Added to timeline", "Can't open file.mkv").
// Dark pills near the bottom of the window; an AI agent's at the top.

import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "progress";
  /** 0..1 for progress toasts. */
  progress?: number;
  /** A button on the toast (Undo); pressing it dismisses the toast. */
  action?: { label: string; run: () => void };
  /** Raised by an AI agent (over MCP, or the docked assistant): shown at
   * the top of the window with the Bot icon, so the user knows who acted. */
  agent?: boolean;
}

let toasts: Toast[] = [];
let next = 1;
let agentCalls = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Toast["kind"] = "info", ms = kind === "error" ? 6000 : 2600, action?: Toast["action"]): number {
  const id = next++;
  toasts = [...toasts.slice(-3), { id, text, kind, ...(agentCalls ? { agent: true } : {}), ...(action ? { action } : {}) }];
  emit();
  if (kind !== "progress") setTimeout(() => dismiss(id), ms);
  return id;
}

/** Run an AI agent's request: the toasts it raises (progress, errors) are
 * the agent's. ponytail: a toast of the user's own raised during an agent's
 * long call (an export) is marked too; AsyncContext would tell them apart. */
export async function asAgent<T>(work: () => Promise<T>): Promise<T> {
  agentCalls++;
  try {
    return await work();
  } finally {
    agentCalls--;
  }
}

let notice = 0;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** What an AI agent just changed: one notice, retitled by each edit, gone
 * after a quiet spell (an agent's run of edits is not a stack of toasts). */
export function agentNotice(text: string) {
  if (toasts.some((t) => t.id === notice)) updateToast(notice, { text });
  else {
    notice = next++;
    toasts = [...toasts.slice(-3), { id: notice, text, kind: "info", agent: true }];
    emit();
  }
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => dismiss(notice), 3000);
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
