// Motion tracking as an app action (CapCut's Tracking): the box around a
// subject in the video under a layer is followed through the video from
// the playhead, and the layer gets position keyframes that move it with
// the subject (lib/follow.ts), as one undo step. While a box is being
// placed, the viewer draws it (TrackBoxOverlay) instead of the layer's
// transform handles.

import { useSyncExternalStore } from "react";
import { frameGrays } from "../engine/analyze";
import { BoxTracker, LOST } from "../lib/analysis/track";
import type { Region } from "../lib/align";
import { inSource, pin, pinKeys, type Path } from "../lib/follow";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project, VideoClip, VisualClip } from "../lib/project/types";
import { layerAt } from "../lib/render/plan";
import { sourceSize } from "../lib/render/size";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { run } from "./actions";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

/** Analysis frames are this wide; the height follows the picture. */
const AW = 320;

/** The box being placed: canvas pixels (center and size) on the frame
 * tracking starts from. */
export interface TrackBox {
  target: Id;
  video: Id;
  frame: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

let box: TrackBox | null = null;
let running: { target: Id; progress: number; abort: AbortController } | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export const useTrackBox = () => useSyncExternalStore(subscribe, () => box);
export const useTracking = () => useSyncExternalStore(subscribe, () => running);

const pinnable = (c: Clip): c is VisualClip => c.type !== "audio" && c.type !== "adjustment";

/** The video a layer can follow at frame f: on another track, playing
 * forward, with a picture. The main track's comes first. */
export function followable(p: Project, target: Clip, f: number): VideoClip | null {
  const found = p.tracks
    .filter((t) => !t.hidden && !t.clips.some((c) => c.id === target.id))
    .sort((a, b) => Number(!!b.main) - Number(!!a.main))
    .flatMap((t) => t.clips)
    .find((c): c is VideoClip => c.type === "video" && f >= c.start && f < c.start + c.duration && !c.reverse && !c.freeze && !!ops.getAsset(p, c.assetId)?.hasVideo);
  return found ?? null;
}

/** Why `target` cannot be tracked at the playhead, or null. */
export function cannotTrack(p: Project, targetId: Id, f: number): string | null {
  const loc = ops.findClip(p, targetId);
  if (!loc || !pinnable(loc.clip)) return "Select a title, sticker, picture or video to pin";
  const c = loc.clip;
  if (f < c.start || f >= c.start + c.duration) return "Move the playhead over this layer";
  if (!followable(p, c, f)) return "Move the playhead over a video under this layer";
  return null;
}

/** Start placing the box: around the layer's own center, a square a
 * sixth of the canvas high. Playback stops. */
export function beginTrackBox(targetId: Id) {
  const s = store.get();
  const why = cannotTrack(s.project, targetId, s.playhead);
  if (why) return void toast(why, "error");
  if (s.playing) run("shuttleStop");
  const target = ops.findClip(s.project, targetId)!.clip as VisualClip;
  const video = followable(s.project, target, s.playhead)!;
  const l = layerAt(s.project, target, s.playhead);
  const side = s.project.height / 6;
  box = { target: targetId, video: video.id, frame: s.playhead, cx: s.project.width * (0.5 + (l?.x ?? 0)), cy: s.project.height * (0.5 + (l?.y ?? 0)), w: side, h: side };
  changed();
}

export function setTrackBox(b: Pick<TrackBox, "cx" | "cy" | "w" | "h">) {
  if (box) box = { ...box, ...b };
  changed();
}

export function cancelTrackBox() {
  box = null;
  changed();
}

export function cancelTracking() {
  running?.abort.abort();
}

// A box left over from another selection, playhead or project is dropped.
store.subscribe(() => {
  if (!box) return;
  const s = store.get();
  if (s.selection.length !== 1 || s.selection[0] !== box.target || s.playhead !== box.frame || s.playing) cancelTrackBox();
});

export interface TrackResult {
  /** Frames followed. */
  frames: number;
  /** Frames the subject was not found on (held in place). */
  lost: number;
  /** Position keyframes written. */
  keys: number;
}

/**
 * Track the subject in `opts.box` (fractions of the followed video's
 * uncropped picture) from `opts.at` (timeline seconds; the playhead) and
 * pin `targetId` to it. Without a box, the one being placed in the viewer
 * is used, or else one around the layer's center.
 */
export async function trackMotion(targetId?: Id, opts: { box?: Region; at?: number; videoId?: Id } = {}): Promise<TrackResult> {
  const scope = projectWork.signal();
  const s = store.get();
  const p = s.project;
  const id = targetId ?? s.selection[0];
  const f = opts.at !== undefined ? secondsToFrames(opts.at, p.fps) : box?.target === id ? box.frame : s.playhead;
  const why = id ? cannotTrack(p, id, f) : "Select a layer to pin";
  if (why) throw new Error(why);
  if (running) throw new Error("Already tracking");
  const target = ops.findClip(p, id)!.clip as VisualClip;
  const v = opts.videoId ? ops.findClip(p, opts.videoId)?.clip : followable(p, target, f);
  if (!v || v.type !== "video" || f < v.start || f >= v.start + v.duration) throw new Error("No video to follow at that time");
  const video = v;
  const asset = ops.getAsset(p, video.assetId)!;
  const layer = layerAt(p, video, f)!;
  // The box in source fractions: given, placed in the viewer, or default.
  let region = opts.box;
  if (!region) {
    const b = box?.target === id ? box : null;
    const tl = layerAt(p, target, f);
    const cx = b?.cx ?? p.width * (0.5 + (tl?.x ?? 0)), cy = b?.cy ?? p.height * (0.5 + (tl?.y ?? 0));
    const half = (b?.h ?? p.height / 6) / 2, halfW = (b?.w ?? p.height / 6) / 2;
    const a = inSource(p, video, layer, cx - halfW, cy - half), z = inSource(p, video, layer, cx + halfW, cy + half);
    region = { x: Math.min(a.u, z.u), y: Math.min(a.v, z.v), w: Math.abs(z.u - a.u), h: Math.abs(z.v - a.v) };
  }
  cancelTrackBox();
  const src = sourceSize(p, video);
  const ah = Math.max(16, Math.round((AW * src.h) / src.w / 2) * 2);
  const end = Math.min(video.start + video.duration, target.start + target.duration);
  const from = (layer.source.kind === "video" ? layer.source.time : video.in) - 0.5 / (asset.fps || 30);
  const last = layerAt(p, video, end - 1)!;
  const to = (last.source.kind === "video" ? last.source.time : from) + 1 / (asset.fps || 30);

  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, scope]);
  running = { target: id, progress: 0, abort };
  changed();
  const tid = toast(`Tracking in ${asset.name}`, "progress");
  updateToast(tid, { progress: 0 });
  const path: Path = { times: [], x: [], y: [] };
  let lost = 0;
  try {
    let tracker: BoxTracker | null = null;
    await frameGrays(asset, Math.max(0, from), to, AW, ah, (t, gray) => {
      if (!tracker) {
        tracker = new BoxTracker(gray, AW, ah, { x: region.x * AW, y: region.y * ah, w: region.w * AW, h: region.h * ah });
        path.times.push(t);
        path.x.push(region.x + region.w / 2);
        path.y.push(region.y + region.h / 2);
        return;
      }
      const r = tracker.next(gray);
      if (r.score < LOST) lost++;
      path.times.push(t);
      path.x.push(r.x / AW);
      path.y.push(r.y / ah);
    }, (x) => {
      updateToast(tid, { progress: x });
      if (running) running = { ...running, progress: x };
      changed();
    }, signal);
    signal.throwIfAborted();
    if (path.times.length < 2) throw new Error("The video is too short to track there");
  } catch (e) {
    toast(signal.aborted ? "Canceled" : e instanceof Error ? e.message : String(e), signal.aborted ? "info" : "error");
    throw e;
  } finally {
    dismiss(tid);
    running = null;
    changed();
  }
  let keys = 0;
  store.edit("Track motion", (q) => {
    const t = ops.findClip(q, id)?.clip, vv = ops.findClip(q, video.id)?.clip;
    if (!t || !vv || vv.type !== "video" || !pinnable(t)) return q;
    const k = pinKeys(q, vv, path, t, f);
    keys = k.x.length;
    return pin(q, id, k);
  });
  const frames = path.times.length;
  toast(lost > frames / 4 ? `Lost the subject on ${lost} of ${frames} frames; try a bigger box on something with detail` : `Pinned to the subject for ${framesToSeconds(end - f, p.fps).toFixed(1)} s`, lost > frames / 4 ? "error" : "info");
  return { frames, lost, keys };
}
