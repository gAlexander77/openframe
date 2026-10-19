// Shape layers (ADR-057): a color clip with a `shape` draws a rectangle,
// rounded rectangle, ellipse or line instead of filling the canvas, with a
// solid or two-color gradient fill, a stroke and a draw-on amount (After
// Effects' Trim Paths). The compositor draws them from signed distances in
// the layer shader (src/engine/shaders.ts, shapeColor); this module holds
// what the plan, the loader, the commands and the viewer's geometry need,
// and a copy of the shader's outline math so it is tested.

import { paramAt } from "./keyframes";
import type { ColorClip, Shape } from "./project/types";

export const SHAPE_KINDS = ["rectangle", "ellipse", "line"] as const;

/** A shape's numbers at one frame, keyframes applied. */
export type ResolvedShape = Shape & { radius: number; draw: number; feather: number };

/** Paths that keyframe (every number of a shape), as shape.<param>. */
export const SHAPE_PARAMS = ["width", "height", "radius", "draw", "stroke.width", "gradient.angle", "feather", "gradient.x", "gradient.y", "gradient.radius"] as const;

/** A feather wider than this (pixels at 1080p) is clamped. */
export const FEATHER_MAX = 1000;

/** The shape at clip frame `r`: animated numbers read from their keys. */
export function resolveShape(clip: ColorClip, r: number): ResolvedShape | undefined {
  const s = clip.shape;
  if (!s) return undefined;
  const at = (k: string, fallback: number) => (clip.keyframes?.[`shape.${k}`]?.length ? paramAt(clip, `shape.${k}`, r) : fallback);
  return {
    ...s,
    width: Math.max(0, at("width", s.width)),
    height: Math.max(0, at("height", s.height)),
    radius: clamp01(at("radius", s.radius ?? 0)),
    draw: clamp01(at("draw", s.draw ?? 1)),
    feather: Math.min(FEATHER_MAX, Math.max(0, at("feather", s.feather ?? 0))),
    ...(s.stroke ? { stroke: { ...s.stroke, width: Math.max(0, at("stroke.width", s.stroke.width)) } } : {}),
    ...(s.gradient ? { gradient: resolveGradient(s.gradient, at) } : {}),
  };
}

/** A gradient's numbers at one frame: a radial one's center and radius
 * filled in (center of the box, out to its sides). */
function resolveGradient(g: NonNullable<Shape["gradient"]>, at: (k: string, fallback: number) => number): NonNullable<Shape["gradient"]> {
  const angle = at("gradient.angle", g.angle);
  if (g.kind !== "radial") return { ...g, angle };
  return { ...g, angle, x: at("gradient.x", g.x ?? 0), y: at("gradient.y", g.y ?? 0), radius: Math.max(0.001, at("gradient.radius", g.radius ?? 1)) };
}

/** Pixels of soft edge a feather of `feather` (1080p pixels) reaches
 * past the outline, on a canvas `height` tall: three sigma, where its
 * Gaussian falloff is spent. The compositor grows the shape's quad by
 * this. */
export const featherReach = (feather: number, height: number) => (Math.max(0, feather) * 0.75 * height) / 1080;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A line with no stroke is drawn this thick (pixels at 1080p). */
export const LINE_WIDTH = 8;

/** The stroke's width in pixels of a canvas `height` tall: a line's
 * thickness, a rectangle's or ellipse's outline (0 for none). */
export function strokePx(s: Shape, height: number): number {
  const w = s.stroke?.width ?? (s.kind === "line" ? LINE_WIDTH : 0);
  return (Math.max(0, w) * height) / 1080;
}

/** What a shape covers in pixels of a `width` x `height` canvas: its box
 * plus the half of the stroke outside it (a line: its length by its
 * thickness). The viewer's handles and Align measure this. */
export function shapeExtent(s: Shape, width: number, height: number): { w: number; h: number } {
  const sw = strokePx(s, height);
  if (s.kind === "line") return { w: Math.max(1, s.width * width), h: Math.max(1, sw) };
  return { w: Math.max(1, s.width * width + sw), h: Math.max(1, s.height * height + sw) };
}

/**
 * Where along a rectangle's (rounded) outline the point nearest `q` lies,
 * as a share of the perimeter from the top center, clockwise on screen
 * (y down). `bx`, `by` are the box's half sizes and `r` the corner radius,
 * all in pixels. The shader's outlineAt is this, line for line: trim paths
 * draw the outline up to `draw` of the way round.
 */
