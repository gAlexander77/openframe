// J and L cuts (Premiere's split edit, ADR-147): the sound's cut moved off
// the picture's. Each shot's sound becomes an audio clip of its own, as
// Detach audio makes it, both on one audio track, and the cut between them
// rolls: one sound grows by what the other loses, so nothing goes out of
// sync and nothing else moves.

import { createTrack } from "./defaults";
import { clipEnd, detachAudio, findClip, getAsset, moveClip, rollBounds, rollEdit, sourceTimeAt, type TrimStop } from "./ops";
import type { AudioClip, Clip, Id, Project, VideoClip } from "./types";

export interface SplitEdit {
  project: Project;
  /** The two sounds, outgoing then incoming, and the track they share. */
  audio: [Id, Id];
  trackId: Id;
  /** The picture's cut and where the sound's cut landed, timeline frames. */
  cut: number;
  at: number;
  /** Set when the sound's cut stopped short of what was asked. */
  stop?: { clip: Clip; edge: "start" | "end"; why: TrimStop };
}

/** The audio clip that plays a video clip's sound: one an earlier detach
 * made (same file, same group, still in sync), else a new one. */
function soundOf(p: Project, videoId: Id): { project: Project; id: Id } {
  const v = findClip(p, videoId)?.clip;
  if (!v) throw new Error(`no clip with id ${videoId}`);
  if (v.type !== "video") throw new Error(`${videoId} is ${v.type === "audio" || v.type === "image" || v.type === "adjustment" ? "an" : "a"} ${v.type} clip: a J or L cut is made at the cut between two video clips`);
  if (getAsset(p, v.assetId)?.hasAudio === false) throw new Error(`${videoId} has no sound (its file is silent)`);
  if (v.muted) {
    const inSync = (a: AudioClip) => Math.abs(sourceTimeAt(a, v.start, p.fps) - sourceTimeAt(v, v.start, p.fps)) < (0.5 * p.fps.den) / p.fps.num;
    const overlap = (a: Clip) => Math.min(clipEnd(a), clipEnd(v)) - Math.max(a.start, v.start);
    const mates = p.tracks.flatMap((t) => t.clips).filter((c): c is AudioClip => c.type === "audio" && !!v.group && c.group === v.group && c.assetId === v.assetId && inSync(c));
    const mate = mates.sort((a, b) => overlap(b) - overlap(a))[0];
    if (!mate) throw new Error(`${videoId} is muted and no detached sound of it is on the timeline`);
    return { project: p, id: mate.id };
  }
  const before = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const q = detachAudio(p, videoId);
  const made = q.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio" && !before.has(c.id));
  if (!made) throw new Error(`could not detach ${videoId}'s sound`);
  return { project: q, id: made.id };
}

/**
 * Put the sound's cut `by` frames after (L cut: the outgoing sound runs on
 * under the incoming picture) or before (J cut: the incoming sound starts
 * under the outgoing picture) the picture's cut between two touching video
 * clips. `by` is measured from the picture's cut, so calling again with
 * another value moves the same cut, and 0 makes it straight again.
 */
export function splitEdit(p: Project, leftId: Id, rightId: Id, by: number): SplitEdit {
  const L = findClip(p, leftId), R = findClip(p, rightId);
  if (!L || !R || L.track.id !== R.track.id || clipEnd(L.clip) !== R.clip.start) throw new Error(`${leftId} and ${rightId} do not touch on one track`);
  const cut = R.clip.start;
  const a = soundOf(p, leftId);
  const b = soundOf(a.project, rightId);
  let q = b.project;
  // Both sounds on one track, so the cut between them can roll.
  const la = findClip(q, a.id)!, ra = findClip(q, b.id)!;
  const apart = `the sounds of ${leftId} and ${rightId} (${a.id}, ${b.id}) no longer meet: roll_edit or trim_clip them by hand`;
  if (clipEnd(la.clip) !== ra.clip.start) throw new Error(apart);
  if (la.track.id !== ra.track.id) {
    const from = la.clip.start, len = clipEnd(ra.clip) - from;
    let home = q.tracks.find((t) => t.kind === "audio" && !t.locked && t.clips.every((c) => c.id === a.id || c.id === b.id || clipEnd(c) <= from || c.start >= from + len));
    if (!home) {
      home = createTrack("audio", "Audio");
      q = { ...q, tracks: [...q.tracks, home] };
    }
    for (const id of [a.id, b.id]) if (findClip(q, id)!.track.id !== home.id) q = moveClip(q, id, home.id, findClip(q, id)!.clip.start);
  }
  const bounds = rollBounds(q, a.id, b.id);
  if (!bounds) throw new Error(apart);
  const want = cut + Math.round(by);
  const at = Math.min(Math.max(want, bounds.lo), bounds.hi);
  const [clip, why] = want < bounds.lo ? bounds.loBy : bounds.hiBy;
  q = rollEdit(q, a.id, b.id, at);
  return { project: q, audio: [a.id, b.id], trackId: findClip(q, a.id)!.track.id, cut, at, ...(at !== want ? { stop: { clip, edge: clip.id === a.id ? "end" as const : "start" as const, why } } : {}) };
}

/** The two video clips that meet at a clip's cut, outgoing then incoming,
 * or why there is no such cut. */
export function cutNeighbors(p: Project, clipId: Id, edge: "start" | "end"): [VideoClip, VideoClip] | string {
  const loc = findClip(p, clipId);
  if (!loc) return `no clip with id ${clipId}`;
  const nb = loc.track.clips[loc.clipIndex + (edge === "start" ? -1 : 1)];
  const cut = edge === "start" ? loc.clip.start : clipEnd(loc.clip);
  if (!nb || (edge === "start" ? clipEnd(nb) : nb.start) !== cut) return `no clip touches ${clipId}'s ${edge}: a J or L cut needs two clips that meet at a cut`;
  const [l, r] = edge === "start" ? [nb, loc.clip] : [loc.clip, nb];
  if (l.type !== "video" || r.type !== "video") return `a J or L cut is made between two video clips; ${l.type !== "video" ? l.id : r.id} is ${l.type !== "video" ? l.type : r.type}`;
  return [l, r];
}
