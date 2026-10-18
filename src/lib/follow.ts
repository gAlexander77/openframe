// Pinning a layer to a tracked subject (CapCut's Tracking). The tracker
// (analysis/track.ts) gives the subject's path in the source picture; this
// carries it onto the canvas through the followed clip's own transform at
// each frame (its keyframes, stabilization and anchor included) and writes
// the pinned layer's position as keyframes, so it moves with the subject
// and stays editable. Position only: the layer keeps its scale and angle.

import { thin } from "./analysis/track";
import { paramAt } from "./keyframes";
import { updateClip } from "./project/ops";
import type { Clip, Id, Keyframe, Project, VideoClip, VisualClip } from "./project/types";
import { layerAt, type Layer } from "./render/plan";
import { fittedSize } from "./render/size";

/** A subject's path: source seconds, and its center in fractions of the
 * uncropped source picture. */
export interface Path {
  times: number[];
  x: number[];
  y: number[];
}

/** Canvas pixels of a point of the clip's picture (fractions of its
 * uncropped source), as `layer` places it. */
export function onCanvas(p: Project, c: VisualClip, layer: Layer, u: number, v: number) {
  const { w, h } = fittedSize(p, c);
  const lx = (u - 0.5) * w * layer.scale * (layer.flipX ? -1 : 1);
  const ly = (v - 0.5) * h * (layer.scaleY ?? layer.scale) * (layer.flipY ? -1 : 1);
  const rad = (layer.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  return { x: p.width * (0.5 + layer.x) + cos * lx - sin * ly, y: p.height * (0.5 + layer.y) + sin * lx + cos * ly };
}

/** The picture point (source fractions) under canvas pixel (x, y). */
export function inSource(p: Project, c: VisualClip, layer: Layer, x: number, y: number) {
  const { w, h } = fittedSize(p, c);
  const dx = x - p.width * (0.5 + layer.x), dy = y - p.height * (0.5 + layer.y);
  const rad = (layer.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const lx = cos * dx + sin * dy, ly = -sin * dx + cos * dy;
  return { u: 0.5 + lx / (w * layer.scale * (layer.flipX ? -1 : 1)), v: 0.5 + ly / (h * (layer.scaleY ?? layer.scale) * (layer.flipY ? -1 : 1)) };
}

/** The path's point at source second t: linear between samples, held
 * past either end. */
export function pointAt(path: Path, t: number): { x: number; y: number } {
  const { times } = path;
  const n = times.length;
  if (t <= times[0] || n === 1) return { x: path.x[0], y: path.y[0] };
  if (t >= times[n - 1]) return { x: path.x[n - 1], y: path.y[n - 1] };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return { x: path.x[lo] + (path.x[hi] - path.x[lo]) * k, y: path.y[lo] + (path.y[hi] - path.y[lo]) * k };
}

const tidy = (v: number) => Math.round(v * 1e5) / 1e5 || 0;

/** A binomial (1 4 6 4 1) smoothing that leaves the ends where they are:
 * the tracker's sub-pixel jitter would otherwise wobble the layer and keep
 * a keyframe on every frame. */
export function smooth(v: number[]): number[] {
  return v.map((x, i) => {
    if (i === 0 || i === v.length - 1) return x;
    if (i === 1 || i === v.length - 2) return (v[i - 1] + 2 * x + v[i + 1]) / 4;
    return (v[i - 2] + 4 * v[i - 1] + 6 * x + 4 * v[i + 1] + v[i + 2]) / 16;
  });
}

/**
 * Position keyframes (clip-relative frames) that move `target` with the
 * path from timeline frame `from` to the end of the shorter clip: its
 * position there plus how far the subject has moved on the canvas since.
 * Smoothed, then thinned to within a canvas pixel.
 */
export function pinKeys(p: Project, video: VideoClip, path: Path, target: VisualClip, from: number): { x: Keyframe[]; y: Keyframe[] } {
  const end = Math.min(video.start + video.duration, target.start + target.duration);
  const at = (f: number) => {
    const l = layerAt(p, video, f);
    if (!l || l.source.kind !== "video") return null;
    const q = pointAt(path, l.source.time);
    return onCanvas(p, video, l, q.x, q.y);
  };
  const ref = at(from);
  if (!ref) return { x: [], y: [] };
  const x0 = paramAt(target, "transform.x", from - target.start), y0 = paramAt(target, "transform.y", from - target.start);
  const fs: number[] = [], xs: number[] = [], ys: number[] = [];
  for (let f = from; f < end; f++) {
    const q = at(f);
    if (!q) continue;
    fs.push(f - target.start);
    xs.push(x0 + (q.x - ref.x) / p.width);
    ys.push(y0 + (q.y - ref.y) / p.height);
  }
  const sx = smooth(xs), sy = smooth(ys);
  const keep = [...new Set([...thin(sx, 1 / p.width), ...thin(sy, 1 / p.height)])].sort((a, b) => a - b);
  return { x: keep.map((i) => ({ f: fs[i], v: tidy(sx[i]) })), y: keep.map((i) => ({ f: fs[i], v: tidy(sy[i]) })) };
}

/** Write pinned keys on the target: they replace its position keys from
 * their first frame on; earlier ones stay. */
export function pin(p: Project, targetId: Id, keys: { x: Keyframe[]; y: Keyframe[] }): Project {
  if (!keys.x.length) return p;
  const from = keys.x[0].f;
  return updateClip(p, targetId, (c) => {
    const k = { ...c.keyframes };
    k["transform.x"] = [...(k["transform.x"] ?? []).filter((x) => x.f < from), ...keys.x];
    k["transform.y"] = [...(k["transform.y"] ?? []).filter((x) => x.f < from), ...keys.y];
    return { ...c, keyframes: k } as Clip;
  });
}
