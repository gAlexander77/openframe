// The crop's geometry: CapCut's Crop ratios, the largest crop of a ratio,
// and where a dragged crop handle puts the edges. Everything is in
// fractions of the source (Crop), with the source's pixel size where a
// shape needs it. The canvas crop mode and the set_crop command share it,
// so a ratio picked on the viewer and one an agent asks for agree.

import { sourceSize, tidy } from "./align";
import { findClip, updateClip } from "./project/ops";
import type { Clip, Crop, Id, Project } from "./project/types";

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

/** The narrowest strip a crop keeps on each axis (the sliders stop at 95%). */
export const MIN_CROP = 0.05;

/** CapCut's crop ratios: free, the source's own shape, then the common
 * delivery shapes. */
export const CROP_RATIOS = ["free", "original", "16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "21:9"] as const;
export type CropRatio = (typeof CROP_RATIOS)[number];

export const ratioLabel = (r: CropRatio) => (r === "free" ? "Free" : r === "original" ? "Original" : r);

/** The width-to-height a ratio asks for, in source pixels; null for free. */
export function ratioAspect(r: CropRatio, w: number, h: number): number | null {
  if (r === "free") return null;
  if (r === "original") return w / h;
  const [a, b] = r.split(":").map(Number);
  return a / b;
}

/** The largest crop of `aspect` (source pixels), centered: what picking a
 * ratio in CapCut's crop does. */
export function ratioCrop(aspect: number, w: number, h: number): Crop {
  const own = w / h;
  const fw = aspect >= own ? 1 : aspect / own;
  const fh = aspect >= own ? own / aspect : 1;
  const x = tidy((1 - fw) / 2), y = tidy((1 - fh) / 2);
  return { left: x, top: y, right: x, bottom: y };
}

/** The crop as a mirrored picture shows it: a flip swaps the edges, so
 * the canvas can drag the edge under the pointer. Its own inverse. */
export function mirrorCrop(c: Crop, flipX: boolean, flipY: boolean): Crop {
  return {
    left: flipX ? c.right : c.left,
    right: flipX ? c.left : c.right,
    top: flipY ? c.bottom : c.top,
    bottom: flipY ? c.top : c.bottom,
  };
}

/** Each edge in range and each pair leaving at least MIN_CROP. */
export const validCrop = (c: Crop) =>
  [c.left, c.top, c.right, c.bottom].every((v) => Number.isFinite(v) && v >= 0) &&
  c.left + c.right <= 1 - MIN_CROP + 1e-9 &&
  c.top + c.bottom <= 1 - MIN_CROP + 1e-9;

export const sameCrop = (a: Crop, b: Crop) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move";

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * The crop after dragging `handle` by (du, dv), fractions of the source,
 * from `start`. The edges stay inside the picture and MIN_CROP apart.
 * With an `aspect` (source pixels) the crop keeps that shape: a corner
 * pins the opposite corner and follows the pointer along the diagonal, an
 * edge grows the other axis about its middle (sliding it inside the
 * picture at the borders). "move" slides the whole crop.
 */
export function dragCrop(start: Crop, handle: CropHandle, du: number, dv: number, size: { w: number; h: number }, aspect: number | null): Crop {
  let x0 = start.left, x1 = 1 - start.right, y0 = start.top, y1 = 1 - start.bottom;
  if (handle === "move") {
    const dx = clamp(du, -x0, 1 - x1), dy = clamp(dv, -y0, 1 - y1);
    return out(x0 + dx, y0 + dy, x1 + dx, y1 + dy);
  }
  const east = handle.includes("e"), west = handle.includes("w"), north = handle.includes("n"), south = handle.includes("s");
  if (aspect === null) {
    if (west) x0 = clamp(x0 + du, 0, x1 - MIN_CROP);
    if (east) x1 = clamp(x1 + du, x0 + MIN_CROP, 1);
    if (north) y0 = clamp(y0 + dv, 0, y1 - MIN_CROP);
    if (south) y1 = clamp(y1 + dv, y0 + MIN_CROP, 1);
    return out(x0, y0, x1, y1);
  }
  // In pixels a crop of this shape is t * (aspect, 1); find t, then place it.
  const { w, h } = size;
  const tMin = Math.max((MIN_CROP * w) / aspect, MIN_CROP * h);
  if ((east || west) && (north || south)) {
    const ax = east ? x0 : x1, ay = south ? y0 : y1;
    const rw = (east ? x1 + du - ax : ax - (x0 + du)) * w;
    const rh = (south ? y1 + dv - ay : ay - (y0 + dv)) * h;
    const roomW = (east ? 1 - ax : ax) * w, roomH = (south ? 1 - ay : ay) * h;
    const t = clamp((Math.max(0, rw) * aspect + Math.max(0, rh)) / (aspect * aspect + 1), tMin, Math.min(roomW / aspect, roomH));
    const fw = (t * aspect) / w, fh = t / h;
    return out(east ? ax : ax - fw, south ? ay : ay - fh, east ? ax + fw : ax, south ? ay + fh : ay);
  }
  if (east || west) {
    const ax = east ? x0 : x1;
    const rw = (east ? x1 + du - ax : ax - (x0 + du)) * w;
    const t = clamp(rw / aspect, tMin, Math.min(((east ? 1 - ax : ax) * w) / aspect, h));
    const fw = (t * aspect) / w, fh = t / h;
    const top = clamp((y0 + y1) / 2 - fh / 2, 0, 1 - fh);
    return out(east ? ax : ax - fw, top, east ? ax + fw : ax, top + fh);
  }
  const ay = south ? y0 : y1;
  const rh = (south ? y1 + dv - ay : ay - (y0 + dv)) * h;
  const t = clamp(rh, tMin, Math.min((south ? 1 - ay : ay) * h, w / aspect));
  const fw = (t * aspect) / w, fh = t / h;
  const left = clamp((x0 + x1) / 2 - fw / 2, 0, 1 - fw);
  return out(left, south ? ay : ay - fh, left + fw, south ? ay + fh : ay);
}

const out = (x0: number, y0: number, x1: number, y1: number): Crop => ({
  left: tidy(Math.max(0, x0)),
  top: tidy(Math.max(0, y0)),
  right: tidy(Math.max(0, 1 - x1)),
  bottom: tidy(Math.max(0, 1 - y1)),
});

/** Clips the crop mode works on: pictures from a source (CapCut crops
 * video and images) and color boxes, on unlocked tracks. */
export function canCrop(p: Project, id: Id): boolean {
  const loc = findClip(p, id);
  const t = loc?.clip.type;
  // A compound clip crops its nested timeline's picture, as a video clip does.
  return !!loc && !loc.track.locked && (t === "video" || t === "image" || t === "color" || t === "compound");
}

const croppable = (c: Clip): c is Clip & { crop: Crop } => "crop" in c;

/** Set clips' crop edges; edges left out keep their value. Unchanged
 * clips stay the same objects, so a no-op records no undo step. */
export function cropClips(p: Project, ids: Id[], edges: Partial<Crop>): Project {
  for (const id of ids) {
    const c = findClip(p, id)?.clip;
    if (!c || !croppable(c)) continue;
    const crop = { ...c.crop, ...edges };
    if (!sameCrop(crop, c.crop)) p = updateClip(p, id, (x) => ({ ...x, crop }) as Clip);
  }
  return p;
}

/** Crop each clip to the largest centered area of a ratio, measured on
 * its own source; free leaves it alone, original uncrops it. */
export function cropToRatio(p: Project, ids: Id[], ratio: CropRatio): Project {
  for (const id of ids) {
    const c = findClip(p, id)?.clip;
    if (!c || !croppable(c) || c.type === "audio" || c.type === "adjustment") continue;
    const src = sourceSize(p, c);
    const aspect = ratioAspect(ratio, src.w, src.h);
    if (aspect !== null) p = cropClips(p, [id], ratioCrop(aspect, src.w, src.h));
  }
  return p;
}
