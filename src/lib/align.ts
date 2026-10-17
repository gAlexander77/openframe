// Where a visual clip sits on the canvas, and the moves that align,
// distribute and snap it: CapCut's Transform align row, Premiere's align
// to selection, and the viewer's edge snapping share this geometry with
// the on-canvas handles, so a button and a drag agree to the pixel.
// Everything is in project pixels.

import { paramAt } from "./keyframes";
import { findClip, getAsset, setParam, setUniformScale } from "./project/ops";
import type { Id, Project, TextClip, VisualClip } from "./project/types";
import { layerAt, type Layer } from "./render/plan";

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export const ALIGNS: Align[] = ["left", "center", "right", "top", "middle", "bottom"];
export type Axis = "horizontal" | "vertical";

/** A text clip's raster size. The engine registers its rasterizer at load;
 * without one (unit tests) a box from the style stands in. */
let measureText = (c: TextClip, w: number, h: number) => ({
  width: c.style.maxWidth * w,
  height: ((c.style.size * h) / 1080) * c.style.lineHeight * Math.max(1, c.text.split("\n").length),
});
export function setTextMeasure(fn: typeof measureText) {
  measureText = fn;
}

/** Size of a clip's source in project pixels before transform, and whether
 * it keeps its native size (text, color) or fits the canvas (media). */
export function sourceSize(p: Project, c: VisualClip): { w: number; h: number; native: boolean } {
  if (c.type === "color") return { w: p.width, h: p.height, native: true };
  if (c.type === "text") {
    const r = measureText(c, p.width, p.height);
    return { w: r.width, h: r.height, native: true };
  }
  const a = getAsset(p, c.assetId);
  return { w: a?.width || p.width, h: a?.height || p.height, native: false };
}

export interface Box {
  /** Center. */
  cx: number;
  cy: number;
  /** The cropped picture's own size, before rotation. */
  w: number;
  h: number;
  /** Half the axis-aligned extent, after rotation. */
  hw: number;
  hh: number;
}

/** The on-canvas box of a layer: crop moves its center, rotation widens its
 * extent. */
