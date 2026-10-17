// Compound clips (ADR-037): CapCut's "Create compound clip", Premiere's
// Nest. A selection becomes one clip that plays a nested timeline stored in
// project.compounds; Break apart puts the clips back. Opening one for
// editing is a view: the project with the compound's tracks in place of its
// own, written back after each edit. Pure ops, like ops.ts.

import { frameAt, type Rational } from "../time";
import { createCompoundClip, createTrack, uid } from "./defaults";
import { addClip, clipEnd, deleteClips, findClip, findCompound, pruneEmptyTracks, rangeFree, setFps, sourceTimeAt, splitParts, timelineEnd } from "./ops";
import type { Clip, Compound, CompoundClip, Id, Marker, Project, Track } from "./types";

/** The inner timeline frame a compound clip shows at timeline frame `f`.
 * Inner frames are whole frames of the same rate: the nested timeline is
 * a source like a file, sampled at its frames. */
export const innerFrameAt = (c: CompoundClip, f: number, fps: Rational) => frameAt(sourceTimeAt(c, f, fps), fps);

/** Every compound clip on these tracks. */
const compoundClips = (tracks: Track[]) =>
  tracks.flatMap((t) => t.clips.filter((c): c is CompoundClip => c.type === "compound"));

/** Do these tracks play `target`, directly or through other compounds? */
export function reaches(p: Project, tracks: Track[], target: Id, seen = new Set<Id>()): boolean {
  for (const c of compoundClips(tracks)) {
    if (c.compoundId === target) return true;
    if (seen.has(c.compoundId)) continue;
    seen.add(c.compoundId);
    const k = findCompound(p, c.compoundId);
    if (k && reaches(p, k.tracks, target, seen)) return true;
  }
  return false;
}

/** Drop compounds nothing plays any more, from the root timeline down.
 * Only meaningful on the whole document, never on an open compound's view
 * (which cannot see the root timeline's clips). */
export function pruneCompounds(p: Project): Project {
  if (!p.compounds?.length) return p;
  const live = new Set<Id>();
  const walk = (tracks: Track[]) => {
    for (const c of compoundClips(tracks)) {
      if (live.has(c.compoundId)) continue;
      live.add(c.compoundId);
      const k = findCompound(p, c.compoundId);
      if (k) walk(k.tracks);
    }
  };
  walk(p.tracks);
  if (live.size === p.compounds.length) return p;
  return withCompounds(p, p.compounds.filter((k) => live.has(k.id)));
}

function withCompounds(p: Project, list: Compound[]): Project {
  const { compounds: _old, ...rest } = p;
  return list.length ? { ...rest, compounds: list } : rest;
}

// ---- create ---------------------------------------------------------------------

const label = (c: Clip) => c.name ?? (c.type === "text" ? `"${c.text}"` : `a ${c.type} clip`);

/** Why these clips cannot become a compound clip, or null when they can. */
export function compoundProblem(p: Project, ids: Id[]): string | null {
  const locs = ids.map((id) => findClip(p, id)).filter((l) => !!l);
  if (!locs.length) return "Select the clips to put in a compound clip.";
  if (locs.some((l) => l.track.locked)) return "A selected clip is on a locked track; unlock it first.";
  const video = locs.filter((l) => l.track.kind === "video");
  if (!video.length) return "A compound clip needs at least one clip from a video track.";
  const dest = video.reduce((a, b) => (b.trackIndex > a.trackIndex ? b : a)).track;
  const start = Math.min(...locs.map((l) => l.clip.start));
  const end = Math.max(...locs.map((l) => clipEnd(l.clip)));
  const sel = new Set(ids);
  const blocker = dest.clips.find((c) => !sel.has(c.id) && c.start < end && clipEnd(c) > start);
  if (blocker) return `${label(blocker)} is in the way on ${dest.name}: a compound clip takes the whole span of the clips in it. Select it too, or move it.`;
  return null;
}

/**
 * Turn the selected clips into one compound clip on the lowest selected
 * video track, at the earliest start, spanning to the latest end. The clips
 * keep their ids, tracks (one inner track per track they came from, in the
 * same order), timing relative to each other, effects, keyframes and
 * transitions between them; a transition to a clip left outside is dropped.
 * Returns the project unchanged (and clipId null) when compoundProblem
 * names a reason.
 */
