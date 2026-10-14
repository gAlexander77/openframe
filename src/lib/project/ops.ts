// Editing operations: pure functions Project -> Project. The store applies
// them (with undo), automation and the AI copilot call them by name through
// commands.ts, and the tests pin each one's semantics. Trim modes follow the
// definitions in docs/research/Professional NLE features.md.
//
// Every op leaves the invariants normalizeProject checks: clips sorted, no
// overlaps on a track, durations >= 1, source ranges inside the asset.

import { setPath, upsertKey } from "../keyframes";
import type { Rational } from "../time";
import { createTrack, uid } from "./defaults";
import type {
  Asset,
  AudioClip,
  Clip,
  Id,
  Keyframe,
  Marker,
  Project,
  Track,
  TrackKind,
  Transition,
  VideoClip,
} from "./types";

// ---- lookups ----------------------------------------------------------------

export const clipEnd = (c: Clip) => c.start + c.duration;

export interface ClipLoc {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}

export function findClip(p: Project, clipId: Id): ClipLoc | null {
  for (let ti = 0; ti < p.tracks.length; ti++) {
    const track = p.tracks[ti];
    const ci = track.clips.findIndex((c) => c.id === clipId);
    if (ci >= 0) return { track, trackIndex: ti, clip: track.clips[ci], clipIndex: ci };
  }
  return null;
}

export const getAsset = (p: Project, id: Id): Asset | undefined =>
  p.assets.find((a) => a.id === id);

export const findTrack = (p: Project, id: Id) => p.tracks.find((t) => t.id === id);

export const mainTrack = (p: Project) => p.tracks.find((t) => t.main)!;

/** Last frame any clip occupies, exclusive. */
export function projectDuration(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export const isTimed = (c: Clip): c is VideoClip | AudioClip =>
  c.type === "video" || c.type === "audio";

/** Seconds of source consumed per timeline frame. */
export const sourcePerFrame = (c: VideoClip | AudioClip, fps: Rational) =>
  (c.speed * fps.den) / fps.num;

/** Source time (seconds) shown at timeline frame `f` inside clip `c`. */
export function sourceTimeAt(c: VideoClip | AudioClip, f: number, fps: Rational): number {
  if (c.freeze) return c.in;
  return c.in + (f - c.start) * sourcePerFrame(c, fps);
}

/** How many frames the clip's end could still grow before running out of
 * source. Stills, text and freezes are unlimited. */
export function roomRight(p: Project, c: Clip): number {
  if (!isTimed(c) || c.freeze) return Infinity;
  const a = getAsset(p, c.assetId);
  if (!a || !(a.duration > 0)) return Infinity;
  const total = Math.floor((a.duration - c.in) / sourcePerFrame(c, p.fps) + 1e-6);
  return Math.max(0, total - c.duration);
}

/** How many frames the clip's start could move left before source frame 0. */
export function roomLeft(p: Project, c: Clip): number {
  if (!isTimed(c) || c.freeze) return Infinity;
  return Math.floor(c.in / sourcePerFrame(c, p.fps) + 1e-6);
}

// ---- immutable plumbing -----------------------------------------------------

function withTrack(p: Project, trackId: Id, fn: (t: Track) => Track): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

function setClips(t: Track, clips: Clip[]): Track {
  return { ...t, clips: [...clips].sort((a, b) => a.start - b.start) };
}

export function updateClip(p: Project, clipId: Id, fn: (c: Clip) => Clip): Project {
  const loc = findClip(p, clipId);
  if (!loc) return p;
  return withTrack(p, loc.track.id, (t) =>
    setClips(
      t,
      t.clips.map((c) => (c.id === clipId ? fn(c) : c)),
    ),
  );
}

function omit<T extends object>(o: T, keys: string[]): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

function shiftKeys(keys: Clip["keyframes"], by: number): Clip["keyframes"] {
  if (!keys) return keys;
  const out: Record<string, Keyframe[]> = {};
  for (const [k, list] of Object.entries(keys)) out[k] = list.map((x) => ({ ...x, f: x.f + by }));
  return out;
}

/** Move a clip's left edge by `d` frames (+ = later), keeping its content
 * anchored to the timeline: source in-point and keyframes shift with it. */
function moveLeftEdge(c: Clip, d: number, fps: Rational): Clip {
  let out = { ...c, start: c.start + d, duration: c.duration - d } as Clip;
  if (isTimed(out) && !out.freeze) out = { ...out, in: out.in + d * sourcePerFrame(out, fps) };
  if (c.keyframes) out = { ...out, keyframes: shiftKeys(c.keyframes, -d) };
  return out;
}

// ---- split and range clearing ----------------------------------------------

/** Two halves of `c` cut at absolute frame `at` (start < at < end). Keys stay
 * on both halves (shifted on the right) so the animation curve is unchanged. */
export function splitParts(c: Clip, at: number, fps: Rational): [Clip, Clip] {
  const r = at - c.start;
  const left = omit({ ...c, duration: r } as Clip, ["transitionOut", "animOut"]);
  const right = omit(moveLeftEdge({ ...c, id: uid("c") } as Clip, r, fps), ["animIn"]);
  if ("fadeOut" in left) (left as AudioClip).fadeOut = 0;
  if ("fadeIn" in right) (right as AudioClip).fadeIn = 0;
  return [left, right];
}

export function splitClip(p: Project, clipId: Id, at: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || at <= loc.clip.start || at >= clipEnd(loc.clip)) return p;
  const [l, r] = splitParts(loc.clip, at, p.fps);
  return withTrack(p, loc.track.id, (t) =>
    setClips(t, [...t.clips.filter((c) => c.id !== clipId), l, r]),
  );
}

