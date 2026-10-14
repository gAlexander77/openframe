// Timeline geometry that does not need a DOM: snapping, ruler ticks, track
// heights. The timeline component draws what these decide.

import type { Track } from "./project/types";
import { fpsValue, type Rational } from "./time";

export interface SnapResult {
  /** The adjusted position of the dragged reference. */
  frame: number;
  /** The edit point snapped to, for drawing the guide line; null if none. */
  target: number | null;
}

/**
 * Snap a dragged span to the nearest target. `edges` are the dragged
 * span's snappable points relative to its position (0 = start, duration =
 * end); the span moves as a whole so whichever edge lands closest wins.
 * `threshold` is in frames (pixels / zoom at the call site).
 */
export function snapSpan(pos: number, edges: number[], targets: number[], threshold: number): SnapResult {
  let best = { d: threshold + 1, frame: pos, target: null as number | null };
  for (const e of edges) {
    const at = pos + e;
    // targets are sorted; binary search the nearest
    let lo = 0;
    let hi = targets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (targets[mid] < at) lo = mid + 1;
      else hi = mid;
    }
    for (const i of [lo - 1, lo]) {
      const t = targets[i];
      if (t === undefined) continue;
      const d = Math.abs(t - at);
      if (d < best.d) best = { d, frame: pos + (t - at), target: t };
    }
  }
  return best.d <= threshold ? { frame: best.frame, target: best.target } : { frame: pos, target: null };
}

export interface Tick {
  frame: number;
  major: boolean;
  label?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Ruler ticks for frames [from, to) at `zoom` px/frame. Major ticks are at
 * least ~90 px apart and labeled like CapCut's ruler (MM:SS, plus frames
 * when zoomed past one second per major tick). */
export function rulerTicks(from: number, to: number, zoom: number, fps: Rational): Tick[] {
  const rate = fpsValue(fps);
  const nominal = Math.round(rate);
  const steps = [1, 2, 5, 10, 15].filter((s) => s < nominal).concat(
    [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].map((s) => Math.round(s * rate)),
  );
  const major = steps.find((s) => s * zoom >= 90) ?? steps[steps.length - 1];
  const minor = Math.max(1, major / (major % 5 === 0 ? 5 : 2));
  const out: Tick[] = [];
  const start = Math.floor(from / minor) * minor;
  for (let f = start; f < to; f += minor) {
    const frame = Math.round(f);
    if (frame < 0) continue;
    const isMajor = frame % major === 0;
    let label: string | undefined;
    if (isMajor) {
      const secs = Math.floor(frame / rate + 1e-6);
      const ff = Math.round(frame - secs * rate);
      const base = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
      label = major < nominal ? `${base}:${pad(ff)}` : base;
    }
    out.push({ frame, major: isMajor, label });
  }
  return out;
}

/** Lane height in px, following CapCut's sizes: the main track tallest,
 * video tracks with media next, audio, then text/effect-only tracks. */
export function trackHeight(t: Track): number {
  if (t.kind === "audio") return 46;
  if (t.main) return 70;
  const hasMedia = t.clips.some((c) => c.type === "video" || c.type === "image");
  return hasMedia || t.clips.length === 0 ? 56 : 34;
}

/** The cut nearest `frame` on a track (0 or a clip's end), earlier on a
 * tie: where an insert on the magnetic main track lands, since CapCut
 * never splits or overwrites a main clip to make room (§2.8). */
export function nearestCut(t: Track, frame: number): number {
  let best = 0;
  for (const c of t.clips) {
    const end = c.start + c.duration;
    if (Math.abs(end - frame) < Math.abs(best - frame)) best = end;
  }
  return best;
}

/**
 * Where a video or image dropped on track `row` at `frame` lands (CapCut
 * §2.8), so the drop preview shows what the drop will do. Above the top
 * track (row -1), a new overlay track at the drop time — once the main
 * track has something to overlay; on an unlocked video track, that track;
 * anywhere else, the main track, where the magnet inserts at the nearest
 * cut. `row` indexes `tracks`; a result row of -1 means a new top track.
 */
export function visualDrop(tracks: Track[], row: number, frame: number, magnet: boolean): { row: number; frame: number; insert: boolean } {
  const main = tracks.findIndex((t) => t.main);
  if (row < 0 && tracks[main].clips.length) return { row: -1, frame, insert: false };
  const t = tracks[row];
  const at = t && t.kind === "video" && !t.locked ? row : main;
  if (at === main && magnet) return { row: at, frame: nearestCut(tracks[at], frame), insert: true };
  return { row: at, frame, insert: false };
}

/** A zoom that fits `frames` into `width` px, with breathing room at the
 * end, clamped to the zoom range. */
export function fitZoom(frames: number, width: number, fps: Rational): number {
  const span = Math.max(frames, Math.round(fpsValue(fps) * 10));
  return clampZoom((width * 0.92) / span);
}

export const ZOOM_MIN = 0.02;
export const ZOOM_MAX = 60;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
