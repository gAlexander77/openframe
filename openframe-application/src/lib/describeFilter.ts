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
  /** Timeline seconds: clips playing inside [start, end); start = end is
   * a moment, the clips playing at it. */
  start?: number;
  end?: number;
  /** false leaves the list out; true lists all of it however the clips are narrowed. */
  assets?: boolean;
  markers?: boolean;
  compounds?: boolean;
  /** false: the tracks alone, each with how many clips it holds instead of
   * its clips (the cheap way to learn track ids, ADR-115). */
  clips?: boolean;
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

export const FILTER_KEYS = ["track_ids", "clip_ids", "start", "end", "assets", "markers", "compounds", "clips"] as const;

/** The description narrowed as `f` asks, with `shown` saying how much of
 * each list is in it ("5 of 43") wherever something was left out, and
 * `not_found` naming ids that are not in the project. */
export function filterDescription(description: unknown, asked: DescribeFilter): unknown {
  const d = description as Desc;
  // An empty list of ids is no filter: an agent that fills in every
  // optional argument sends [] for "all" (ADR-108).
  const f = { ...asked, clip_ids: asked.clip_ids?.length ? asked.clip_ids : undefined, track_ids: asked.track_ids?.length ? asked.track_ids : undefined };
  if (!d?.tracks || !FILTER_KEYS.some((k) => f[k] !== undefined)) return description;
  if (f.start !== undefined && f.end !== undefined && f.end < f.start) throw new Error("end must not be before start");
  const lo = f.start ?? -Infinity, hi = f.end ?? Infinity;
  const ranged = f.start !== undefined || f.end !== undefined;
  const bare = f.clips === false;
  const narrow = ranged || !!f.track_ids || !!f.clip_ids || bare;
  const ids = f.clip_ids && new Set(f.clip_ids);
  const trackIds = f.track_ids && new Set(f.track_ids);
  // start = end is a moment: what plays at it.
  const moment = lo === hi;
  const inRange = (c: ClipDesc) => c.end > lo && (c.start < hi || (moment && c.start <= hi));
  const wanted = (c: ClipDesc) => (!ids || ids.has(c.id)) && inRange(c);

  const tracks = d.tracks
    .filter((t) => !trackIds || trackIds.has(t.id))
    .map((t) => ({ ...t, clips: t.clips.filter(wanted) }))
    // A track asked for by id stays, empty or not; over a stretch every
    // track does (its id is what the next call needs, ADR-115); others
    // only with a clip.
    .filter((t) => t.clips.length || trackIds?.has(t.id) || (ranged && !ids && !trackIds) || bare);
  const shownClips = bare ? [] : tracks.flatMap((t) => t.clips);

  // Nested timelines: one holding a track or a clip asked for by id, with
  // only those (their times are its own, so a stretch does not apply
  // inside); one a clip listed plays, whole, and what that one plays in
  // turn, all the way down (ADR-108).
  const nested = d.compounds ?? [];
  const chosen = new Map<string, NonNullable<Desc["compounds"]>[number]>();
  if (!narrow || f.compounds === true) for (const k of nested) chosen.set(k.id, k);
  else {
    for (const k of nested) {
      const inside = k.tracks
        .filter((t) => trackIds?.has(t.id) || (ids && t.clips.some((c) => ids.has(c.id))))
        .map((t) => ({ ...t, clips: ids ? t.clips.filter((c) => ids.has(c.id)) : t.clips }));
      if (inside.length) chosen.set(k.id, { ...k, tracks: inside });
    }
    const queue = [...shownClips, ...[...chosen.values()].flatMap((k) => k.tracks.flatMap((t) => t.clips))];
    for (let c = queue.pop(); c; c = queue.pop()) {
      const k = c.compound ? nested.find((x) => x.id === c!.compound) : undefined;
      if (!k || chosen.get(k.id) === k) continue;
      chosen.set(k.id, k);
      queue.push(...k.tracks.flatMap((t) => t.clips));
    }
  }
  const compounds = nested.filter((k) => chosen.has(k.id)).map((k) => chosen.get(k.id)!);
  const everyClip = [...shownClips, ...compounds.flatMap((k) => k.tracks.flatMap((t) => t.clips))];

  const used = new Set(everyClip.map((c) => c.asset).filter(Boolean));
  const assets = !narrow || f.assets === true ? d.assets : d.assets?.filter((a) => used.has(a.id));
  const shownIds = new Set(shownClips.map((c) => c.id));
  const markers = !narrow || f.markers === true ? d.markers : d.markers?.filter((m) => (ranged ? m.at >= lo && (m.at < hi || (moment && m.at === hi)) : !!m.clip && shownIds.has(m.clip)));

  // clips false: each track with a count of its clips in their place.
  const out: Desc = { ...d, tracks: bare ? (tracks.map((t) => ({ ...t, clips: t.clips.length })) as unknown as TrackDesc[]) : tracks };
  const shown: Record<string, string> = {};
  const tell = (key: string, now: number, all: number) => {
    if (now !== all) shown[key] = `${now} of ${all}`;
  };
  tell("tracks", tracks.length, d.tracks.length);
  if (!bare) tell("clips", shownClips.length, d.tracks.reduce((n, t) => n + t.clips.length, 0));
  const lists: [key: "assets" | "markers" | "compounds", list: unknown[] | undefined, all: unknown[] | undefined][] = [
    ["assets", f.assets === false || (bare && f.assets !== true) ? undefined : assets, d.assets],
    ["markers", f.markers === false || (bare && f.markers !== true) ? undefined : markers, d.markers],
    ["compounds", f.compounds === false || (bare && f.compounds !== true) ? undefined : compounds, d.compounds],
  ];
  for (const [key, list, all] of lists) {
    // A project without compounds has no compounds key; keep it that way.
    if (list?.length || (key !== "compounds" && list)) (out as Record<string, unknown>)[key] = list;
    else delete out[key];
    tell(key, list?.length ?? 0, all?.length ?? 0);
  }
  if (Object.keys(shown).length) out.shown = shown;
  const timelines = [d.tracks, ...nested.map((k) => k.tracks)];
  const missing = [...(f.clip_ids ?? []).filter((id) => !timelines.some((ts) => ts.some((t) => t.clips.some((c) => c.id === id)))), ...(f.track_ids ?? []).filter((id) => !timelines.some((ts) => ts.some((t) => t.id === id)))];
  if (missing.length) out.not_found = missing;
  return out;
}