/** Split every clip under `at` on unlocked tracks, or only `clipIds`. */
export function splitAt(p: Project, at: number, clipIds?: Id[]): Project {
  for (const t of p.tracks) {
    if (t.locked) continue;
    for (const c of t.clips) {
      if (clipIds && !clipIds.includes(c.id)) continue;
      if (c.start < at && at < clipEnd(c)) p = splitClip(p, c.id, at);
    }
  }
  return p;
}

/** Remove [from, to) from a track's clips without moving anything else:
 * overlapping clips are trimmed or split around the hole (overwrite edit). */
function clearRange(clips: Clip[], from: number, to: number, fps: Rational): Clip[] {
  const out: Clip[] = [];
  for (const c of clips) {
    const end = clipEnd(c);
    if (end <= from || c.start >= to) out.push(c);
    else if (c.start >= from && end <= to) continue;
    else if (c.start < from && end > to) {
      const [l, rest] = splitParts(c, from, fps);
      const [, r] = splitParts(rest, to, fps);
      out.push(l, r);
    } else if (c.start < from) out.push({ ...c, duration: from - c.start } as Clip);
    else out.push(moveLeftEdge(c, to - c.start, fps));
  }
  return out;
}

// ---- add, delete, move ------------------------------------------------------

export type PlaceMode = "overwrite" | "insert";

const fitsTrack = (c: Clip, kind: TrackKind) => (c.type === "audio") === (kind === "audio");

/** Place a clip on a track. Overwrite clears the range under it; insert
 * ripples everything at or after its start to make room (splitting a clip
 * that straddles the insertion point). */
export function addClip(p: Project, trackId: Id, clip: Clip, mode: PlaceMode = "overwrite"): Project {
  const track = findTrack(p, trackId);
  if (!track || !fitsTrack(clip, track.kind)) return p;
  return withTrack(p, trackId, (t) => {
    if (mode === "overwrite") {
      return setClips(t, [...clearRange(t.clips, clip.start, clipEnd(clip), p.fps), clip]);
    }
    const shifted: Clip[] = [];
    for (const c of t.clips) {
      if (clipEnd(c) <= clip.start) shifted.push(c);
      else if (c.start >= clip.start) shifted.push({ ...c, start: c.start + clip.duration });
      else {
        const [l, r] = splitParts(c, clip.start, p.fps);
        shifted.push(l, { ...r, start: r.start + clip.duration });
      }
    }
    return setClips(t, [...shifted, clip]);
  });
}

/** Delete clips. Ripple closes each hole by pulling later clips on the same
 * track left (Premiere's ripple delete, CapCut's main-track behavior). */
export function deleteClips(p: Project, ids: Id[], ripple = false): Project {
  const gone = new Set(ids);
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      if (t.locked || !t.clips.some((c) => gone.has(c.id))) return t;
      if (!ripple) return { ...t, clips: t.clips.filter((c) => !gone.has(c.id)) };
      let shift = 0;
      const out: Clip[] = [];
      for (const c of t.clips) {
        if (gone.has(c.id)) {
          shift += c.duration;
          continue;
        }
        out.push(shift ? { ...c, start: c.start - shift } : c);
      }
      return setClips(t, out);
    }),
  };
}

