import { fittedSize } from "./render/size";
import { createColorClip, uid } from "./project/defaults";
import { findClip, updateClip } from "./project/ops";
import { placeStack } from "./overlays";
import type { Project, VisualClip } from "./project/types";

export const LAYOUTS = ["split-vertical", "split-horizontal", "grid-2x2", "triptych", "pip-top-right", "pip-top-left", "pip-bottom-right", "pip-bottom-left", "pip-center-card"] as const;
export type Layout = typeof LAYOUTS[number];
export interface Cell { x: number; y: number; w: number; h: number }
export interface LayoutOptions { gap?: number; margin?: number; radius?: number; border?: { width: number; color: string }; animate?: "none" | "slide" | "scale" }

/** Gap and margin are fractions of the shorter canvas side: equal pixel gutters. */
export function layoutCells(layout: Layout, count: number, width: number, height: number, gap = 0.02, margin = 0.04): Cell[] {
  if (!LAYOUTS.includes(layout) || !Number.isInteger(count) || count < 2 || count > 4) throw new Error("Choose a layout and 2 to 4 distinct visual clips");
  if (layout === "triptych" && count !== 3) throw new Error("Triptych needs exactly 3 clips");
  if (![width, height, gap, margin].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0 || margin < 0) throw new Error("Invalid canvas, gap or margin");
  const unit = Math.min(width, height), g = gap * unit, m = margin * unit;
  const w = width - 2 * m, h = height - 2 * m;
  let cells: Cell[];
  if (layout.startsWith("pip-")) {
    const center = layout === "pip-center-card";
    const cw = w * (center ? 0.64 : 0.32), ch = (h * (center ? 0.64 : 0.48) - g * (count - 2)) / (count - 1);
    const total = ch * (count - 1) + g * (count - 2);
    const x = center ? (width - cw) / 2 : layout.endsWith("left") ? m : width - m - cw;
    const y = center ? (height - total) / 2 : layout.includes("bottom") ? height - m - total : m;
    cells = [{ x: 0, y: 0, w: width, h: height }, ...Array.from({ length: count - 1 }, (_, i) => ({ x, y: y + i * (ch + g), w: cw, h: ch }))];
  } else {
    const cols = layout === "split-horizontal" ? 1 : layout === "grid-2x2" ? 2 : count;
    const rows = layout === "split-horizontal" ? count : layout === "grid-2x2" ? 2 : 1;
    const cw = (w - g * (cols - 1)) / cols, ch = (h - g * (rows - 1)) / rows;
    cells = Array.from({ length: count }, (_, i) => ({ x: m + (i % cols) * (cw + g), y: m + Math.floor(i / cols) * (ch + g), w: cw, h: ch }));
  }
  if (cells.some(c => c.w <= 0 || c.h <= 0)) throw new Error("Gap and margin leave no room for cells");
  return cells;
}

export function coverCell(source: { w: number; h: number }, cell: Cell, width: number, height: number) {
  const scale = Math.max(cell.w / source.w, cell.h / source.h);
  const x = Math.max(0, (1 - cell.w / (source.w * scale)) / 2), y = Math.max(0, (1 - cell.h / (source.h * scale)) / 2);
  return { scale, x: (cell.x + cell.w / 2) / width - 0.5, y: (cell.y + cell.h / 2) / height - 0.5, crop: { left: x, right: x, top: y, bottom: y } };
}

export function applyLayout(p: Project, ids: string[], layout: Layout, options: LayoutOptions = {}): Project {
  if (new Set(ids).size !== ids.length) throw new Error("Clip ids must be distinct");
  const cells = layoutCells(layout, ids.length, p.width, p.height, options.gap, options.margin);
  const clips = ids.map(id => {
    const loc = findClip(p, id);
    if (!loc || !("transform" in loc.clip) || loc.track.locked || loc.track.hidden) throw new Error("Choose unlocked, visible visual clips");
    return loc.clip as VisualClip;
  });
  if (Math.max(...clips.map(c => c.start)) >= Math.min(...clips.map(c => c.start + c.duration))) throw new Error("Layout clips must overlap in time");
  // A clip on the main track stays there, refit in place: taking it off left
  // a gap, and with the magnet on rippled every later shot. The others stack
  // above it, so in picture in picture it must be the full-frame picture.
  const onMain = new Set(p.tracks.find(t => t.main)?.clips.filter(c => ids.includes(c.id)).map(c => c.id));
  if (layout.startsWith("pip-") && ids.slice(1).some(id => onMain.has(id))) throw new Error("A main-track clip stays underneath: put it first, as the full-frame picture, or move the card off the main track");
  const stack: VisualClip[] = [];
  clips.forEach((c, i) => {
    const cell = cells[i], fit = coverCell(fittedSize(p, c), cell, p.width, p.height);
    const main = layout.startsWith("pip-") && i === 0;
    const group = options.border?.width && !main ? c.group ?? uid("g") : c.group;
    const keyframes = Object.fromEntries(Object.entries(c.keyframes ?? {}).filter(([path]) => !path.startsWith("transform.") && !path.startsWith("crop.") && !path.startsWith("mask.")));
    const duration = Math.min(c.duration - 1, Math.max(1, Math.round(p.fps.num / p.fps.den * 0.4)));
    const animate = (clip: VisualClip): VisualClip => {
      if (!duration || !options.animate || options.animate === "none" || main) return clip;
      const path = options.animate === "slide" ? "transform.x" : "transform.scale";
      const target = options.animate === "slide" ? clip.transform.x : clip.transform.scale;
      const from = options.animate === "slide" ? target + 0.12 : target * 0.8;
      return { ...clip, keyframes: { ...clip.keyframes, [path]: [{ f: 0, v: from, ease: "easeOut" }, { f: duration, v: target }] } };
    };
    const next = animate({ ...c, group, keyframes, crop: fit.crop,
      transform: { ...c.transform, x: fit.x, y: fit.y, scale: fit.scale, scaleY: undefined, rotation: 0, anchorX: 0, anchorY: 0, rotateX: 0, rotateY: 0 },
      mask: { shape: "rectangle", x: 0, y: 0, width: 1, height: 1, rotation: 0, feather: 0, invert: false, radius: main ? 0 : options.radius ?? 0 },
      animIn: undefined, animOut: undefined, animLoop: undefined, canvas: undefined, edge: undefined, wiggle: undefined,
    });
    p = updateClip(p, c.id, () => next);
    stack.push(next);
    // ponytail: borders are ordinary editable shapes, not linked layout
    // objects. Remove an old border before applying another bordered layout.
    if (options.border && options.border.width > 0 && !main) {
      const border = createColorClip(options.border.color, c.start, c.duration);
      border.name = "Layout border";
      border.group = group;
      border.shape = { kind: "rectangle", width: cell.w / p.width, height: cell.h / p.height, radius: options.radius ?? 0, fill: false, stroke: options.border, draw: 1 };
      border.transform = { ...border.transform, x: fit.x, y: fit.y };
      stack.push(animate(border));
    }
  });
  // Stack the chosen clips in input order, main PIP picture first. Existing
  // clips on their old tracks stay untouched; borders remain editable shapes.
  p = { ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.filter(c => !ids.includes(c.id) || onMain.has(c.id)) })) };
  return placeStack(p, stack.filter(c => !onMain.has(c.id)), "Layout");
}
