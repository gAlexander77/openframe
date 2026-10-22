import { projectWork } from "./projectWork";
// Auto adjust (CapCut's Auto adjust): draw the clip's own picture at the
// playhead with its Basic adjustments, filter and effects off, measure it,
// and set exposure, white balance and levels to correct it
// (src/lib/autoColor.ts), as one undo step.

import { exportStills } from "../engine/export";
import { autoAdjust, frameStats, type AutoAdjust } from "../lib/autoColor";
import { createTrack, DEFAULT_ADJUST, DEFAULT_TRANSFORM } from "../lib/project/defaults";
import { findClip, getAsset, updateClip } from "../lib/project/ops";
import type { Clip, Id, Project } from "../lib/project/types";
import { store } from "./store";
import { toast } from "./toast";

/** Shared still-export sampling for Auto adjust and Match color. Each
 * bitmap is owned here; decoder samples stay owned by export's pool. */
export async function sampleColorFrames(p: Project, frames: number[], w: number, h: number, clipIds?: string[], signal?: AbortSignal): Promise<Uint8ClampedArray[]> {
  const blobs = await exportStills(p, frames, w, h, undefined, clipIds || signal ? { clipIds: clipIds ?? [], signal } : undefined);
  const cv = new OffscreenCanvas(w, h), ctx = cv.getContext("2d")!;
  const out: Uint8ClampedArray[] = [];
  for (const blob of blobs) {
    signal?.throwIfAborted();
    const bitmap = await createImageBitmap(blob);
    try {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0);
      out.push(ctx.getImageData(0, 0, w, h).data);
    } finally { bitmap.close(); }
  }
  return out;
}

export async function autoAdjustClip(clipId?: Id): Promise<AutoAdjust> {
  const signal = projectWork.capture();
  const s = store.get();
  const p = s.project;
  const id = clipId ?? s.selection[0];
  const loc = id ? findClip(p, id) : null;
  const c = loc?.clip;
  if (!c || (c.type !== "video" && c.type !== "image")) throw new Error("Select a video or picture to auto adjust");
  const a = getAsset(p, c.assetId);
  if (!a?.width || !a.height) throw new Error("The clip's media is missing");
  // The picture alone, filling a small canvas of its own shape: letterbox
  // bars would read as black and skew the measurement.
  const k = Math.min(1, 320 / Math.max(a.width, a.height));
  const w = Math.max(2, Math.round((a.width * k) / 2) * 2), h = Math.max(2, Math.round((a.height * k) / 2) * 2);
  const plain = { ...c, adjust: { ...DEFAULT_ADJUST, lut: undefined }, effects: [], transform: { ...DEFAULT_TRANSFORM }, keyframes: undefined } as Clip & Record<string, unknown>;
  for (const key of ["filter", "mask", "chromaKey", "animIn", "animOut", "animLoop", "transitionOut", "canvas", "cutout"]) delete plain[key];
  const solo: Project = { ...p, width: w, height: h, tracks: [{ ...createTrack("video", "Main", true), clips: [plain as Clip] }] };
  const f = Math.min(Math.max(s.playhead, c.start), c.start + c.duration - 1);
  const [pixels] = await sampleColorFrames(solo, [f], w, h, undefined, signal);
  signal.throwIfAborted();
  const v = autoAdjust(frameStats(pixels));
  if (!findClip(store.get().project, c.id)) throw new Error("The clip was removed meanwhile");
  store.edit("Auto adjust", (q) => updateClip(q, c.id, (x) => ("adjust" in x ? ({ ...x, adjust: { ...x.adjust, ...v } } as Clip) : x)));
  toast(`Auto adjusted: exposure ${v.exposure}, temperature ${v.temperature}, tint ${v.tint}, blacks ${v.blacks}, whites ${v.whites}`);
  return v;
}
