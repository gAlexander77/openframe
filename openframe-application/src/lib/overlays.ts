// Where a new overlay (sticker, title, template part) lands: on top of
// everything already visible during its time range, so what was just added
// is what the viewer shows. CapCut stacks a new sticker or text the same way.

import { createTrack } from "./project/defaults";
import * as ops from "./project/ops";
import type { Clip, Project, Track } from "./project/types";
import { framesToSeconds } from "./time";

const overlaps = (t: Track, start: number, end: number) => t.clips.some((c) => c.start < end && c.start + c.duration > start);

/** Footage: video, pictures other than stickers, and compound clips that
 * play some (a title card built as a compound is a graphic, as its titles
 * and shapes are). A title or sticker never shares a track with it, so
 * B-roll stays a B-roll row, and beat hits go above it (lib/epic.ts). */
export function isFootage(p: Project, c: Clip, depth = 0): boolean {
  if (c.type === "video") return true;
  // The brand's logo is a graphic (an end card's or a lower third's mark).
  if (c.type === "image") return !p.assets.find((a) => a.id === c.assetId)?.sticker && !Object.values(p.brand?.logos ?? {}).includes(c.assetId);
  if (c.type !== "compound") return false;
  const k = ops.findCompound(p, c.compoundId);
  return !k || depth > 4 || k.tracks.some((t) => t.kind === "video" && t.clips.some((x) => isFootage(p, x, depth + 1)));
}

/** A track of adjustment layers only (beat hits, bars, a grade). */
const effectRow = (t: Track) => t.clips.length > 0 && t.clips.every((c) => c.type === "adjustment");
/** A track of captions only (add_captions, a voiceover's). */
const captionRow = ops.isCaptionTrack;

/** A track an overlay may join: an unlocked video track other than the
 * main one, holding no footage, and neither a row of adjustment layers
 * nor of captions. */
const joinable = (p: Project, t: Track | undefined): t is Track =>
  !!t && t.kind === "video" && !t.main && !t.locked && !effectRow(t) && !captionRow(t) && !t.clips.some((c) => isFootage(p, c));

/** The track overlays over [start, end) go directly above: the topmost
 * video track that shows anything then, holds footage at all or is a row
 * of adjustment layers (the main track when none does), so a title never
 * sits under a B-roll row, or a grade or the beat hits, that is only empty
 * for now. Every track above it is free over the range, or a row of
 * captions: captions stay the top layer (ADR-121), so what lands goes
 * under them. */
function baseTrack(p: Project, start: number, end: number): number {
  const top = p.tracks.findIndex((t) => t.kind === "video" && !captionRow(t) && (overlaps(t, start, end) || effectRow(t) || t.clips.some((c) => isFootage(p, c))));
  return top >= 0 ? top : Math.max(0, p.tracks.findIndex((t) => t.main));
}

/** The adjustment layers drawn over a clip during its time: enabled ones
 * on visible video tracks above its own. A title placed under one takes
 * its look and effects (a grade, a beat hit's zoom). */
export function adjustmentsOver(p: Project, clipId: string): { clip: Clip; track: Track }[] {
  const at = p.tracks.findIndex((t) => t.clips.some((c) => c.id === clipId));
  if (at < 0) return [];
  const c = p.tracks[at].clips.find((x) => x.id === clipId)!;
  return p.tracks.slice(0, at).flatMap((t) => (t.kind !== "video" || t.hidden ? [] : t.clips.filter((x) => x.type === "adjustment" && !x.disabled && x.start < c.start + c.duration && x.start + x.duration > c.start).map((clip) => ({ clip, track: t }))));
}

/** A note for an answer when a title or graphic sits under an adjustment
 * layer, or nothing. */
export function underAdjustmentNote(p: Project, clipId: string, what: string): string | undefined {
  const over = adjustmentsOver(p, clipId);
  if (!over.length) return undefined;
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const list = over.slice(0, 3).map(({ clip, track }) => `${clip.id} on track ${track.id} "${track.name}" (${sec(clip.start)}-${sec(clip.start + clip.duration)} s)`).join(", ");
  return `${clipId} (${what}) is under the adjustment layer${over.length > 1 ? "s" : ""} ${list}${over.length > 3 ? ` and ${over.length - 3} more` : ""}: ${over.length > 1 ? "their" : "its"} look and effects (a grade, a beat hit's zoom) apply to it too. Leave track_id out to put it above everything at that time, or move_track the adjustment track below it.`;
}

