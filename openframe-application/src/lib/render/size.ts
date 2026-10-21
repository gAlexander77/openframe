// The size a visual clip's picture has before its transform, shared by the
// render plan (anchor points) and the on-canvas geometry (lib/align.ts).

import { getAsset } from "../project/ops";
import { shapeExtent } from "../shapes";
import type { Project, TextClip, VisualClip } from "../project/types";

/** A text clip's raster size. The engine registers its rasterizer at load;
 * without one (unit tests) a box from the style stands in. */
let measureText = (c: TextClip, w: number, h: number): { width: number; height: number; layout?: { pad: number; lines?: string[] } } => ({
  width: c.style.maxWidth * w,
  height: ((c.style.size * h) / 1080) * c.style.lineHeight * Math.max(1, c.text.split("\n").length),
});
export function setTextMeasure(fn: typeof measureText) {
  measureText = fn;
}

/** Size of a clip's source in project pixels before transform, and whether
 * it keeps its native size (text, color) or fits the canvas (media). */
export function sourceSize(p: Project, c: VisualClip): { w: number; h: number; native: boolean } {
  // A shape is its box and stroke (ADR-057); a solid and a compound
  // clip's inner timeline are drawn at canvas size.
  if (c.type === "color" && c.shape) return { ...shapeExtent(c.shape, p.width, p.height), native: true };
  if (c.type === "color" || c.type === "compound") return { w: p.width, h: p.height, native: true };
  if (c.type === "text") {
    const r = measureText(c, p.width, p.height);
    return { w: r.width, h: r.height, native: true };
  }
  const a = getAsset(p, c.assetId);
  return { w: a?.width || p.width, h: a?.height || p.height, native: false };
}

/** The picture's size on the canvas at scale 1 (fitted media, native text). */
export function fittedSize(p: Project, c: VisualClip): { w: number; h: number } {
  const s = sourceSize(p, c);
  const fit = s.native ? 1 : Math.min(p.width / s.w, p.height / s.h);
  return { w: s.w * fit, h: s.h * fit };
}

/** The empty margin a text raster has around its letters (room for an
 * outline, shadow or glow to spread), in canvas pixels; 0 without the
 * engine's rasterizer. */
export const textPad = (p: Project, c: TextClip) => measureText(c, p.width, p.height).layout?.pad ?? 0;

/** A text clip's lines as the rasterizer wraps them (cased as shown), or
 * undefined without the engine's rasterizer (unit tests). */
export const textLines = (p: Project, c: TextClip): string[] | undefined => measureText(c, p.width, p.height).layout?.lines;
