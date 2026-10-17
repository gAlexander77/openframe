// Where a visual clip sits on the canvas, and the moves that align,
// distribute and snap it: CapCut's Transform align row, Premiere's align
// to selection, and the viewer's edge snapping share this geometry with
// the on-canvas handles, so a button and a drag agree to the pixel.
// Everything is in project pixels.

import { paramAt } from "./keyframes";
import { findClip, setParam, setUniformScale, updateClip } from "./project/ops";
import type { Clip, Id, Project, VisualClip } from "./project/types";
import { anchorShift, layerAt, type Layer } from "./render/plan";

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export const ALIGNS: Align[] = ["left", "center", "right", "top", "middle", "bottom"];
export type Axis = "horizontal" | "vertical";

// The picture's own size lives with the render plan, which also needs it.
export { setTextMeasure, sourceSize } from "./render/size";
import { sourceSize } from "./render/size";

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

/** The on-canvas box of a layer: crop moves its center (mirrored by a flip,
 * since the crop is cut from the source first: ADR-048), rotation widens
 * its extent. */
export function layerBox(p: Project, c: VisualClip, layer: Layer): Box {
  const src = sourceSize(p, c);
  const fit = src.native ? 1 : Math.min(p.width / src.w, p.height / src.h);
  const s = fit * layer.scale, sv = fit * (layer.scaleY ?? layer.scale);
  const { left, top, right, bottom } = layer.crop;
  const w = Math.abs(src.w * s * (1 - left - right));
  const h = Math.abs(src.h * sv * (1 - top - bottom));
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const sx = ((left - right) / 2) * src.w * s * (layer.flipX ? -1 : 1);
  const sy = ((top - bottom) / 2) * src.h * sv * (layer.flipY ? -1 : 1);
  return {
    cx: p.width / 2 + layer.x * p.width + cos * sx - sin * sy,
    cy: p.height / 2 + layer.y * p.height + sin * sx + cos * sy,
    w,
    h,
    hw: (Math.abs(cos) * w + Math.abs(sin) * h) / 2,
    hh: (Math.abs(sin) * w + Math.abs(cos) * h) / 2,
  };
}

/** The visible picture's width over its height at a frame (crop and
 * Scale Y included): what a mask's fractions are measured against. */
export function pictureAspect(p: Project, c: VisualClip, frame: number): number {
  const layer = layerAt(p, c, frame);
  const b = layer && layerBox(p, c, layer);
  return b && b.h > 0 ? b.w / b.h : p.width / p.height;
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
export function snapLines(p: Project, others: Box[], guides: "off" | "safe" | "thirds" | "both" = "off"): { x: number[]; y: number[] } {
  const x = [0, p.width / 2, p.width], y = [0, p.height / 2, p.height];
  // The viewer's guides catch too while they show (Premiere snaps to its
  // guides): the action (90%) and title (80%) safe edges, and the thirds.
  const at = (fs: number[]) => {
    for (const f of fs) x.push(p.width * f), y.push(p.height * f);
  };
  if (guides === "safe" || guides === "both") at([0.05, 0.1, 0.9, 0.95]);
  if (guides === "thirds" || guides === "both") at([1 / 3, 2 / 3]);
  for (const b of others) {
    x.push(b.cx - b.hw, b.cx, b.cx + b.hw);
    y.push(b.cy - b.hh, b.cy, b.cy + b.hh);
  }
  return { x, y };
}

/** Screen pixels within which a dragged edge or center catches a line. */
export const SNAP = 6;

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
    const sh = anchorShift(p, c, { ax: at("transform.anchorX"), ay: at("transform.anchorY"), scale: rest.scale, scaleY: rest.scaleY, rotation: rest.rotation });
    rest.x += sh.dx;
    rest.y += sh.dy;
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

/** Move pictures by whole pixels (the viewer's arrow keys), or by a
 * multi-selection's drag. */
export function nudgeClips(p: Project, ids: Id[], dx: number, dy: number, frame: number): Project {
  const items = boxesAt(p, ids, frame);
  return shift(p, items, items.map(() => ({ dx, dy })));
}

/** Clips the viewer shows at `frame`: under it, enabled, on a shown video
 * track. */
function shownAt(p: Project, frame: number): Set<Id> {
  const out = new Set<Id>();
  for (const t of p.tracks) {
    if (t.kind !== "video" || t.hidden) continue;
    for (const c of t.clips) if (!c.disabled && c.start <= frame && frame < c.start + c.duration) out.add(c.id);
  }
  return out;
}

/** The boxes of the visible pictures other than `except` at `frame`, as
 * drawn there: what a dragged box snaps to. */
export function otherBoxes(p: Project, frame: number, except: Id[]): Box[] {
  const shown = shownAt(p, frame);
  const out: Box[] = [];
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (!shown.has(c.id) || except.includes(c.id) || c.type === "audio" || c.type === "adjustment") continue;
      const l = layerAt(p, c, frame);
      if (l) out.push(layerBox(p, c, l));
    }
  }
  return out;
}

/** A multi-selection on the viewer: the selected pictures showing at
 * `frame`, at rest (ADR-045), and the one box around them all. */
