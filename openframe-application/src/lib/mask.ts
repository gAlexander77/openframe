// A mask on the viewer: where it sits on its layer, the outline the
// handles draw, and what a handle drag does to it. Mirrors maskAlpha in
// engine/shaders.ts (ADR-049): center and size are fractions of the
// visible (cropped) layer, and the shape turns rigidly in layer pixels.
// "Layer pixels" here are the layer's own, before its rotation and flips,
// with the layer's center at 0,0 and y down.

import type { Mask } from "./project/types";

export type MaskShape = Mask["shape"];
export const MASK_SHAPES: MaskShape[] = ["linear", "mirror", "circle", "rectangle", "heart", "star"];

export const MASK_LABELS: Record<MaskShape, string> = {
  linear: "Linear",
  mirror: "Mirror",
  circle: "Circle",
  rectangle: "Rectangle",
  heart: "Heart",
  star: "Star",
};

/** A new mask, as the Mask tab adds it. Heart and star start square on
 * the layer (`aspect`: its width over height), as CapCut's do; the
 * others keep the layer's shape, as they always have. */
export function newMask(shape: MaskShape, aspect: number): Mask {
  const square = shape === "heart" || shape === "star";
  return { shape, x: 0, y: 0, width: square ? 0.6 / aspect : 0.6, height: 0.6, rotation: 0, feather: 0.05, invert: false };
}

export interface MaskFrame {
  /** Center in layer pixels. */
  cx: number;
  cy: number;
  /** Half the size along the mask's own axes, in layer pixels. */
  hw: number;
  hh: number;
  /** Radians, clockwise. */
  rot: number;
}

export function maskFrame(m: Mask, lw: number, lh: number): MaskFrame {
  return { cx: m.x * lw, cy: m.y * lh, hw: (m.width * lw) / 2, hh: (m.height * lh) / 2, rot: (m.rotation * Math.PI) / 180 };
}

/** How far a closed mask reaches on its layer: its edges as offsets from
 * the layer's center in fractions of the layer's width and height (the
 * picture's own edges are at ±0.5), the shape turned with it. Null for
 * linear and mirror, which run across the layer by design. `aspect`: the
 * layer's width over its height. A mask past an edge is cut flat there. */
export function maskReach(m: Mask, aspect: number): { left: number; right: number; top: number; bottom: number } | null {
  if (m.shape === "linear" || m.shape === "mirror") return null;
  const f = maskFrame(m, aspect, 1);
  const c = Math.abs(Math.cos(f.rot)), s = Math.abs(Math.sin(f.rot));
  // An ellipse's box turned with it; any other shape's box, turned.
  const hx = m.shape === "circle" ? Math.hypot(f.hw * c, f.hh * s) : f.hw * c + f.hh * s;
  const hy = m.shape === "circle" ? Math.hypot(f.hw * s, f.hh * c) : f.hw * s + f.hh * c;
  return { left: m.x - hx / aspect, right: m.x + hx / aspect, top: m.y - hy, bottom: m.y + hy };
}

/** The other size of a mask `aspect` times as wide as tall in pixels
 * (1: a round circle, a square), on a layer `layer` wide over tall: the
 * height for a width, or the width for a height, as fractions of it. */
export function sizeForAspect(given: { width?: number; height?: number }, aspect: number, layer: number): { width: number; height: number } {
  if (given.height !== undefined && given.width === undefined) return { width: (given.height * aspect) / layer, height: given.height };
  const width = given.width ?? 0.6;
  return { width, height: (width * layer) / aspect };
}

/** A layer-pixel point in the mask's own frame: centered, unrotated. */
export function toMask(f: MaskFrame, x: number, y: number) {
  const dx = x - f.cx, dy = y - f.cy, c = Math.cos(f.rot), s = Math.sin(f.rot);
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

// The star's ten corners, a point at the top, inner radius 0.382 of the
// outer, mapped so the star fills its box (as sdStar does).
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.381966 : 1;
  return [(Math.cos(a) * r) / 0.951057, (Math.sin(a) * r + 0.095492) / 0.904508];
});

const n = (v: number) => +v.toFixed(2);

/** The outline as an SVG path in the mask's frame, scaled by `k` (screen
 * pixels per layer pixel). Linear and mirror lines run `reach` layer
 * pixels each way. */
