// Stabilization (CapCut's Stabilize, Premiere's Warp Stabilizer in its
// "position" mode): measure how far each frame moved from the last by phase
// correlation on small gray frames, smooth the camera's path with a
// Gaussian, and store the per-frame correction that moves each frame onto
// the smooth path, with just enough zoom that no edge shows.
// ponytail: translation only. Handheld roll and zoom wobble remain; a
// feature-based similarity fit (rotation and scale) is the upgrade.

import { fft } from "./beats";
import type { Stabilize } from "../project/types";

/** Analysis frames: a power of two each way for the FFT. */
export const AW = 128;
export const AH = 64;

export type StabilizeLevel = "least-crop" | "recommended" | "most-stable";
/** Smoothing (frames, at 30 fps) and the most zoom each level may use. */
export const LEVELS: Record<StabilizeLevel, { label: string; sigma: number; maxZoom: number }> = {
  "least-crop": { label: "Least cropping", sigma: 8, maxZoom: 1.08 },
  recommended: { label: "Recommended", sigma: 20, maxZoom: 1.15 },
  "most-stable": { label: "Most stable", sigma: 45, maxZoom: 1.3 },
};

const hann2 = (() => {
  const w = new Float64Array(AW * AH);
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) w[y * AW + x] = (0.5 - 0.5 * Math.cos((2 * Math.PI * x) / AW)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * y) / AH));
  return w;
})();

function fft2(re: Float64Array, im: Float64Array) {
  const rr = new Float64Array(AW), ri = new Float64Array(AW);
  for (let y = 0; y < AH; y++) {
    rr.set(re.subarray(y * AW, y * AW + AW));
    ri.set(im.subarray(y * AW, y * AW + AW));
    fft(rr, ri);
    re.set(rr, y * AW);
    im.set(ri, y * AW);
  }
  const cr = new Float64Array(AH), ci = new Float64Array(AH);
  for (let x = 0; x < AW; x++) {
    for (let y = 0; y < AH; y++) {
      cr[y] = re[y * AW + x];
      ci[y] = im[y * AW + x];
    }
    fft(cr, ci);
    for (let y = 0; y < AH; y++) {
      re[y * AW + x] = cr[y];
      im[y * AW + x] = ci[y];
    }
  }
}

/** A frame's spectrum: gray AW x AH, mean removed, windowed. */
export function spectrum(gray: Float32Array | Uint8Array): { re: Float64Array; im: Float64Array } {
  let mean = 0;
  for (let i = 0; i < gray.length; i++) mean += gray[i];
  mean /= gray.length;
  const re = new Float64Array(AW * AH), im = new Float64Array(AW * AH);
  for (let i = 0; i < re.length; i++) re[i] = (gray[i] - mean) * hann2[i];
  fft2(re, im);
  return { re, im };
}

/** How far `b`'s picture moved from `a`'s, in analysis pixels (sub-pixel). */
export function shiftBetween(a: { re: Float64Array; im: Float64Array }, b: { re: Float64Array; im: Float64Array }): { dx: number; dy: number } {
  const re = new Float64Array(AW * AH), im = new Float64Array(AW * AH);
  for (let i = 0; i < re.length; i++) {
    // Cross-power spectrum of b against a, normalized: only phase is left.
    const r = b.re[i] * a.re[i] + b.im[i] * a.im[i];
    const m = b.im[i] * a.re[i] - b.re[i] * a.im[i];
    const mag = Math.hypot(r, m) || 1;
    re[i] = r / mag;
    im[i] = -m / mag; // conjugate, so the forward FFT inverts
  }
  fft2(re, im);
  let best = 0, bx = 0, by = 0;
  for (let i = 0; i < re.length; i++) {
    if (re[i] > best) {
      best = re[i];
      bx = i % AW;
      by = (i / AW) | 0;
    }
  }
  const at = (x: number, y: number) => re[((y + AH) % AH) * AW + ((x + AW) % AW)];
  // A parabola through the peak and its neighbors finds the fraction.
  const frac = (l: number, c: number, r: number) => (l - r) / (2 * (l - 2 * c + r) || 1);
  let dx = bx + frac(at(bx - 1, by), best, at(bx + 1, by));
  let dy = by + frac(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > AW / 2) dx -= AW;
  if (dy > AH / 2) dy -= AH;
  return { dx, dy };
}

export function gaussian(xs: number[], sigma: number): number[] {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  return xs.map((_, i) => {
    let s = 0, w = 0;
    const n = xs.length;
    for (let j = -r; j <= r; j++) {
      // Past the ends, reflect through the end point: a steady pan carries
      // on straight instead of bending back.
      const t = i + j;
      const v = t < 0 ? 2 * xs[0] - xs[Math.min(-t, n - 1)] : t >= n ? 2 * xs[n - 1] - xs[Math.max(2 * n - 2 - t, 0)] : xs[t];
      s += v * k[j + r];
      w += k[j + r];
    }
    return s / w;
  });
}

/** The correction for the source frame showing at second `t`. Per frame,
 * never blended: shake can reverse every frame, and a quarter of the next
 * frame's correction (the plan looks a quarter frame in) undid a quarter. */
export function correctionAt(s: Stabilize, t: number): { x: number; y: number } {
  const n = s.x.length;
  if (!n) return { x: 0, y: 0 };
  const i = Math.min(Math.max(Math.floor((t - s.from) * s.rate + 0.5), 0), n - 1);
  return { x: s.x[i], y: s.y[i] };
}

export interface Stabilization {
  /** Per analyzed frame: the move onto the smooth path, in fractions of the
   * picture's width and height. */
  x: number[];
  y: number[];
  /** Scale that keeps the moved picture covering its frame. */
  zoom: number;
}

/** Corrections from frame-to-frame motion (analysis pixels). `fps` scales
 * the level's smoothing to the footage's rate. */
export function stabilization(moves: { dx: number; dy: number }[], level: StabilizeLevel, fps = 30): Stabilization {
  const { sigma, maxZoom } = LEVELS[level];
  const px: number[] = [0], py: number[] = [0];
  for (const m of moves) {
    px.push(px[px.length - 1] + m.dx / AW);
    py.push(py[py.length - 1] + m.dy / AH);
  }
  const s = sigma * (fps / 30);
  const sx = gaussian(px, s), sy = gaussian(py, s);
  let x = sx.map((v, i) => v - px[i]);
  let y = sy.map((v, i) => v - py[i]);
  const need = 1 + 2 * Math.max(0, ...x.map(Math.abs), ...y.map(Math.abs));
  const zoom = Math.min(need, maxZoom);
  // Past the zoom's margin a correction would show an edge: hold it there.
  const room = (zoom - 1) / 2;
  const clamp = (v: number) => Math.max(-room, Math.min(room, v));
  x = x.map((v) => +clamp(v).toFixed(5));
  y = y.map((v) => +clamp(v).toFixed(5));
  return { x, y, zoom: +zoom.toFixed(4) };
}