export function createCompound(p: Project, ids: Id[], name?: string): { project: Project; clipId: Id | null } {
  if (compoundProblem(p, ids)) return { project: p, clipId: null };
  const sel = new Set(ids);
  const picked = p.tracks.flatMap((t, ti) => t.clips.filter((c) => sel.has(c.id)).map((c) => ({ c, t, ti })));
  const start = Math.min(...picked.map((x) => x.c.start));
  const end = Math.max(...picked.map((x) => clipEnd(x.c)));
  const dest = picked.filter((x) => x.t.kind === "video").reduce((a, b) => (b.ti > a.ti ? b : a)).t;
  const split = new Set(p.tracks.flatMap((t) => t.clips.filter((c) => c.group && !sel.has(c.id)).map((c) => c.group!)));
  const tracks: Track[] = p.tracks
    .filter((t) => t.clips.some((c) => sel.has(c.id)))
    .map((t) => {
      const clips = t.clips.flatMap((c, i) => {
        if (!sel.has(c.id)) return [];
        const next = t.clips[i + 1];
        const keepTr = "transitionOut" in c && c.transitionOut && next && sel.has(next.id);
        const { transitionOut: _tr, ...rest } = c as Clip & { transitionOut?: unknown };
        const inner = { ...(keepTr ? c : rest), start: c.start - start } as Clip;
        // A group the selection splits stays outside; a whole one comes in.
        if (inner.group && split.has(inner.group)) delete inner.group;
        return [inner];
      });
      const { main: _m, ...base } = t;
      return { ...base, id: uid("t"), locked: false, clips, ...(t.main ? { main: true } : {}) };
    });
  // One main video track, as every timeline has: the one that came from
  // the main track, else the bottom video track (normalizeProject's rule).
  if (!tracks.some((t) => t.main)) {
    const bottom = [...tracks].reverse().find((t) => t.kind === "video")!;
    bottom.main = true;
  }
  const compound: Compound = { id: uid("k"), name: name ?? `Compound clip ${(p.compounds?.length ?? 0) + 1}`, tracks, markers: [] };
  const clip = createCompoundClip(compound.id, start, end - start);
  let q = deleteClips(p, ids);
  q = addClip(q, dest.id, clip, "overwrite");
  q = pruneEmptyTracks({ ...q, compounds: [...(q.compounds ?? []), compound] });
  return { project: q, clipId: clip.id };
}

// ---- break apart ----------------------------------------------------------------

/** Why a compound clip cannot be broken apart, or null. */
export function breakProblem(p: Project, clipId: Id): string | null {
  const loc = findClip(p, clipId);
  if (!loc || loc.clip.type !== "compound") return "Select a compound clip.";
  if (loc.track.locked) return "The compound clip is on a locked track; unlock it first.";
  if (!findCompound(p, loc.clip.compoundId)) return "This compound clip's timeline is missing.";
  if (loc.clip.speed !== 1 || loc.clip.speedCurve) return "Set the compound clip's speed back to 1x before breaking it apart.";
  return null;
}

/** Clips put back on the magnetic main track must run gapless from the
 * window's start, and fill it unless nothing follows on the track: the
 * magnet would otherwise close the gap and move everything after it. */
const fitsMain = (t: Track, clips: Clip[], from: number, to: number) => {
  if (!clips.length || clips[0].start !== from || !clips.every((c, i) => i === 0 || c.start === clipEnd(clips[i - 1]))) return false;
  return clipEnd(clips[clips.length - 1]) === to || !t.clips.some((c) => c.start >= to);
};

/**
 * Put a compound clip's contents back on the timeline where it showed them
 * (Resolve's Decompose in Place, CapCut's Undo compound clip): what was
 * visible stays at the same frames, parts hidden by the compound clip's
 * trims are trimmed off, the bottom inner track lands on the compound
 * clip's track and the others above it (audio on audio tracks), each on a
 * new track where the old one has no room. The compound clip's own effects,
 * transform and volume go with it, as in Resolve. The compound itself stays
 * in the project while anything still plays it (pruneCompounds, which the
 * store runs on the whole document).
 * ponytail: when the bottom track inside does not fit the main track, it
 * lands above, and the magnet closes the main track's gap.
 */