/** Pack a track's clips end to end from frame 0 — the magnetic main track. */
export function compactTrack(p: Project, trackId: Id): Project {
  return withTrack(p, trackId, (t) => {
    let at = 0;
    const clips = t.clips.map((c) => {
      const moved = c.start === at ? c : { ...c, start: at };
      at += c.duration;
      return moved;
    });
    return { ...t, clips };
  });
}

/** Is [start, start+duration) free on the track, ignoring `ignore`? */
export function rangeFree(t: Track, start: number, duration: number, ignore?: Id): boolean {
  return t.clips.every((c) => c.id === ignore || clipEnd(c) <= start || c.start >= start + duration);
}

export interface MoveOptions {
  /** The magnetic main track reorders instead of overlapping. */
  magnet?: boolean;
  /** What to do when the destination is occupied: overwrite what is there
   * (Premiere) or put the clip on a new track (CapCut). */
  collision?: "overwrite" | "newTrack";
}

export function moveClip(
  p: Project,
  clipId: Id,
  trackId: Id,
  start: number,
  opts: MoveOptions = {},
): Project {
  const loc = findClip(p, clipId);
  const target = findTrack(p, trackId);
  if (!loc || !target || target.locked || loc.track.locked || !fitsTrack(loc.clip, target.kind)) {
    return p;
  }
  const clip = { ...loc.clip, start: Math.max(0, Math.round(start)) } as Clip;
  const q = withTrack(p, loc.track.id, (t) => ({
    ...t,
    clips: t.clips.filter((c) => c.id !== clipId),
  }));
  return placeClip(q, trackId, clip, opts);
}

/** Put a new clip on a track under the move rules: magnetic main track
 * reorders, a free spot takes it, an occupied one either overwrites or
 * spills onto a fresh track (see MoveOptions). */
export function placeClip(p: Project, trackId: Id, clip: Clip, opts: MoveOptions = {}): Project {
  const dest = findTrack(p, trackId);
  if (!dest || dest.locked || !fitsTrack(clip, dest.kind)) return p;
  if (opts.magnet && dest.main) {
    // Reorder by where the clip's center lands among the others' centers.
    const center = clip.start + clip.duration / 2;
    const others = dest.clips;
    let index = others.findIndex((c) => c.start + c.duration / 2 > center);
    if (index < 0) index = others.length;
    const ordered = [...others.slice(0, index), clip, ...others.slice(index)];
    let at = 0;
    const clips = ordered.map((c) => {
      const placed = { ...c, start: at } as Clip;
      at += c.duration;
      return placed;
    });
    return withTrack(p, trackId, (t) => ({ ...t, clips }));
  }
  if (rangeFree(dest, clip.start, clip.duration) || opts.collision !== "newTrack") {
    return addClip(p, trackId, clip, "overwrite");
  }
  // CapCut: dropping onto an occupied overlay spot makes room on a new track
  // just above it (below it for audio, which stacks downward).
  const fresh = createTrack(dest.kind, dest.kind === "audio" ? "Audio" : "Video");
  const at = p.tracks.findIndex((t) => t.id === trackId) + (dest.kind === "audio" ? 1 : 0);
  const q = { ...p, tracks: [...p.tracks.slice(0, at), fresh, ...p.tracks.slice(at)] };
  return addClip(q, fresh.id, clip, "overwrite");
}

// ---- trims ------------------------------------------------------------------

export type Edge = "start" | "end";

/**
 * Drag one edge of a clip to `frame`.
 * - Normal trim: limited by source handles and by the neighbor (no overlap).
 * - Ripple trim: the clip's later neighbors on the track move with the edge,
 *   so no gap opens and nothing is covered (Premiere's ripple edit tool).
 */
