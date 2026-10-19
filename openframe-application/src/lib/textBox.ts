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
 * the textarea wraps where the rasterizer does.
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
  const textWidth = Math.max(layout.wrapWidth, layout.textWidth) * k;
  const pad = layout.pad * k;
  const left = align === "left" ? pad : align === "right" ? width - pad - textWidth : (width - textWidth) / 2;
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
