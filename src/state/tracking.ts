// Motion tracking as an app action (CapCut's Tracking) and the subject
// half of Auto reframe. A box around a subject is followed through a video
// from a frame (trackPath), then either a layer above gets position
// keyframes that move it with the subject ("pin", lib/follow.ts pinKeys)
// or the video itself gets keyframes that keep the subject centered
// ("center", centerKeys), as one undo step. While a box is being placed,
// the viewer draws it (TrackBoxOverlay) instead of the transform handles.

import { useSyncExternalStore } from "react";
import { frameGrays } from "../engine/analyze";
import { BoxTracker, LOST } from "../lib/analysis/track";
import { frameClips, type Region } from "../lib/align";
import { centerKeys, inSource, pin, pinKeys, type Path } from "../lib/follow";
import * as ops from "../lib/project/ops";
import type { Asset, Clip, Id, Project, VideoClip, VisualClip } from "../lib/project/types";
import { layerAt } from "../lib/render/plan";
import { fittedSize, sourceSize } from "../lib/render/size";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { run } from "./actions";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

/** Analysis frames are this wide; the height follows the picture. */
const AW = 320;

/** Pin a layer to a subject in the video under it, or keep a subject of
 * the video itself centered (reframe). */
export type TrackMode = "pin" | "center";

/** The box being placed: canvas pixels (center and size) on the frame
 * tracking starts from. */