export function layerBox(p: Project, c: VisualClip, layer: Layer): Box {
  const src = sourceSize(p, c);
  const fit = src.native ? 1 : Math.min(p.width / src.w, p.height / src.h);
  const s = fit * layer.scale, sv = fit * (layer.scaleY ?? layer.scale);
  const { left, top, right, bottom } = layer.crop;
  const w = Math.abs(src.w * s * (1 - left - right));
  const h = Math.abs(src.h * sv * (1 - top - bottom));
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const sx = ((left - right) / 2) * src.w * s;
  const sy = ((top - bottom) / 2) * src.h * sv;
  return {
    cx: p.width / 2 + layer.x * p.width + cos * sx - sin * sy,
    cy: p.height / 2 + layer.y * p.height + sin * sx + cos * sy,
    w,
    h,
    hw: (Math.abs(cos) * w + Math.abs(sin) * h) / 2,
    hh: (Math.abs(sin) * w + Math.abs(cos) * h) / 2,
  };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const rectOf = (b: Box): Rect => ({ left: b.cx - b.hw, top: b.cy - b.hh, right: b.cx + b.hw, bottom: b.cy + b.hh });

/** Pixels to move `b` so it sits against `edge` of `to`. */
export function alignShift(b: Box, edge: Align, to: Rect): { dx: number; dy: number } {
  const r = rectOf(b);
  switch (edge) {
    case "left": return { dx: to.left - r.left, dy: 0 };
    case "center": return { dx: (to.left + to.right) / 2 - b.cx, dy: 0 };
    case "right": return { dx: to.right - r.right, dy: 0 };
    case "top": return { dx: 0, dy: to.top - r.top };
    case "middle": return { dx: 0, dy: (to.top + to.bottom) / 2 - b.cy };
    case "bottom": return { dx: 0, dy: to.bottom - r.bottom };
  }
}

/** Shifts that space boxes evenly between the outermost two, with equal
 * gaps between neighbors (Figma's and Illustrator's distribute spacing).
 * Fewer than three boxes stay put. */
export function distributeShifts(boxes: Box[], axis: Axis): { dx: number; dy: number }[] {
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const h = axis === "horizontal";
  const c = (b: Box) => (h ? b.cx : b.cy);
  const half = (b: Box) => (h ? b.hw : b.hh);
  const order = boxes.map((_, i) => i).sort((a, b) => c(boxes[a]) - c(boxes[b]));
  const first = boxes[order[0]], last = boxes[order[order.length - 1]];
  const span = c(last) + half(last) - (c(first) - half(first));
  const gap = (span - boxes.reduce((s, b) => s + 2 * half(b), 0)) / (boxes.length - 1);
  let edge = c(first) - half(first);
  for (const i of order) {
    const want = edge + half(boxes[i]);
    out[i] = h ? { dx: want - c(boxes[i]), dy: 0 } : { dx: 0, dy: want - c(boxes[i]) };
    edge += 2 * half(boxes[i]) + gap;
  }
  return out;
}

/** Lines a moving box catches on: the canvas edges and center, and the
 * edges and centers of the other boxes. */
export function snapLines(p: Project, others: Box[]): { x: number[]; y: number[] } {
  const x = [0, p.width / 2, p.width], y = [0, p.height / 2, p.height];
  for (const b of others) {
    x.push(b.cx - b.hw, b.cx, b.cx + b.hw);
    y.push(b.cy - b.hh, b.cy, b.cy + b.hh);
  }
  return { x, y };
}

/** The nearest line within `tol` of the box's edges or center, per axis:
 * the extra shift to land on it and the line, for the guide. */
export function snapBox(b: Box, lines: { x: number[]; y: number[] }, tol: number) {
  const best = (mine: number[], theirs: number[]) => {
    let hit: { d: number; at: number } | null = null;
    for (const m of mine) for (const t of theirs) if (Math.abs(t - m) <= tol && (!hit || Math.abs(t - m) < Math.abs(hit.d))) hit = { d: t - m, at: t };
    return hit;
  };
  const x = best([b.cx - b.hw, b.cx, b.cx + b.hw], lines.x);
  const y = best([b.cy - b.hh, b.cy, b.cy + b.hh], lines.y);
  return { dx: x?.d ?? 0, dy: y?.d ?? 0, gx: x?.at, gy: y?.at };
}

/** The visual clips among `ids` that can move, each with its box at the
 * frame nearest `frame` inside it (the playhead, for clips under it;
 * -Infinity for each clip's first frame). */
export function boxesAt(p: Project, ids: Id[], frame: number) {
  const out: { clip: VisualClip; rel: number; box: Box }[] = [];
  for (const id of ids) {
    const loc = findClip(p, id);
    if (!loc || loc.track.locked) continue;
    const c = loc.clip;
    if (c.type === "audio" || c.type === "adjustment") continue;
    const f = Math.min(Math.max(frame, c.start), c.start + c.duration - 1), rel = f - c.start;
    const layer = layerAt(p, c, f);
    if (!layer) continue;
    // The resting transform: an in or out animation's offsets pass by.
    const at = (path: string) => paramAt(c, path, rel);
    const rest = { ...layer, x: at("transform.x"), y: at("transform.y"), scale: at("transform.scale"), rotation: at("transform.rotation") };
    if (c.transform.scaleY !== undefined) rest.scaleY = at("transform.scaleY");
    out.push({ clip: c, rel, box: layerBox(p, c, rest) });
  }
  return out;
}

/** A position without float dust: centered reads 0, not -2.8e-17 (a
 * millionth of the canvas is far below a pixel). */
export const tidy = (v: number) => Math.round(v * 1e6) / 1e6 || 0;

/** Move clips by pixel shifts through their transform (a keyframe at `rel`
 * where the position is animated). */
function shift(p: Project, items: { clip: VisualClip; rel: number }[], shifts: { dx: number; dy: number }[]): Project {
  items.forEach(({ clip, rel }, i) => {
    const { dx, dy } = shifts[i];
    if (Math.abs(dx) > 1e-6) p = setParam(p, [clip.id], "transform.x", tidy(paramAt(clip, "transform.x", rel) + dx / p.width), rel);
    if (Math.abs(dy) > 1e-6) p = setParam(p, [clip.id], "transform.y", tidy(paramAt(clip, "transform.y", rel) + dy / p.height), rel);
  });
  return p;
}

/** Move pictures by whole pixels (the viewer's arrow keys). */
export function nudgeClips(p: Project, ids: Id[], dx: number, dy: number, frame: number): Project {
  const items = boxesAt(p, ids, frame);
  return shift(p, items, items.map(() => ({ dx, dy })));
}

/** Align one clip to the canvas, or several to their combined bounds, as
 * Premiere's Essential Graphics does. */
export function alignClips(p: Project, ids: Id[], edge: Align, frame: number): Project {
  const items = boxesAt(p, ids, frame);
  if (!items.length) return p;
  const to: Rect = items.length === 1
    ? { left: 0, top: 0, right: p.width, bottom: p.height }
    : items.map((i) => rectOf(i.box)).reduce((a, r) => ({
        left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom),
      }));
  return shift(p, items, items.map((i) => alignShift(i.box, edge, to)));
}

export type Frame = "fit" | "fill" | "stretch";

/** Resolve's and Premiere's framing: fit shows the whole (cropped) picture,
 * fill covers the canvas and crops the overflow, stretch covers it exactly
 * and gives up the proportions. Each centers the picture. */
export function frameClips(p: Project, ids: Id[], mode: Frame, frame: number): Project {
  for (const { clip, rel } of boxesAt(p, ids, frame)) {
    const src = sourceSize(p, clip);
    const fit = src.native ? 1 : Math.min(p.width / src.w, p.height / src.h);
    const { left, top, right, bottom } = clip.crop;
    const kx = p.width / (src.w * fit * Math.max(0.01, 1 - left - right));
    const ky = p.height / (src.h * fit * Math.max(0.01, 1 - top - bottom));
    p = setUniformScale(p, [clip.id], mode !== "stretch");
    if (mode === "stretch") {
      p = setParam(p, [clip.id], "transform.scale", tidy(kx), rel);
      p = setParam(p, [clip.id], "transform.scaleY", tidy(ky), rel);
    } else p = setParam(p, [clip.id], "transform.scale", tidy(mode === "fit" ? Math.min(kx, ky) : Math.max(kx, ky)), rel);
    p = alignClips(p, [clip.id], "center", frame);
    p = alignClips(p, [clip.id], "middle", frame);
  }
  return p;
}

export function distributeClips(p: Project, ids: Id[], axis: Axis, frame: number): Project {
  const items = boxesAt(p, ids, frame);
  return shift(p, items, distributeShifts(items.map((i) => i.box), axis));
}
