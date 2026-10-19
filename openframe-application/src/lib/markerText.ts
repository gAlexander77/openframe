import type { Marker } from "./project/types";
import { formatTimecode, framesToSeconds, type Rational } from "./time";

export type MarkerTextFormat = "notes" | "chapters";

const stamp = (seconds: number) => {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds / 60) % 60, s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/** Export the chosen notes without silently dropping, merging or retiming
 * them. Chapter checks use the timestamps actually written to the text. */
export function markerText(markers: Marker[], fps: Rational, endFrame: number, format: MarkerTextFormat) {
  const sorted = [...markers].sort((a, b) => a.frame - b.frame);
  const seconds = sorted.map((m) => Math.floor(framesToSeconds(m.frame, fps) + 1e-9));
  const text = sorted.map((m, i) => {
    const label = m.label.replace(/\s+/g, " ").trim() || `${format === "chapters" ? "Chapter" : "Marker"} ${i + 1}`;
    return `${format === "chapters" ? stamp(seconds[i]) : formatTimecode(m.frame, fps)} ${label}`;
  }).join("\n");
  const issues: string[] = [];
  if (format === "chapters") {
    const end = framesToSeconds(endFrame, fps);
    if (seconds[0] !== 0) issues.push("Start the first chapter at 00:00.");
    if (sorted.length < 3) issues.push("Use at least three chapter markers.");
    if (new Set(seconds).size !== seconds.length) issues.push("Chapter timestamps must be distinct after rounding down to seconds.");
    if (sorted.some((m) => m.frame >= endFrame)) issues.push("Chapter markers must fall before the end of the timeline.");
    if (seconds.some((s, i) => (seconds[i + 1] ?? end) - s < 10)) issues.push("Leave at least 10 seconds per chapter, including the last.");
  }
  return { text, issues, count: sorted.length };
}
