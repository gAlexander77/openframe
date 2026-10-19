export interface TimelineDisplay { waveforms: boolean; thumbnails: boolean; names: boolean; height: "small" | "medium" | "large" }
export const DEFAULT_TIMELINE_DISPLAY: TimelineDisplay = { waveforms: true, thumbnails: true, names: true, height: "medium" };
export function normalizeTimelineDisplay(raw: unknown): TimelineDisplay {
  const r = raw && typeof raw === "object" ? raw as Partial<TimelineDisplay> : {};
  return { waveforms: typeof r.waveforms === "boolean" ? r.waveforms : true, thumbnails: typeof r.thumbnails === "boolean" ? r.thumbnails : true, names: typeof r.names === "boolean" ? r.names : true, height: r.height === "small" || r.height === "large" ? r.height : "medium" };
}