export function rectOutlineAt(qx: number, qy: number, bx: number, by: number, r: number): number {
  r = Math.min(r, bx, by);
  const ix = bx - r, iy = by - r;
  const arc = (Math.PI / 2) * r;
  const total = 4 * ix + 4 * iy + 4 * arc;
  if (total <= 0) return 0;
  const ax = Math.abs(qx), ay = Math.abs(qy);
  // Distance along the outline of the quadrant-local point, measured in
  // the top-right quadrant from the top center: the top edge, the corner,
  // then the right edge down to the middle.
  let s: number;
  const nearTop = ax <= ix && ay <= iy ? bx - ax > by - ay : ax <= ix;
  if (ax > ix && ay > iy) s = ix + r * Math.atan2(ax - ix, ay - iy);
  else if (nearTop) s = ax;
  else s = ix + arc + (iy - ay);
  // ...then mirrored into the other quadrants, going clockwise.
  const quarter = ix + arc + iy;
  let d: number;
  if (qx >= 0 && qy <= 0) d = s;
  else if (qx >= 0) d = 2 * quarter - s;
  else if (qy > 0) d = 2 * quarter + s;
  else d = 4 * quarter - s;
  return (d / total) % 1;
}

/** The same for an ellipse, by angle from the top, clockwise. Not arc
 * length (an ellipse has none in closed form): a long, flat ellipse draws
 * a little faster along its ends. */
export function ellipseOutlineAt(qx: number, qy: number, bx: number, by: number): number {
  const a = Math.atan2(qx / Math.max(bx, 1e-6), -qy / Math.max(by, 1e-6));
  return (a / (2 * Math.PI) + 1) % 1;
}

// ---- colors ---------------------------------------------------------------

const NAMED: Record<string, string> = {
  white: "#ffffff", black: "#000000", red: "#ff0000", green: "#008000", lime: "#00ff00", blue: "#0000ff",
  yellow: "#ffff00", cyan: "#00ffff", magenta: "#ff00ff", orange: "#ffa500", purple: "#800080",
  pink: "#ffc0cb", gray: "#808080", grey: "#808080", gold: "#ffd700", navy: "#000080", teal: "#008080",
  transparent: "#00000000",
};

/** A CSS color as straight RGBA, each 0..1: #rgb, #rgba, #rrggbb,
 * #rrggbbaa, rgb()/rgba() and common names. Null when unreadable. */
export function parseColor(css: string): [number, number, number, number] | null {
  const s = css.trim().toLowerCase();
  const hex = (NAMED[s] ?? s).match(/^#([0-9a-f]{3,8})$/)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? hex.split("").map((c) => c + c).join("") : hex;
    const v = [0, 2, 4, 6].map((i) => (i < full.length ? parseInt(full.slice(i, i + 2), 16) / 255 : 1));
    return [v[0], v[1], v[2], v[3]];
  }
  const fn = s.match(/^rgba?\(([^)]*)\)$/)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const ch = parts.slice(0, 3).map((x) => (x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x) / 255));
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out = [...ch, a];
    return out.every(Number.isFinite) ? (out.map(clamp01) as [number, number, number, number]) : null;
  }
  return null;
}

// ---- loading ----------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A shape from untrusted JSON, or undefined when it is not one (the clip
 * then draws as a plain solid). Numbers out of range are clamped. */
export function cleanShape(raw: unknown): Shape | undefined {
  if (!isObj(raw) || !SHAPE_KINDS.includes(raw.kind as Shape["kind"])) return undefined;
  const size = (v: unknown, d: number) => (fin(v) ? Math.max(0.001, Math.min(4, v)) : d);
  const out: Shape = { kind: raw.kind as Shape["kind"], width: size(raw.width, 0.3), height: size(raw.height, 0.1) };
  if (fin(raw.radius) && raw.radius > 0) out.radius = clamp01(raw.radius);
  if (raw.fill === false) out.fill = false;
  const g = raw.gradient;
  if (isObj(g) && typeof g.from === "string" && typeof g.to === "string") {
    out.gradient = { from: g.from, to: g.to, angle: fin(g.angle) ? g.angle : 0 };
    if (g.kind === "radial") {
      out.gradient.kind = "radial";
      if (fin(g.x) && g.x !== 0) out.gradient.x = Math.max(-2, Math.min(2, g.x));
      if (fin(g.y) && g.y !== 0) out.gradient.y = Math.max(-2, Math.min(2, g.y));
      if (fin(g.radius) && g.radius !== 1) out.gradient.radius = Math.max(0.001, Math.min(10, g.radius));
    }
  }
  const st = raw.stroke;
  if (isObj(st) && typeof st.color === "string" && fin(st.width) && st.width >= 0) out.stroke = { color: st.color, width: st.width };
  if (fin(raw.draw) && raw.draw < 1) out.draw = clamp01(raw.draw);
  if (fin(raw.feather) && raw.feather > 0) out.feather = Math.min(FEATHER_MAX, raw.feather);
  return out;
}
