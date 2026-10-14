// Where a new overlay (sticker, title, template part) lands: on top of
// everything already visible during its time range, so what was just added
// is what the viewer shows. CapCut stacks a new sticker or text the same way.

import { createTrack } from "./project/defaults";
import * as ops from "./project/ops";
import type { Clip, Project, Track } from "./project/types";

const overlaps = (t: Track, start: number, end: number) => t.clips.some((c) => c.start < end && c.start + c.duration > start);

/**
 * Add `clip` directly above the topmost video track that has anything in the
 * clip's range (or above the main track when nothing does). The track
 * already there is reused when it is a free, unlocked overlay track, so
 * stickers added one after another share a row; otherwise a new track named
 * `name` is inserted. Calling this bottom layer first stacks a multi-layer
 * template in order.
 */
export function placeOnTop(p: Project, clip: Clip, name: string): Project {
  const end = clip.start + clip.duration;
  let top = p.tracks.findIndex((t) => t.kind === "video" && overlaps(t, clip.start, end));
  if (top < 0) top = Math.max(0, p.tracks.findIndex((t) => t.main));
  const above = p.tracks[top - 1];
  if (above && above.kind === "video" && !above.main && !above.locked) return ops.addClip(p, above.id, clip);
  const track = createTrack("video", name);
  return ops.addClip(ops.addTrack(p, track, top), track.id, clip);
}
