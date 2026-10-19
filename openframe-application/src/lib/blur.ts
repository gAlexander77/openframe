// Large Gaussian blurs (ADR-069): the blur effect past its old maximum,
// and the drop shadow's softness. The picture is halved k times, blurred
// there by a separable 33-tap Gaussian, and read back to full size with a
// cubic B-spline. Every stage widens the blur, so the Gaussian at the
// small level takes only what the halvings and the read-back leave of the
// asked-for variance: the total is the sigma asked for at every size, and
// a keyed blur grows smoothly across the levels.
//
// Each halving is a [1, 3, 3, 1] / 8 filter per axis (four bilinear reads
// at +-0.75 texels), not a 2x2 box: a box snaps a small bright point to
// the coarse grid, so a moving dot's glow would jump a level's texel at a
// time; this filter keeps every point's center exactly. The B-spline
// read-back has no creases where a bilinear one would facet a big glow.
//
// The compositor runs this on the GPU (shaders.ts); simulate1d is the
// same pipeline on one row, so the tests measure what it draws.

/** The blur effect's old maximum: up to here the original single-scale
 * shader draws it, pixel for pixel as before. */
export const CLASSIC_BLUR_MAX = 100;

/** The blur effect's maximum amount: a 300-pixel radius at 1080p. */
export const BLUR_MAX = 500;

/** The blur effect's radius is 0.6 pixels at 1080p per unit of amount, and
 * twice its Gaussian's sigma (the original shader's mapping, kept). */
export const blurSigma = (amount: number) => Math.max(0, amount) * 0.3;

/** Amounts past the old maximum run on the pyramid. */
export const usesPyramid = (amount: number) => amount > CLASSIC_BLUR_MAX;

/** Taps either side of the center in the Gaussian, over three sigma. The
 * shader's loop is this. */
export const TAPS = 16;

export interface BlurPlan {
  /** Halvings before the Gaussian (0: at full size). */
  levels: number;
  /** The Gaussian's sigma at that level, in its texels. */
  sigma: number;
  /** Texels between taps: under about one, so no point is skipped. */
  step: number;
}

/** How to draw a Gaussian of `sigma` render pixels: halve until it is 3 to
 * 6 texels wide there (cheap, and still smooth when read back). */
export function blurPlan(sigma: number): BlurPlan {
  const levels = sigma < 6 ? 0 : Math.floor(Math.log2(sigma / 3));
  const d = 2 ** levels;
  // Variance already spent, in render pixels squared: a halving at level i
  // spreads by 0.75 of its source texel (2^(i-1) pixels) squared, the
  // B-spline read-back by a third of the last level's texel squared, and
  // taps between texels by a sixth of a texel squared on average.
  const spent = levels ? (4 ** levels - 1) / 4 + (d * d) / 3 : 0;
  const s = Math.sqrt(Math.max(sigma * sigma - spent - (d * d) / 6, 0)) / d;
  return { levels, sigma: s, step: (3 * s) / TAPS };
}

/** Tap i's weight (i from -TAPS to TAPS), before normalizing. */
export const tapWeight = (i: number) => Math.exp(-(((3 * i) / TAPS) ** 2) / 2);

// ---- a row through the same pipeline, for the tests -------------------------

const clampAt = (row: Float64Array, i: number) => row[Math.min(Math.max(i, 0), row.length - 1)];

/** Linear interpolation of `row` at texel coordinate x (texel centers at
 * integers), clamped at the ends as CLAMP_TO_EDGE does. */
function linear(row: Float64Array, x: number): number {
  const i = Math.floor(x), t = x - i;
  return clampAt(row, i) * (1 - t) + clampAt(row, i + 1) * t;
}

/** The cubic B-spline through `row` at x: what the read-back's four
 * bilinear reads add up to. */
function bspline(row: Float64Array, x: number): number {
  const i = Math.floor(x), t = x - i, t2 = t * t, t3 = t2 * t;
  const w = [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
  return w.reduce((acc, wk, k) => acc + wk * clampAt(row, i - 1 + k), 0);
}

/** A full-screen pass's place in its input for output texel j of n. */
const at = (j: number, n: number, from: number) => ((j + 0.5) * from) / n - 0.5;

/** One row of pixels blurred as the compositor blurs it: halvings, the
 * Gaussian, the read-back to full size. */
export function simulate1d(row: Float64Array, sigma: number): Float64Array {
  const plan = blurPlan(sigma);
  let level = row;
  for (let l = 1; l <= plan.levels; l++) {
    const n = Math.max(1, Math.ceil(row.length / 2 ** l)), src = level;
    // Texel offsets are the source's: +-0.75 of its texel either side.
    level = Float64Array.from({ length: n }, (_, j) => (linear(src, at(j, n, src.length) - 0.75) + linear(src, at(j, n, src.length) + 0.75)) / 2);
  }
  let wsum = 0;
  for (let i = -TAPS; i <= TAPS; i++) wsum += tapWeight(i);
  const blurred = level.map((_, j) => {
    let acc = 0;
    for (let i = -TAPS; i <= TAPS; i++) acc += tapWeight(i) * linear(level, j + i * plan.step);
    return acc / wsum;
  });
  return plan.levels ? Float64Array.from({ length: row.length }, (_, x) => bspline(blurred, at(x, row.length, blurred.length))) : blurred;
}