/**
 * Add `clip` directly above whatever shows during its range (baseTrack).
 * The track already there is reused when it is a free overlay track
 * (joinable), so stickers added one after another share a row; otherwise
 * a new track named `name` is inserted.
 */
export function placeOnTop(p: Project, clip: Clip, name: string): Project {
  return placeStack(p, [clip], name);
}

/**
 * Add a multi-layer title or graphic (`clips`, bottom layer first) as one
 * block above whatever shows during it (ADR-073): layers that overlap in
 * time take rows of their own, each above the layers it covers; layers
 * that follow one another share a row (a countdown's numbers). The rows
 * sit together directly above the base track, reusing free overlay rows
 * there and inserting new ones named `name`, never a footage row. Template
 * and ad element callers group the clips themselves. `own`: the block
 * shares no row with anything else (an ad element, ADR-121), so moving an
 * unrelated track never slides between its parts; it may reuse the rows of
 * an earlier element of the same name (`name` the clips' own).
 */
export function placeStack(p: Project, clips: Clip[], name: string, own = false): Project {
  if (!clips.length) return p;
  // Row per clip: one above every earlier layer it overlaps.
  const rows: number[] = [];
  clips.forEach((c, i) => {
    const under = clips.slice(0, i).flatMap((o, j) => (o.start < c.start + c.duration && o.start + o.duration > c.start ? [rows[j]] : []));
    rows.push(under.length ? Math.max(...under) + 1 : 0);
  });
  let at = baseTrack(p, Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.start + c.duration)));
  for (let row = 0; row <= Math.max(...rows); row++) {
    const above = p.tracks[at - 1];
    let id: string;
    // own: only a row of the same element's parts (named alike) is shared,
    // never an empty one made for something else (the tester's Callouts).
    if (joinable(p, above) && (!own || (above.name === name && above.clips.every((c) => c.name === name)))) {
      id = above.id;
      at -= 1;
    } else {
      const track = createTrack("video", name);
      p = ops.addTrack(p, track, at);
      id = track.id;
    }
    clips.forEach((c, i) => {
      if (rows[i] === row) p = ops.addClip(p, id, c);
    });
  }
  return p;
}

/**
 * What to play so a just-added overlay shows (UX-15): an In animation
 * starts invisible (a title rising from below, a sticker popping from
 * nothing), so with the playhead inside one the viewer shows an empty
 * box. Returns the span from the earliest animated clip's start to where
 * the last In has settled, when the playhead sits inside it; else null.
 */
export function revealSpan(clips: Clip[], playhead: number): { from: number; to: number } | null {
  const ins = clips.flatMap((c) => ("animIn" in c && c.animIn && c.animIn.duration > 0 ? [{ start: c.start, end: c.start + Math.min(c.animIn.duration, c.duration) }] : []));
  if (!ins.length) return null;
  const from = Math.min(...ins.map((c) => c.start));
  const to = Math.max(...ins.map((c) => c.end));
  return playhead >= from && playhead < to ? { from, to } : null;
}

/**
 * What to play when an animation preset is picked (CapCut previews it):
 * the clip's In from its first frame to where it has settled, its Out from
 * where it starts to the clip's last frame, or one loop cycle, after the
 * In when the clip has room. Frames on the timeline; null when the slot is
 * empty.
 */
export function animationSpan(clip: Clip, slot: "in" | "out" | "loop"): { from: number; to: number } | null {
  if (!("transform" in clip)) return null;
  const a = slot === "in" ? clip.animIn : slot === "out" ? clip.animOut : clip.animLoop;
  if (!a || a.duration <= 0 || clip.duration < 2) return null;
  const last = clip.start + clip.duration - 1;
  const len = Math.min(a.duration, clip.duration - 1);
  if (slot === "in") return { from: clip.start, to: clip.start + len };
  if (slot === "out") return { from: last - len, to: last };
  const settled = clip.start + Math.min(clip.animIn?.duration ?? 0, clip.duration - 1);
  const from = settled + len <= last ? settled : last - len;
  return { from, to: from + len };
}