export function breakCompound(p: Project, clipId: Id): Project {
  if (breakProblem(p, clipId)) return p;
  const loc = findClip(p, clipId)!;
  const K = loc.clip as CompoundClip;
  const inner = findCompound(p, K.compoundId)!;
  const ws = K.start;
  const we = clipEnd(K);
  const offset = ws - innerFrameAt(K, ws, p.fps);
  let q = deleteClips(p, [clipId]);
  // The inner clips moved to the timeline and cut to the clip's window.
  const window = (t: Track) =>
    t.clips.flatMap((c0) => {
      let c = { ...c0, start: c0.start + offset } as Clip;
      if (clipEnd(c) <= ws || c.start >= we) return [];
      if (c.start < ws) c = { ...splitParts(c, ws, p.fps)[1], id: c.id };
      if (clipEnd(c) > we) c = splitParts(c, we, p.fps)[0];
      return [c];
    });
  const fits = (t: Track, clips: Clip[]) =>
    !t.locked && clips.every((c) => rangeFree(t, c.start, c.duration)) && (!t.main || fitsMain(t, clips, ws, we));
  // Groups too: a second copy broken apart gets groups of its own.
  const taken = new Set(q.tracks.flatMap((t) => t.clips.flatMap((c) => (c.group ? [c.group] : []))));
  const regroup = new Map<Id, Id>();
  const place = (trackId: Id, clips: Clip[]) => {
    for (const c of clips) {
      // Ids stay when they are free here (a compound played once), so a
      // create-then-break round trip keeps every reference working.
      let clip = findClip(q, c.id) ? ({ ...c, id: uid("c") } as Clip) : c;
      if (clip.group && taken.has(clip.group)) {
        if (!regroup.has(clip.group)) regroup.set(clip.group, uid("g"));
        clip = { ...clip, group: regroup.get(clip.group) };
      }
      q = addClip(q, trackId, clip, "overwrite");
    }
  };
  // Video, bottom up: the compound clip's own track first, then the track
  // above the last one used, or a new track right above it.
  let at = q.tracks.findIndex((t) => t.id === loc.track.id);
  let first = true;
  for (const t of [...inner.tracks].reverse()) {
    if (t.kind !== "video") continue;
    const clips = window(t);
    if (!clips.length) continue;
    const want = first ? at : at - 1;
    const cand = q.tracks[want];
    if (cand && cand.kind === "video" && fits(cand, clips)) at = want;
    else {
      const fresh = { ...createTrack("video", t.name), muted: t.muted, hidden: t.hidden, volume: t.volume };
      q = { ...q, tracks: [...q.tracks.slice(0, at), fresh, ...q.tracks.slice(at)] };
    }
    place(q.tracks[at].id, clips);
    first = false;
  }
  // Audio: the first audio track with room, else a new one at the bottom.
  for (const t of inner.tracks) {
    if (t.kind !== "audio") continue;
    const clips = window(t);
    if (!clips.length) continue;
    let dest = q.tracks.find((x) => x.kind === "audio" && fits(x, clips));
    if (!dest) {
      dest = { ...createTrack("audio", t.name), muted: t.muted, volume: t.volume };
      q = { ...q, tracks: [...q.tracks, dest] };
    }
    place(dest.id, clips);
  }
  return pruneEmptyTracks(q);
}

/** Clips on `after`'s timeline that `before`'s did not have: what Break
 * apart put back, for selecting it. */
export function newClipIds(before: Project, after: Project): Id[] {
  const was = new Set(before.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return after.tracks.flatMap((t) => t.clips.filter((c) => !was.has(c.id)).map((c) => c.id));
}

// ---- open: a compound as the timeline being edited ----------------------------------

/** The project as seen from inside compound `id`: its tracks and markers
 * in place of the root timeline's. Every op works on it unchanged. */
export function compoundView(p: Project, id: Id): Project {
  const k = findCompound(p, id);
  return k ? { ...p, tracks: k.tracks, markers: k.markers } : p;
}

/**
 * Write an edited view of compound `id` back into the timeline it was
 * opened from (`p`: only its tracks, markers and frame rate are read). The
 * compound gets the view's tracks and markers; assets, LUTs, settings and
 * the other compounds come from the view (an import inside lands in the
 * project). A frame-rate change inside (which rescaled the view and every
 * compound) rescales the outer timeline once. An edit that would make the
 * compound play itself is refused: p comes back.
 */
export function withCompoundView(p: Project, id: Id, view: Project): Project {
  if (reaches(view, view.tracks, id)) return p;
  const same = view.fps.num * p.fps.den === p.fps.num * view.fps.den;
  const outer = same ? p : setFps({ ...p, compounds: undefined }, view.fps);
  const compounds = (view.compounds ?? []).map((k) => (k.id === id ? { ...k, tracks: view.tracks, markers: view.markers } : k));
  return { ...view, tracks: outer.tracks, markers: outer.markers, compounds };
}

/** One open level: the compound being edited and the timeline it was
 * opened from, which the document gets back on the way out. */
export interface NestLevel {
  id: Id;
  tracks: Track[];
  markers: Marker[];
  fps: Rational;
}

/** Does this timeline play compound `id` directly? */
const plays = (tracks: Track[], id: Id) => tracks.some((t) => t.clips.some((c) => c.type === "compound" && c.compoundId === id));

/**
 * Open compounds `path` in turn, from the document: the innermost view and
 * the levels it took. Stops at the first compound the timeline above no
 * longer plays (an undo took it away), so the result may be shallower.
 */
export function openPath(doc: Project, path: Id[]): { view: Project; levels: NestLevel[] } {
  let view = doc;
  const levels: NestLevel[] = [];
  for (const id of path) {
    if (!findCompound(view, id) || !plays(view.tracks, id)) break;
    levels.push({ id, tracks: view.tracks, markers: view.markers, fps: view.fps });
    view = compoundView(view, id);
  }
  return { view, levels };
}

/** The whole document from an open view and its levels, innermost last. */
export function closePath(view: Project, levels: NestLevel[]): Project {
  let p = view;
  for (let i = levels.length - 1; i >= 0; i--) {
    const l = levels[i];
    p = withCompoundView({ ...p, tracks: l.tracks, markers: l.markers, fps: l.fps }, l.id, p);
  }
  return p;
}

/** Would this view, open inside `levels`, play one of them (a cycle)? */
export const nestsItself = (view: Project, levels: NestLevel[]) => levels.some((l) => reaches(view, view.tracks, l.id));

/** Frames the compound's timeline lasts. */
export const compoundDuration = (p: Project, id: Id) => timelineEnd(findCompound(p, id)?.tracks ?? []);