export function groupBoxes(p: Project, ids: Id[], frame: number) {
  const shown = shownAt(p, frame);
  const items = boxesAt(p, ids.filter((id) => shown.has(id)), frame);
  if (!items.length) return null;
  const r = items.map((i) => rectOf(i.box)).reduce((a, b) => ({
    left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom),
  }));
  const hw = (r.right - r.left) / 2, hh = (r.bottom - r.top) / 2;
  const box: Box = { cx: r.left + hw, cy: r.top + hh, w: 2 * hw, h: 2 * hh, hw, hh };
  return { items, box };
}

/** Scale the showing pictures among `ids` together by `k` about their
 * combined center: each scale grows and each position moves out from the
 * center with it, so the arrangement scales as one (Premiere's and
 * CapCut's multi-selection corners). No picture goes below 1%. */
export function scaleClips(p: Project, ids: Id[], k: number, frame: number): Project {
  const g = groupBoxes(p, ids, frame);
  if (!g) return p;
  const at = (c: VisualClip, rel: number, path: string) => paramAt(c, path, rel);
  for (const { clip, rel } of g.items) k = Math.max(k, 0.01 / Math.max(1e-6, Math.min(at(clip, rel, "transform.scale"), clip.transform.scaleY === undefined ? Infinity : at(clip, rel, "transform.scaleY"))));
  const { cx, cy } = g.box;
  for (const { clip, rel } of g.items) {
    // The layer's center moves out from the group's center exactly as its
    // box's does: a crop's offset scales with the picture.
    const lx = p.width / 2 + at(clip, rel, "transform.x") * p.width, ly = p.height / 2 + at(clip, rel, "transform.y") * p.height;
    p = setParam(p, [clip.id], "transform.scale", +(at(clip, rel, "transform.scale") * k).toFixed(4), rel);
    if (clip.transform.scaleY !== undefined) p = setParam(p, [clip.id], "transform.scaleY", +(at(clip, rel, "transform.scaleY") * k).toFixed(4), rel);
    p = setParam(p, [clip.id], "transform.x", tidy((cx + k * (lx - cx) - p.width / 2) / p.width), rel);
    p = setParam(p, [clip.id], "transform.y", tidy((cy + k * (ly - cy) - p.height / 2) / p.height), rel);
  }
  return p;
}

/** Align one clip to the canvas, or several to their combined bounds, as
 * Premiere's Essential Graphics does. */
export function alignClips(p: Project, ids: Id[], edge: Align, frame: number, margin = 0): Project {
  const items = boxesAt(p, ids, frame);
  if (!items.length) return p;
  const mx = margin * p.width, my = margin * p.height;
  const to: Rect = items.length === 1
    ? { left: mx, top: my, right: p.width - mx, bottom: p.height - my }
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

/** A rectangle in fractions of a picture: x, y its top-left corner. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The uniform scale and position (canvas fractions from the center) that
 * show `r` of the clip's uncropped source filling the canvas (fit: all of
 * it inside). The picture slides back where it would uncover empty canvas,
 * so a region at the picture's edge zooms without a black band.
 */
export function regionTransform(p: Project, c: VisualClip, r: Region, mode: "fill" | "fit" = "fill") {
  const src = sourceSize(p, c);
  const fit = src.native ? 1 : Math.min(p.width / src.w, p.height / src.h);
  const kx = p.width / (r.w * src.w * fit), ky = p.height / (r.h * src.h * fit);
  const scale = mode === "fit" ? Math.min(kx, ky) : Math.max(kx, ky);
  const place = (center: number, shown: number, canvas: number) => {
    const v = (-(center - 0.5) * shown) / canvas;
    const room = (shown - canvas) / (2 * canvas); // before an edge shows
    return room < 0 ? v : Math.max(-room, Math.min(room, v));
  };
  return {
    scale: tidy(scale),
    x: tidy(place(r.x + r.w / 2, src.w * fit * scale, p.width)),
    y: tidy(place(r.y + r.h / 2, src.h * fit * scale, p.height)),
  };
}

const FRAMED = ["transform.scale", "transform.x", "transform.y"] as const;

/** Frame `r` (frame_region): static, or moving to `move.region` between two
 * clip-relative frames, easing in and out. Replaces those keyframes. */
export function frameRegion(p: Project, id: Id, r: Region, move: { region: Region; from: number; to: number } | undefined, mode: "fill" | "fit"): Project {
  p = setUniformScale(p, [id], true);
  const c = findClip(p, id)!.clip as VisualClip;
  const a = regionTransform(p, c, r, mode);
  const b = move && regionTransform(p, c, move.region, mode);
  return updateClip(p, id, (clip) => {
    const keys = { ...clip.keyframes };
    FRAMED.forEach((k, i) => {
      delete keys[k];
      const v = (t: typeof a) => [t.scale, t.x, t.y][i];
      if (b && move) keys[k] = [{ f: move.from, v: v(a), ease: "easeInOut" }, { f: move.to, v: v(b) }];
    });
    const transform = { ...(clip as VisualClip).transform, scale: a.scale, x: a.x, y: a.y };
    return { ...clip, transform, keyframes: Object.keys(keys).length ? keys : undefined } as Clip;
  });
}

export function distributeClips(p: Project, ids: Id[], axis: Axis, frame: number): Project {
  const items = boxesAt(p, ids, frame);
  return shift(p, items, distributeShifts(items.map((i) => i.box), axis));
}
