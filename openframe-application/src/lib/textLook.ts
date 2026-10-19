// The geometry of a title's look that the text rasterizer (engine/text.ts)
// draws: how far its outlines, shadow and glow reach past the letters, and
// where a gradient fill runs. Pure, so the numbers are tested without a
// canvas.

import type { TextStyle } from "./project/types";

/** Pixels the drawn look reaches past the glyphs on every side, at `k`
 * canvas pixels per 1080p pixel: outlines, the shadow or glow (whichever
 * is larger), and the background box's padding. */
export function lookReach(s: TextStyle, k: number): { stroke: number; stroke2: number; shadow: number; glow: number; box: number; total: number } {
  const stroke = s.stroke && s.stroke.width > 0 ? s.stroke.width * k : 0;
  const stroke2 = s.stroke2 && s.stroke2.width > 0 ? s.stroke2.width * k : 0;
  const shadow = s.shadow ? s.shadow.blur * k + Math.max(Math.abs(s.shadow.x), Math.abs(s.shadow.y)) * k : 0;
  // A canvas shadow's blur reaches about its radius past the shape; a
  // stronger glow (drawn several times) brightens, it does not widen.
  const glow = s.glow && s.glow.blur > 0 ? s.glow.blur * k : 0;
  const box = s.background ? s.background.padding * k : 0;
  return { stroke, stroke2, shadow, glow, box, total: stroke + stroke2 + Math.max(shadow, glow) + box };
}

/** The line a gradient fill runs along, for a text block `w` x `h`
 * centered at (cx, cy): through the center at `angle` degrees (0 left to
 * right, 90 top to bottom), as long as the block is across that way, so
 * the first color touches one edge and the second the opposite one. */
export function gradientLine(cx: number, cy: number, w: number, h: number, angle: number): [number, number, number, number] {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half];
}

/** The second outline's line width: it surrounds the first, so its pen is
 * as wide as both outlines on each side of the glyph's edge. */
export const stroke2Width = (stroke: number, stroke2: number) => (stroke + stroke2) * 2;

// ---- font weight -------------------------------------------------------------

/** The weight a title draws with: its own, else 700 when bold, 400 when not. */
export const fontWeight = (s: Pick<TextStyle, "bold" | "weight">) => s.weight ?? (s.bold ? 700 : 400);

/** A weight from untrusted JSON, whole and within 100..900; undefined when
 * it is not a number (bold decides then). */
export function cleanWeight(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(900, Math.max(100, v))) : undefined;
}

/** The usual names of the nine weights. */
export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium",
  600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black",
};

/** The weights 100, 200 .. 900, in order. */
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/**
 * The weights a font really has, one per face, from how it drew at each of
 * 100..900 (`drawn[i]` for weight 100 * (i + 1); equal values drew the same
 * face). The browser draws a weight a font lacks with its nearest face
 * (CSS font matching), so each face answers for a run of weights; the run
 * is named by the weight a face usually has there: 400 or 700 when the run
 * holds it, the heaviest below 400 (light faces are 300, not 100), the
 * heaviest above 700 (black is 900), else the middle one. Any weight of
 * the run draws the same face, so the name only labels it.
 */
export function distinctWeights(drawn: string[]): number[] {
  const runs = new Map<string, number[]>();
  drawn.forEach((sig, i) => runs.set(sig, [...(runs.get(sig) ?? []), WEIGHTS[i]]));
  return [...runs.values()]
    .map((run) => {
      if (run.includes(400)) return 400;
      if (run.includes(700)) return 700;
      const top = run[run.length - 1];
      if (top < 400 || run[0] > 700) return top;
      return run[Math.floor((run.length - 1) / 2)];
    })
    .sort((a, b) => a - b);
}
