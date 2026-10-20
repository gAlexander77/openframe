// Colorize (ADR-105): a picture's brightness drawn in one color, as
// Premiere's Tint maps white to a color and After Effects' Tint does. The
// Claude film test warmed a white glow sprite with temperature 70-80 and
// it stayed neutral: white is already at the top of every channel, so
// white balance (a gain per channel, clamped) cannot make it amber. This
// can: white becomes the color, black stays black, and the amount mixes it
// over the picture. It runs first in the clip's color, so exposure,
// temperature, a filter or a LUT act on the colorized picture; the shader
// (engine/shaders.ts adjustColor) mirrors colorizeRgb.

import { parseColor } from "./shapes";
import type { Colorize } from "./project/types";

type Rgb = [number, number, number];

/** A new colorize: amber, at full strength. */
export const COLORIZE_DEFAULT: Colorize = { color: "#ffb347", amount: 1 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Rec. 709 luma of straight sRGB, as the shaders' luma(). */
export const luma = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** One pixel colorized: its luma times the color, mixed in by amount. */
export function colorizeRgb(rgb: Rgb, tint: Rgb, amount: number): Rgb {
  const l = luma(rgb), k = clamp01(amount);
  return rgb.map((v, i) => v + (l * tint[i] - v) * k) as Rgb;
}

/** The color as straight RGB for the shader, and its alpha, which scales
 * the amount as a border's or a shadow's color alpha scales its opacity
 * (ADR-108); null when it is not a color. */
export function colorizeTint(c: Colorize): { rgb: Rgb; alpha: number } | null {
  const p = parseColor(c.color);
  return p ? { rgb: [p[0], p[1], p[2]], alpha: p[3] } : null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A colorize from untrusted JSON: an unknown color takes the default's,
 * the amount is clamped to 0..1; undefined when it is not one. */
export function cleanColorize(raw: unknown): Colorize | undefined {
  if (!isObj(raw)) return undefined;
  return {
    color: typeof raw.color === "string" && parseColor(raw.color) ? raw.color : COLORIZE_DEFAULT.color,
    amount: typeof raw.amount === "number" && Number.isFinite(raw.amount) ? clamp01(raw.amount) : COLORIZE_DEFAULT.amount,
  };
}