export function trimClip(p: Project, clipId: Id, edge: Edge, frame: number, ripple = false): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const { clip: c, track, clipIndex } = loc;
  const prev = track.clips[clipIndex - 1];
  const next = track.clips[clipIndex + 1];
  frame = Math.round(frame);
  if (edge === "start") {
    let lo = c.start - roomLeft(p, c);
    if (!ripple && prev) lo = Math.max(lo, clipEnd(prev));
    lo = Math.max(lo, 0);
    const to = Math.min(Math.max(frame, lo), clipEnd(c) - 1);
    const d = to - c.start;
    if (d === 0) return p;
    if (!ripple) return updateClip(p, clipId, (x) => moveLeftEdge(x, d, p.fps));
    // Ripple at the head keeps the clip's start where it is and shifts the
    // clip plus everything after it by the change in duration.
    const trimmed = moveLeftEdge(c, d, p.fps);
    const shift = -d;
    return withTrack(p, track.id, (t) =>
      setClips(
        t,
        t.clips.map((x) =>
          x.id === clipId
            ? { ...trimmed, start: c.start }
            : x.start >= clipEnd(c)
              ? { ...x, start: x.start + shift }
              : x,
        ),
      ),
    );
  }
  let hi = clipEnd(c) + roomRight(p, c);
  if (!ripple && next) hi = Math.min(hi, next.start);
  const to = Math.max(Math.min(frame, hi), c.start + 1);
  const d = to - clipEnd(c);
  if (d === 0) return p;
  return withTrack(p, track.id, (t) =>
    setClips(
      t,
      t.clips.map((x) =>
        x.id === clipId
          ? ({ ...x, duration: x.duration + d } as Clip)
          : ripple && x.start >= clipEnd(c)
            ? { ...x, start: x.start + d }
            : x,
      ),
    ),
  );
}

/** Roll edit: move the cut between two adjacent clips; the sequence length
 * does not change. Limited by both clips' source handles. */
export function rollEdit(p: Project, leftId: Id, rightId: Id, frame: number): Project {
  const L = findClip(p, leftId);
  const R = findClip(p, rightId);
  if (!L || !R || L.track.id !== R.track.id || clipEnd(L.clip) !== R.clip.start) return p;
  const lo = Math.max(L.clip.start + 1, R.clip.start - roomLeft(p, R.clip));
  const hi = Math.min(clipEnd(R.clip) - 1, clipEnd(L.clip) + roomRight(p, L.clip));
  const cut = Math.min(Math.max(Math.round(frame), lo), hi);
  const d = cut - R.clip.start;
  if (d === 0) return p;
  let q = updateClip(p, leftId, (c) => ({ ...c, duration: c.duration + d }) as Clip);
  q = updateClip(q, rightId, (c) => moveLeftEdge(c, d, p.fps));
  return q;
}

/** Slip: change which part of the source plays, keeping position and length. */
export function slipClip(p: Project, clipId: Id, deltaFrames: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || !isTimed(loc.clip) || loc.clip.freeze) return p;
  const c = loc.clip;
  const d = Math.min(Math.max(Math.round(deltaFrames), -roomLeft(p, c)), roomRight(p, c));
  if (d === 0) return p;
  return updateClip(p, clipId, (x) => ({ ...x, in: (x as VideoClip).in + d * sourcePerFrame(c, p.fps) }) as Clip);
}

/** Slide: move a clip between its neighbors; the previous clip's end and the
 * next clip's start absorb the move, so the sequence length is unchanged. */
export function slideClip(p: Project, clipId: Id, deltaFrames: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.track.locked) return p;
  const { clip: c, track, clipIndex } = loc;
  const prev = track.clips[clipIndex - 1];
  const next = track.clips[clipIndex + 1];
  if (!prev || !next || clipEnd(prev) !== c.start || clipEnd(c) !== next.start) return p;
  const lo = Math.max(-(prev.duration - 1), -roomLeft(p, next));
  const hi = Math.min(next.duration - 1, roomRight(p, prev));
  const d = Math.min(Math.max(Math.round(deltaFrames), lo), hi);
  if (d === 0) return p;
  let q = updateClip(p, prev.id, (x) => ({ ...x, duration: x.duration + d }) as Clip);
  q = updateClip(q, clipId, (x) => ({ ...x, start: x.start + d }) as Clip);
  q = updateClip(q, next.id, (x) => moveLeftEdge(x, d, p.fps));
  return q;
}

// ---- speed, freeze, detach -------------------------------------------------

/** Constant speed change. The clip keeps its source range, so its timeline
 * length scales; later clips on the track ripple by the difference. */
export function setSpeed(p: Project, clipId: Id, speed: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || !isTimed(loc.clip) || !(speed > 0)) return p;
  const c = loc.clip;
  const duration = Math.max(1, Math.round((c.duration * c.speed) / speed));
  const d = duration - c.duration;
  return withTrack(p, loc.track.id, (t) =>
    setClips(
      t,
      t.clips.map((x) =>
        x.id === clipId
          ? ({ ...x, speed, duration } as Clip)
          : x.start >= clipEnd(c)
            ? { ...x, start: x.start + d }
            : x,
      ),
    ),
  );
}

/** Insert a held frame at `at`, rippling the rest of the track (CapCut's
 * Freeze). Returns the project unchanged when `at` is outside a video clip. */
