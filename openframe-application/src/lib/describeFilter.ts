// describe_project, asked for less (ADR-105). The whole timeline of a
// 38-second ad was about 20 KB (some 10,000 tokens) in the Claude film
// test, and it was the only way to read one clip's in-point or keyframes.
// A filter narrows the clips to tracks, ids or a stretch of the timeline;
// the media and markers listed follow the clips shown, and either list can
// be left out. With no filter the answer is the whole description, as
// before.

/** What describe_project's arguments ask for. */
export interface DescribeFilter {
  track_ids?: string[];
  clip_ids?: string[];
  /** Timeline seconds: clips playing inside [start, end). */
  start?: number;
  end?: number;
  /** false leaves the list out; true lists all of it however the clips are narrowed. */
  assets?: boolean;
  markers?: boolean;
  compounds?: boolean;
}

interface ClipDesc {
  id: string;
  start: number;
  end: number;
  asset?: string;
  compound?: string;
}
interface TrackDesc {
  id: string;
  clips: ClipDesc[];
}
interface Desc {
  tracks?: TrackDesc[];
  assets?: { id: string }[];
  markers?: { id: string; at: number; clip?: string }[];
  compounds?: { id: string; tracks: TrackDesc[] }[];
  [k: string]: unknown;
}

export const FILTER_KEYS = ["track_ids", "clip_ids", "start", "end", "assets", "markers", "compounds"] as const;

/** The description narrowed as `f` asks, with `shown` saying how much of
 * each list is in it ("5 of 43") wherever something was left out, and
 * `not_found` naming ids that are not in the project. */
export function filterDescription(description: unknown, f: DescribeFilter): unknown {
  const d = description as Desc;
  if (!d?.tracks || !FILTER_KEYS.some((k) => f[k] !== undefined)) return description;
  if (f.start !== undefined && f.end !== undefined && f.end <= f.start) throw new Error("end must be after start");
  const lo = f.start ?? -Infinity, hi = f.end ?? Infinity;
  const ranged = f.start !== undefined || f.end !== undefined;
  const narrow = ranged || !!f.track_ids || !!f.clip_ids;
  const ids = f.clip_ids && new Set(f.clip_ids);
  const trackIds = f.track_ids && new Set(f.track_ids);
  const inRange = (c: ClipDesc) => c.end > lo && c.start < hi;
  const wanted = (c: ClipDesc) => (!ids || ids.has(c.id)) && inRange(c);

  const tracks = d.tracks
    .filter((t) => !trackIds || trackIds.has(t.id))
    .map((t) => ({ ...t, clips: t.clips.filter(wanted) }))
    // A track asked for by id stays, empty or not; others only with a clip.
    .filter((t) => t.clips.length || trackIds?.has(t.id));
  const shownClips = tracks.flatMap((t) => t.clips);

  // Nested timelines: one a clip shown plays, whole; one holding a clip
  // asked for by id, with only those clips (their times are its own, so a
  // stretch does not apply inside).
  const played = new Set(shownClips.map((c) => c.compound).filter(Boolean));
  const compounds = (d.compounds ?? []).flatMap((k) => {
    if (!narrow || f.compounds === true || played.has(k.id)) return [k];
    if (!ids) return [];
    const inside = k.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => ids.has(c.id)) })).filter((t) => t.clips.length);
    return inside.length ? [{ ...k, tracks: inside }] : [];
  });
  const everyClip = [...shownClips, ...compounds.flatMap((k) => k.tracks.flatMap((t) => t.clips))];

  const used = new Set(everyClip.map((c) => c.asset).filter(Boolean));
  const assets = !narrow || f.assets === true ? d.assets : d.assets?.filter((a) => used.has(a.id));
  const shownIds = new Set(shownClips.map((c) => c.id));
  const markers = !narrow || f.markers === true ? d.markers : d.markers?.filter((m) => (ranged ? m.at >= lo && m.at < hi : !!m.clip && shownIds.has(m.clip)));

  const out: Desc = { ...d, tracks };
  const shown: Record<string, string> = {};
  const tell = (key: string, now: number, all: number) => {
    if (now !== all) shown[key] = `${now} of ${all}`;
  };
  tell("tracks", tracks.length, d.tracks.length);
  tell("clips", shownClips.length, d.tracks.reduce((n, t) => n + t.clips.length, 0));
  const lists: [key: "assets" | "markers" | "compounds", list: unknown[] | undefined, all: unknown[] | undefined][] = [
    ["assets", f.assets === false ? undefined : assets, d.assets],
    ["markers", f.markers === false ? undefined : markers, d.markers],
    ["compounds", f.compounds === false ? undefined : compounds, d.compounds],
  ];
  for (const [key, list, all] of lists) {
    // A project without compounds has no compounds key; keep it that way.
    if (list?.length || (key !== "compounds" && list)) (out as Record<string, unknown>)[key] = list;
    else delete out[key];
    tell(key, list?.length ?? 0, all?.length ?? 0);
  }
  if (Object.keys(shown).length) out.shown = shown;
  const missing = [...(f.clip_ids ?? []).filter((id) => !d.tracks!.some((t) => t.clips.some((c) => c.id === id)) && !(d.compounds ?? []).some((k) => k.tracks.some((t) => t.clips.some((c) => c.id === id)))), ...(f.track_ids ?? []).filter((id) => !d.tracks!.some((t) => t.id === id))];
  if (missing.length) out.not_found = missing;
  return out;
}
