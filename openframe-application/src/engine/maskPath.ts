import { maskPathData, pathBounds } from "../lib/maskPath";
import type { Mask } from "../lib/project/types";

/** Rasterize in the path's own frame. Rotation/translation stay in GLSL,
 * so keyed motion reuses this texture. Canvas2D uses nonzero winding. */
export function rasterMaskPath(mask: Mask, lw: number, lh: number) {
  const points = mask.points ?? [];
  const b = pathBounds(points);
  const padX = mask.feather * lh / Math.max(1, lw * mask.width) + 2 / Math.max(1, lw);
  const padY = mask.feather / Math.max(0.01, mask.height) + 2 / Math.max(1, lh);
  const bounds = { left: b.left - padX, top: b.top - padY, right: b.right + padX, bottom: b.bottom + padY };
  const w = Math.max(0.001, bounds.right - bounds.left), h = Math.max(0.001, bounds.bottom - bounds.top);
  const width = Math.max(1, Math.ceil(w * lw * mask.width)), height = Math.max(1, Math.ceil(h * lh * mask.height));
  // ponytail: path rasters cap their long side at 1024 to bound mask memory;
  // raise this or tile distance fields for very large delivery frames.
  const k = Math.min(1, 1024 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * k));
  canvas.height = Math.max(1, Math.ceil(height * k));
  const ctx = canvas.getContext("2d")!;
  if (points.length >= 3 && mask.closed !== false) {
    ctx.fillStyle = "white";
    ctx.filter = mask.feather > 0 ? `blur(${mask.feather * lh * k / 4}px)` : "none";
    ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, -bounds.left * canvas.width / w, -bounds.top * canvas.height / h);
    ctx.fill(new Path2D(maskPathData(points)), "nonzero");
  }
  return { canvas, bounds };
}
