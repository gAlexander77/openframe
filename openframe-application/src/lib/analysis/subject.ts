// What a picture is about, for keeping it in frame when a version crops it
// to another shape (export_versions, ADR-097). Two classic saliency cues on
// a small frame, each cheap, deterministic and offline:
//
// - Minimum barrier distance (Zhang et al., ICCV 2015): a pixel stands out
//   by how high a "barrier" of color any path from it to the frame's border
//   must cross. Sky, sea and ground reach the border smoothly; a tower, a
//   boat or a person is walled off by its own edges.
// - Spectral residual (Hou and Zhang, CVPR 2007): what the picture's log
//   spectrum has beyond its smooth average, back in space, picks out the
//   small unusual thing (a boat on water) that a large, distinct region
//   (the island behind it) would outweigh by area alone.
//
// Each is normalized and they are summed. A window the version's size is
// then placed over the map: the most salience it keeps, the middle of the
// window counting more than its edges, so the subject sits inside rather
// than on the border. Through a shot the windows are chosen together, a
// pan costing in proportion to how far it moves, so the frame follows a
// subject that moves and holds still on one that does not.
//
// On the launch film's footage (docs/research/Versions keep the subject
// 2026-10-19.md) this keeps the Eiffel Tower, right of center, and the
// speedboat, left of center, that a center crop to 9:16 cut off.

/** A saliency map: `w` x `h` values, 0..1, row by row. */
export interface SaliencyMap {
  w: number;
  h: number;
  v: Float32Array;
}

/** A rectangle of the picture, fractions of its width and height. */
export interface Rect01 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const SRGB = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const f3 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** CIE L*a*b* of RGBA pixels, one plane each. */
function toLab(rgba: ArrayLike<number>, n: number): [Float32Array, Float32Array, Float32Array] {
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = SRGB[rgba[i * 4]], g = SRGB[rgba[i * 4 + 1]], b = SRGB[rgba[i * 4 + 2]];
    const fx = f3((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), fy = f3(0.2126 * r + 0.7152 * g + 0.0722 * b), fz = f3((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return [L, A, B];
}

/** The minimum barrier distance of every pixel of one plane from the
 * border: raster scans down and up, three times (the paper's FastMBD). */
export function barrierDistance(I: Float32Array, w: number, h: number, passes = 3): Float32Array {
  const n = w * h, U = Float32Array.from(I), Lo = Float32Array.from(I), D = new Float32Array(n).fill(Infinity);
  for (let x = 0; x < w; x++) D[x] = D[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) D[y * w] = D[y * w + w - 1] = 0;
  const relax = (i: number, j: number) => {
    const u = U[j] > I[i] ? U[j] : I[i], l = Lo[j] < I[i] ? Lo[j] : I[i];
    if (u - l < D[i]) {
      D[i] = u - l;
      U[i] = u;
      Lo[i] = l;
    }
  };
  for (let p = 0; p < passes; p++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) relax(y * w + x, y * w + x - 1), relax(y * w + x, (y - 1) * w + x);
    for (let y = h - 2; y > 0; y--) for (let x = w - 2; x > 0; x--) relax(y * w + x, y * w + x + 1), relax(y * w + x, (y + 1) * w + x);
  }
  for (let i = 0; i < n; i++) if (!Number.isFinite(D[i])) D[i] = 0;
  return D;
}

/** An in-place radix-2 FFT of one row or column. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}

function fft2(re: Float64Array, im: Float64Array, s: number, inverse: boolean) {
  const r = new Float64Array(s), i2 = new Float64Array(s);
  for (let pass = 0; pass < 2; pass++)
    for (let a = 0; a < s; a++) {
      const at = (b: number) => (pass === 0 ? a * s + b : b * s + a);
      for (let b = 0; b < s; b++) (r[b] = re[at(b)]), (i2[b] = im[at(b)]);
      fft(r, i2, inverse);
      for (let b = 0; b < s; b++) (re[at(b)] = r[b]), (im[at(b)] = i2[b]);
    }
}

/** The spectral residual of a lightness plane, on a 64 x 64 resampling with
 * its outer tenth tapered (a frame's edges would otherwise wrap round the
 * transform and light up), blurred and back at w x h. */
export function spectralResidual(L: Float32Array, w: number, h: number): Float32Array {
  const S = 64, n = S * S;
  const re = new Float64Array(n), im = new Float64Array(n);
  let mean = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) mean += re[y * S + x] = L[Math.floor(((y + 0.5) * h) / S) * w + Math.floor(((x + 0.5) * w) / S)];
  mean /= n;
  const taper = (k: number) => {
    const e = Math.min(k + 0.5, S - k - 0.5) / (S * 0.1);
    return e >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * e);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) re[y * S + x] = (re[y * S + x] - mean) * taper(x) * taper(y);
  fft2(re, im, S, false);
  const logA = new Float64Array(n), phase = new Float64Array(n);
  for (let i = 0; i < n; i++) (logA[i] = Math.log(Math.hypot(re[i], im[i]) + 1e-9)), (phase[i] = Math.atan2(im[i], re[i]));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let avg = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) avg += logA[((y + j + S) % S) * S + ((x + i + S) % S)];
      const m = Math.exp(logA[y * S + x] - avg / 9);
      re[y * S + x] = m * Math.cos(phase[y * S + x]);
      im[y * S + x] = m * Math.sin(phase[y * S + x]);
    }
  fft2(re, im, S, true);
  const sal = new Float64Array(n);
  for (let i = 0; i < n; i++) sal[i] = re[i] * re[i] + im[i] * im[i];
  // A box blur of 3 cells, then back to w x h.
  const blurred = new Float64Array(n);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let s = 0, k = 0;
      for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (y + j >= 0 && y + j < S && x + i >= 0 && x + i < S) (s += sal[(y + j) * S + x + i]), k++;
      blurred[y * S + x] = s / k;
    }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = blurred[Math.min(S - 1, Math.floor((y * S) / h)) * S + Math.min(S - 1, Math.floor((x * S) / w))];
  return out;
}

