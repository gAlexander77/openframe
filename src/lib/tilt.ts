// Perspective tilt (ADR-070): a picture turned about its own horizontal
// (transform.rotateX) and vertical (transform.rotateY) axes and seen
// through a camera transform.perspective pixels (at 1080p) in front of
// the canvas center, as CSS rotateX/rotateY under a perspective do. A
// flat picture stays flat, so its quad maps to the screen by a
// homography: the compositor draws it with that matrix and the GPU
// interpolates the picture perspective-correctly.

import { paramAt } from "./keyframes";
import type { VisualClip } from "./project/types";

/** The camera's distance when none is set: pixels at 1080p. */
export const DEFAULT_PERSPECTIVE = 2000;

/** Tilts are kept short of edge-on, where the picture vanishes. */
export const TILT_MAX = 89;

/** Paths that keyframe, as transform.<name>. */
export const TILT_PARAMS = ["rotateX", "rotateY", "perspective"] as const;

export interface Tilt {
  /** Degrees: positive x tips the top away, positive y turns the right
   * side away (CSS rotateX, rotateY). */
  x: number;
  y: number;
  /** The camera's distance, pixels at 1080p. */
  distance: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The clip's tilt at frame `r`, or undefined when it lies flat. */
export function resolveTilt(clip: VisualClip, r: number): Tilt | undefined {
  const x = clamp(paramAt(clip, "transform.rotateX", r), -TILT_MAX, TILT_MAX);
  const y = clamp(paramAt(clip, "transform.rotateY", r), -TILT_MAX, TILT_MAX);
  if (!x && !y) return undefined;
  const d = paramAt(clip, "transform.perspective", r);
  return { x, y, distance: clamp(d > 0 ? d : DEFAULT_PERSPECTIVE, 100, 100000) };
}

/** A picture's placement on a W x H canvas, in pixels (y down): its
 * center, the visible size along its own axes (signed: a flip is
 * negative), the crop's shift of the visible part and the turn in the
 * canvas plane (degrees, clockwise). */
export interface Quad {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  shiftX: number;
  shiftY: number;
  rotation: number;
}

/**
 * The column-major 3x3 matrix taking a layer point (a, b, 1), a and b
 * 0..1 across the picture, to clip-space homogeneous coordinates
 * (x, y, w) on a W x H canvas, the picture tilted by `t` (`distance` in
 * canvas pixels). The tilt turns the picture about its center: rotateY,
 * then rotateX, then the turn in the plane, as CSS composes them.
 */
export function tiltMatrix(q: Quad, t: Tilt, W: number, H: number): number[] {
  const r = (deg: number) => (deg * Math.PI) / 180;
  const [cz, sz] = [Math.cos(r(q.rotation)), Math.sin(r(q.rotation))];
  const [cxr, sxr] = [Math.cos(r(t.x)), Math.sin(r(t.x))];
  const [cyr, syr] = [Math.cos(r(t.y)), Math.sin(r(t.y))];
  // M = Rz * Rx * Ry, z toward the camera.
  const ry = [[cyr, 0, syr], [0, 1, 0], [-syr, 0, cyr]];
  const rx = [[1, 0, 0], [0, cxr, -sxr], [0, sxr, cxr]];
  const rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (a: number[][], b: number[][]) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const m = mul(rz, mul(rx, ry));
  const apply = (v: number[]) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
  // The picture's point (a, b) is O + a A + b B in 3D, pixels.
  const A = apply([q.sx, 0, 0]);
  const B = apply([0, q.sy, 0]);
  const L0 = apply([-0.5 * q.sx + q.shiftX, -0.5 * q.sy + q.shiftY, 0]);
  const O = [q.cx + L0[0], q.cy + L0[1], L0[2]];
  // Seen from `distance` in front of the canvas center: a point at depth z
  // lands at center + (p - center) * d / (d - z). Homogeneous, over d:
  // (p - center * z / d, 1 - z / d), then to clip space.
  const d = t.distance, mx = W / 2, my = H / 2;
  const col = (v: number[], one: number) => {
    const w = one - v[2] / d;
    const X = v[0] - (mx * v[2]) / d, Y = v[1] - (my * v[2]) / d;
    return [(X * 2) / W - w, -(Y * 2) / H + w, w];
  };
  return [...col(A, 0), ...col(B, 0), ...col(O, 1)];
}
