// Remove background's pure parts (ADR-033): the size a matte is stored at,
// the temporal stabilizer that keeps a per-frame model from flickering,
// and which source seconds a clip needs a matte for. The model, decoding
// and encoding live in src/engine/cutout.ts.

import { sourceTimeAt } from "./project/ops";
import type { Cutout, VideoClip } from "./project/types";
import type { Rational } from "./time";

/** Size a matte is stored at: the source's aspect, the long side at most
 * `max` pixels, both sides even (video encoders need even sizes). */
export function matteSize(width: number, height: number, max = 1024): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export interface StabilizeOptions {
  /** Frame-to-frame changes smaller than this (of 255) count as shimmer. */
  hold: number;
  /** 0..1: how much of a shimmer-sized change is held back. */
  strength: number;
}

export const STABILIZE: StabilizeOptions = { hold: 24, strength: 0.6 };

/**
 * One frame of temporal stabilization for a matte sequence (alpha bytes,
 * one per pixel), run in frame order:
 *
 * 1. The per-pixel median of the previous, current and next raw mattes
 *    removes one-frame pops (a hand that vanishes for a frame) with no lag
 *    on steady motion: the median of a monotonic run is its middle value.
 * 2. What is left is low-amplitude shimmer along soft edges. It is eased
 *    toward the last output: a change under `hold` is held back by up to
 *    `strength`, a larger one passes untouched, so a moving edge never
 *    trails a ghost the way a plain running average would.
 *
 * `prev`/`next` are null at the ends of the clip; `last` is the previous
 * call's output (null on the first frame).
 */
export function stabilize(
  prev: Uint8Array | null,
  cur: Uint8Array,
  next: Uint8Array | null,
  last: Uint8Array | null,
  out: Uint8Array = new Uint8Array(cur.length),
  { hold, strength }: StabilizeOptions = STABILIZE,
): Uint8Array {
  const p = prev ?? cur;
  const n = next ?? cur;
  for (let i = 0; i < cur.length; i++) {
    const a = p[i], b = cur[i], c = n[i];
    // median of three
    const m = a > b ? (b > c ? b : a > c ? c : a) : a > c ? a : b > c ? c : b;
    if (!last) {
      out[i] = m;
      continue;
    }
    const d = m - last[i];
    const ad = d < 0 ? -d : d;
    out[i] = ad >= hold ? m : Math.round(last[i] + d * (1 - strength * (1 - ad / hold)));
  }
  return out;
}

/** Source seconds [from, to] a video clip shows, at least one frame long
 * (a freeze frame shows one instant). */
export function clipWindow(clip: VideoClip, fps: Rational, assetFps = 30): [number, number] {
  const a = sourceTimeAt(clip, clip.start, fps);
  const b = sourceTimeAt(clip, clip.start + clip.duration, fps);
  const from = Math.min(a, b);
  return [from, Math.max(a, b, from + 1 / assetFps)];
}

/** Whether a matte covers source seconds [from, to], give or take a frame
 * at 60 fps (a matte starts on the frame covering `from`). */
export const covers = (m: Pick<Cutout, "from" | "to">, from: number, to: number) => m.from <= from + 1 / 60 && m.to >= to - 1 / 60;

/**
 * Whether a model that failed to load failed for want of its weights:
 * the network, as the browser and transformers.js word it ("Failed to
 * fetch", "Could not locate file", "... occurred while trying to load
 * file", "Forbidden access to file"). Another model would have to be
 * downloaded too, so that failure is reported, not retried; anything else
 * (a runtime that cannot start here) falls back to the light model.
 */
export const isDownloadFailure = (message: string, online = true) => !online || /fetch|network|locate file|load file|access to file/i.test(message);