export function maskOutline(m: Mask, f: MaskFrame, k: number, reach: number): string {
  const w = f.hw * k, h = f.hh * k, L = reach * k;
  switch (m.shape) {
    case "linear":
      return `M ${n(-L)} 0 H ${n(L)}`;
    case "mirror":
      return `M ${n(-L)} ${n(-h)} H ${n(L)} M ${n(-L)} ${n(h)} H ${n(L)}`;
    case "circle":
      return `M ${n(-w)} 0 A ${n(w)} ${n(h)} 0 1 0 ${n(w)} 0 A ${n(w)} ${n(h)} 0 1 0 ${n(-w)} 0 Z`;
    case "rectangle": {
      const r = Math.max(0, Math.min(1, m.radius ?? 0)) * Math.min(w, h);
      return `M ${n(-w + r)} ${n(-h)} H ${n(w - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(w)} ${n(-h + r)} V ${n(h - r)} A ${n(r)} ${n(r)} 0 0 1 ${n(w - r)} ${n(h)} H ${n(-w + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(-w)} ${n(h - r)} V ${n(-h + r)} A ${n(r)} ${n(r)} 0 0 1 ${n(-w + r)} ${n(-h)} Z`;
    }
    case "heart": {
      // sdHeart's boundary: from the tip, a line to where each lobe's
      // circle starts, then the lobes over the top to the dip.
      const x = (hx: number) => n((hx / 0.603553) * w), y = (hy: number) => n((1 - hy / 0.551777) * h);
      const rx = n((0.353553 / 0.603553) * w), ry = n((0.353553 / 0.551777) * h);
      return `M 0 ${y(0)} L ${x(0.5)} ${y(0.5)} A ${rx} ${ry} 0 0 0 0 ${y(1)} A ${rx} ${ry} 0 0 0 ${x(-0.5)} ${y(0.5)} Z`;
    }
    case "star":
      return `M ${STAR.map(([sx, sy]) => `${n(sx * w)} ${n(sy * h)}`).join(" L ")} Z`;
  }
}

export type MaskHandle = "move" | "e" | "w" | "n" | "s" | "rotate" | "feather" | "radius";

/** Which handles a shape has: a line has no size, a band only a height. */
export function maskHandles(shape: MaskShape): MaskHandle[] {
  if (shape === "linear") return ["move", "rotate", "feather"];
  if (shape === "mirror") return ["move", "n", "s", "rotate", "feather"];
  return ["move", "e", "w", "n", "s", "rotate", "feather", ...(shape === "rectangle" ? (["radius"] as const) : [])];
}

/** How far below the shape the feather arrow starts, and how far it travels
 * from no feather to full, in layer pixels for a layer `lh` tall. */
export const featherReach = (lh: number) => ({ gap: lh * 0.06, span: lh * 0.5 });

/** Where a handle sits in the mask's frame, layer pixels. */
export function handleAt(m: Mask, f: MaskFrame, h: MaskHandle, lh: number): { x: number; y: number } {
  const base = m.shape === "linear" ? 0 : f.hh;
  const r = Math.max(0, Math.min(1, m.radius ?? 0)) * Math.min(f.hw, f.hh);
  const fr = featherReach(lh);
  switch (h) {
    case "move": return { x: 0, y: 0 };
    case "e": return { x: f.hw, y: 0 };
    case "w": return { x: -f.hw, y: 0 };
    case "n": return { x: 0, y: -f.hh };
    case "s": return { x: 0, y: f.hh };
    case "rotate": return { x: 0, y: -base - fr.gap };
    case "feather": return { x: 0, y: base + fr.gap + m.feather * fr.span };
    case "radius": return { x: -f.hw + r, y: -f.hh + r };
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 4) => +v.toFixed(d) || 0;

/**
 * The mask after dragging `handle` from layer pixel `grab` to `to`, from
 * `start`. Move follows the pointer; an edge sets that half-size about the
 * center; rotate turns by the pointer's angle around the center, catching
 * every 45 degrees within 3 unless `free`; feather follows the arrow down
 * the mask's own axis; radius rounds the corners toward the center.
 */
export function dragMask(start: Mask, handle: MaskHandle, grab: { x: number; y: number }, to: { x: number; y: number }, lw: number, lh: number, free = false): Mask {
  const f = maskFrame(start, lw, lh);
  const p = toMask(f, to.x, to.y);
  switch (handle) {
    case "move":
      return { ...start, x: round(clamp(start.x + (to.x - grab.x) / lw, -1, 1)), y: round(clamp(start.y + (to.y - grab.y) / lh, -1, 1)) };
    case "e":
    case "w":
      return { ...start, width: round(clamp((2 * Math.abs(p.x)) / lw, 0.01, 2)) };
    case "n":
    case "s":
      return { ...start, height: round(clamp((2 * Math.abs(p.y)) / lh, 0.01, 2)) };
    case "rotate": {
      const a = (x: number, y: number) => (Math.atan2(y - f.cy, x - f.cx) * 180) / Math.PI;
      let r = start.rotation + a(to.x, to.y) - a(grab.x, grab.y);
      r = ((((r + 180) % 360) + 360) % 360) - 180;
      if (!free) {
        const snapped = Math.round(r / 45) * 45;
        if (Math.abs(r - snapped) < 3) r = snapped;
      }
      return { ...start, rotation: round(r, 2) };
    }
    case "feather": {
      const fr = featherReach(lh), base = start.shape === "linear" ? 0 : f.hh;
      return { ...start, feather: round(clamp((p.y - base - fr.gap) / fr.span, 0, 1)) };
    }
    case "radius": {
      const r = ((p.x + f.hw) + (p.y + f.hh)) / 2;
      return { ...start, radius: round(clamp(r / Math.max(1e-6, Math.min(f.hw, f.hh)), 0, 1)) };
    }
  }
}
