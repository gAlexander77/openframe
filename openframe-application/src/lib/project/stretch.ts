// Premiere's Rate Stretch tool: drag a clip's edge and its speed changes so
// the same source fills the new length. The far edge stays put; dragging
// the end ripples later clips the way a speed change does here, dragging
// the start stops at the clip before.

import type { Rational } from "../time";
import { findClip, isTimed, sourceOffset } from "./ops";
import type { Clip, Id, Project } from "./types";

/** Speed limits, the same as the speed panel's. */
const MIN = 0.1, MAX = 100;

/** Frames' worth of source (at the project rate) the clip reads. */
const span = (c: Parameters<typeof sourceOffset>[0], fps: Rational) => (sourceOffset(c, c.duration, fps) * fps.num) / fps.den;

export function stretchClip(p: Project, clipId: Id, edge: "start" | "end", frame: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const c = loc.clip;
  if (!isTimed(c) || c.speedCurve || c.freeze) return p;
  const frames = span(c, p.fps); // source the clip reads, in project frames
  const end = c.start + c.duration;
  const prevEnd = loc.track.clips.slice(0, loc.clipIndex).reduce((m, x) => Math.max(m, x.start + x.duration), 0);
  // The length the drag asks for, within the speed limits (and, for the
  // start, the clip before).
  const lo = Math.max(1, Math.ceil(frames / MAX)), hi = Math.floor(frames / MIN);
  let want = edge === "end" ? frame - c.start : end - Math.max(frame, prevEnd);
  want = Math.min(hi, Math.max(lo, Math.round(want)));
  if (want === c.duration) return p;
  const speed = +(frames / want).toFixed(6);
  const next = { ...c, speed, duration: want, start: edge === "end" ? c.start : end - want } as Clip;
  const d = want - c.duration;
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id !== loc.track.id
        ? t
        : { ...t, clips: t.clips.map((x) => (x.id === c.id ? next : edge === "end" && x.start >= end ? { ...x, start: x.start + d } : x)) },
    ),
  };
}