export interface TrackBox {
  target: Id;
  video: Id;
  mode: TrackMode;
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
const trackable = (p: Project, c: Clip): c is VideoClip => c.type === "video" && !c.reverse && !c.freeze && !!ops.getAsset(p, c.assetId)?.hasVideo;

/** The video a layer can follow at frame f: on another track, playing
 * forward, with a picture. The main track's comes first. */
export function followable(p: Project, target: Clip, f: number): VideoClip | null {
  const found = p.tracks
    .filter((t) => !t.hidden && !t.clips.some((c) => c.id === target.id))
    .sort((a, b) => Number(!!b.main) - Number(!!a.main))
    .flatMap((t) => t.clips)
    .find((c): c is VideoClip => f >= c.start && f < c.start + c.duration && trackable(p, c));
  return found ?? null;
}

/** Why `target` cannot be tracked at frame f in this mode, or null. */
export function cannotTrack(p: Project, targetId: Id, f: number, mode: TrackMode = "pin"): string | null {
  const loc = ops.findClip(p, targetId);
  if (!loc || !pinnable(loc.clip)) return "Select a title, sticker, picture or video to pin";
  const c = loc.clip;
  if (f < c.start || f >= c.start + c.duration) return "Move the playhead over this clip";
  if (mode === "center") return trackable(p, c) ? null : "Only a video playing forward can be reframed";
  if (!followable(p, c, f)) return "Move the playhead over a video under this layer";
  return null;
}

/** The video a target's tracking reads, by mode. */
const videoFor = (p: Project, target: Clip, f: number, mode: TrackMode) => (mode === "center" ? (target as VideoClip) : followable(p, target, f));

/** Start placing the box: around the layer's own center, a square a
 * sixth of the canvas high. Playback stops. */
export function beginTrackBox(targetId: Id, mode: TrackMode = "pin") {
  const s = store.get();
  const why = cannotTrack(s.project, targetId, s.playhead, mode);
  if (why) return void toast(why, "error");
  if (s.playing) run("shuttleStop");
  const target = ops.findClip(s.project, targetId)!.clip as VisualClip;
  const video = videoFor(s.project, target, s.playhead, mode)!;
  const l = layerAt(s.project, target, s.playhead);
  const side = s.project.height / 6;
  box = { target: targetId, video: video.id, mode, frame: s.playhead, cx: s.project.width * (0.5 + (l?.x ?? 0)), cy: s.project.height * (0.5 + (l?.y ?? 0)), w: side, h: side };
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

/** The subject region (source fractions) under a canvas box at frame f. */
function regionOf(p: Project, video: VideoClip, f: number, b: { cx: number; cy: number; w: number; h: number }): Region {
  const layer = layerAt(p, video, f)!;
  const a = inSource(p, video, layer, b.cx - b.w / 2, b.cy - b.h / 2), z = inSource(p, video, layer, b.cx + b.w / 2, b.cy + b.h / 2);
  return { x: Math.min(a.u, z.u), y: Math.min(a.v, z.v), w: Math.abs(z.u - a.u), h: Math.abs(z.v - a.v) };
}

/** Auto reframe's subject when none is given: a square a third of the
 * picture high at its center, where a framed subject usually starts. */
export function centerRegion(p: Project, video: VideoClip): Region {
  const src = sourceSize(p, video);
  const h = 1 / 3, w = (src.h / src.w) / 3;
  return { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h };
}

/**
 * Follow `region` (source fractions) through `video` from timeline frame
 * `from` to `end`: the subject's center per decoded frame, and how many
 * frames it was lost on (held in place there).
 */
export async function trackPath(p: Project, video: VideoClip, asset: Asset, region: Region, from: number, end: number, onProgress: (x: number) => void, signal: AbortSignal): Promise<{ path: Path; lost: number }> {
  const src = sourceSize(p, video);
  const ah = Math.max(16, Math.round((AW * src.h) / src.w / 2) * 2);
  const first = layerAt(p, video, from)!, last = layerAt(p, video, end - 1)!;
  const step = 1 / (asset.fps || 30);
  const t0 = (first.source.kind === "video" ? first.source.time : video.in) - step / 2;
  const t1 = (last.source.kind === "video" ? last.source.time : t0) + step;
  const path: Path = { times: [], x: [], y: [] };
  let lost = 0;
  let tracker: BoxTracker | null = null;
  await frameGrays(asset, Math.max(0, t0), t1, AW, ah, (t, gray) => {
    path.times.push(t);
    if (!tracker) {
      tracker = new BoxTracker(gray, AW, ah, { x: region.x * AW, y: region.y * ah, w: region.w * AW, h: region.h * ah });
      path.x.push(region.x + region.w / 2);
      path.y.push(region.y + region.h / 2);
      return;
    }
    const r = tracker.next(gray);
    if (r.score < LOST) lost++;
    path.x.push(r.x / AW);
    path.y.push(r.y / ah);
  }, onProgress, signal);
  signal.throwIfAborted();
  if (path.times.length < 2) throw new Error("The video is too short to track there");
  return { path, lost };
}

/** The edit a finished track makes: pin the target to the path, or
 * (center) fill the canvas with the video if it does not already, then
 * keep the subject centered. */
export function applyTrack(q: Project, targetId: Id, videoId: Id, path: Path, f: number, mode: TrackMode): Project {
  const t = ops.findClip(q, targetId)?.clip, v = ops.findClip(q, videoId)?.clip;
  if (!t || !v || v.type !== "video" || !pinnable(t)) return q;
  if (mode === "pin") return pin(q, targetId, pinKeys(q, v, path, t, f));
  const l = layerAt(q, v, f);
  const { w, h } = fittedSize(q, v);
  if (l && (w * l.scale < q.width - 0.5 || h * (l.scaleY ?? l.scale) < q.height - 0.5)) q = frameClips(q, [v.id], "fill", f);
  const filled = ops.findClip(q, videoId)!.clip as VideoClip;
  return pin(q, videoId, centerKeys(q, filled, path, f));
}

export interface TrackResult {
  /** Frames followed. */
  frames: number;
  /** Frames the subject was not found on (held in place). */
  lost: number;
  /** Position keyframes written. */
  keys: number;
}

/**
 * Track the subject in `opts.box` (fractions of the video's uncropped
 * picture) from `opts.at` (timeline seconds; the playhead) and pin
 * `targetId` to it, or with mode "center" keep it centered in `targetId`
 * (a video) itself. Without a box, the one being placed in the viewer is
 * used, or else one around the layer's center.
 */
export async function trackMotion(targetId?: Id, opts: { box?: Region; at?: number; videoId?: Id; mode?: TrackMode } = {}): Promise<TrackResult> {
  const scope = projectWork.signal();
  const s = store.get();
  const p = s.project;
  const id = targetId ?? s.selection[0];
  const placed = box?.target === id ? box : null;
  const mode = opts.mode ?? placed?.mode ?? "pin";
  const f = opts.at !== undefined ? secondsToFrames(opts.at, p.fps) : placed ? placed.frame : s.playhead;
  const why = id ? cannotTrack(p, id, f, mode) : "Select a layer to pin";
  if (why) throw new Error(why);
  if (running) throw new Error("Already tracking");
  const target = ops.findClip(p, id)!.clip as VisualClip;
  const v = mode === "center" ? target : opts.videoId ? ops.findClip(p, opts.videoId)?.clip : followable(p, target, f);
  if (!v || v.type !== "video" || f < v.start || f >= v.start + v.duration) throw new Error("No video to follow at that time");
  const video = v;
  const asset = ops.getAsset(p, video.assetId)!;
  const tl = layerAt(p, target, f);
  const side = p.height / 6;
  const region = opts.box ?? regionOf(p, video, f, placed ?? { cx: p.width * (0.5 + (tl?.x ?? 0)), cy: p.height * (0.5 + (tl?.y ?? 0)), w: side, h: side });
  cancelTrackBox();
  const end = mode === "center" ? video.start + video.duration : Math.min(video.start + video.duration, target.start + target.duration);

  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, scope]);
  running = { target: id, progress: 0, abort };
  changed();
  const tid = toast(`Tracking in ${asset.name}`, "progress");
  updateToast(tid, { progress: 0 });
  let result: { path: Path; lost: number };
  try {
    result = await trackPath(p, video, asset, region, f, end, (x) => {
      updateToast(tid, { progress: x });
      if (running) running = { ...running, progress: x };
      changed();
    }, signal);
  } catch (e) {
    toast(signal.aborted ? "Canceled" : e instanceof Error ? e.message : String(e), signal.aborted ? "info" : "error");
    throw e;
  } finally {
    dismiss(tid);
    running = null;
    changed();
  }
  let keys = 0;
  store.edit(mode === "center" ? "Reframe" : "Track motion", (q) => {
    const next = applyTrack(q, id, video.id, result.path, f, mode);
    keys = (ops.findClip(next, id)?.clip.keyframes?.["transform.x"] ?? []).length;
    return next;
  });
  const frames = result.path.times.length, lost = result.lost;
  const done = mode === "center" ? `Reframed on the subject for ${framesToSeconds(end - f, p.fps).toFixed(1)} s` : `Pinned to the subject for ${framesToSeconds(end - f, p.fps).toFixed(1)} s`;
  toast(lost > frames / 4 ? `Lost the subject on ${lost} of ${frames} frames; try a bigger box on something with detail` : done, lost > frames / 4 ? "error" : "info");
  return { frames, lost, keys };
}
