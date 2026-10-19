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
  const base = t.kind === "audio" ? 46 : t.main ? 70 : t.clips.some((c) => c.type === "video" || c.type === "image") || t.clips.length === 0 ? 56 : 34;
  // Small still fits a clip's label and the header's toggles.
  return t.height === "small" ? Math.min(base, 30) : t.height === "large" ? Math.round(base * 1.7) : base;
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

/** Preserve the first visible frame and span when the lane viewport resizes. */
export function refitTimeline(zoom: number, left: number, oldWidth: number, width: number) {
  if (oldWidth <= 0 || width <= 0) return { zoom, left };
  const next = clampZoom(zoom * width / oldWidth);
  return { zoom: next, left: left * next / zoom };
}
