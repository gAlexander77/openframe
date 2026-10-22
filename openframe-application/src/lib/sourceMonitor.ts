import { clipForAsset, createProject } from "./project/defaults";
import type { Asset, Clip, Project } from "./project/types";
import { FPS_PRESETS, fpsValue, secondsToFrames, type Rational } from "./time";

export interface SourceRange { in: number; out: number; speed?: number; duration?: number }
/** The source's own rate; a probed 29.97 snaps to 30000/1001 (as on import)
 * so its timecode is drop-frame like the program monitor's. */
export function sourceFps(asset: Asset): Rational {
  const fps = asset.fps && asset.fps > 0 ? asset.fps : 30;
  const preset = FPS_PRESETS.find((x) => Math.abs(fpsValue(x.fps) - fps) < 0.01);
  return preset ? preset.fps : { num: Math.round(fps * 1000), den: 1000 };
}
export const sourceFrames = (asset: Asset, fps = sourceFps(asset)) => Math.max(1, Math.floor((asset.kind === "image" && !asset.animated ? 5 : asset.duration) * fpsValue(fps) + 1e-6));

/** An isolated source timeline, with no edits from the program monitor. */
export function sourceProject(asset: Asset): Project {
  const fps = sourceFps(asset);
  const p = createProject({ width: asset.width || 640, height: asset.height || 360, fps });
  const clip = clipForAsset(asset, 0, fps);
  clip.id = `source-${asset.id}`;
  clip.duration = sourceFrames(asset, fps);
  p.assets = [asset];
  p.tracks[0] = { ...p.tracks[0], kind: asset.kind === "audio" ? "audio" : "video", clips: [clip] };
  return p;
}

/** Out is exclusive. Round down to avoid adding a frame past the selection. */
export function withSourceRange(clip: Clip, asset: Asset, range: SourceRange, fps: Rational): Clip {
  if (asset.kind === "image" && !asset.animated) return { ...clip, duration: range.duration ?? clip.duration };
  if (clip.type !== "image" && !("in" in clip)) return clip;
  if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in || range.out > asset.duration + 1e-6) throw new Error("Choose a range inside the source.");
  const speed = range.speed ?? 1;
  const duration = range.duration ?? Math.floor((range.out - range.in) * fpsValue(fps) / speed + 1e-6);
  if (!Number.isFinite(speed) || speed < 0.05 || speed > 100 || !Number.isSafeInteger(duration) || duration / fpsValue(fps) * speed > range.out - range.in + 1e-6) throw new Error("Invalid source duration or speed.");
  if (duration < 1) throw new Error("Select at least one project frame.");
  return clip.type === "image" ? { ...clip, imageIn: range.in, duration } : { ...clip, in: range.in, duration, speed };
}

export interface SourceMarks {
  sourceIn?: number; sourceOut?: number;
  timelineIn?: number; timelineOut?: number;
  fit?: "fill" | "trim";
}
export interface SourceEdit extends SourceRange { start: number; duration: number; speed: number }

/** Times at this boundary are seconds; Out is exclusive. Only explicit
 * marks count toward four-point ambiguity. A lone timeline Out backtimes. */
export function resolveSourceEdit(asset: Asset, fps: Rational, playhead: number, marks: SourceMarks): SourceEdit {
  for (const x of [marks.sourceIn, marks.sourceOut, marks.timelineIn, marks.timelineOut]) if (x !== undefined && (!Number.isFinite(x) || x < 0)) throw new Error("Marks must be nonnegative seconds.");
  const rate = fpsValue(fps), snap = (s: number) => secondsToFrames(s, fps);
  const si = marks.sourceIn, so = marks.sourceOut, ti = marks.timelineIn, to = marks.timelineOut;
  const sourceEnd = asset.kind === "image" && !asset.animated ? 5 : asset.duration;
  if ((si !== undefined && si >= sourceEnd) || (so !== undefined && so > sourceEnd + 1e-6) || (si !== undefined && so !== undefined && so <= si)) throw new Error("Choose a range inside the source.");
  if (ti !== undefined && to !== undefined && snap(to) <= snap(ti)) throw new Error("Timeline Out must follow In.");
  const timelineLength = ti !== undefined && to !== undefined ? snap(to) - snap(ti) : undefined;
  let start = ti !== undefined ? snap(ti) : Math.round(playhead);
  let from = si ?? 0, end = so ?? sourceEnd, speed = 1;
  let duration = Math.floor((end - from) * rate + 1e-6);
  if (timelineLength !== undefined) {
    if (si !== undefined && so !== undefined && duration !== timelineLength && !marks.fit) throw new Error("Choose Fit to fill or Trim source to fit.");
    duration = timelineLength;
    if (si !== undefined && so !== undefined && marks.fit === "fill") speed = (so - si) * rate / duration;
    else if (si === undefined && so !== undefined) from = so - duration / rate;
    else end = from + duration / rate;
  } else if (ti === undefined && to !== undefined) start = snap(to) - duration;
  if (duration < 1 || start < 0 || from < -1e-6 || end > sourceEnd + 1e-6 || (so !== undefined && end > so + 1e-6)) throw new Error("Not enough source media for the marked range.");
  if (asset.kind === "image" && speed !== 1) throw new Error("Fit to fill speed changes need a video or audio source.");
  if (speed < 0.05 || speed > 100) throw new Error("Fit to fill needs a speed between 0.05 and 100.");
  return { start, in: Math.max(0, from), out: end, duration, speed };
}