function normalize(v: Float32Array): Float32Array {
  let max = 0;
  for (const x of v) if (x > max) max = x;
  if (max > 0) for (let i = 0; i < v.length; i++) v[i] /= max;
  return v;
}

/** The saliency of a small RGBA frame (about 128 wide): the barrier
 * distance of its L*, a* and b* planes plus its spectral residual, each
 * normalized, the sum normalized to 0..1. */
export function saliencyMap(rgba: ArrayLike<number>, w: number, h: number): SaliencyMap {
  const n = w * h;
  const [L, A, B] = toLab(rgba, n);
  const mbd = new Float32Array(n);
  for (const plane of [L, A, B]) {
    const d = barrierDistance(plane, w, h);
    for (let i = 0; i < n; i++) mbd[i] += d[i];
  }
  const sr = normalize(spectralResidual(L, w, h));
  normalize(mbd);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = mbd[i] + sr[i];
  return { w, h, v: normalize(v) };
}

// ---- windows -------------------------------------------------------------------

/** Salience counts to the fourth power, so what stands out most decides
 * and a wide, fainter region (a horizon's haze, an island behind a boat)
 * does not outweigh it by area. */
const weight = (x: number) => x * x * x * x;

/** The salience along one axis inside `within` on the other: the column
 * sums (axis x) or row sums (axis y). */
function profile(map: SaliencyMap, axis: "x" | "y", within: Rect01): Float64Array {
  const { w, h, v } = map;
  const out = new Float64Array(axis === "x" ? w : h);
  const x0 = Math.floor(within.left * w), x1 = Math.ceil(within.right * w), y0 = Math.floor(within.top * h), y1 = Math.ceil(within.bottom * h);
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) out[axis === "x" ? x : y] += weight(v[y * w + x]);
  return out;
}

/** A window counts its middle most and its edges least (0.2 at the very
 * edge, 0.8 a tenth in from it), so the subject is placed toward the
 * middle rather than on the border. */
const edgeWeight = (u: number) => 0.2 + 0.8 * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));

/** The candidates a window's center can take on an axis: `steps` + 1 even
 * positions over the whole picture. */
export const CANDIDATES = 100;

/**
 * How good each center is for a window `size` wide (a fraction of the
 * picture, on `axis`) over `map`, kept inside `within`: the edge-weighted
 * salience it holds, normalized so the best is 1; -Infinity where the
 * window would leave `within`. Index i is the center i / CANDIDATES.
 */
export function windowScores(map: SaliencyMap, axis: "x" | "y", size: number, within: Rect01): Float64Array {
  if (!subjectBox(map, within)) {
    const centered = new Float64Array(CANDIDATES + 1).fill(-Infinity);
    const middle = axis === "x" ? (within.left + within.right) / 2 : (within.top + within.bottom) / 2;
    centered[Math.round(middle * CANDIDATES)] = 1;
    return centered;
  }
  const prof = profile(map, axis, within);
  const n = prof.length;
  const lo = axis === "x" ? within.left : within.top, hi = axis === "x" ? within.right : within.bottom;
  const scores = new Float64Array(CANDIDATES + 1).fill(-Infinity);
  // Too narrow a room for the window: its middle is the only place.
  const min = lo + size / 2, max = hi - size / 2;
  const valid = (c: number) => (max < min ? Math.abs(c - (lo + hi) / 2) <= 0.5 / CANDIDATES + 1e-9 : c >= min - 1e-9 && c <= max + 1e-9);
  let best = 0;
  for (let i = 0; i <= CANDIDATES; i++) {
    const c = i / CANDIDATES;
    if (!valid(c)) continue;
    let s = 0;
    const a = c - size / 2;
    for (let k = Math.max(0, Math.floor(a * n)); k < Math.min(n, Math.ceil((c + size / 2) * n)); k++) s += prof[k] * edgeWeight(((k + 0.5) / n - a) / size);
    scores[i] = s;
    best = Math.max(best, s);
  }
  if (best > 0) for (let i = 0; i <= CANDIDATES; i++) if (Number.isFinite(scores[i])) scores[i] /= best;
  // No valid candidate on the grid (a room narrower than a step): its middle.
  if (scores.every((s) => !Number.isFinite(s))) scores[Math.round(((lo + hi) / 2) * CANDIDATES)] = 1;
  return scores;
}

