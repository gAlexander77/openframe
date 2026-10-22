import { sourceToTimeline } from "./analysis/musicMap";
import { createMarker } from "./project/defaults";
import type { Project } from "./project/types";
import { secondsToFrames } from "./time";

/** A separate editing command lets both an agent and the results card mark
 * an already reviewed reading without decoding the file again. */
export function highlightMarkers(p: Project, clipId: string, ranges: { start: number; end: number }[]): Project {
  const c = p.tracks.flatMap(t => t.clips).find(c => c.id === clipId);
  if (!c || (c.type !== "audio" && c.type !== "video") || c.freeze) throw new Error("Highlight markers need a video or audio source clip");
  const map = sourceToTimeline(c, p.fps);
  const fresh = ranges.map((range, i) => {
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) throw new Error("Highlight ranges need finite start < end in source seconds");
    if (range.start < map.lo || range.end > map.hi) throw new Error("A highlight range is outside this clip; place the full source on the timeline first");
    const a = secondsToFrames(map.edge(range.start), p.fps), b = secondsToFrames(map.edge(range.end), p.fps);
    const start = Math.min(a, b), end = Math.max(a, b);
    if (end <= start) throw new Error("A highlight range must span at least one timeline frame");
    const at = c.reverse ? range.end : range.start;
    return { ...createMarker(start, `Highlight ${i + 1}`, "#f5c543"), duration: end - start, follows: { clip: clipId, at } };
  });
  const kept = p.markers.filter(m => !(m.follows?.clip === clipId && /^Highlight \d+$/.test(m.label)));
  return { ...p, markers: [...kept, ...fresh].sort((a, b) => a.frame - b.frame) };
}
