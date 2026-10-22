import { fittedSize } from "./render/size";
import { createColorClip, createTrack, uid } from "./project/defaults";
import { addClip, addTrack, findClip, updateClip } from "./project/ops";
import type { Project, VideoClip } from "./project/types";

export interface SourceRegion { x: number; y: number; w: number; h: number }
export interface StreamOptions {
  facecam?: SourceRegion;
  gameplay?: SourceRegion;
  split?: number;
  facecam_fit?: "fill" | "fit";
  gap?: number;
  border?: "none" | { color: string; width: number };
  order?: "facecam_top" | "gameplay_top";
}
export const FULL_REGION: SourceRegion = { x: 0, y: 0, w: 1, h: 1 };

export function checkRegion(r: SourceRegion) {
  if (![r.x, r.y, r.w, r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x + r.w > 1.000001 || r.y + r.h > 1.000001) throw new Error("A source region must be inside the picture, with positive width and height");
}

/** Crops stay in source coordinates. Compensate the off-center crop in
 * transform, since the compositor positions the uncropped picture. */
export function streamBand(source: { w: number; h: number }, region: SourceRegion, band: { y: number; w: number; h: number }, canvas: { width: number; height: number }, fit: "fill" | "fit" = "fill") {
  checkRegion(region);
  const scale = (fit === "fit" ? Math.min : Math.max)(band.w / (source.w * region.w), band.h / (source.h * region.h));
  const w = Math.min(region.w, band.w / (source.w * scale)), h = Math.min(region.h, band.h / (source.h * scale));
  const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
  return { scale, x: -(cx - 0.5) * source.w * scale / canvas.width,
    y: (band.y + band.h / 2 - canvas.height / 2 - (cy - 0.5) * source.h * scale) / canvas.height,
    crop: { left: cx - w / 2, right: 1 - cx - w / 2, top: cy - h / 2, bottom: 1 - cy - h / 2 } };
}

export function streamBands(width: number, height: number, o: StreamOptions) {
  const split = o.split ?? 0.35, gap = o.gap ?? 0;
  if (!Number.isFinite(split) || split < 0.1 || split > 0.9 || !Number.isFinite(gap) || gap < 0 || gap >= height) throw new Error("Use split 0.1 to 0.9 and a gap smaller than the canvas height");
  if (!o.facecam) return { gameplay: { y: 0, w: width, h: height } };
  const face = (height - gap) * split, game = height - gap - face;
  return o.order === "gameplay_top"
    ? { facecam: { y: game + gap, w: width, h: face }, gameplay: { y: 0, w: width, h: game } }
    : { facecam: { y: 0, w: width, h: face }, gameplay: { y: face + gap, w: width, h: game } };
}

export function applyStreamLayout(p: Project, id: string, o: StreamOptions = {}): Project {
  const loc = findClip(p, id);
  if (!loc || loc.clip.type !== "video" || loc.track.locked || loc.track.hidden) throw new Error("Choose an unlocked, visible video clip");
  if (loc.clip.streamLayout) throw new Error("This clip already belongs to a stream layout; undo it before applying another");
  if (loc.clip.group) throw new Error("Ungroup the video before applying a stream layout");
  if (p.height <= p.width) p = { ...p, width: 1080, height: 1920, canvasFixed: true };
  const bands = streamBands(p.width, p.height, o), group = uid("g"), original = loc.clip;
  const make = (part: "facecam" | "gameplay", band: NonNullable<typeof bands.facecam>, r: SourceRegion): VideoClip => {
    const fit = streamBand(fittedSize(p, original), r, band, p, part === "facecam" ? o.facecam_fit : "fill");
    return { ...original, id: part === "gameplay" ? original.id : uid("c"), name: part === "facecam" ? "Facecam" : "Gameplay", group, streamLayout: part,
      crop: fit.crop, transform: { x: fit.x, y: fit.y, scale: fit.scale, rotation: 0, flipX: false, flipY: false },
      keyframes: Object.fromEntries(Object.entries(original.keyframes ?? {}).filter(([k]) => !/^(transform|crop|mask)\./.test(k))),
      muted: part === "facecam" || original.muted, canvas: undefined, mask: undefined, border: undefined, shadow: undefined, anchor: undefined,
      animIn: undefined, animOut: undefined, animLoop: undefined, edge: undefined, wiggle: undefined,
    };
  };
  p = updateClip(p, id, () => make("gameplay", bands.gameplay, o.gameplay ?? FULL_REGION));
  if (bands.facecam && o.facecam) {
    const track = createTrack("video", "Stream layout");
    p = addTrack(p, track, loc.trackIndex);
    p = addClip(p, track.id, make("facecam", bands.facecam, o.facecam));
    if (o.border && o.border !== "none" && o.border.width > 0) {
      if (!Number.isFinite(o.border.width) || o.border.width > 100 || o.border.width >= bands.facecam.h) throw new Error("Border width must be between 0 and 100 pixels and smaller than its band");
      const b = createColorClip(o.border.color, original.start, original.duration);
      b.name = "Facecam border"; b.group = group; b.streamLayout = "border";
      b.shape = { kind: "rectangle", width: 1 - o.border.width / p.width, height: (bands.facecam.h - o.border.width) / p.height, fill: false, stroke: { color: o.border.color, width: o.border.width * 1080 / p.height }, draw: 1 };
      b.transform.y = (bands.facecam.y + bands.facecam.h / 2) / p.height - 0.5;
      const border = createTrack("video", "Stream layout");
      p = addClip(addTrack(p, border, loc.trackIndex), border.id, b);
    }
  }
  return p;
}