export function freezeFrame(p: Project, clipId: Id, at: number, frames: number): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "video" || at < loc.clip.start || at >= clipEnd(loc.clip)) {
    return p;
  }
  const c = loc.clip;
  const freeze: VideoClip = {
    ...omit(c, ["transitionOut", "animIn", "animOut", "keyframes"]),
    id: uid("c"),
    start: at,
    duration: frames,
    in: sourceTimeAt(c, at, p.fps),
    freeze: true,
    muted: true,
  };
  let q = at > c.start ? splitClip(p, clipId, at) : p;
  return addClip(q, loc.track.id, freeze, "insert");
}

/** Move a video clip's sound onto an audio track (CapCut's Extract audio),
 * so J/L cuts and separate audio edits become possible. */
export function detachAudio(p: Project, clipId: Id): Project {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "video" || loc.clip.muted) return p;
  const v = loc.clip;
  const audio: AudioClip = {
    id: uid("c"),
    type: "audio",
    assetId: v.assetId,
    start: v.start,
    duration: v.duration,
    in: v.in,
    speed: v.speed,
    ...(v.freeze ? { freeze: true } : {}),
    volume: v.volume,
    pan: v.pan,
    fadeIn: v.fadeIn,
    fadeOut: v.fadeOut,
    muted: false,
  };
  let q = updateClip(p, clipId, (c) => ({ ...c, muted: true }) as Clip);
  let track = q.tracks.find((t) => t.kind === "audio" && rangeFree(t, audio.start, audio.duration));
  if (!track) {
    track = createTrack("audio", "Audio");
    q = { ...q, tracks: [...q.tracks, track] };
  }
  return addClip(q, track.id, audio);
}

// ---- parameters and keyframes ----------------------------------------------

/** Set a parameter. If the path is keyframed, the value becomes a keyframe at
 * clip-relative frame `f` instead (pro editors' "auto-key" behavior). */
export function setParam(p: Project, clipIds: Id[], path: string, value: number, f?: number): Project {
  for (const id of clipIds) {
    p = updateClip(p, id, (c) => {
      const keys = c.keyframes?.[path];
      if (keys?.length && f !== undefined) {
        return { ...c, keyframes: { ...c.keyframes, [path]: upsertKey(keys, { ...keys.find((k) => k.f === f), f, v: value }) } };
      }
      return setPath(c, path, value);
    });
  }
  return p;
}

/** Add a keyframe at `f` holding the current value, or remove the one there. */
export function toggleKeyframe(p: Project, clipId: Id, path: string, f: number, current: number): Project {
  return updateClip(p, clipId, (c) => {
    const keys = c.keyframes?.[path] ?? [];
    const has = keys.some((k) => k.f === f);
    const next = has ? keys.filter((k) => k.f !== f) : upsertKey(keys, { f, v: current });
    const all = { ...c.keyframes, [path]: next };
    if (!next.length) delete all[path];
    return { ...c, keyframes: Object.keys(all).length ? all : undefined } as Clip;
  });
}

/** Attach a transition to the cut after `clipId`. Only adjacent clips can
 * share one; its length is capped by the shorter clip. */
export function setTransition(p: Project, clipId: Id, tr: Transition | null): Project {
  const loc = findClip(p, clipId);
  if (!loc) return p;
  const next = loc.track.clips[loc.clipIndex + 1];
  if (tr && (!next || next.start !== clipEnd(loc.clip))) return p;
  return updateClip(p, clipId, (c) => {
    if (!tr) return omit(c, ["transitionOut"]);
    const max = Math.min(c.duration, next!.duration);
    return { ...c, transitionOut: { ...tr, duration: Math.max(2, Math.min(tr.duration, max)) } } as Clip;
  });
}

// ---- tracks and markers -----------------------------------------------------

export function addTrack(p: Project, track: Track, index?: number): Project {
  const i = index ?? (track.kind === "audio" ? p.tracks.length : p.tracks.findIndex((t) => t.kind === "video"));
  const at = Math.max(0, Math.min(i, p.tracks.length));
  return { ...p, tracks: [...p.tracks.slice(0, at), track, ...p.tracks.slice(at)] };
}

export function updateTrack(p: Project, trackId: Id, patch: Partial<Track>): Project {
  return withTrack(p, trackId, (t) => ({ ...t, ...patch }));
}

/** Remove tracks that hold nothing, except the main track and the last
 * track of each kind (CapCut tidies empty tracks away the same way). */
