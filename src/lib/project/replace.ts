// Replace clip (CapCut's right-click Replace, Premiere's Replace with clip):
// new media in the same spot. The clip keeps its identity, start, look and
// sound settings; its length holds unless the new source is shorter.

import { clipForAsset } from "./defaults";
import { findClip, updateClip } from "./ops";
import type { Asset, Clip, Id, Project } from "./types";

const VISUAL_KEYS = ["transform", "opacity", "blend", "crop", "adjust", "filter", "effects", "mask", "chromaKey", "animIn", "animOut", "animLoop", "transitionOut", "canvas"] as const;
const SOUND_KEYS = ["volume", "pan", "fadeIn", "fadeOut"] as const;

/** Why `asset` cannot stand in for the clip, or null when it can. */
export function replaceProblem(clip: Clip, asset: Asset): string | null {
  if (clip.type === "audio") return asset.kind === "audio" ? null : "Choose an audio file to replace an audio clip.";
  if (clip.type === "video" || clip.type === "image") return asset.kind === "video" || asset.kind === "image" ? null : "Choose a video or a picture to replace this clip.";
  return "Only media clips can be replaced.";
}

export function replaceClip(p: Project, clipId: Id, asset: Asset): Project {
  const loc = findClip(p, clipId);
  if (!loc) throw new Error(`no clip with id ${clipId}`);
  const old = loc.clip;
  const problem = replaceProblem(old, asset);
  if (problem) throw new Error(problem);
  if (loc.track.locked) return p;
  const fresh = clipForAsset(asset, old.start, p.fps) as Clip & Record<string, unknown>;
  const next: Record<string, unknown> = { ...fresh, id: old.id };
  // Optional settings (a mask, an animation) are absent on the fresh clip,
  // so carry by kind: the look between pictures, the sound between sounds.
  const keys = [...("transform" in old && "transform" in fresh ? VISUAL_KEYS : []), ...("volume" in old && "volume" in fresh ? SOUND_KEYS : [])];
  for (const k of keys) if (k in old) next[k] = (old as unknown as Record<string, unknown>)[k];
  if (old.keyframes) next.keyframes = old.keyframes;
  if (old.name) next.name = old.name;
  if (old.disabled) next.disabled = true;
  // A constant speed carries over; a speed curve belongs to the old shot.
  if ("speed" in old && "speed" in fresh && !old.speedCurve) next.speed = old.speed;
  // As long as before, unless the new source runs out first.
  const room = asset.kind === "image" ? Infinity : Math.max(1, Math.floor(fresh.duration / ((next.speed as number) ?? 1)));
  next.duration = Math.min(old.duration, room);
  const p2 = { ...p, assets: p.assets.some((a) => a.id === asset.id) ? p.assets : [...p.assets, asset] };
  return updateClip(p2, old.id, () => next as unknown as Clip);
}
