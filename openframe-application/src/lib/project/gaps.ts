// Gaps and nudges: Premiere's Ripple Delete on an empty stretch (Close gap),
// Resolve's Delete gaps for a whole track, and Premiere's Alt+arrow nudge
// of the selected clips by frames.

import { compactTrack, findTrack } from "./ops";
import type { Clip, Id, Project, Track } from "./types";

const end = (c: Clip) => c.start + c.duration;

/** The empty stretch [start, end) at `frame` between two clips (or before
 * the first), or null when a clip covers the frame or nothing follows it. */
export function gapAt(t: Track, frame: number): [number, number] | null {
  let from = 0;
  for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
    if (frame < c.start) return frame >= from && c.start > from ? [from, c.start] : null;
    from = Math.max(from, end(c));
    if (frame < from) return null;
  }
  return null;
}

/** Ripple the clips after the gap at `frame` left by its length. */
export function closeGap(p: Project, trackId: Id, frame: number): Project {
  const t = findTrack(p, trackId);
  const gap = t && !t.locked ? gapAt(t, frame) : null;
  if (!t || !gap) return p;
  const len = gap[1] - gap[0];
  const clips = t.clips.map((c) => (c.start >= gap[1] ? ({ ...c, start: c.start - len } as Clip) : c));
  return { ...p, tracks: p.tracks.map((x) => (x.id === trackId ? { ...x, clips } : x)) };
}

/** Pack a track's clips from frame 0, closing every gap. */
export function closeAllGaps(p: Project, trackId: Id): Project {
  const t = findTrack(p, trackId);
  return !t || t.locked || !t.clips.length ? p : compactTrack(p, trackId);
}

/** Move clips by `delta` frames on their tracks. All or nothing: a clip
 * that would pass frame 0, cover an unselected clip or sit on a locked
 * track leaves everything where it was. */
export function nudgeClips(p: Project, ids: Id[], delta: number): Project {
  const moving = new Set(ids);
  if (!delta || !moving.size) return p;
  let moved = false;
  const tracks: Track[] = [];
  for (const t of p.tracks) {
    if (!t.clips.some((c) => moving.has(c.id))) {
      tracks.push(t);
      continue;
    }
    if (t.locked) return p;
    const still = t.clips.filter((c) => !moving.has(c.id));
    const clips = t.clips.map((c) => (moving.has(c.id) ? ({ ...c, start: c.start + delta } as Clip) : c));
    for (const c of clips) {
      if (!moving.has(c.id)) continue;
      if (c.start < 0 || still.some((o) => o.start < end(c) && c.start < end(o))) return p;
    }
    moved = true;
    tracks.push({ ...t, clips: clips.sort((a, b) => a.start - b.start) });
  }
  return moved ? { ...p, tracks } : p;
}
