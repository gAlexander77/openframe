// Where a library drop lands on the timeline. The drop preview and the drop
// run the same placement: the timeline places the dragged item on the
// current project as a dry run and draws the difference (landing), so the
// preview never shows a spot the drop does not use (UX-12, UX-13).

import { assetRole, roleTrack } from "./audioRoles";
import { clipForAsset, createTrack } from "./project/defaults";
import * as ops from "./project/ops";
import type { Asset, Clip, Id, Project, Track } from "./project/types";
import { withSourceRange, type SourceRange } from "./sourceMonitor";
import { FPS_PRESETS, fpsValue } from "./time";

/** The cut nearest `frame` on a track (0 or a clip's end), earlier on a
 * tie: where an insert on the magnetic main track lands, since CapCut
 * never splits or overwrites a main clip to make room (§2.8). */
export function nearestCut(t: Track, frame: number): number {
  let best = 0;
  for (const c of t.clips) {
    const end = c.start + c.duration;
    if (Math.abs(end - frame) < Math.abs(best - frame)) best = end;
  }
  return best;
}

/**
 * Where a video or image dropped on track `row` at `frame` goes (CapCut
 * §2.8). Above the top track (row -1), a new overlay track at the drop
 * time — once the main track has something to overlay; on an unlocked
 * video track, that track; anywhere else, the main track, where the magnet
 * inserts at the nearest cut. `row` indexes `tracks`; a result row of -1
 * means a new top track.
 */
export function visualDrop(tracks: Track[], row: number, frame: number, magnet: boolean): { row: number; frame: number; insert: boolean } {
  const main = tracks.findIndex((t) => t.main);
  if (row < 0 && tracks[main].clips.length) return { row: -1, frame, insert: false };
  const t = tracks[row];
  const at = t && t.kind === "video" && !t.locked ? row : main;
  if (at === main && magnet) return { row: at, frame: nearestCut(tracks[at], frame), insert: true };
  return { row: at, frame, insert: false };
}

/** CapCut: the first clip on an empty timeline sets the canvas size and
 * frame rate, so phone footage gets a vertical project automatically —
 * unless the user already chose a canvas, which then only takes the
 * clip's frame rate (UX-02). */
export function adoptSettings(p: Project, a: Asset): Project {
  const empty = p.tracks.every((t) => t.clips.length === 0);
  if (!empty || a.kind === "audio" || !a.width || !a.height) return p;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let fps = p.fps;
  if (a.fps) {
    const nearest = FPS_PRESETS.reduce((b, x) => (Math.abs(fpsValue(x.fps) - a.fps!) < Math.abs(fpsValue(b.fps) - a.fps!) ? x : b));
    if (Math.abs(fpsValue(nearest.fps) - a.fps) < 0.5) fps = nearest.fps;
  }
  return p.canvasFixed ? { ...p, fps } : { ...p, width: even(a.width), height: even(a.height), fps };
}

/**
 * Put an asset on the timeline at `start` (the + button, a drop, the
 * source monitor). Video and images go on `to` — a track id, "overlay"
 * for a new top track, or the main track by default — where the magnet
 * inserts at the nearest cut on the main track and an occupied spot
 * elsewhere opens a new track; audio goes on `to` or the first audio track
 * with room, or a new one. Pure: the drop preview runs it as a dry run.
 */
