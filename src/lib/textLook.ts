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