/** How much a frame moving costs, in samples' worth of salience per
 * picture width: a pan across the whole picture costs what two samples of
 * the best framing gain, so the frame follows a subject that moves and
 * does not wander after noise. */
export const PAN_COST = 2;

/**
 * The centers that keep the subject through a shot: one per sample, chosen
 * together (Viterbi over windowScores) so the frame holds still unless the
 * subject moves enough to pay for the pan, then smoothed. Fractions of the
 * picture on that axis.
 */
export function followPath(scores: Float64Array[], panCost = PAN_COST): number[] {
  if (!scores.length) return [];
  const N = CANDIDATES + 1;
  let total = Float64Array.from(scores[0]);
  const back: Int32Array[] = [];
  for (let k = 1; k < scores.length; k++) {
    const next = new Float64Array(N).fill(-Infinity), from = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(scores[k][i])) continue;
      let best = -Infinity, arg = 0;
      for (let j = 0; j < N; j++) {
        if (!Number.isFinite(total[j])) continue;
        const v = total[j] - (panCost * Math.abs(i - j)) / CANDIDATES;
        if (v > best) (best = v), (arg = j);
      }
      // A sample with no valid way in (its room jumped): start afresh there.
      next[i] = Number.isFinite(best) ? best + scores[k][i] : scores[k][i];
      from[i] = Number.isFinite(best) ? arg : i;
    }
    back.push(from);
    total = next;
  }
  let at = 0;
  for (let i = 1; i < N; i++) if (total[i] > total[at]) at = i;
  const path = [at];
  for (let k = back.length - 1; k >= 0; k--) path.unshift((at = back[k][at]));
  const c = path.map((i) => i / CANDIDATES);
  // A light binomial smoothing that keeps the ends.
  return c.map((x, i) => (i === 0 || i === c.length - 1 ? x : (c[i - 1] + 2 * x + c[i + 1]) / 4));
}

/** The subject of a frame: the blob of high salience (over 60% of the
 * peak, 4-connected) holding the most of it, as a box of the picture. */
export function subjectBox(map: SaliencyMap, within: Rect01 = { left: 0, top: 0, right: 1, bottom: 1 }): (Rect01 & { mass: number }) | null {
  const { w, h, v } = map;
  const x0 = Math.max(0, Math.floor(within.left * w)), x1 = Math.min(w, Math.ceil(within.right * w)), y0 = Math.max(0, Math.floor(within.top * h)), y1 = Math.min(h, Math.ceil(within.bottom * h));
  let peak = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) peak = Math.max(peak, v[y * w + x]);
  if (peak <= 0) return null;
  const on = (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1 && v[y * w + x] >= 0.6 * peak;
  const seen = new Uint8Array(w * h);
  let best: (Rect01 & { mass: number }) | null = null;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (!on(x, y) || seen[y * w + x]) continue;
      const stack = [y * w + x];
      seen[y * w + x] = 1;
      let mass = 0, l = x, r = x, t = y, b = y;
      while (stack.length) {
        const i = stack.pop()!, px = i % w, py = (i - px) / w;
        mass += weight(v[i]);
        l = Math.min(l, px), r = Math.max(r, px), t = Math.min(t, py), b = Math.max(b, py);
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]])
          if (on(nx, ny) && !seen[ny * w + nx]) (seen[ny * w + nx] = 1), stack.push(ny * w + nx);
      }
      if (!best || mass > best.mass) best = { left: l / w, right: (r + 1) / w, top: t / h, bottom: (b + 1) / h, mass };
    }
  // No dominant component in repeating foam, or almost the whole frame
  // salient: neither is a reliable subject to crop around (ADR-135).
  let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) total += weight(v[y * w + x]);
  if (!best || best.mass < total * 0.18 || (best.right - best.left) * (best.bottom - best.top) > (within.right - within.left) * (within.bottom - within.top) * 0.65) return null;
  return best;
}

/** The share of a box inside a window, each a rect of the picture. */
export function shareInside(box: Rect01, win: Rect01): number {
  const w = Math.max(0, Math.min(box.right, win.right) - Math.max(box.left, win.left)), h = Math.max(0, Math.min(box.bottom, win.bottom) - Math.max(box.top, win.top));
  const area = (box.right - box.left) * (box.bottom - box.top);
  return area > 0 ? (w * h) / area : 1;
}
