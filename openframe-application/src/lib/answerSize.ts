// Answers sized to what was asked (ADR-105, ADR-115). The second Claude
// film test paid about 10k tokens for each call that touched its 46
// captions (every clip's whole style, again and again), 6k for a voice
// review that told each line to duck the music on its own, 6k for check
// findings that said the same thing 25 times, and a list of every marker
// a cut moved. These shape an answer without losing what it says: what a
// long list of clips shares is given once, markers that moved together are
// counted, alike findings are grouped and a review gives each line's
// verdict with only the measures that decide it. Pure.

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A list of clips this long or longer gives what they share once. */
export const SHARE_FROM = 4;
/** Fields every clip keeps in its own entry: what an answer is read by. */
const OWN = new Set(["id", "type", "start", "end"]);

/** What every value has in common: the value itself when all are the
 * same, else the fields of objects that are (deeply), else undefined. */
function common(values: unknown[], top = false): unknown {
  if (!top && values.every((v) => same(v, values[0]))) return values[0];
  if (!values.every(isObj)) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(values[0] as object)) {
    if (top && OWN.has(k)) continue;
    if (!values.every((v) => k in (v as object))) continue;
    const c = common(values.map((v) => (v as Record<string, unknown>)[k]));
    if (c !== undefined) out[k] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

/** What is left of `value` once `shared` is taken out (undefined: nothing). */
function strip(value: unknown, shared: unknown): unknown {
  if (shared === undefined) return value;
  if (same(value, shared)) return undefined;
  if (!isObj(value) || !isObj(shared)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const left = k in shared ? strip(v, shared[k]) : v;
    if (left !== undefined) out[k] = left;
  }
  return Object.keys(out).length ? out : undefined;
}

/** `shared` merged into an entry: the entry's own fields win, objects merge. */
export function withShared(entry: unknown, shared: unknown): unknown {
  if (!isObj(entry) || !isObj(shared)) return entry === undefined ? shared : entry;
  const out: Record<string, unknown> = { ...shared };
  for (const [k, v] of Object.entries(entry)) out[k] = k in shared ? withShared(v, shared[k]) : v;
  return out;
}

/**
 * A list of clips (as describe_project gives them) with what all of them
 * share taken out into `common`: four or more clips, ids, types, starts and
 * ends always kept in each entry. 46 captions added in one call went from
 * 14 KB, each with the whole style, to 3.5 KB. Lossless: every entry is
 * `common` with the entry's own fields over it (withShared).
 */
export function shareCommon<T>(list: T[], from = SHARE_FROM): { items: T[]; common?: Record<string, unknown> } {
  if (list.length < from) return { items: list };
  const shared = common(list, true) as Record<string, unknown> | undefined;
  // Worth a key of its own only when it saves something.
  if (!shared || JSON.stringify(shared).length * (list.length - 1) < 200) return { items: list };
  return { items: list.map((c) => (strip(c, shared) ?? {}) as T), common: shared };
}

type MarkerDesc = { id: string; at?: number; frame?: number; label?: string; clip?: string };

/** Markers this many or more moved together by one edit are counted. */
const MOVED_TOGETHER = 3;

/**
 * Markers an edit changed, split into those that only moved, together, with
 * their clip (a song's bars after cut_music, a ripple), counted by clip and
 * distance, and the rest, listed. cut_music listed 19 bars, a breakdown, a
 * drop and an outro one by one, each with its id, frame and color.
 */
export function markerMoves(was: Map<string, MarkerDesc>, changed: MarkerDesc[]): { listed: MarkerDesc[]; moved: Record<string, unknown>[] } {
  const groups = new Map<string, MarkerDesc[]>();
  const listed: MarkerDesc[] = [];
  for (const m of changed) {
    const w = was.get(m.id);
    // Moved, and maybe onto the piece of its clip that now plays it (a cut song's second piece).
    const onlyMoved = w && same({ ...w, at: 0, frame: 0, clip: "" }, { ...m, at: 0, frame: 0, clip: "" }) && m.at !== undefined && w.at !== undefined;
    if (!onlyMoved) {
      listed.push(m);
      continue;
    }
    const key = `${m.clip ?? ""}|${+(m.at! - w!.at!).toFixed(3)}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const moved: Record<string, unknown>[] = [];
  for (const [key, ms] of groups) {
    if (ms.length < MOVED_TOGETHER) {
      listed.push(...ms);
      continue;
    }
    const [clip, by] = key.split("|");
    const labels: Record<string, number> = {};
    for (const m of ms) labels[m.label || "(no label)"] = (labels[m.label || "(no label)"] ?? 0) + 1;
    const at = ms.map((m) => m.at!).sort((a, b) => a - b);
    moved.push({ ...(clip ? { clip } : {}), by: Number(by), count: ms.length, labels, from: at[0], to: at.at(-1) });
  }
  return { listed, moved };
}

// ---- check_project ---------------------------------------------------------------

type FindingDesc = { rule: string; level: string; message: string; fix: string; clip_id?: string; clip_ids?: string[]; compound_clip_id?: string; at?: number };

/** The same finding on this many clips or more is given once. */
const ALIKE = 3;

/**
 * check_project's findings with alike ones (the same rule, level and fix)
 * given once: the first one's message, how many, every clip and time.
 * detail full keeps every finding. The film test's 9 KB check was mostly
 * 25 caption warnings that differed only in their numbers.
 */
export function groupFindings<T extends { findings?: FindingDesc[] }>(answer: T): T {
  const list = answer?.findings;
  if (!Array.isArray(list)) return answer;
  const groups = new Map<string, FindingDesc[]>();
  for (const f of list) {
    const key = `${f.rule}|${f.level}|${f.fix}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  if (![...groups.values()].some((g) => g.length >= ALIKE)) return answer;
  const out: unknown[] = [];
  const done = new Set<string>();
  for (const f of list) {
    const key = `${f.rule}|${f.level}|${f.fix}`;
    const g = groups.get(key)!;
    if (g.length < ALIKE) out.push(f);
    else if (!done.has(key)) {
      done.add(key);
      const ids = g.flatMap((x) => x.clip_ids ?? (x.clip_id ? [x.clip_id] : []));
      out.push({
        rule: f.rule,
        level: f.level,
        count: g.length,
        message: `${g.length} alike; the first: ${f.message}`,
        fix: f.fix,
        ...(ids.length ? { clip_ids: [...new Set(ids)] } : {}),
        at: g.map((x) => x.at ?? null),
      });
    }
  }
  return { ...answer, findings: out, grouped: "alike findings (the same rule and fix) are given once with every clip and time; detail full lists each" };
}

// ---- review_voiceover --------------------------------------------------------------

type Fix = { problem: string; tool: string; args?: Record<string, unknown>; see?: string };
type ReviewLine = Record<string, unknown> & { voice_clip: string; verdict: string; fixes?: Fix[]; differences?: unknown[]; pace?: Record<string, unknown> };
type Review = { lines: ReviewLine[]; summary: Record<string, unknown> };

/**
 * One duck for the music under several lines: a line short of its margin
 * over the music used to get its own duck_under_speech on the music clip
 * under it (the same call twelve times on a song cut in two), when one call
 * on the music track (track_id, every piece as one bed) holds every line.
 * The lines keep their problem and point at summary.fixes. `trackOf` names
 * a music clip's track.
 */
export function oneDuck(review: Review, trackOf: (clipId: string) => string | undefined): Review {
  const groups = new Map<string, { args: Record<string, unknown>; lines: string[]; depths: (number | undefined)[]; problem: string }>();
  const lines = review.lines.map((l) => {
    if (!l.fixes?.length) return l;
    const fixes = l.fixes.map((f) => {
      const clip = f.tool === "duck_under_speech" ? f.args?.clip_id : undefined;
      const track = typeof clip === "string" ? trackOf(clip) : undefined;
      if (!track) return f;
      const { clip_id: _c, depth, ...rest } = f.args!;
      const key = `${track}|${JSON.stringify(rest)}`;
      const g = groups.get(key) ?? { args: { track_id: track, ...rest }, lines: [], depths: [], problem: /nearly nothing/.test(f.problem) ? "ducked to nearly nothing" : "short of their margin over the music" };
      g.lines.push(l.voice_clip);
      g.depths.push(typeof depth === "number" ? depth : undefined);
      groups.set(key, g);
      return { problem: f.problem, tool: f.tool, see: "summary.fixes" };
    });
    return { ...l, fixes };
  });
  if (!groups.size) return review;
  const fixes = [...groups.values()].map((g) => {
    // The least dip every line already has, when each has one.
    const depth = g.depths.every((d) => d !== undefined) ? Math.min(...(g.depths as number[])) : undefined;
    return { problem: `${g.lines.length} line${g.lines.length === 1 ? "" : "s"} ${g.problem}: one duck on the music track holds every line`, tool: "duck_under_speech", args: { ...g.args, ...(depth !== undefined ? { depth } : {}) }, lines: g.lines };
  });
  return { lines, summary: { ...review.summary, fixes: [...((review.summary.fixes as unknown[]) ?? []), ...fixes] } };
}

/**
 * Each line's verdict with only what decides it (detail summary, the
 * default): its clip, times, verdict, fixes and advice; its words a second
 * against its band; its loudness and margin over the music; and what was
 * heard only where it differs from the script. The silences, peaks and
 * pitch each give a fix when they fail; detail full lists them all. 12
 * lines answered about 12 KB.
 */
export function reviewSummary(review: Review): Review {
  const lines = review.lines.map((l) => {
    const pace = l.pace as { meant?: string; target_words_per_second?: number[]; over_speech?: { words_per_second?: number } | null; on_target?: boolean } | undefined;
    const differs = Array.isArray(l.differences) && l.differences.length > 0;
    return {
      voice_clip: l.voice_clip,
      start: l.start,
      end: l.end,
      // The full verdict is every fix's problem joined: they are in fixes.
      verdict: l.fixes?.length ? "to fix" : l.verdict,
      ...(l.fixes ? { fixes: l.fixes } : {}),
      ...(l.advice ? { advice: l.advice } : {}),
      ...(differs ? { script: l.script, heard: l.heard, match: l.match, differences: l.differences } : {}),
      ...(l.heard_again !== undefined ? { heard_again: l.heard_again, match_again: l.match_again } : {}),
      ...(l.notes ? { notes: l.notes } : {}),
      ...(pace ? { words_per_second: pace.over_speech?.words_per_second ?? null, target_words_per_second: pace.target_words_per_second, ...(pace.meant ? { pace_meant: pace.meant } : {}) } : {}),
      loudness_lufs: l.loudness_lufs,
      ...(l.voice_above_music_lu !== null && l.voice_above_music_lu !== undefined ? { voice_above_music_lu: l.voice_above_music_lu } : {}),
    };
  });
  return { lines, summary: { ...review.summary, detail: "summary: each line's verdict, fixes, pace, loudness and margin; detail full adds the syllables, the clip window, silences, peaks and pitch of every line" } };
}

/** Clips that moved by one amount: start and end shifted alike, on the
 * same track. */
type Moved = { id: string; start: number; end: number; track: string };

/**
 * An app tool's moved clips with the ones a ripple carried, SHARE_FROM or
 * more shifted by one amount, counted instead of listed (ADR-121):
 * retake_voiceover ripple answered every caption after the line with its
 * whole style, about 40 clips and 4k tokens a retake, where the shift and
 * a count say it. Each count gives the shift, how many clips moved and on
 * which tracks, and the stretch they now cover; a clip that moved
 * otherwise (a new length, another track) is listed as before.
 */
export function shiftedTogether(moved: Moved[], was: Map<string, Moved>): { listed: Moved[]; shifted: { by: number; clips: number; from: number; to: number; tracks: Record<string, number> }[] } {
  const by = new Map<string, Moved[]>();
  const listed: Moved[] = [];
  for (const c of moved) {
    const w = was.get(c.id);
    const d = w ? +(c.start - w.start).toFixed(3) : NaN;
    if (!w || w.track !== c.track || Math.abs(c.end - w.end - d) > 0.0015 || !d) listed.push(c);
    else by.set(String(d), [...(by.get(String(d)) ?? []), c]);
  }
  const shifted: ReturnType<typeof shiftedTogether>["shifted"] = [];
  for (const [d, cs] of by) {
    if (cs.length < SHARE_FROM) {
      listed.push(...cs);
      continue;
    }
    const tracks: Record<string, number> = {};
    for (const c of cs) tracks[c.track] = (tracks[c.track] ?? 0) + 1;
    shifted.push({ by: Number(d), clips: cs.length, from: Math.min(...cs.map((c) => c.start)), to: Math.max(...cs.map((c) => c.end)), tracks });
  }
  return { listed: moved.filter((c) => listed.includes(c)), shifted };
}
