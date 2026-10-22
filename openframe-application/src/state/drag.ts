// In-app drag and drop on pointer events. HTML5 drag and drop is off the
// table on desktop: Tauri's OS file drop (dragDropEnabled) swallows it on
// Windows (TermHQ learned this; ADR in research notes). Pointer events also
// let the ghost and the drop preview animate however we like.

import { useSyncExternalStore } from "react";
import type { Asset } from "../lib/project/types";

export type DragPayload =
  | { kind: "asset"; asset: Asset }
  | { kind: "text"; preset: string; label: string }
  | { kind: "sticker"; id: string; label: string }
  | { kind: "template"; id: string; label: string }
  | { kind: "effect"; type: string; label: string }
  | { kind: "transition"; type: string; label: string }
  | { kind: "filter"; type: string; label: string }
  | { kind: "adjustment"; label: string }
  | { kind: "color"; label: string }
  | { kind: "callout"; label: string }
  | { kind: "sfx"; id: string; label: string }
  | { kind: "ambience"; id: string; label: string };

export interface DragState {
  payload: DragPayload;
  x: number;
  y: number;
}

/** A drop zone: given client coordinates, preview (hover) or accept (drop).
 * Returns true when the point is inside the zone. */
export interface DropZone {
  hover(d: DragState | null): void;
  drop(d: DragState): boolean;
  contains(x: number, y: number): boolean;
}

let state: DragState | null = null;
const zones = new Set<DropZone>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function registerDropZone(z: DropZone) {
  zones.add(z);
  return () => {
    zones.delete(z);
  };
}

/** Begin a drag once the pointer has moved a few pixels (a click stays a
 * click). Call from a pointerdown handler. */
export function beginDrag(e: React.PointerEvent, payload: DragPayload) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  let started = false;
  const move = (ev: PointerEvent) => {
    if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    started = true;
    state = { payload, x: ev.clientX, y: ev.clientY };
    for (const z of zones) z.hover(z.contains(ev.clientX, ev.clientY) ? state : null);
    emit();
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("keydown", esc);
    if (started && state) {
      const d = { ...state, x: ev.clientX, y: ev.clientY };
      for (const z of zones) {
        z.hover(null);
        if (z.contains(d.x, d.y)) z.drop(d);
      }
    }
    state = null;
    emit();
  };
  const esc = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    for (const z of zones) z.hover(null);
    started = false;
    state = null;
    emit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("keydown", esc);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useDrag(): DragState | null {
  return useSyncExternalStore(subscribe, () => state);
}

/** Whether a library drag is under way; re-renders only when it starts and
 * ends, not on every pointer move. */
export function useDragging(): boolean {
  return useSyncExternalStore(subscribe, () => state !== null);
}
