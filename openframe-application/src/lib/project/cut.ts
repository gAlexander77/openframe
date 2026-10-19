// Edits driven by analysis: remove source ranges from a clip (silences,
// filler words, deleted transcript) and split a clip at source times (scene
// cuts). Pure ops like ops.ts; the commands cut_ranges and split_at_times
// wrap them (ADR-017 explains why their times are source seconds).

import type { Rational } from "../time";
import { clipEnd, deleteClips, findClip, isTimed, sourcePerFrame, splitClip } from "./ops";
import type { AudioClip, Clip, Id, Project, VideoClip } from "./types";

/** Seconds into the source file, [start, end). */
export interface SourceRange {
  start: number;
  end: number;
}

type TimedClip = VideoClip | AudioClip;

/** The timeline frame where source time `t` plays inside `c` (unclamped). */
export const frameOfSource = (c: TimedClip, t: number, fps: Rational) => c.start + Math.round((t - c.in) / sourcePerFrame(c, fps));

/** Timeline frame ranges [a, b) of `c` that the source ranges cover:
 * clamped to the clip, rounded to frames, sorted, overlaps merged. */
export function framesOfRanges(c: TimedClip, ranges: SourceRange[], fps: Rational): [number, number][] {
  const out: [number, number][] = [];
  const spans = ranges
    .map((r) => [Math.max(c.start, frameOfSource(c, r.start, fps)), Math.min(clipEnd(c), frameOfSource(c, r.end, fps))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  for (const [a, b] of spans) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Media clips only: analysis reports seconds of a file, and a compound
 * clip's source is a nested timeline. */
const cuttable = (c: Clip | undefined): c is TimedClip => !!c && isTimed(c) && c.type !== "compound" && !c.freeze;

/** Clips lined up with `c` on other unlocked tracks: same media, same
 * position, same source window (a video and the audio detached from it).
 * Cutting one without the other would knock them out of sync. */
export function linkedPartners(p: Project, c: TimedClip): Id[] {
  const ids: Id[] = [];
  for (const t of p.tracks) {
    if (t.locked) continue;
    for (const x of t.clips) {
      if (x.id === c.id || !cuttable(x)) continue;
      if (x.assetId === c.assetId && x.start === c.start && x.duration === c.duration && x.speed === c.speed && Math.abs(x.in - c.in) < 1e-6) ids.push(x.id);
    }
  }
  return ids;
}

/** Split `clipId` at each frame (descending, so the original id always
 * holds the leftmost part) and return the ids of the pieces in time order. */
function splitPieces(p: Project, clipId: Id, frames: number[]): [Project, Id[]] {
  const trackId = findClip(p, clipId)!.track.id;
  const cuts = [...new Set(frames)].sort((a, b) => b - a);
  for (const f of cuts) p = splitClip(p, clipId, f);
  const track = p.tracks.find((t) => t.id === trackId)!;
  const first = findClip(p, clipId)!.clip;
  const pieces = [first.id];
  for (const f of [...cuts].reverse()) {
    const piece = track.clips.find((x) => x.start === f && x.id !== first.id);
    if (piece && f > first.start) pieces.push(piece.id);
  }
  return [p, pieces];
}

export interface CutResult {
  project: Project;
  /** Ranges actually removed (after clamping and merging). */
  removed: number;
  /** Timeline frames removed from the clip. */
  frames: number;
}

/**
 * Remove source ranges from a clip: split at each range's edges and delete
 * the pieces inside. With `ripple`, later clips on the track close up (and
 * the clip itself gets shorter); without it the holes stay. Clips lined up
 * with it (detached audio) get the same cuts. Ranges outside the clip's
 * current source window are ignored, so a list computed once stays valid
 * while the clip is trimmed or cut.
 */
export function cutRanges(p: Project, clipId: Id, ranges: SourceRange[], ripple = true): CutResult {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || !cuttable(loc.clip)) return { project: p, removed: 0, frames: 0 };
  const spans = framesOfRanges(loc.clip, ranges, p.fps);
  if (!spans.length) return { project: p, removed: 0, frames: 0 };
  const targets = [loc.clip.id, ...linkedPartners(p, loc.clip)];
  const gone: Id[] = [];
  for (const id of targets) {
    const c = findClip(p, id)!.clip;
    const edges = spans.flatMap(([a, b]) => [a, b]).filter((f) => f > c.start && f < clipEnd(c));
    let pieces: Id[];
    [p, pieces] = splitPieces(p, id, edges);
    for (const pid of pieces) {
      const piece = findClip(p, pid)!.clip;
      if (spans.some(([a, b]) => piece.start >= a && clipEnd(piece) <= b)) gone.push(pid);
    }
  }
  return {
    project: deleteClips(p, gone, ripple),
    removed: spans.length,
    frames: spans.reduce((s, [a, b]) => s + b - a, 0),
  };
}

/** Split a clip (and the clips lined up with it) at source times. Times
 * outside the clip, or on its edges, are ignored. */
export function splitAtSourceTimes(p: Project, clipId: Id, times: number[]): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked || !cuttable(loc.clip)) return p;
  const c = loc.clip;
  const frames = times.map((t) => frameOfSource(c, t, p.fps)).filter((f) => f > c.start && f < clipEnd(c));
  if (!frames.length) return p;
  for (const id of [c.id, ...linkedPartners(p, c)]) [p] = splitPieces(p, id, frames);
  return p;
}
