import { clipForAsset, createProject } from "./project/defaults";
import type { Asset, Clip, Project } from "./project/types";
import { FPS_PRESETS, fpsValue, type Rational } from "./time";

export interface SourceRange { in: number; out: number }
/** The source's own rate; a probed 29.97 snaps to 30000/1001 (as on import)
 * so its timecode is drop-frame like the program monitor's. */
export function sourceFps(asset: Asset): Rational {
  const fps = asset.fps && asset.fps > 0 ? asset.fps : 30;
  const preset = FPS_PRESETS.find((x) => Math.abs(fpsValue(x.fps) - fps) < 0.01);
  return preset ? preset.fps : { num: Math.round(fps * 1000), den: 1000 };
}
export const sourceFrames = (asset: Asset, fps = sourceFps(asset)) => Math.max(1, Math.floor((asset.kind === "image" ? 5 : asset.duration) * fpsValue(fps) + 1e-6));

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
  if (asset.kind === "image" || !("in" in clip)) return clip;
  if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in || range.out > asset.duration + 1e-6) throw new Error("Choose a range inside the source.");
  const duration = Math.floor((range.out - range.in) * fpsValue(fps) + 1e-6);
  if (duration < 1) throw new Error("Select at least one project frame.");
  return { ...clip, in: range.in, duration };
}
