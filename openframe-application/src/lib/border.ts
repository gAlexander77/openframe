// Borders on pictures (ADR-099): a stroke around the finished picture, as
// a picture-in-picture or a social layout frames its shots. What the plan,
// the loader and the commands need; the compositor finds the picture's
// edge by its alpha (a jump flood) and draws the border outside it.

import { paramAt } from "./keyframes";
import { parseColor } from "./shapes";
import type { Border, VisualClip } from "./project/types";

/** A new border: white, a clean 8 px frame at 1080p. */
export const BORDER_DEFAULT: Border = { color: "#ffffff", width: 8, opacity: 1 };

/** The numbers that keyframe, as border.<name>. */
export const BORDER_PARAMS = ["width", "opacity"] as const;

/** Widths past this (pixels at 1080p) are clamped. */
export const BORDER_WIDTH_MAX = 200;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The clip's border at clip frame `r`, keyframes applied; undefined when
 * it has none, or none that shows (no width, transparent). */
export function resolveBorder(clip: VisualClip, r: number): Border | undefined {
  const b = clip.border;
  if (!b) return undefined;
  const at = (k: (typeof BORDER_PARAMS)[number]) => (clip.keyframes?.[`border.${k}`]?.length ? paramAt(clip, `border.${k}`, r) : b[k]);
  const out = { color: b.color, width: clamp(at("width"), 0, BORDER_WIDTH_MAX), opacity: clamp(at("opacity"), 0, 1) };
  return out.width > 0 && out.opacity > 0 && (parseColor(out.color)?.[3] ?? 0) > 0 ? out : undefined;
}

/** Jump-flood steps that carry the picture's edge `reach` render pixels
 * out: halving from the power of two that covers it, then one more step of
 * 1 (JFA+1, which mends most of the flood's rare misses). */
export function floodSteps(reach: number): number[] {
  const steps: number[] = [];
  for (let k = 2 ** Math.ceil(Math.log2(Math.max(2, reach + 2))) / 2; k >= 1; k /= 2) steps.push(k);
  return [...steps, 1];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A border from untrusted JSON: missing numbers take the defaults, out of
 * range ones are clamped; undefined when it is not one (no border then). */
export function cleanBorder(raw: unknown): Border | undefined {
  if (!isObj(raw)) return undefined;
  return {
    color: typeof raw.color === "string" && parseColor(raw.color) ? raw.color : BORDER_DEFAULT.color,
    width: clamp(fin(raw.width) ? raw.width : BORDER_DEFAULT.width, 0, BORDER_WIDTH_MAX),
    opacity: clamp(fin(raw.opacity) ? raw.opacity : BORDER_DEFAULT.opacity, 0, 1),
  };
}