export function pruneEmptyTracks(p: Project): Project {
  const tracks = p.tracks.filter((t) => t.main || t.clips.length > 0);
  return tracks.length === p.tracks.length ? p : { ...p, tracks };
}

export function addMarker(p: Project, m: Marker): Project {
  return { ...p, markers: [...p.markers, m].sort((a, b) => a.frame - b.frame) };
}

export function removeMarker(p: Project, id: Id): Project {
  return { ...p, markers: p.markers.filter((m) => m.id !== id) };
}

/** Every clip edge and marker on unlocked, visible tracks — snapping targets. */
export function editPoints(p: Project, exclude: Set<Id> = new Set()): number[] {
  const pts = new Set<number>([0]);
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (exclude.has(c.id)) continue;
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
  }
  for (const m of p.markers) pts.add(m.frame);
  return [...pts].sort((a, b) => a - b);
}

// ---- magnet and linkage -------------------------------------------------------

export interface SettleOptions {
  /** Pack the main track end to end (CapCut's main track magnet). */
  magnet: boolean;
  /** Overlay clips that start on a main-track clip move with it when it
   * moves (CapCut's linkage), so titles stay on their shots through ripples. */
  linkage: boolean;
}

/**
 * Apply the magnet and linkage after an edit turned `before` into `after`.
 * Linkage looks at where each main-track clip was and where it is now, and
 * shifts overlay clips that started inside its old span by the same amount,
 * unless the edit moved that overlay itself or the new spot is occupied.
 */
export function settle(before: Project, after: Project, o: SettleOptions): Project {
  let p = o.magnet ? compactTrack(after, mainTrack(after).id) : after;
  if (!o.linkage) return p;
  const oldMain = mainTrack(before);
  const newMain = mainTrack(p);
  const moves: { from: number; to: number; delta: number }[] = [];
  for (const c of oldMain.clips) {
    const now = newMain.clips.find((x) => x.id === c.id);
    if (now && now.start !== c.start) moves.push({ from: c.start, to: c.start + c.duration, delta: now.start - c.start });
  }
  if (!moves.length) return p;
  const oldPos = new Map(before.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start] as const)));
  for (const t of p.tracks) {
    if (t.main || t.locked) continue;
    for (const c of t.clips) {
      const was = oldPos.get(c.id);
      if (was === undefined || was !== c.start) continue; // new or moved by the edit itself
      const m = moves.find((x) => was >= x.from && was < x.to);
      if (!m) continue;
      const track = findTrack(p, t.id)!;
      const start = c.start + m.delta;
      if (start < 0 || !rangeFree(track, start, c.duration, c.id)) continue;
      p = withTrack(p, t.id, (tr) => setClips(tr, tr.clips.map((x) => (x.id === c.id ? ({ ...x, start } as Clip) : x))));
    }
  }
  return p;
}

// ---- frame rate ------------------------------------------------------------------

/** Change the project frame rate, rescaling every frame-based value once
 * (ADR-004: an explicit, rare operation). Clips keep their time in seconds;
 * edges that no longer land on a frame round to the nearest one, and each
 * track is re-packed so rounding can never create an overlap. */
export function setFps(p: Project, fps: Rational): Project {
  const r = (fps.num / fps.den) / (p.fps.num / p.fps.den);
  if (r === 1) return { ...p, fps };
  const f = (n: number) => Math.round(n * r);
  const keys = (k: Clip["keyframes"]) =>
    k ? Object.fromEntries(Object.entries(k).map(([path, list]) => [path, list.map((x) => ({ ...x, f: f(x.f) }))])) : k;
  const anim = <T extends { duration: number } | undefined>(a: T): T => (a ? { ...a, duration: Math.max(1, f(a.duration)) } : a);
  const tracks = p.tracks.map((t) => {
    let prevEnd = 0;
    const clips = t.clips.map((c) => {
      const start = Math.max(f(c.start), prevEnd);
      const end = Math.max(start + 1, f(c.start + c.duration));
      prevEnd = end;
      const out: Record<string, unknown> = { ...c, start, duration: end - start, keyframes: keys(c.keyframes) };
      for (const k of ["fadeIn", "fadeOut"]) if (typeof out[k] === "number") out[k] = f(out[k] as number);
      for (const k of ["animIn", "animOut", "animLoop", "transitionOut"]) if (out[k]) out[k] = anim(out[k] as { duration: number });
      return out as unknown as Clip;
    });
    return { ...t, clips };
  });
  return { ...p, fps, tracks, markers: p.markers.map((m) => ({ ...m, frame: f(m.frame) })) };
}
