// Put a clip in sync with another: a separately recorded sound (a lav, a
// recorder) with the camera clip of the same take, once the offset between
// their sources is known (by waveform: lib/analysis/sync.ts; or by hand,
// from a clap). The sync is exact, not to the nearest frame: the clip
// starts on the frame nearest where it belongs and its in-point takes up
// the rest of that frame. Sound before the timeline's start is trimmed off
// the clip's head (the recorder ran before the camera did).

import type { Rational } from "../time";
import { deleteClips, findClip, getAsset, placeClip, shiftKeys, updateClip } from "./ops";
import type { AudioClip, Clip, Id, Project, VideoClip } from "./types";

type Media = VideoClip | AudioClip;

const isMedia = (c: Clip | undefined): c is Media => c?.type === "video" || c?.type === "audio";

/** Why `clipId` cannot be synced to `refId`, or null when it can. */
export function syncProblem(p: Project, clipId: Id, refId: Id): string | null {
  const loc = findClip(p, clipId), ref = findClip(p, refId)?.clip;
  if (!loc) return `No clip with id ${clipId}`;
  if (!ref) return `No clip with id ${refId}`;
  if (clipId === refId) return "A clip is always in sync with itself: pick two clips";
  const c = loc.clip;
  if (!isMedia(c) || !isMedia(ref)) return "Only video and audio clips can be synced";
  if (loc.track.locked) return "Its track is locked";
  // With the magnet on, the main track would close the gap right back.
  if (loc.track.main) return "Clips on the main track keep their place: sync the other clip to this one";
  for (const x of [c, ref]) {
    if (x.freeze) return "A freeze frame has no sound to sync";
    if (x.speedCurve || x.reverse) return "Sync needs both clips playing forward at a constant speed";
  }
  if (Math.abs(c.speed - ref.speed) > 1e-9) return "Sync needs both clips at the same speed";
  return null;
}

/** Source seconds per timeline frame. */
const perFrame = (c: Media, fps: Rational) => (c.speed * fps.den) / fps.num;

/**
 * Move `clipId` so that source second t of `refId` plays with source
 * second t + `offset` of `clipId`, on its own track (or a new one below
 * it, when that spot is taken). `muteRef` silences the reference (volume
 * 0, its volume keyframes removed): the synced sound replaces the camera's.
 */
export function syncClip(p: Project, clipId: Id, refId: Id, offset: number, muteRef = false): Project {
  const problem = syncProblem(p, clipId, refId);
  if (problem) throw new Error(problem);
  const loc = findClip(p, clipId)!, refLoc = findClip(p, refId)!;
  const clip = loc.clip as Media, ref = refLoc.clip as Media;
  if (muteRef && refLoc.track.locked) throw new Error("The track of the clip to sync to is locked, so its sound cannot be muted");
  const step = perFrame(clip, p.fps);
  const frame = (f: number) => (f * p.fps.den) / p.fps.num;
  // In sync, in - start * speed is the same for every placement: the
  // reference's own, shifted by the offset (times in seconds).
  const k = ref.in - frame(ref.start) * ref.speed + offset;
  // The nearest frame to start on, but never before the timeline or the
  // source begins: those cut the head instead.
  const ideal = (clip.in - k) / step;
  const start = Math.max(0, Math.round(ideal), Math.ceil(-k / step - 1e-9));
  const inPoint = Math.max(0, k + start * step);
  // The clip keeps the source it ended on, inside the media.
  const media = getAsset(p, clip.assetId)?.duration ?? Infinity;
  const duration = Math.min(Math.round((clip.in + clip.duration * step - inPoint) / step), Math.floor((media - inPoint) / step + 1e-6));
  if (duration < 1) throw new Error("In sync, none of it would be on the timeline: move the video later first");
  const head = Math.round((inPoint - clip.in) / step);
  const moved = { ...clip, start, in: inPoint, duration, ...(clip.keyframes ? { keyframes: shiftKeys(clip.keyframes, -head) } : {}) } as Clip;
  let q = placeClip(deleteClips(p, [clipId]), loc.track.id, moved, { collision: "newTrack" });
  if (muteRef) {
    q = updateClip(q, refId, (c) => {
      const { volume: _, ...keys } = c.keyframes ?? {};
      const { keyframes: __, ...rest } = c;
      return { ...rest, volume: 0, ...(Object.keys(keys).length ? { keyframes: keys } : {}) } as Clip;
    });
  }
  return q;
}

/** The offset the two clips play at now: `clipId`'s source second minus
 * `refId`'s at any one timeline moment (what syncClip places by). */
export function currentOffset(p: Project, clipId: Id, refId: Id): number {
  const c = findClip(p, clipId)?.clip, r = findClip(p, refId)?.clip;
  if (!isMedia(c) || !isMedia(r)) throw new Error("Only video and audio clips can be synced");
  const sec = (f: number) => (f * p.fps.den) / p.fps.num;
  return c.in - sec(c.start) * c.speed - (r.in - sec(r.start) * r.speed);
}
