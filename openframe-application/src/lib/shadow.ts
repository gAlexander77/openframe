// Drop shadows on pictures (ADR-070): what the plan, the loader and the
// commands need. The compositor casts the shadow from the finished layer's
// alpha, blurred on the same pyramid as the blur effect (lib/blur.ts).

import { paramAt } from "./keyframes";
import { parseColor } from "./shapes";
import type { DropShadow, VisualClip } from "./project/types";

/** A new shadow: soft, dark, a little below, as a floating window's. */
export const SHADOW_DEFAULT: DropShadow = { color: "#000000", blur: 60, x: 0, y: 24, opacity: 0.5 };

/** The numbers that keyframe, as shadow.<name>. */
export const SHADOW_PARAMS = ["blur", "x", "y", "opacity"] as const;

/** Softness and offsets past these are clamped (pixels at 1080p). */
export const SHADOW_BLUR_MAX = 600;
export const SHADOW_OFFSET_MAX = 2000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The clip's shadow at clip frame `r`, keyframes applied; undefined when
 * it has none or it is fully transparent. */
export function resolveShadow(clip: VisualClip, r: number): DropShadow | undefined {
  const s = clip.shadow;
  if (!s) return undefined;
  const at = (k: (typeof SHADOW_PARAMS)[number]) => (clip.keyframes?.[`shadow.${k}`]?.length ? paramAt(clip, `shadow.${k}`, r) : s[k]);
  const out = {
    color: s.color,
    blur: clamp(at("blur"), 0, SHADOW_BLUR_MAX),
    x: clamp(at("x"), -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX),
    y: clamp(at("y"), -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX),
    opacity: clamp(at("opacity"), 0, 1),
  };
  return out.opacity > 0 && (parseColor(out.color)?.[3] ?? 0) > 0 ? out : undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A shadow from untrusted JSON: missing numbers take the defaults, out of
 * range ones are clamped; undefined when it is not one (no shadow then). */
export function cleanShadow(raw: unknown): DropShadow | undefined {
  if (!isObj(raw)) return undefined;
  const color = typeof raw.color === "string" && parseColor(raw.color) ? raw.color : SHADOW_DEFAULT.color;
  const num = (k: keyof typeof SHADOW_DEFAULT, lo: number, hi: number) => clamp(fin(raw[k]) ? (raw[k] as number) : (SHADOW_DEFAULT[k] as number), lo, hi);
  return {
    color,
    blur: num("blur", 0, SHADOW_BLUR_MAX),
    x: num("x", -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX),
    y: num("y", -SHADOW_OFFSET_MAX, SHADOW_OFFSET_MAX),
    opacity: num("opacity", 0, 1),
  };
}
