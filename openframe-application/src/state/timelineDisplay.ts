import { useSyncExternalStore } from "react";
import { normalizeTimelineDisplay, type TimelineDisplay } from "../lib/timelineDisplay";
const key = "video-editor.timeline-display";
let value = normalizeTimelineDisplay(null);
try { value = normalizeTimelineDisplay(JSON.parse(localStorage.getItem(key) ?? "null")); } catch { /* storage unavailable */ }
const listeners = new Set<() => void>();
export const timelineDisplay = () => value;
export function setTimelineDisplay(patch: Partial<TimelineDisplay>) {
  value = normalizeTimelineDisplay({ ...value, ...patch });
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* session preferences still work */ }
  listeners.forEach(f => f());
}
export const useTimelineDisplay = () => useSyncExternalStore(f => { listeners.add(f); return () => { listeners.delete(f); }; }, timelineDisplay);
