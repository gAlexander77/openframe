// Speed curves (CapCut's Curve speed, Premiere's time remapping): a clip's
// playback rate as a graph over its timeline frames, and the exact amount of
// source that graph consumes. Pure math; ops.ts turns it into source times.
//
// Between points the rate changes exponentially, which is a straight line on
// the editor's log-scale speed axis, so the graph shows exactly what plays.
// That shape also has closed forms both ways:
//   area   ∫ s0·(s1/s0)^(u/L) du from 0 to x  = s0·x·expm1(z)/z,  z = x·ln(s1/s0)/L
//   inverse x = (a/s0)·log1p(w)/w,  w = a·ln(s1/s0)/(s0·L)
// and a piece cut out of a segment is again an exponential between its new
// end values, so splitting and trimming never distort a ramp (ADR-027).

import type { SpeedPoint } from "./project/types";

/** The graph's range, CapCut's: 0.1x at the bottom, 10x at the top. */
export const CURVE_MIN = 0.1;
export const CURVE_MAX = 10;

export const clampSpeed = (s: number) => Math.min(CURVE_MAX, Math.max(CURVE_MIN, s));

/** A point on a curve normalized to the clip: t is 0 at its start, 1 at its end. */
export interface NormPoint {
  t: number;
  speed: number;
}

/** expm1(z)/z without the 0/0 at z = 0. */
const exprel = (z: number) => (Math.abs(z) < 1e-9 ? 1 + z / 2 : Math.expm1(z) / z);
/** log1p(w)/w without the 0/0 at w = 0. */
const logrel = (w: number) => (Math.abs(w) < 1e-9 ? 1 - w / 2 : Math.log1p(w) / w);

/** Area under one exponential segment from its start to dx in. */
function segArea(s0: number, s1: number, len: number, dx: number): number {
  return s0 * dx * exprel((Math.log(s1 / s0) * dx) / len);
}

/** The dx where segArea reaches `a`. */
function segInverse(s0: number, s1: number, len: number, a: number): number {
  return (a / s0) * logrel((a * Math.log(s1 / s0)) / (s0 * len));
}

/** Rate at clip-relative frame x. */
export function speedAt(pts: SpeedPoint[], x: number): number {
  const first = pts[0];
  if (x <= first.f) return first.speed;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x <= b.f) {
      const len = b.f - a.f;
      return len > 0 ? a.speed * (b.speed / a.speed) ** ((x - a.f) / len) : b.speed;
    }
  }
  return pts[pts.length - 1].speed;
}

/** Signed area from the first point to x. */
function cumulative(pts: SpeedPoint[], x: number): number {
  const first = pts[0];
  if (x <= first.f) return (x - first.f) * first.speed;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = b.f - a.f;
    if (len <= 0) continue;
    if (x <= b.f) return acc + segArea(a.speed, b.speed, len, x - a.f);
    acc += segArea(a.speed, b.speed, len, len);
  }
  const last = pts[pts.length - 1];
  return acc + (x - last.f) * last.speed;
}

/** The x where cumulative(pts, x) = target. */
function cumulativeInverse(pts: SpeedPoint[], target: number): number {
  const first = pts[0];
  if (target <= 0) return first.f + target / first.speed;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = b.f - a.f;
    if (len <= 0) continue;
    const seg = segArea(a.speed, b.speed, len, len);
    if (target <= acc + seg) return a.f + Math.min(len, segInverse(a.speed, b.speed, len, target - acc));
    acc += seg;
  }
  const last = pts[pts.length - 1];
  return last.f + (target - acc) / last.speed;
}

/**
 * ∫ speed from clip frame 0 to x: how many frames' worth of source (at the
 * project rate) the clip's first x frames consume. Negative for x < 0, which
 * is what extending the clip's start to the left would add.
 */
export function areaTo(pts: SpeedPoint[], x: number): number {
  return cumulative(pts, x) - cumulative(pts, 0);
}

/** Inverse of areaTo: the clip frame x whose area from 0 is `a`. */
export function frameForArea(pts: SpeedPoint[], a: number): number {
  return cumulativeInverse(pts, a + cumulative(pts, 0));
}

/** Mean rate of a normalized curve over the clip: source span / duration. */
export function meanSpeed(norm: NormPoint[]): number {
  return areaTo(toFrames(norm, 1), 1);
}

/** Normalized points placed on a clip `len` frames long. */
export function toFrames(norm: NormPoint[], len: number): SpeedPoint[] {
  return norm.map((p) => ({ f: p.t * len, speed: p.speed }));
}

/**
 * The part of a curve a clip `len` frames long shows, normalized, with end
 * points pinned at t = 0 and t = 1. Exact: the pinned ends take the curve's
 * own values there, and a cut segment is still exponential.
 */
export function normalizeWindow(pts: SpeedPoint[], len: number): NormPoint[] {
  const out: NormPoint[] = [{ t: 0, speed: speedAt(pts, 0) }];
  for (const p of pts) if (p.f > 0 && p.f < len) out.push({ t: p.f / len, speed: p.speed });
  out.push({ t: 1, speed: speedAt(pts, len) });
  return out;
}

/** Sorted, deduplicated (later wins), finite, clamped. Null if nothing is left. */
export function cleanPoints<P extends { speed: number }>(pts: P[], key: (p: P) => number): P[] | null {
  const ok = pts.filter((p) => Number.isFinite(key(p)) && Number.isFinite(p.speed) && p.speed > 0);
  const byKey = new Map<number, P>();
  for (const p of ok) byKey.set(key(p), { ...p, speed: clampSpeed(p.speed) });
  const out = [...byKey.values()].sort((a, b) => key(a) - key(b));
  return out.length ? out : null;
}

// ---- presets -------------------------------------------------------------------

export interface CurvePreset {
  label: string;
  points: NormPoint[];
}

const P = (...pairs: [number, number][]): NormPoint[] => pairs.map(([t, speed]) => ({ t, speed }));

/**
 * CapCut's curve tiles (research §3.6). CapCut does not publish its numbers;
 * these shapes are ours, drawn to match what each tile is for.
 */
export const PRESETS: Record<string, CurvePreset> = {
  custom: { label: "Custom", points: P([0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1]) },
  montage: { label: "Montage", points: P([0, 0.8], [0.25, 3], [0.5, 0.5], [0.75, 3], [1, 0.8]) },
  hero: { label: "Hero time", points: P([0, 1], [0.3, 1.5], [0.5, 0.25], [0.7, 1.5], [1, 3]) },
  bullet: { label: "Bullet time", points: P([0, 4], [0.3, 0.2], [0.7, 0.2], [1, 4]) },
  jumpCut: { label: "Jump cut", points: P([0, 1], [0.4, 1], [0.5, 8], [0.6, 1], [1, 1]) },
  flashIn: { label: "Flash in", points: P([0, 8], [0.4, 1], [1, 1]) },
  flashOut: { label: "Flash out", points: P([0, 1], [0.6, 1], [1, 8]) },
};
