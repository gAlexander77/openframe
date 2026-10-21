// Where a text clip's on-canvas editor goes (ADR-030). The rasterizer lays
// the text out in canvas pixels; the viewer shows the canvas at its own zoom,
// and the clip's transform moves, scales and turns the raster. This maps the
// raster's layout into viewer pixels, so a transparent textarea laid over the
// frame puts its caret and selection on the glyphs the engine drew.

/** How the rasterizer laid a text clip out, in pixels of the canvas it
 * rasterized for. */
export interface TextLayout {
  /** The raster: the text plus `pad` on every side. */
  width: number;
  height: number;
  pad: number;
  /** The widest line, and the width lines wrap past. */
  textWidth: number;
  wrapWidth: number;
  size: number;
  /** Line pitch (size times the style's line height). */
  lineHeight: number;
  letterSpacing: number;
  /** How far the canvas's baseline sits below where CSS puts it in a line
   * of the same height: the canvas centers the em box ("middle"), CSS
   * centers the font's ascent plus descent. */
  baselineShift: number;
  /** The lines as drawn, wrapped (cased as shown). */
  lines?: string[];
}

/**
 * A line's width on its letters. Canvas and CSS letter spacing both add
 * the spacing after every letter, the last one too, so the advance they
 * measure, and center or right-align, ends one spacing past the last glyph
 * (measured in Edge: NORTH in 100 px Arial with spacing 34 advances 523.7
 * px, 5 x 34 more than untracked, and a centered fillText drew its ink 17
 * px left of center). Lines are laid out on this width instead, so tracked
 * titles center on their letters (ADR-105).
 */
export function letterWidth(advance: number, letterSpacing: number, text: string): number {
  return text ? advance - letterSpacing : advance;
}

/** Where a line `width` wide (letterWidth) starts in a raster `rasterWidth`
 * wide with `pad` on each side, aligned as the style says. */
export function lineStart(align: "left" | "center" | "right", width: number, rasterWidth: number, pad: number): number {
  return align === "left" ? pad : align === "right" ? rasterWidth - pad - width : (rasterWidth - width) / 2;
}

export interface EditBox {
  /** The raster's box in viewer pixels: center, size, turn in degrees. */
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  /** The text area, relative to that box's top-left corner. */
  left: number;
  top: number;
  textWidth: number;
  textHeight: number;
  /** How much to trim off the text area's left and right so it reaches only
   * half an em past the box: a wrap-wide area around a short title would
   * otherwise swallow the clicks beside it that should end editing. */
  clipLeft: number;
  clipRight: number;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
}

/**
 * The editor's box for a text layer placed at `at` (the render plan's
 * layer: offsets as fractions of the canvas, scale, degrees), seen in a
 * viewer of `viewer` pixels showing a canvas `canvasWidth` pixels wide.
 * The text area is as wide as the wrap width (or the widest line, when one
 * word overflows it), anchored the way the alignment anchors the lines, so
 * the textarea wraps where the rasterizer does. CSS aligns a line with its
 * spacing after the last letter, which the raster leaves out (letterWidth):
 * a centered area moves half a spacing right, a right-aligned one a whole
 * spacing, so the typed letters stay on the drawn ones.
 */
export function editBox(
  layout: TextLayout,
  align: "left" | "center" | "right",
  at: { x: number; y: number; scale: number; rotation: number },
  viewer: { width: number; height: number },
  canvasWidth: number,
): EditBox {
  const k = (viewer.width / canvasWidth) * Math.abs(at.scale);
  const width = layout.width * k;
  // The widest line as CSS measures it: with the trailing spacing.
  const textWidth = Math.max(layout.wrapWidth, layout.textWidth + layout.letterSpacing) * k;
  const pad = layout.pad * k;
  const trail = layout.letterSpacing * k;
  const left = align === "left" ? pad : align === "right" ? width - pad - textWidth + trail : (width - textWidth + trail) / 2;
  const slack = (layout.size * k) / 2;
  return {
    cx: viewer.width / 2 + at.x * viewer.width,
    cy: viewer.height / 2 + at.y * viewer.height,
    width,
    height: layout.height * k,
    rotation: at.rotation,
    left,
    top: pad + layout.baselineShift * k,
    textWidth,
    textHeight: (layout.height - layout.pad * 2) * k,
    clipLeft: Math.max(0, -left - slack),
    clipRight: Math.max(0, left + textWidth - width - slack),
    fontSize: layout.size * k,
    lineHeight: layout.lineHeight * k,
    letterSpacing: layout.letterSpacing * k,
  };
}
