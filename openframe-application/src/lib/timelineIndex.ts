// Shared rows for the person's Timeline index and the agent's find_clips.
import { clipEnd } from "./project/ops";
import type { Clip, Project, Track } from "./project/types";

export type IndexKind = Clip["type"] | "caption";
export type IndexFilter = "all" | "video" | "audio" | "text" | "caption" | "image" | "other";
export type IndexSort = "start" | "name" | "track";
export interface IndexRow {
  clip: Clip;
  kind: IndexKind;
  name: string;
  track: string;
  trackId: string;
  trackOrder: number;
  start: number;
  end: number;
  search: string;
  compoundClipId?: string;
}

/** A compound view already has its own tracks in project.tracks. Nested
 * search adds each reachable instance with times local to its timeline. */
export function timelineRows(p: Project, nested = false): IndexRow[] {
  const assets = new Map(p.assets.map((a) => [a.id, a.name]));
  const compounds = new Map((p.compounds ?? []).map((k) => [k.id, k]));
  const rows: IndexRow[] = [];
  const walk = (tracks: Track[], parent?: string, path = new Set<string>()) => {
    tracks.forEach((t, ti) => t.clips.forEach((c) => {
      const media = "assetId" in c ? assets.get(c.assetId) ?? "" : "";
      const text = c.type === "text" ? c.text : "";
      const kind = c.type === "text" && c.caption ? "caption" : c.type;
      const name = c.name || text.split(/\r?\n/)[0] || media || kind;
      rows.push({ clip: c, kind, name, track: t.name, trackId: t.id, trackOrder: ti,
        start: c.start, end: clipEnd(c), search: [name, media, text, kind, c.type].join("\n").toLowerCase(),
        ...(parent ? { compoundClipId: parent } : {}) });
      if (nested && c.type === "compound" && !path.has(c.compoundId)) {
        const k = compounds.get(c.compoundId);
        if (k) walk(k.tracks, c.id, new Set([...path, c.compoundId]));
      }
    }));
  };
  walk(p.tracks);
  return rows;
}

export function filterTimelineRows(rows: IndexRow[], query = "", kind: IndexFilter = "all", sort: IndexSort = "start"): IndexRow[] {
  const q = query.trim().toLowerCase();
  const other = new Set(["color", "adjustment", "compound"]);
  return rows.filter((r) => (!q || r.search.includes(q)) &&
    (kind === "all" || (kind === "other" ? other.has(r.kind) : r.kind === kind)))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "track" ? a.trackOrder - b.trackOrder : 0) ||
      a.start - b.start || a.trackOrder - b.trackOrder || a.clip.id.localeCompare(b.clip.id));
}

export interface FindClipsOptions {
  query?: string;
  kind?: IndexKind;
  track_id?: string;
  start?: number;
  end?: number;
  limit?: number;
}
export function findClips(p: Project, o: FindClipsOptions) {
  const rate = p.fps.num / p.fps.den;
  const rows = filterTimelineRows(timelineRows(p, true), o.query).filter((r) =>
    (!o.kind || r.kind === o.kind) && (!o.track_id || r.trackId === o.track_id) &&
    (o.start === undefined || r.end / rate > o.start) &&
    (o.end === undefined || (o.end === o.start ? r.start / rate <= o.end : r.start / rate < o.end)));
  const shown = rows.slice(0, o.limit ?? 50).map((r) => ({ clip_id: r.clip.id, kind: r.kind, name: r.name,
    track_id: r.trackId, track: r.track, start: r.start / rate, end: r.end / rate,
    ...(r.compoundClipId ? { compound_clip_id: r.compoundClipId } : {}) }));
  return { clips: shown, total: rows.length, shown: shown.length };
}
