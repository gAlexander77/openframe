// Tone curves (CapCut's Curves tab, Lumetri's RGB Curves): control points
// joined by a monotone cubic, then baked into a 256-entry table the GPU
// reads with one texture fetch per channel.
//
// Monotone (Fritsch–Carlson) rather than a natural spline because a natural
// spline overshoots: three points close together make it swing past them,
// so a gentle lift of the shadows would crush or clip the tones beside it.
// The monotone cubic never leaves the range of its neighboring points.

export const CURVE_CHANNELS = ["luma", "r", "g", "b"] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

/** Control points [input, output], both 0..1, sorted by input. */
export type CurvePoints = [number, number][];
/** A clip's curves; a missing channel is the identity. `luma` applies to
 * R, G and B alike (Lumetri's white master curve), before the per-channel
 * curves. */
export type Curves = Partial<Record<CurveChannel, CurvePoints>>;

export const IDENTITY_CURVE: CurvePoints = [
  [0, 0],
  [1, 1],
];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Clamp to 0..1, sort by input, drop repeated inputs (the later wins).
 * Fewer than two points is no curve: returns null. */
export function cleanCurve(raw: unknown): CurvePoints | null {
  if (!Array.isArray(raw)) return null;
  const pts = raw
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([x, y]) => [clamp01(x), clamp01(y)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const out: CurvePoints = [];
  for (const p of pts) {
    if (out.length && Math.abs(out[out.length - 1][0] - p[0]) < 1e-6) out[out.length - 1] = p;
    else out.push(p);
  }
  return out.length >= 2 ? out : null;
}

/** True when the curve maps every input to itself. */
export function isIdentityCurve(pts: CurvePoints | undefined): boolean {
  if (!pts) return true;
  const first = pts[0];
  const last = pts[pts.length - 1];
  return first[0] === 0 && last[0] === 1 && pts.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

/** Every channel is the identity (or missing). */
export function isIdentityCurves(c: Curves | undefined): boolean {
  return !c || CURVE_CHANNELS.every((ch) => isIdentityCurve(c[ch]));
}

/** The curve as a function: monotone cubic Hermite through the points,
 * flat beyond the first and last point (like Photoshop and Lumetri). */
export function curveFn(points: CurvePoints): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / Math.max(xs[k + 1] - xs[k], 1e-9));
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] > 0 ? (d[k - 1] + d[k]) / 2 : 0;
  // Fritsch–Carlson: shrink tangents that would overshoot.
  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
      continue;
    }
    const a = m[k] / d[k];
    const b = m[k + 1] / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[k + 1] = t * b * d[k];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
    return clamp01(y);
  };
}

export const CURVE_TABLE_SIZE = 256;

/** Bake all four channels into RGBA bytes, one texel per input level:
 * R, G, B hold the red, green and blue curves, A holds luma. */
export function bakeCurves(c: Curves): Uint8Array {
  const out = new Uint8Array(CURVE_TABLE_SIZE * 4);
  const fns = (["r", "g", "b", "luma"] as const).map((ch) => (c[ch] && !isIdentityCurve(c[ch]) ? curveFn(c[ch]!) : (x: number) => x));
  for (let i = 0; i < CURVE_TABLE_SIZE; i++) {
    const x = i / (CURVE_TABLE_SIZE - 1);
    for (let ch = 0; ch < 4; ch++) out[i * 4 + ch] = Math.round(fns[ch](x) * 255);
  }
  return out;
}

/** CPU reference of the shader: luma curve on every channel, then each
 * channel's own curve, each read from the baked table with linear
 * filtering the way the GPU samples it. */
export function applyCurves(table: Uint8Array, rgb: [number, number, number]): [number, number, number] {
  const read = (v: number, ch: number) => {
    const p = clamp01(v) * (CURVE_TABLE_SIZE - 1);
    const i = Math.min(Math.floor(p), CURVE_TABLE_SIZE - 2);
    const t = p - i;
    return (table[i * 4 + ch] * (1 - t) + table[(i + 1) * 4 + ch] * t) / 255;
  };
  const l = rgb.map((v) => read(v, 3));
  return [read(l[0], 0), read(l[1], 1), read(l[2], 2)];
}