export function placeAsset(
  p0: Project,
  asset: Asset,
  start: number,
  to: Id | "overlay" | undefined,
  magnet: boolean,
  range?: SourceRange,
  /** Premiere's Insert or Overwrite edit: exactly at `start` on the target
   * (the main track, or the first audio track), splitting what is there,
   * instead of the timeline's own placement. */
  mode?: ops.PlaceMode,
): { project: Project; clipId: Id } {
  let p = adoptSettings(p0, asset);
  let clip: Clip = clipForAsset(asset, start, p.fps);
  if (range) clip = withSourceRange(clip, asset, range, p.fps);
  const clipId = clip.id;
  if (asset.kind === "audio") {
    if (!mode && (!to || to === "overlay")) {
      // By what the sound is (ADR-098): a voice on the voiceover, an
      // effect on the effects track, an imported song on a music track.
      const r = roleTrack(p, assetRole(asset), clip.start, clip.duration);
      return { project: ops.addClip(r.project, r.trackId, clip, "overwrite"), clipId };
    }
    let track = to && to !== "overlay" ? ops.findTrack(p, to) : p.tracks.find((t) => t.kind === "audio" && !t.locked);
    if (!track || track.kind !== "audio") {
      track = createTrack("audio", "Audio");
      p = ops.addTrack(p, track);
    }
    if (mode) return { project: ops.addClip(p, track.id, clip, mode), clipId };
    return { project: ops.placeClip(p, track.id, clip, { collision: "newTrack" }), clipId };
  }
  if (to === "overlay") {
    const t = createTrack("video", "Overlay");
    return { project: ops.addClip(ops.addTrack(p, t, 0), t.id, clip), clipId };
  }
  const target = to ? ops.findTrack(p, to) : ops.mainTrack(p);
  if (!target || target.kind !== "video") return { project: p, clipId };
  if (mode) return { project: ops.addClip(p, target.id, clip, mode), clipId };
  if (target.main && magnet) {
    // Snap to the nearest cut so nothing is split by an insert.
    return { project: ops.addClip(p, target.id, { ...clip, start: nearestCut(target, start) }, "insert"), clipId };
  }
  return { project: ops.placeClip(p, target.id, clip, { collision: "newTrack" }), clipId };
}

/** The touching cut a transition dropped on track `row` near `frame` goes
 * on, as the clip before it: the nearest on that video track, or on the
 * main track when that one has none. */
export function transitionCut(tracks: Track[], row: number, frame: number): { clipId: Id; row: number; frame: number } | null {
  const cuts = (i: number) => {
    const t = tracks[i];
    if (!t || t.kind !== "video" || t.locked) return [];
    return t.clips.filter((c, k) => t.clips[k + 1]?.start === c.start + c.duration).map((c) => ({ clipId: c.id, row: i, frame: c.start + c.duration }));
  };
  let list = cuts(row);
  if (!list.length) list = cuts(tracks.findIndex((t) => t.main));
  return list.reduce<ReturnType<typeof transitionCut>>((b, c) => (!b || Math.abs(c.frame - frame) < Math.abs(b.frame - frame) ? c : b), null);
}

/** What a drop does, in the layout of the timeline before it. */
export interface Landing {
  /** The row the clip lands on; with `newTrack`, the index a new track is
   * inserted at (0: above everything; the track count: below everything). */
  row: number;
  newTrack: boolean;
  frame: number;
  duration: number;
  /** Frames each existing clip moves to make room (magnet inserts, and the
   * clips linkage carries with them). */
  shifts: Map<Id, number>;
}

/** Read a drop's landing off its dry run: `after` is `before` with clip
 * `clipId` placed, exactly as the drop will commit it. */
export function landing(before: Project, after: Project, clipId: Id): Landing | null {
  const at = after.tracks.findIndex((t) => t.clips.some((c) => c.id === clipId));
  if (at < 0) return null;
  const track = after.tracks[at];
  const clip = track.clips.find((c) => c.id === clipId)!;
  const known = new Set(before.tracks.map((t) => t.id));
  const newTrack = !known.has(track.id);
  const row = newTrack ? after.tracks.slice(0, at).filter((t) => known.has(t.id)).length : before.tracks.findIndex((t) => t.id === track.id);
  const was = new Map(before.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start] as const)));
  const shifts = new Map<Id, number>();
  for (const t of after.tracks) {
    for (const c of t.clips) {
      const s = was.get(c.id);
      if (s !== undefined && s !== c.start) shifts.set(c.id, c.start - s);
    }
  }
  return { row, newTrack, frame: clip.start, duration: clip.duration, shifts };
}
