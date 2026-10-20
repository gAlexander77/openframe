import { sourceToTimeline } from "./analysis/musicMap";
import { createMarker } from "./project/defaults";
import type { AudioClip, Clip, Id, Marker, Project, Track, VideoClip } from "./project/types";
import { formatTimecode, type Rational } from "./time";

/** Markers are absolute timeline notes; moving one never moves a clip. A
 * marker that followed a clip's media (a beat) and is moved by hand is the
 * user's from then on: it stays where they put it. */
export function updateMarker(p: Project, id: Id, patch: Partial<Pick<Marker, "frame" | "label" | "color">>): Project {
  const marker = p.markers.find((m) => m.id === id);
  if (!marker) throw new Error(`No marker with id ${id}`);
  if (patch.frame !== undefined && (!Number.isSafeInteger(patch.frame) || patch.frame < 0)) throw new Error("Marker position must be a nonnegative integer frame");
  const next = { ...marker, ...patch };
  if (next.frame === marker.frame && next.label === marker.label && next.color === marker.color) return p;
  if (next.frame !== marker.frame) delete next.follows;
  return { ...p, markers: p.markers.map((m) => m.id === id ? next : m).sort((a, b) => a.frame - b.frame) };
}

type Media = VideoClip | AudioClip;
const isMedia = (c: Clip): c is Media => c.type === "video" || c.type === "audio";

/** One timeline's following markers placed again, or null when none moved. */
function follow(tracks: Track[], markers: Marker[], fps: Rational): Marker[] | null {
  if (!markers.some((m) => m.follows)) return null;
  const media = tracks.flatMap((t) => t.clips.filter(isMedia));
  const byId = new Map(media.map((c) => [c.id, c]));
  const maps = new Map<Id, ReturnType<typeof sourceToTimeline>>();
  const frameIn = (c: Media, at: number) => {
    if (!maps.has(c.id)) maps.set(c.id, sourceToTimeline(c, fps));
    return maps.get(c.id)!.frame(at);
  };
  let changed = false;
  const out: Marker[] = [];
  for (const m of markers) {
    if (!m.follows) {
      out.push(m);
      continue;
    }
    const own = byId.get(m.follows.clip);
    let clip = own, frame = own ? frameIn(own, m.follows.at) : null;
    if (own && frame === null) {
      // Another clip of the same file that plays this second (the other
      // half of a split): the one nearest where the marker is.
      let best = Infinity;
      for (const c of media) {
        if (c === own || c.assetId !== own.assetId) continue;
        const f = frameIn(c, m.follows.at);
        if (f !== null && Math.abs(f - m.frame) < best) [best, clip, frame] = [Math.abs(f - m.frame), c, f];
      }
    }
    // Nothing plays that second any more (trimmed off, or the clip deleted).
    if (frame === null || !clip) {
      changed = true;
      continue;
    }
    if (frame === m.frame && clip.id === m.follows.clip) out.push(m);
    else {
      changed = true;
      out.push({ ...m, frame, follows: { clip: clip.id, at: m.follows.at } });
    }
  }
  return changed ? out.sort((a, b) => a.frame - b.frame) : null;
}

/**
 * Markers that follow a clip (a song's beats, bars, parts and drop) placed
 * where the clip plays their second of its file now, on the project's
 * timeline and every compound's: after a move, a trim, a speed change or a
 * split they still stand on the beat they mark, and a second the clip no
 * longer plays loses its marker. The same object when nothing moved.
 */
export function followClips(p: Project): Project {
  const root = follow(p.tracks, p.markers, p.fps);
  let compounds = p.compounds;
  if (compounds?.some((k) => k.markers.some((m) => m.follows))) {
    const next = compounds.map((k) => {
      const ms = follow(k.tracks, k.markers, p.fps);
      return ms ? { ...k, markers: ms } : k;
    });
    if (next.some((k, i) => k !== compounds![i])) compounds = next;
  }
  if (!root && compounds === p.compounds) return p;
  return { ...p, ...(root ? { markers: root } : {}), ...(compounds !== p.compounds ? { compounds } : {}) };
}

/**
 * Mark a media clip at seconds of its file, the markers following it: the
 * clip's own earlier markers with these labels go first (a new reading
 * replaces the old one instead of doubling it), and so does any marker
 * with the same label already on one of the new frames. `marks` lists a
 * label, a color and the file seconds for each kind.
 */
export function markClip(p: Project, clipId: Id, marks: { label: string; color: string; at: number[] }[]): Project {
  const clip = p.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip || !isMedia(clip)) throw new Error(`no video or audio clip with id ${clipId}`);
  const map = sourceToTimeline(clip, p.fps);
  const labels = new Set(marks.map((k) => k.label));
  const fresh: Marker[] = [];
  for (const k of marks) {
    const taken = new Set<number>();
    for (const at of k.at) {
      const frame = map.frame(at);
      if (frame === null || taken.has(frame)) continue;
      taken.add(frame);
      fresh.push({ ...createMarker(frame, k.label, k.color), follows: { clip: clipId, at: Math.round(at * 1e4) / 1e4 } });
    }
  }
  const on = new Set(fresh.map((m) => `${m.label}|${m.frame}`));
  const kept = p.markers.filter((m) => !(labels.has(m.label) && (m.follows?.clip === clipId || on.has(`${m.label}|${m.frame}`))));
  return { ...p, markers: [...kept, ...fresh].sort((a, b) => a.frame - b.frame) };
}

export function deleteMarkers(p: Project, ids: Id[]): Project {
  const chosen = new Set(ids);
  for (const id of chosen) if (!p.markers.some((m) => m.id === id)) throw new Error(`No marker with id ${id}`);
  if (!chosen.size) return p;
  return { ...p, markers: p.markers.filter((m) => !chosen.has(m.id)) };
}

export function filterMarkers(markers: Marker[], fps: Rational, query: string, color = ""): Marker[] {
  const q = query.trim().toLowerCase();
  return markers.filter((m) => (!color || m.color === color) &&
    (!q || m.label.toLowerCase().includes(q) || formatTimecode(m.frame, fps).includes(q)))
    .sort((a, b) => a.frame - b.frame);
}

/** Loaded JSON can list markers in any order, including coincident ones. */
export function adjacentMarker(markers: Marker[], frame: number, direction: -1 | 1): Marker | undefined {
  return markers.filter((m) => direction * (m.frame - frame) > 0)
    .sort((a, b) => direction * (a.frame - b.frame))[0];
}
