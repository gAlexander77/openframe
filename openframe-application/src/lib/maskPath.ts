import type { Mask, MaskPoint } from "./project/types";
import { maskFrame, toMask } from "./mask";

type Point = { x: number; y: number };
const control = (p: MaskPoint, side: "in" | "out"): Point => ({ x: p.x + (p[side]?.[0] ?? 0), y: p.y + (p[side]?.[1] ?? 0) });

/** Shared by Path2D rasterization and the viewer outline. Points are local
 * layer fractions, multiplied by the mask's width/height, then turned rigidly. */
export function maskPathData(points: MaskPoint[], closed = true, sx = 1, sy = sx): string {
  if (!points.length) return "";
  const xy = (p: Point) => `${p.x * sx} ${p.y * sy}`;
  let d = `M ${xy(points[0])}`;
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    d += a.out || b.in ? ` C ${xy(control(a, "out"))} ${xy(control(b, "in"))} ${xy(b)}` : ` L ${xy(b)}`;
  }
  return d + (closed ? " Z" : "");
}

/** Flatten cubic segments to a subpixel tolerance in local layer fractions.
 * Used for bounds and coverage checks; Canvas2D fills the original curves. */
export function flattenPath(points: MaskPoint[], closed = true, tolerance = 1 / 8192): Point[] {
  if (!points.length) return [];
  const out: Point[] = [{ x: points[0].x, y: points[0].y }];
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const curve = (a: Point, b: Point, c: Point, d: Point, depth = 0) => {
    const dx = d.x - a.x, dy = d.y - a.y, len = Math.hypot(dx, dy);
    const dist = (p: Point) => len ? Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len : Math.hypot(p.x - a.x, p.y - a.y);
    if (depth >= 12 || (Math.max(dist(b), dist(c)) <= tolerance && Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y) + Math.hypot(d.x - c.x, d.y - c.y) - len <= tolerance)) { out.push(d); return; }
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
    curve(a, ab, abc, center, depth + 1);
    curve(center, bcd, cd, d, depth + 1);
  };
  for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a.out || b.in) curve(a, control(a, "out"), control(b, "in"), b);
    else out.push({ x: b.x, y: b.y });
  }
  return out;
}

export function pathBounds(points: MaskPoint[]) {
  const p = flattenPath(points);
  if (!p.length) return { left: 0, top: 0, right: 0, bottom: 0 };
  return p.reduce((b, p) => ({ left: Math.min(b.left, p.x), top: Math.min(b.top, p.y), right: Math.max(b.right, p.x), bottom: Math.max(b.bottom, p.y) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

/** Nonzero winding, matching Canvas2D's fill rule (including crossings). */
export function pathContains(points: MaskPoint[], x: number, y: number): boolean {
  const p = flattenPath(points);
  let winding = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    const cross = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
    if (a.y <= y && b.y > y && cross > 0) winding++;
    if (a.y > y && b.y <= y && cross < 0) winding--;
  }
  return winding !== 0;
}

export function pathMaskContains(m: Mask, x: number, y: number, lw: number, lh: number): boolean {
  if (m.closed === false || (m.points?.length ?? 0) < 3) return m.invert;
  const q = toMask(maskFrame(m, lw, lh), x, y);
  const inside = pathContains(m.points!, q.x / (lw * m.width), q.y / (lh * m.height));
  return m.invert ? !inside : inside;
}

/** A corner becomes smooth along its neighbors' tangent; a smooth point
 * becomes a corner without moving its anchor or either neighboring point. */
export function togglePathCorner(points: MaskPoint[], index: number): MaskPoint[] {
  return points.map((p, i) => {
    if (i !== index) return p;
    if (p.in || p.out) return { x: p.x, y: p.y };
    const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
    const dx = (b.x - a.x) / 6, dy = (b.y - a.y) / 6;
    return { ...p, in: [-dx, -dy], out: [dx, dy] };
  });
}

/** Untrusted files cannot pass NaNs, enormous paths, or partial handles to
 * Path2D. A malformed path is dropped with its mask by normalizeClip. */
export function cleanMaskPoints(raw: unknown): MaskPoint[] | undefined {
  // ponytail: 256 anchors bounds curve subdivision and raster work per edit;
  // raise this after profiling large traced paths or move rasterization to a worker.
  if (!Array.isArray(raw) || raw.length > 256) return undefined;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 4;
  const points: MaskPoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object" || !finite(p.x) || !finite(p.y)) return undefined;
    const next: MaskPoint = { x: p.x, y: p.y };
    for (const side of ["in", "out"] as const) {
      const h = p[side];
      if (h === undefined) continue;
      if (!Array.isArray(h) || h.length !== 2 || !h.every(finite)) return undefined;
      next[side] = [h[0], h[1]];
    }
    points.push(next);
  }
  return points;
}
