import { curveFn, type CurvePoints, type Curves } from "./curves";

type Rgb = [number, number, number];
export interface ColorMatch {
  curves: Curves;
  saturation: number;
  before: Rgb;
  after: Rgb;
}
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const luma = (c: Rgb) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
const saturated = (c: Rgb, amount: number): Rgb => {
  const y = luma(c);
  return c.map(v => clamp(y + (v - y) * amount)) as Rgb;
};
function pixels(frames: readonly ArrayLike<number>[]): Rgb[] {
  const out: Rgb[] = [];
  for (const f of frames) for (let i = 0; i + 3 < f.length; i += 4) {
    if (f[i + 3] > 0) out.push([f[i] / 255, f[i + 1] / 255, f[i + 2] / 255]);
  }
  if (!out.length) throw new Error("No pixels to match");
  return out;
}
const mean = (p: Rgb[]): Rgb => [0, 1, 2].map(k => p.reduce((s, c) => s + c[k], 0) / p.length) as Rgb;
const chroma = (p: Rgb[]) => p.reduce((s, c) => s + Math.hypot(...c.map(v => v - luma(c))), 0) / p.length;
const difference = (a: Rgb[], b: Rgb[]): Rgb => {
  const am = mean(a), bm = mean(b);
  return am.map((v, k) => Math.abs(v - bm[k]) * 255) as Rgb;
};

/** Evenly cover the middle 90% of a clip's visible timeline range. */
export function matchFrames(start: number, duration: number, count = 5): number[] {
  return Array.from({ length: count }, (_, i) => start + Math.round((duration - 1) * (0.05 + 0.9 * (count === 1 ? 0.5 : i / (count - 1)))));
}

/** Quantile fit with pinned black/white and bounded derivatives, including
 * between control points in the inspector's monotone cubic interpolation. */
function fit(target: number[], reference: number[], strength: number): CurvePoints {
  target.sort((a, b) => a - b);
  reference.sort((a, b) => a - b);
  const quantile = (v: number[], q: number) => {
    const x = q * (v.length - 1), i = Math.floor(x);
    return v[i] + (v[Math.min(i + 1, v.length - 1)] - v[i]) * (x - i);
  };
  const knots: CurvePoints = [[0, 0]];
  // Dense percentiles retain smooth gamma changes; duplicate histogram
  // bins are merged, so a solid patch never creates an infinite slope.
  for (let i = 1; i < 100; i++) {
    const x = quantile(target, i / 100), y = quantile(reference, i / 100);
    const prev = knots.at(-1)!;
    if (x > prev[0] + 1 / 1024 && x < 1 - 1 / 1024) knots.push([x, y]);
  }
  knots.push([1, 1]);
  let points: CurvePoints = Array.from({ length: 129 }, (_, i) => {
    const x = i / 128;
    let j = 0;
    while (j < knots.length - 2 && knots[j + 1][0] < x) j++;
    const [a, b] = [knots[j], knots[j + 1]];
    return [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
  });
  const smooth = points.map((p, i) => i === 0 || i === points.length - 1 ? p[1] : (points[i - 1][1] + p[1] * 2 + points[i + 1][1]) / 4);
  points.forEach((p, i) => { p[1] = smooth[i]; });
  // Project neighboring slopes into the safe range in both directions.
  for (let pass = 0; pass < 100; pass++) {
    points[0][1] = 0;
    for (let i = 1; i < points.length; i++) points[i][1] = clamp(points[i][1], points[i - 1][1] + 0.45 / 128, points[i - 1][1] + 2.4 / 128);
    points.at(-1)![1] = 1;
    for (let i = points.length - 2; i >= 0; i--) points[i][1] = clamp(points[i][1], points[i + 1][1] - 2.4 / 128, points[i + 1][1] - 0.45 / 128);
  }
  // Keep only points needed to describe the fit within a quarter level.
  // A simple gain then has a few editable handles, rather than a handle
  // on every histogram bin. The cubic is checked again after reduction.
  const keep = new Set([0, points.length - 1]);
  const reduce = (lo: number, hi: number) => {
    const a = points[lo], b = points[hi];
    let error = 0.25 / 255, index = -1;
    for (let i = lo + 1; i < hi; i++) {
      const [x, y] = points[i], expected = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      if (Math.abs(y - expected) > error) { error = Math.abs(y - expected); index = i; }
    }
    if (index >= 0) { keep.add(index); reduce(lo, index); reduce(index, hi); }
  };
  reduce(0, points.length - 1);
  points = points.filter((_, i) => keep.has(i));
  // A cubic's derivative can exceed its secants. Relax toward identity
  // until its actual sampled derivative also obeys the safety bound.
  for (let pass = 0; pass < 100; pass++) {
    const fn = curveFn(points);
    let safe = true, prev = fn(0);
    for (let i = 1; i <= 4096; i++) {
      const next = fn(i / 4096), slope = (next - prev) * 4096;
      if (slope < 0.4 - 1e-6 || slope > 2.5 + 1e-6) safe = false;
      prev = next;
    }
    if (safe) break;
    for (const p of points) p[1] = p[0] + (p[1] - p[0]) * 0.95;
  }
  points[0][1] = 0;
  points.at(-1)![1] = 1;
  return points.map(([x, y]) => [x, x + (y - x) * strength]);
}

/** Match independent sampled frames, not corresponding pixels. Saturation
 * runs before curves, just as Basic runs before RGB Curves in the shader.
 * The retained master curve is included in the fit's input domain. */
export function colorMatch(referenceFrames: readonly ArrayLike<number>[], targetFrames: readonly ArrayLike<number>[], strength = 1, matchSaturation = true, master?: CurvePoints): ColorMatch {
  const reference = pixels(referenceFrames), target = pixels(targetFrames);
  const amount = clamp(strength);
  const targetChroma = chroma(target);
  const ratio = matchSaturation && targetChroma > 1e-5 ? clamp(chroma(reference) / targetChroma, 0, 2) : 1;
  const saturation = amount === 0 ? 0 : (ratio - 1) * 100 * amount;
  const masterFn = master ? curveFn(master) : (v: number) => v;
  const input = target.map(c => saturated(c, 1 + saturation / 100).map(masterFn) as Rgb);
  const curves: Curves = {};
  for (const [k, ch] of (["r", "g", "b"] as const).entries()) curves[ch] = fit(input.map(c => c[k]), reference.map(c => c[k]), amount);
  const fns = (["r", "g", "b"] as const).map(ch => curveFn(curves[ch]!));
  const output = input.map(c => c.map((v, k) => fns[k](v)) as Rgb);
  return { curves, saturation, before: difference(reference, target), after: difference(reference, output) };
}
