// The Model Context Protocol, transport-agnostic: JSON-RPC 2.0 messages in,
// responses out. Tools are the command registry (ADR-006) plus app-level
// tools (import, undo, seek, a frame as an image); resources are the
// project. A desktop HTTP server, a stdio bridge or the web build's
// window API all hand messages to handleMcp, so agents see one surface
// however they connect (ADR-008).

import { SFX } from "./sfx";
import { AMBIENCE, AMBIENCE_IDS, BED_MAX_SECONDS } from "./ambience";
import { DEFAULT_VOICE, VOICES } from "./tts";
import { CHOSEN_MAX_SPS, PACE_BANDS, READ_AS, readBand } from "./voicePace";
import { STYLE_IDS, STYLES } from "./music/styles";
import { MODE_IDS } from "./music/theory";
import { MUSIC_MARKER_KINDS, planMusicAnswer } from "./music/cues";
import { coerceNumbers, COMMANDS, PROJECT_FILE_COMMANDS, TEXT_STYLE_SCHEMA, validate, type JsonSchema } from "./commands";
import { annotations, DESIGN, fullCatalog, helpText, HELP_TOPICS, PLAYBOOKS, PROMPTS, promptMessages } from "./mcpGuide";
import { filterDescription, type DescribeFilter } from "./describeFilter";
import { musicSummary } from "./musicSummary";
import type { MappedMusic } from "./analysis/musicMap";
import { PROGRAM_KINDS, SPEC_IDS } from "./analysis/delivery";
import { LINE_CEILING_LU } from "./analysis/balance";
import { DUCK_MIN_GAP, DUCK_RELEASE } from "./analysis/duck";
import { didYouMean } from "./didYouMean";
import { expandVersions, VERSION_CAPTIONS, VERSION_FITS, VERSION_PUSHES, VERSION_RATIOS, type VersionCaptions, type VersionFit, type VersionOverride, type VersionPushes, type VersionRatio, type VersionSpec } from "./versions";
import { REFRAMES, type Focus, type Reframe } from "./reframe";

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** What the handler needs from the running app. */
export interface McpHost {
  name: string;
  version: string;
  /** False where export_video and export_versions cannot write files (the
   * browser build), so the instructions say so before a model plans on it. */
  canExport?(): boolean;
  /** Run a registry command as an undoable edit; returns the new summary. */
  exec(name: string, args: unknown): unknown | Promise<unknown>;
  describe(): unknown;
  projectJson(): unknown;
  catalog(): unknown;
  /** One entry per file, in order: the asset, a LUT ({lut_id}), or
   * {src, name, error}; empty when the project closed meanwhile. */
  importMedia(files: { src: string; name?: string }[]): Promise<unknown>;
  undo(): unknown;
  redo(): unknown;
  seek(seconds: number): unknown;
  /** PNG of the frame at `seconds`, base64 without the data: prefix. */
  frame(seconds: number, maxWidth: number): Promise<string>;
  /** One JPEG of several frames in a grid, each stamped with its time
   * (photographs: as PNG a sheet ran to megabytes, ADR-073). */
  sheet(times: number[], tileWidth: number, columns: number): Promise<string>;
  /** The same, of an imported video's own frames at source seconds. */
  mediaSheet(assetId: string, times: number[], tileWidth: number, columns: number): Promise<string>;
  /** The same, of a file that is not imported (an exported video): its
   * frames at `times`, or `count` spread over it, and what it is. */
  fileSheet?(src: string, times: number[] | undefined, count: number, tileWidth: number, columns: number): Promise<{ image: string; file: unknown }>;
  /** A stretch of the sound rendered as export renders it (preview_audio):
   * an MP3 (base64; absent when audio is false) and its measurements. */
  audition(options: { start: number; end?: number; solo?: string; loudness?: number; audio?: boolean }): Promise<{ data?: string; mimeType?: string; summary: unknown }>;
  /** The design check (lib/designCheck.ts) of the open project; the app
   * renders the picture behind every title at a few moments and decodes
   * each music clip's last seconds first, so it may take a moment. */
  checkProject(kind: string): unknown | Promise<unknown>;
  /** Export without a dialog (desktop); resolves when the file is done. */
  exportVideo(options: Record<string, unknown>): Promise<unknown>;
  /** The last export_video: running (with progress), done or failed. */
  exportStatus(): unknown;
  /** export_versions: one file per version, the project left as it is. */
  exportVersions(options: VersionsRequest): Promise<unknown>;
  /** One JPEG (base64) of every version at a few moments, nothing
   * exported, and where each version's framing cuts a shot's subject. */
  versionsSheet(options: VersionsRequest & { at?: number[] }): Promise<{ image: string; subjects?: unknown; titles?: unknown; overlaps?: unknown }>;
  /** Each version saved as a project of its own, nothing exported. */
  saveVersions(options: VersionsRequest): Promise<unknown>;
  /** Speak a script's lines and place them with captions (add_voiceover). */
  voiceover(lines: Record<string, unknown>[], options: Record<string, unknown>): Promise<unknown>;
  /** Run a local AI tool (src/state/ai.ts) by its automation name. */
  ai(tool: AiTool, target: string | string[], options: Record<string, unknown>): Promise<unknown>;
  /** The saved projects, as the home screen lists them; `open` marks the
   * one in the editor. */
  listProjects(): Promise<SavedProject[]>;
  /** Save the open project and open this one; resolves to its description. */
  openProject(id: string): Promise<unknown>;
  /** Save the open project and start an empty one; resolves to its description. */
  newProject(name?: string): Promise<unknown>;
  /** Save the open project as a copy (sharing its media), opening it or not. */
  saveCopy(name: string, open: boolean): Promise<unknown>;
}

export interface SavedProject {
  id: string;
  name: string;
  updatedAt: number;
  /** Seconds. */
  duration: number;
  width: number;
  height: number;
  open?: boolean;
}

/** A project by id, or by name (any case; the most recently edited of
 * several with that name), for open_project. */
export function findProject(all: SavedProject[], key: string): SavedProject {
  const recent = [...all].sort((a, b) => b.updatedAt - a.updatedAt);
  const hit = recent.find((p) => p.id === key) ?? recent.find((p) => p.name.toLowerCase() === key.trim().toLowerCase());
  if (hit) return hit;
  const names = recent.slice(0, 10).map((p) => `"${p.name}"`).join(", ");
  throw new Error(`No project "${key}". ${names ? `Recent: ${names}.` : "There are no saved projects."} list_projects has them all with ids.`);
}

export type AiTool = "generateMusic" | "removeSilences" | "removeFillers" | "clipTranscript" | "splitScenes" | "markBeats" | "normalizeLoudness" | "duckUnderSpeech" | "reduceNoise" | "stabilizeClip" | "removeBackground" | "textToSpeech" | "autoAdjustClip" | "trackMotion" | "syncAudio" | "reframeClip" | "addSoundEffects" | "addAmbience" | "analyzeMusic" | "loudnessReport" | "textBehindSubject" | "retakeVoiceover" | "reviewVoiceover";

/** What export_versions hands the host: the versions spelled out, and the
 * export settings they share. */
export interface VersionsRequest {
  versions: VersionSpec[];
  keepEnd?: number;
  format?: string;
  resolution?: string;
  quality?: string;
  loudness?: number;
  /** Desktop: the absolute folder to write into instead of the Videos folder. */
  folder?: string;
}

type Desc = Record<string, unknown> & { tracks?: ({ id: string; clips: { id: string }[] } & Record<string, unknown>)[]; assets?: { id: string }[] };
type CompoundDesc = Desc & { id: string; name: string; duration: number; tracks: { clips: unknown[] }[] };

/** A nested timeline in a few words: what an edit answers about a compound
 * it touched, instead of its whole timeline (describe_project has that). */
const compoundSummary = (k: CompoundDesc) => ({ id: k.id, name: k.name, duration: k.duration, clips: k.tracks.reduce((n, t) => n + t.clips.length, 0) });

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** Markers past this many in one answer are summed up: a song's beats
 * moving with its clip are hundreds (a 3-minute song at 128 BPM, 384). */
const MANY_MARKERS = 24;

/** A long list of markers in a few words: how many, by label, and the
 * first and last; describe_project has every one. */
function markerSummary(items: unknown[]): unknown {
  const list = items as { label?: string; at?: number }[];
  if (list.length <= MANY_MARKERS) return list;
  const by: Record<string, number> = {};
  for (const m of list) by[m.label || "(no label)"] = (by[m.label || "(no label)"] ?? 0) + 1;
  const at = list.map((m) => m.at ?? 0).sort((a, b) => a - b);
  return { count: list.length, by_label: by, from: at[0], to: at.at(-1), note: "describe_project lists every marker" };
}

/**
 * What an edit changed, from describe_project before and after: clips and
 * tracks added, changed (as they are now) and removed, assets added and
 * removed, and any other part that differs. Agents get this after each
 * edit instead of the whole timeline, which cost thousands of tokens a
 * call while building the RacePulse promo; describe_project still has all.
 */
export function describeChanges(before: unknown, after: unknown): unknown {
  const b = before as Desc, a = after as Desc;
  if (!a?.tracks || !b?.tracks) return after;
  const notes = [...((a.notes as string[] | undefined) ?? []), ...closedGapNotes(b, a)];
  const out: Record<string, unknown> = { duration: a.duration, ...(a.overwritten ? { overwritten: a.overwritten } : {}), ...(notes.length ? { notes } : {}) };
  const diff = <T extends { id: string }>(was: Map<string, T>, now: Map<string, T>, key: string) => {
    const added = [...now.values()].filter((x) => !was.has(x.id));
    const changed = [...now.values()].filter((x) => was.has(x.id) && !same(was.get(x.id), x));
    const removed = [...was.keys()].filter((id) => !now.has(id));
    const many = key === "markers" ? markerSummary : (x: unknown[]) => x;
    if (added.length) out[`added_${key}`] = many(added);
    if (changed.length) out[`changed_${key}`] = many(changed);
    if (removed.length) out[`removed_${key}`] = key === "markers" && removed.length > MANY_MARKERS ? { count: removed.length } : removed;
  };
  const clips = (d: Desc) => new Map(d.tracks!.flatMap((t) => t.clips.map((c) => [c.id, { ...c, track: t.id }] as const)));
  const tracks = (d: Desc) => new Map(d.tracks!.map(({ clips: _, ...t }) => [t.id, t] as const));
  diff(clips(b), clips(a), "clips");
  diff(tracks(b), tracks(a), "tracks");
  const marks = (d: Desc) => new Map(((d.markers ?? []) as { id: string }[]).map((m) => [m.id, m] as const));
  diff(marks(b), marks(a), "markers");
  const order = (d: Desc) => d.tracks!.map((t) => t.id);
  const kept = (x: Desc, y: Desc) => order(x).filter((id) => order(y).includes(id));
  if (!same(kept(b, a), kept(a, b))) out.track_order = order(a);
  const assets = (d: Desc) => new Map((d.assets ?? []).map((x) => [x.id, x] as const));
  const ba = assets(b), aa = assets(a);
  if ([...aa.keys()].some((id) => !ba.has(id))) out.added_assets = [...aa.values()].filter((x) => !ba.has(x.id));
  if ([...ba.keys()].some((id) => !aa.has(id))) out.removed_assets = [...ba.keys()].filter((id) => !aa.has(id));
  // A renamed file, a song given its grid (set_music_grid).
  const changedA = [...aa.values()].filter((x) => ba.has(x.id) && !same(ba.get(x.id), x));
  if (changedA.length) out.changed_assets = changedA;
  // Compounds: only those that changed, summed up, with what changed inside
  // (an edit_compound's clips). Every compound's whole timeline cost ~3 KB
  // an edit on the launch film's six windows.
  const comps = (d: Desc) => new Map(((d.compounds ?? []) as CompoundDesc[]).map((k) => [k.id, k] as const));
  const bk = comps(b), ak = comps(a);
  const addedK = [...ak.values()].filter((k) => !bk.has(k.id));
  const changedK = [...ak.values()].filter((k) => bk.has(k.id) && !same(bk.get(k.id), k));
  const removedK = [...bk.keys()].filter((id) => !ak.has(id));
  if (addedK.length) out.added_compounds = addedK.map(compoundSummary);
  if (changedK.length)
    out.changed_compounds = changedK.map((k) => {
      const { duration: _d, unchanged: _u, ...inside } = describeChanges(bk.get(k.id), k) as Record<string, unknown>;
      return { ...compoundSummary(k), ...inside };
    });
  if (removedK.length) out.removed_compounds = removedK;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!["duration", "tracks", "assets", "markers", "compounds"].includes(k) && !same(a[k], b[k])) out[k] = a[k] ?? null;
  }
  return Object.keys(out).length === 1 ? { unchanged: true, duration: a.duration } : out;
}

type ClipDesc = { id: string; start: number; end: number; track: string };

/** Every clip by id, with its track, from a describe_project answer. */
const clipsOf = (d: Desc) => new Map(d.tracks!.flatMap((t) => (t.clips as unknown as ClipDesc[]).map((c) => [c.id, { ...c, track: t.id }] as const)));

const s3 = (v: number) => +v.toFixed(3);

/**
 * One plain sentence for each gap on the main track that closed between
 * two describe_project answers: where it was, how much of it closed, and
 * how many clips moved earlier for it. A gap that closes without being
 * asked for moves every cut after it off its beat (ADR-102).
 */
export function closedGapNotes(before: unknown, after: unknown): string[] {
  const main = (d: Desc) => d.tracks?.find((t) => t.main) as ({ clips: ClipDesc[] } | undefined);
  const b = main(before as Desc), a = main(after as Desc);
  if (!b || !a) return [];
  const gaps = (clips: ClipDesc[]) => {
    const out = new Map<string, { from: number; gap: number }>();
    let end = 0;
    for (const c of [...clips].sort((x, y) => x.start - y.start)) {
      out.set(c.id, { from: end, gap: c.start - end });
      end = Math.max(end, c.end);
    }
    return out;
  };
  const was = gaps(b.clips), now = gaps(a.clips);
  const startWas = new Map(b.clips.map((c) => [c.id, c.start]));
  const startNow = new Map(a.clips.map((c) => [c.id, c.start]));
  const notes: string[] = [];
  for (const [id, g] of was) {
    const n = now.get(id);
    // Closed, and by moving the clip after it (not by a clip grown into it).
    if (g.gap < 0.0005 || !n || g.gap - n.gap < 0.0005 || startWas.get(id)! - startNow.get(id)! < 0.0005) continue;
    const closed = s3(g.gap - n.gap);
    const at = startWas.get(id)!;
    const moved = a.clips.filter((c) => startWas.has(c.id) && startWas.get(c.id)! >= at && startWas.get(c.id)! - c.start > 0.0005).length;
    notes.push(`The main track closed ${n.gap < 0.0005 ? "the" : `${closed} s of the`} ${s3(g.gap)} s gap at ${s3(g.from)} s: ${moved === 1 ? "the clip" : `the ${moved} clips`} after it moved ${closed} s earlier.`);
  }
  return notes;
}

/**
 * An app tool's answer with every clip it moved (a start, end or track
 * that changed) in changed_clips, and a sentence for any gap it closed on
 * the main track. Tools such as add_voiceover or duck_under_speech answer
 * in their own words, and their edits used to move main-track shots with
 * no mention (ADR-102). A tool whose answer is not one JSON object gets a
 * second text part.
 */
export function withMoves(r: ToolResult, before: unknown, after: unknown): ToolResult {
  const b = before as Desc, a = after as Desc;
  if (r.isError || !b?.tracks || !a?.tracks) return r;
  const was = clipsOf(b);
  const moved = [...clipsOf(a).values()].filter((c) => {
    const w = was.get(c.id);
    return w && (w.start !== c.start || w.end !== c.end || w.track !== c.track);
  });
  const gapNotes = closedGapNotes(b, a);
  if (!moved.length && !gapNotes.length) return r;
  const i = r.content.findIndex((c) => c.type === "text");
  let body: Record<string, unknown> | undefined;
  try {
    const parsed = i >= 0 ? JSON.parse((r.content[i] as { text: string }).text) : undefined;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch {
    // Not JSON: the moves go in a part of their own.
  }
  const listed = new Set(((body?.changed_clips ?? []) as { id: string }[]).map((c) => c.id));
  const extra = moved.filter((c) => !listed.has(c.id));
  const notes = gapNotes.filter((n) => !((body?.notes ?? []) as string[]).includes(n));
  if (!extra.length && !notes.length) return r;
  const add = { ...(extra.length ? { changed_clips: [...((body?.changed_clips ?? []) as unknown[]), ...extra] } : {}), ...(notes.length ? { notes: [...((body?.notes ?? []) as string[]), ...notes] } : {}) };
  if (!body) return { ...r, content: [...r.content, { type: "text", text: JSON.stringify(add) }] };
  return { ...r, content: r.content.map((c, j) => (j === i ? { type: "text", text: JSON.stringify({ ...body, ...add }) } : c)) };
}

/** A project in a few words, for open_project and new_project: the whole
 * timeline was about 20 KB on the launch film, and describe_project has it. */
export function projectSummary(d: unknown): unknown {
  const x = d as Desc & { compounds?: unknown[]; markers?: unknown[] };
  if (!x?.tracks) return d;
  return {
    name: x.name,
    canvas: x.canvas,
    fps: x.fps,
    duration: x.duration,
    counts: { tracks: x.tracks.length, clips: x.tracks.reduce((n, t) => n + t.clips.length, 0), assets: x.assets?.length ?? 0, markers: x.markers?.length ?? 0, compounds: x.compounds?.length ?? 0 },
    note: "describe_project has the timeline: every track and clip with ids, times and settings.",
  };
}

/** Options with the unset ones dropped, so the tool's defaults apply. */
const given = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** export_versions' focus: clips framed by hand, each the point of its
 * picture to keep at the frame's center (lib/reframe.ts). */
const FOCUS_SCHEMA: JsonSchema = {
  type: "array",
  description: "Clips framed by hand: [{clip_id, x, y}], the point of the clip's picture (fractions from its top left, as preview_media shows it) to keep at the center of the frame; an axis left out stays on the subject. On the call, for every version that does not say",
  items: {
    type: "object",
    properties: { clip_id: { type: "string", description: "A full-frame video or picture clip" }, x: { type: "number", minimum: 0, maximum: 1, description: "Across its picture, 0 left to 1 right" }, y: { type: "number", minimum: 0, maximum: 1, description: "Down its picture, 0 top to 1 bottom" } },
    required: ["clip_id"],
    additionalProperties: false,
  },
};

/** export_versions' pushes: what a version does with a shot's keyed push
 * (lib/versions.ts easePush, ADR-116). */
const PUSHES_SCHEMA: JsonSchema = {
  type: "string",
  enum: VERSION_PUSHES,
  description:
    "Full-frame shots' keyed pushes (a zoom keyed by hand or by frame_region): keep (default), relax (half the zoom) or hold (the shot at its widest throughout). A tall master's push-in frames a narrow column; on a wider version the same zoom crops the picture's top and bottom (a rocket's nose), and relax or hold shows them, the frame still around what the master showed. On the call, for every version that does not say",
};

/** export_versions' overrides: clips placed by hand in a version, after
 * its automatic adaptation (lib/versions.ts applyOverrides). */
const OVERRIDES_SCHEMA: JsonSchema = {
  type: "array",
  description:
    "Clips placed by hand in this version, after the automatic adaptation (raise a lower third, enlarge a headline, hide a logo): [{clip_id, x, y, scale, hidden}]. Any clip: a title, a picture, a compound clip, or a clip inside a compound by its own id. A clip in a group (an ad element) moves and resizes with its group; hidden is the clip alone. Kept in a saved version project. On the call, for every version that does not say",
  items: {
    type: "object",
    properties: {
      clip_id: { type: "string", description: "The clip, as describe_project names it in the master" },
      x: { type: "number", minimum: -1, maximum: 1, description: "Where it rests across the version's frame: its transform.x, a fraction of the frame from its center (-0.5 left edge .. 0.5 right edge); keyed motion moves with it" },
      y: { type: "number", minimum: -1, maximum: 1, description: "Where it rests down the frame: its transform.y (-0.5 top .. 0.5 bottom; on a tall frame a title's box stays above y 0.15, where the apps' captions and buttons begin)" },
      scale: { type: "number", minimum: 0.1, maximum: 10, description: "Times its size as the version adapted it (1.25 a quarter larger: a title's type, any other layer's scale), about its own center" },
      hidden: { type: "boolean", description: "true: off in this version; false: on, though the master hides it" },
    },
    required: ["clip_id"],
    additionalProperties: false,
  },
};

interface AppTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call(host: McpHost, args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "audio"; data: string; mimeType: string })[];
  isError?: boolean;
}

const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v) }] });

/** generate_music's parameters (plan_music's are the same less the files). */
function musicSchema(files: boolean): JsonSchema {
  const section = obj(
    {
      name: { type: "string", description: "intro, verse, build, drop (or chorus, climax), breakdown (or bridge), outro, or any name (its energy then decides)" },
      bars: { type: "integer", minimum: 1, maximum: 128, description: "Its length in bars of 4 beats" },
      seconds: { type: "number", minimum: 0.5, description: "Its length in seconds instead, rounded to whole bars" },
      at: { type: "number", minimum: 0, description: "Seconds into the music where it must start (a drop at the edit's climax)" },
      end_at: { type: "number", minimum: 0.5, description: "Seconds into the music where it must end (the outro at the video's end)" },
      energy: { type: "number", minimum: 0, maximum: 1, description: "How full and loud, 0..1 (default by name: drop 1, build 0.65, verse 0.5, breakdown 0.35, intro and outro 0.3)" },
      seed: { type: "integer", minimum: 0, description: "Regenerate only this section's drums, fills and touches with another seed" },
    },
    ["name"],
  );
  const p: Record<string, JsonSchema> = {
    style: { type: "string", enum: STYLE_IDS, description: "launch (product launch: electronic, driving), cinematic (big, swelling), corporate (upbeat corporate), lofi (lo-fi chill), ambient" },
    bpm: { type: "number", minimum: 40, maximum: 220, description: "Tempo; default the style's (launch 120, cinematic 90, corporate 116, lofi 80, ambient 92)" },
    key: { type: "string", description: "The tonic, such as A, F# or Bb; Am or A minor also sets the mode (default the style's)" },
    mode: { type: "string", enum: MODE_IDS, description: "major, minor, dorian, mixolydian, lydian, phrygian or harmonic_minor (default the style's)" },
    length: { type: "number", minimum: 2, maximum: 300, description: "Seconds in all, when no sections are given: the style's form is fitted to it (default 60, at most 300)" },
    sections: { type: "array", items: section, description: "The form, in order; any mix of bars, seconds and fixed times" },
    seed: { type: "integer", minimum: 0, description: "The same seed and arguments give the same music; default a new one, answered" },
    ending: { type: "string", enum: ["ring", "stop"], description: "ring (default): the final chord rings out over the last section; stop: a short final hit, then silence" },
    fx: { type: "boolean", description: "Risers, impacts, reverse cymbals and braams into and on the drops (default true)" },
    max_nudge: { type: "number", minimum: 0, maximum: 0.2, description: "How far the tempo may move to land asked-for times on bar lines, a fraction (default 0.06)" },
    start: { type: "number", minimum: 0, description: "Timeline seconds the music starts at (default 0); the answer's times include it" },
    brightness: { type: "number", minimum: -1, maximum: 1, description: "The master's tilt about 1 kHz: 1 lifts the highs 6 dB from 3 kHz and lowers the lows 3 dB under 300 Hz, -1 the other way (darker, under a busy voice), loudness and true peak held; default the style's (launch 0.4, the rest 0)" },
  };
  if (files) {
    Object.assign(p, {
      loudness: { type: "number", minimum: -30, maximum: -8, description: "Integrated loudness to master to, LUFS (default -14, online video)" },
      stems: { type: "boolean", description: "Also import the drums, bass, harmony and lead stems (default false)" },
      place: { type: "string", enum: ["mix", "stems", "none"], description: "mix (default): the mix on an audio track at start; stems: the four stems on four grouped tracks; none: import only" },
      markers: { type: "array", items: { type: "string", enum: [...MUSIC_MARKER_KINDS] }, description: "Markers to add, as analyze_music names them: beats (Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (Drop)" },
      name: { type: "string", description: "The media's name (default style, tempo, key and seed)" },
    });
  }
  return obj(p, ["style"]);
}

const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false });

/** Where an agent's export goes instead of the Videos folder (ADR-095). */
const FOLDER: JsonSchema = { type: "string", description: "An absolute folder to write into instead of the Videos folder, created if missing (desktop only; the browser build refuses it rather than ignore it)" };
const FOLDER_DESKTOP_ONLY = "folder is desktop only: this build (the browser) cannot write into a folder of your choosing. Leave folder out and ask the user to export from the app, or use the desktop app.";

/** A contact sheet's tiles a row: one limit for every preview tool. */
const columns = (dflt: number): JsonSchema => ({ type: "integer", minimum: 1, maximum: 8, description: `Tiles a row, at most 8; default ${dflt}` });

/** Tools that touch the outside world or the session, not just the document. */
export const APP_TOOLS: AppTool[] = [
  {
    name: "help",
    description: "The guide to these tools. topic: overview (the tools by step; start here), ad, epic_edit, voiceover or social_short (step-by-step playbooks), design (the rules of thumb every playbook follows, given once here), catalog, params (set_param paths), or any tool's name for its parameters and an example call.",
    inputSchema: obj({ topic: { type: "string", description: `overview (default), ${HELP_TOPICS.slice(1).join(", ")}, or a tool's name` } }),
    call: (h, a) => ({ content: [{ type: "text", text: helpText(a.topic === undefined ? undefined : String(a.topic), listTools(), guideFor(h)) }] }),
  },
  {
    name: "describe_project",
    description:
      "Read the timeline: canvas, fps, duration, assets, tracks and clips with ids and times in seconds (a media clip's in/out and speed, keyframes, effects and look), markers and compound clips' nested timelines. Call this first and after edits. A long project's timeline runs to thousands of tokens, so ask for less: clip_ids (one clip's in-point and keyframes), track_ids or a stretch (start, end) narrow the clips, and the media and markers listed follow them; shown says how much of each list is in the answer. Example: {\"clip_ids\": [\"c_12\"]}.",
    inputSchema: obj({
      clip_ids: { type: "array", items: { type: "string" }, description: "Only these clips, each under its track (or its compound)" },
      track_ids: { type: "array", items: { type: "string" }, description: "Only these tracks, each listed empty or not" },
      start: { type: "number", minimum: 0, description: "Only clips still playing after this timeline second" },
      end: { type: "number", minimum: 0, description: "Only clips starting before this timeline second; the same as start: what plays at that moment" },
      assets: { type: "boolean", description: "false: no media list; true: all of it (default: all, or the clips' own when narrowed)" },
      markers: { type: "boolean", description: "false: no markers; true: all (default: all, or those in the stretch or on the clips shown)" },
      compounds: { type: "boolean", description: "false: no nested timelines (default: all, or those the clips shown play)" },
    }),
    call: (h, a) => json(filterDescription(h.describe(), a as DescribeFilter)),
  },
  {
    name: "list_catalog",
    description:
      "Every name the edit tools accept. With no section: an index of all sections (effects, transitions, animations, filters, text_templates, caption_looks, speed_presets, sound_effects, ambience, voices, blend_modes, mask_shapes, fonts, canvas_ratios, export_presets, sticker_motions, stickers, param_paths). With a section: its details, such as each effect's parameters with ranges and defaults, or each voice's accent, gender, grade, character and what to cast it for. section stickers with a query searches the sticker library.",
    inputSchema: obj({ section: { type: "string", description: "A section name from the index" }, query: { type: "string", description: "Search words, for section stickers" } }),
    call: (_h, a) => json(fullCatalog(a.section === undefined ? undefined : String(a.section), a.query === undefined ? undefined : String(a.query))),
  },
  {
    name: "import_media",
    description:
      "Import media files into the project by absolute path (desktop) or URL. What a file is comes from the file (its path's or address's extension, else its contents), never from name, which is only the label the library shows. Answers one entry per file, in the order given: the new asset (id, name, kind, duration, width, height) for add_media_clip, a .cube LUT as {lut_id, name, kind: lut} for apply_lut, or {src, name, error} saying why that file failed; when every file fails, the call is an error naming each reason.",
    inputSchema: obj(
      { files: { type: "array", description: "Files to import", items: obj({ src: { type: "string", description: "Absolute path or URL" }, name: { type: "string", description: "The name the library shows (default the file's name); any text, it does not decide the format" } }, ["src"]) } },
      ["files"],
    ),
    call: async (h, a) => {
      const files = a.files as { src: string; name?: string }[];
      if (!files.length) throw new Error("files needs at least one file");
      const got = (await h.importMedia(files)) as { src?: string; error?: string }[];
      // Every file failed: an error that says why, never an empty answer.
      if (!got.length) throw new Error("Nothing was imported: the project closed during the import.");
      if (got.every((x) => x.error)) throw new Error(`Nothing was imported. ${got.map((x) => `${x.src}: ${x.error}`).join("; ")}`);
      return json(got);
    },
  },
  { name: "undo", description: "Undo the last edit; returns what that changed back.", inputSchema: obj(), call: (h) => json(describeChanges(h.describe(), h.undo())) },
  { name: "redo", description: "Redo the last undone edit; returns what changed.", inputSchema: obj(), call: (h) => json(describeChanges(h.describe(), h.redo())) },
  {
    name: "seek",
    description: "Move the playhead to a time in seconds: what the viewer shows and where tools that act at the playhead (the Tracking box) start.",
    inputSchema: obj({ at: { type: "number", minimum: 0, description: "Seconds" } }, ["at"]),
    call: (h, a) => json(h.seek(Number(a.at))),
  },
  {
    name: "list_projects",
    description: "The saved projects, most recently edited first, with ids for open_project. The one open in the editor is marked open: true; none is when the app shows its home screen.",
    inputSchema: obj(),
    call: async (h) =>
      json(
        [...(await h.listProjects())]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((p) => ({ id: p.id, name: p.name, updated: new Date(p.updatedAt).toISOString(), duration: +p.duration.toFixed(2), canvas: `${p.width}x${p.height}`, ...(p.open ? { open: true } : {}) })),
      ),
  },
  ...PROJECT_FILE_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    inputSchema: c.input,
    call: async (h: McpHost, a: Record<string, unknown>) => {
      const r = (await h.exec(c.name, a)) as { project?: unknown } | null;
      // open_project_file answers a summary, as open_project does, not the timeline.
      return json(r && typeof r === "object" && r.project ? { ...r, project: projectSummary(r.project) } : r);
    },
  })),
  {
    name: "open_project",
    description: "Save the project in the editor and open another, by id or by name (any case; the most recently edited wins a tie). Answers a summary (name, canvas, fps, duration, counts); describe_project has the timeline.",
    inputSchema: obj({ project: { type: "string", description: "Project id or name" } }, ["project"]),
    call: async (h, a) => json(projectSummary(await h.openProject(findProject(await h.listProjects(), String(a.project)).id))),
  },
  {
    name: "new_project",
    description: "Save the project in the editor and start a new, empty one (1920x1080, 30 fps; set_project changes them). Work in one to leave the user's projects untouched. Answers a summary; describe_project has the timeline.",
    inputSchema: obj({ name: { type: "string", description: "Project name; default: the date and time" } }),
    call: async (h, a) => json(projectSummary(await h.newProject(a.name === undefined ? undefined : String(a.name)))),
  },
  {
    name: "save_project_copy",
    description: "Save the open project as a copy under a new name, sharing its media, and open the copy (default) or stay. For a variant worked by hand, or a try that may be thrown away; the original stays as it was. For another shape of the same film, export_versions with save_projects saves it already laid out in that shape, to fine-tune.",
    inputSchema: obj({ name: { type: "string", description: "The copy's name, e.g. 'Ember Roast 16x9'" }, open: { type: "boolean", description: "Open the copy to edit it (default true)" } }, ["name"]),
    call: async (h, a) => json(await h.saveCopy(String(a.name), a.open !== false)),
  },
  {
    name: "preview_frame",
    description: "See the composited picture at a time: returns a PNG image of the frame exactly as it would export.",
    inputSchema: obj({ at: { type: "number", minimum: 0, description: "Seconds" }, max_width: { type: "integer", minimum: 64, maximum: 1920, description: "Image width, default 640 (at most the canvas width)" } }, ["at"]),
    call: async (h, a) => ({ content: [{ type: "image", data: await h.frame(Number(a.at), Number(a.max_width ?? 640)), mimeType: "image/png" }] }),
  },
  {
    name: "preview_frames",
    description: "See several moments at once: one JPEG contact sheet of the frames at the given times, each stamped with its time. Check a whole edit in one call, then preview_frame a moment that needs a closer look.",
    inputSchema: obj(
      {
        times: { type: "array", items: { type: "number", minimum: 0 }, description: "Seconds, up to 24" },
        columns: columns(4),
        tile_width: { type: "integer", minimum: 120, maximum: 640, description: "Width of each frame, default 320" },
      },
      ["times"],
    ),
    call: async (h, a) => {
      const times = (a.times as number[]).slice(0, 24);
      if (!times.length) throw new Error("times needs at least one time");
      return { content: [{ type: "image", data: await h.sheet(times, Number(a.tile_width ?? 320), Number(a.columns ?? 4)), mimeType: "image/jpeg" }] };
    },
  },
  {
    name: "preview_motion",
    description: "See movement and timing: consecutive frames of a stretch of the timeline (default 8 a second, at most 36) as one contact sheet, plus, as text, the cuts on the main track and the markers (beats) in that stretch. Use it to check that cuts land on the beat, a move is smooth, or a transition reads; preview_frames is for whole-video overviews.",
    inputSchema: obj(
      {
        start: { type: "number", minimum: 0, description: "Timeline seconds" },
        end: { type: "number", minimum: 0, description: "Timeline seconds; default start + 2" },
        fps: { type: "number", minimum: 1, maximum: 30, description: "Frames a second, default 8" },
        columns: columns(6),
        tile_width: { type: "integer", minimum: 120, maximum: 640, description: "Default 240" },
      },
      ["start"],
    ),
    call: async (h, a) => {
      const start = Number(a.start), end = Number(a.end ?? start + 2), fps = Number(a.fps ?? 8);
      if (!(end > start)) throw new Error("end must be after start");
      const n = Math.min(36, Math.max(2, Math.round((end - start) * fps) + 1));
      const times = Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(3));
      // The sheet first: with no project open it says so.
      const image = await h.sheet(times, Number(a.tile_width ?? 240), Number(a.columns ?? 6));
      const d = h.describe() as { tracks: { main?: boolean; clips: { start: number }[] }[]; markers: { at: number; label: string }[] };
      const inside = (t: number) => t >= start && t <= end;
      const cuts = (d.tracks.find((t) => t.main)?.clips ?? []).map((c) => c.start).filter((t) => t > 0 && inside(t));
      const markers = d.markers.filter((m) => inside(m.at)).map((m) => ({ at: m.at, label: m.label }));
      return {
        content: [
          { type: "image", data: image, mimeType: "image/jpeg" },
          { type: "text", text: JSON.stringify({ frames: times, cuts, markers }) },
        ],
      };
    },
  },
  {
    name: "preview_media",
    description: "Look inside imported media before using it: a video's own frames at source seconds (times), or `count` frames spread over the whole file (default 12), as one contact sheet; a still picture whole, labeled with its size. Use it to choose the in-points and moments worth using (a hero shot, a reaction, the action) and to see what a photo shows before framing it. file instead of asset_id looks inside a file without importing it: an exported video (the path export_video or export_versions answered) to see what was delivered, frame by frame as the file has it, not the timeline; the answer adds the file's length and size.",
    inputSchema: obj(
      {
        asset_id: { type: "string", description: "A video or picture asset id from describe_project or import_media" },
        file: { type: "string", description: "Instead of asset_id: a video or picture file to look inside without importing it, e.g. an exported file's path (desktop: an absolute path; the browser build: a URL)" },
        times: { type: "array", items: { type: "number", minimum: 0 }, description: "Source seconds, up to 24" },
        count: { type: "integer", minimum: 2, maximum: 24, description: "Frames spread over the file when times is not given; default 12" },
        columns: columns(4),
        tile_width: { type: "integer", minimum: 120, maximum: 640, description: "Default 320" },
      },
      [],
    ),
    call: async (h, a) => {
      // An exported file, or any file not imported (ADR-116).
      if (a.file !== undefined) {
        if (a.asset_id !== undefined) throw new Error("give asset_id or file, not both");
        if (!h.fileSheet) throw new Error("This app cannot read files that are not imported.");
        const r = await h.fileSheet(String(a.file), a.times ? (a.times as number[]).slice(0, 24) : undefined, Number(a.count ?? 12), Number(a.tile_width ?? 320), Number(a.columns ?? 4));
        return { content: [{ type: "image", data: r.image, mimeType: "image/jpeg" }, { type: "text", text: JSON.stringify(r.file) }] };
      }
      if (a.asset_id === undefined) throw new Error("give asset_id (an imported video or picture) or file (a path or URL)");
      const d = h.describe() as { assets: { id: string; kind: string; duration: number }[] };
      const asset = d.assets.find((x) => x.id === a.asset_id);
      if (!asset) throw new Error(`No asset ${a.asset_id}; describe_project lists them`);
      const n = Number(a.count ?? 12);
      const times = asset.kind === "image" ? [0] : a.times ? (a.times as number[]).slice(0, 24) : Array.from({ length: n }, (_, i) => +((asset.duration * (i + 0.5)) / n).toFixed(2));
      return { content: [{ type: "image", data: await h.mediaSheet(String(a.asset_id), times, Number(a.tile_width ?? 320), Number(a.columns ?? 4)), mimeType: "image/jpeg" }] };
    },
  },
  {
    name: "preview_audio",
    description:
      "Hear the sound: a stretch of the mix, or one stem, rendered offline through the mixer export uses (every clip's volume, fades, ducking keys, EQ, compressor, filters, reverb and echo tails), returned as a short MP3 (an audio content block, 96 kbps stereo, at most 30 s a call) for a model that can listen, and as text the measurements for one that cannot: integrated loudness, the loudest 3 s and 400 ms, every second's loudness, the true peak, silent stretches, where the energy sits (below 250 Hz, to 4 kHz, above, and the octave slope; speech and most mixes slope -3 to -6 dB an octave), the stereo correlation and clipped samples; with solo mix also each stem's loudness (dialog, music, effects, ambience, by each track's role, and picture: what the video tracks play, their footage's own sound and any compound clip's mix), each its own integrated loudness where it sounds, so they do not add up to the mix's. edges measures, sample by sample, every place in the stretch where an audio clip meets the next on its track (a song's splice) and any clip start or end that is not clean: dip_db (a hole of a few milliseconds at the cut, as a butt cut's click guard leaves: -10 or deeper is heard as a tick), click_db (a sample step steeper than any around it and than the incoming file's own attack there, so a kick on the downbeat a cut lands on is no click), step_db (the level after against before; a join stepping 6 dB or more that the music makes there itself, on a new bar or hit, says so in step_note, and one inside a ring-out (the sound falling 6 dB or more over the second before) that neither file makes there is flagged at 6 dB, not 12), tail_cut_db (the clip's own file rings on that much louder than what follows: a tail cut dead) and cut_in_db (a clip coming in mid-sound), each with a verdict (clean, or what is wrong) and the fix (set_crossfade, set_fades); dropouts lists anywhere the sound falls to nothing for 3-100 ms inside sound (a lost packet, a hole). solo: mix (default), voice (the dialog tracks alone), music, effects or ambience; the picture's own sound plays only in mix. loudness hears it as export_video with that loudness delivers it (the whole mix is measured first, so it takes longer). audio false answers the measurements alone. Nothing is changed.",
    inputSchema: obj(
      {
        start: { type: "number", minimum: 0, description: "Timeline seconds" },
        end: { type: "number", minimum: 0, description: "Timeline seconds; default start + 10, at most start + 30" },
        solo: { type: "string", enum: ["mix", "voice", "music", "effects", "ambience"], description: "What to hear: the whole mix (default) or one stem by role" },
        loudness: { type: "number", minimum: -40, maximum: -5, description: "Hear it as export_video with this loudness (LUFS) delivers it; default as mixed" },
        audio: { type: "boolean", description: "false: the measurements only, no MP3 (default true)" },
      },
      ["start"],
    ),
    call: async (h, a) => {
      const r = await h.audition(given({ start: Number(a.start), end: a.end === undefined ? undefined : Number(a.end), solo: a.solo, loudness: a.loudness, audio: a.audio }) as { start: number });
      return { content: [...(r.data ? [{ type: "audio" as const, data: r.data, mimeType: r.mimeType ?? "audio/mpeg" }] : []), { type: "text", text: JSON.stringify(r.summary) }] };
    },
  },
  {
    name: "check_project",
    description: "Check the edit against professional rules before exporting: text outside the 90% title-safe area or under the vertical apps' buttons; text too small for a phone (its share of the frame's height named, under 4.5% of the short side, 5% on a tall frame or kind social_short) or too short to read; text in low contrast with the picture behind it: every title is measured on the rendered picture at a few moments of its life with its box, shadow and outline counted, and a low one is named with its WCAG ratio, the time, and a box or outline that measures better there (contrast.lowest lists every title's ratio); captions over 20 characters a second, more than two fonts, a title its subject hides (text_behind_subject on a shape the subject now fills; rendered), flashes over 3 a second (seizure risk), black gaps on the main track, music that stops dead at the end (its last second measured, so a track that fades out in its own audio passes), a sound cut off before the end with no fade while it still sounds (a song or a bed trimmed mid-phrase, a line cut mid-word), and by kind: an ad's end card, an epic edit's cuts on the beat (the Beat, Bar, Phrase and Drop markers, or the grid set_music_grid gave a song, where its clips play it; cuts counted where the viewer sees them, across tracks). ok is true when there are no errors; warnings and tips can remain beside it, and verdict says so in words. not_checked says what was not measured, and why. Every text rule sees the titles inside compound clips too (an end card built as one), where and as large as the compound clip draws them; such a finding names compound_clip_id. Each finding names the clip, the time and the tool that fixes it. Run it, fix, run it again.",
    inputSchema: obj({ kind: { type: "string", enum: ["ad", "epic_edit", "social_short", "any"], description: "What is being made; default any" } }),
    call: async (h, a) => json(await h.checkProject(String(a.kind ?? "any"))),
  },
  {
    name: "export_video",
    description:
      "Export the open project to a video file in the user's Videos folder (in a folder named after the app), or in folder, with no dialog; an existing file is never replaced: the new one takes a numbered name (Trip (2).mp4) and the answer's note says so. Returns the file's path when done. loudness brings the mix to an integrated LUFS with its true peak held under -1 dBTP: -14 for YouTube, TikTok and Spotify, -23 for EBU R128 broadcast, -24 for ATSC A/85 US TV (held under -2 dBTP); the answer's loudness says what the mix reached. Each exported file answers the loudness its mix reached (loudness, info), as export_video does, and titles: a title behind its subject that the subject hides in that shape. Exports that take over about four minutes answer state running: follow them with export_status. format mp3, m4a or wav exports the sound alone. preview_media with file: the answer's path shows the exported file's own frames. captions decides what becomes of the captions (add_captions): burn (default) draws them into the picture, srt writes them as a .srt file beside the video (answered as captions_file) and leaves the picture clean, both does both, none leaves them out.",
    inputSchema: obj({
      name: { type: "string", description: "File name without extension; default the project's name" },
      format: { type: "string", enum: ["mp4", "mov", "webm", "mkv", "gif", "mp3", "m4a", "wav"], description: "Default mp4 (H.264 + AAC); mp3, m4a and wav are sound only" },
      resolution: { type: "string", enum: ["480p", "720p", "1080p", "2k", "4k"], description: "Short side; default from the project" },
      quality: { type: "string", enum: ["lower", "recommended", "higher"], description: "Default recommended" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Integrated LUFS for the mix; default as mixed" },
      start: { type: "number", minimum: 0, description: "Export from this second" },
      end: { type: "number", minimum: 0, description: "Export to this second" },
      captions: { type: "string", enum: ["burn", "srt", "both", "none"], description: "The captions: burn into the picture (default), srt file beside it, both, or none" },
      folder: FOLDER,
    }),
    call: async (h, a) => {
      if (a.folder !== undefined && h.canExport?.() === false) throw new Error(FOLDER_DESKTOP_ONLY);
      const done = h.exportVideo(given({ name: a.name, format: a.format, resolution: a.resolution, quality: a.quality, loudness: a.loudness, start: a.start, end: a.end, captions: a.captions, folder: a.folder }));
      done.catch(() => {}); // after the wait below, export_status reports a failure
      // ponytail: the desktop bridge gives a call 300 s; past 240 s the agent polls export_status.
      const waited = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 240_000))]);
      return json(waited ?? { ...(h.exportStatus() as object), note: "Still exporting: call export_status." });
    },
  },
  {
    name: "export_status",
    description: "The last export_video: running (fraction done, eta seconds), done (path, bytes, seconds) or failed (message).",
    inputSchema: obj(),
    call: (h) => json(h.exportStatus() ?? { state: "none" }),
  },
];

// Speech: the voice, its pace, precision and finish (state/tts.ts).
const VOICE_IDS = VOICES.map((v) => v.id).join(", ");
const VOICE: JsonSchema = { type: "string", description: `Voice id (list_catalog section voices), or a blend ("af_heart:60,af_bella:40"); default ${DEFAULT_VOICE}` };
const SPEED: JsonSchema = { type: "number", minimum: 0.5, maximum: 2, description: "1 is the model's own pace; kept as given. Default: chosen per line to land on its words a second (Heart narrates at 0.6-0.9)" };
const WPS: JsonSchema = { type: "array", items: { type: "number", minimum: 1, maximum: 5 }, description: "[lowest, highest] words a second over each line's speech, first word to last, its pause marks out (narration [2.3, 2.8]); held exactly as given, whatever the pace; the speed is chosen to land on it" };
const READ_AS_SCHEMA: JsonSchema = { type: "string", enum: READ_AS, description: `The kind of read, whose words a second lines land on: ${READ_AS.map((k) => `${k} ${PACE_BANDS[k].join("-")}`).join(", ")} (default narration)` };
const PRONOUNCE: JsonSchema = { type: "object", description: 'Words respelled for the voice only (whole words, case as written), each to the text the voice reads: {"MCP": "M C P", "OpenFrame": "Open Frame"}' };
const QUALITY: JsonSchema = { type: "string", enum: ["best", "draft"], description: "best: full-precision weights (default; on WebGPU, or on the CPU about as fast as draft); draft: 8-bit weights, a quarter of the download" };
const FINISH: JsonSchema = { type: "string", enum: ["natural", "clean", "raw"], description: "natural (default): a recorded read's pauses, EQ, one loudness, room tone, the voice compressor and a touch of room; clean: one loudness and faded edges, nothing added; raw: the model's read, trimmed" };
const PACE: JsonSchema = { type: "string", enum: ["slow", "normal", "fast"], description: "The pace the line is meant to have, kept with it: slow (an end-card tagline, a dramatic beat) or fast moves its kind's words a second half a word down or up, for the read and the review, and a slow line is read no faster than speed 1; a words_per_second given wins over it (default normal)" };

// The local AI tools: analysis on this machine, then one undoable edit each
// ([[AI tools]], ADR-019). They take a while on long clips.
const clipId = { type: "string", description: "Video or audio clip id" } as const;
const sensitivity = { type: "number", minimum: 0, maximum: 1, description: "0..1, default 0.5" } as const;
APP_TOOLS.push(
  {
    name: "remove_silences",
    description: "Find the pauses in a clip's speech and cut them out, closing the gaps (one undo step). Returns the silent source ranges and seconds saved.",
    inputSchema: obj({ clip_id: clipId, sensitivity, min_silence: { type: "number", minimum: 0, description: "Shortest pause to cut, seconds (default 0.4)" }, padding: { type: "number", minimum: 0, description: "Kept around speech, seconds (default 0.1)" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("removeSilences", String(a.clip_id), given({ sensitivity: a.sensitivity, minSilence: a.min_silence, padding: a.padding }))),
  },
  {
    name: "get_transcript",
    description: "Hear a video or audio clip's speech on this machine (Whisper) and return its words with source-second times. Delete words by passing their spans to cut_ranges (Premiere's text-based editing).",
    inputSchema: obj({ clip_id: clipId }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("clipTranscript", String(a.clip_id), {})),
  },
  {
    name: "remove_filler_words",
    description: "Transcribe a clip's speech on this machine (Whisper) and cut its filler words (um, hmm, ah) with the hesitation around each, closing the gaps (one undo step). Whisper does not transcribe \"uh\", so those stay. Returns the source ranges cut and the words heard.",
    inputSchema: obj({ clip_id: clipId, model: { type: "string", description: "Whisper model id (default onnx-community/whisper-base.en_timestamped)" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("removeFillers", String(a.clip_id), given({ model: a.model }))),
  },
  {
    name: "split_scenes",
    description: "Find every shot change in a video clip and split there (or drop markers). Returns the cut times in source seconds.",
    inputSchema: obj({ clip_id: clipId, sensitivity, output: { type: "string", enum: ["split", "markers"], description: "Default split" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("splitScenes", String(a.clip_id), given({ sensitivity: a.sensitivity, output: a.output }))),
  },
  {
    name: "mark_beats",
    description: "Mark a music clip's beats (every Nth) with Beat markers, from the whole song's reading (analyze_music's beats, read through the grid set_music_grid gave the file), placed where the clip plays them: trimmed, moved or sped up, the markers stand on the song's beats, and they follow the clip through later edits, replacing its earlier Beat markers. Answers bpm as the clip plays it (file_bpm, the file's own, when it is sped up or slowed), the beats marked in timeline seconds and how many markers it added (0 when they were there already: a second call replaces them, never doubles them).",
    inputSchema: obj({ clip_id: clipId, every: { type: "integer", enum: [1, 2, 4], description: "Marker on every Nth beat (default 1)" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("markBeats", String(a.clip_id), given({ every: a.every }))),
  },
  {
    name: "normalize_loudness",
    description:
      "Measure clips' loudness (EBU R128) and set their volume to reach a target without their true peak passing the ceiling (-1 dBTP; -2 for ATSC). -14 LUFS suits social video, -16 podcasts, -23 European broadcast, -24 US TV. spec names a delivery spec instead (its target and ceiling). A ducked clip keeps its duck: its volume keys scale so the loudest is the new level. Each clip is measured alone: measure_loudness checks the mix.",
    inputSchema: obj(
      {
        clip_ids: { type: "array", items: { type: "string" }, description: "Video or audio clip ids" },
        target: { type: "number", minimum: -40, maximum: -5, description: "LUFS, default -14" },
        spec: { type: "string", enum: SPEC_IDS, description: "online (-14 LUFS, -1 dBTP), ebu_r128 (-23 LUFS, -1 dBTP) or atsc_a85 (-24 LKFS, -2 dBTP); overrides target" },
      },
      ["clip_ids"],
    ),
    call: async (h, a) => json(await h.ai("normalizeLoudness", (a.clip_ids as unknown[]).map(String), given({ target: a.target, spec: a.spec }))),
  },
  // ---- delivery (ADR-061) --------------------------------------------------------
  {
    name: "measure_loudness",
    description:
      "Measure the mix the way export renders it (48 kHz stereo, every clip's effects, tails and fades) and check it against a delivery spec before exporting. Answers integrated_lufs (BS.1770), loudness_range_lu (EBU Tech 3342 LRA) with range (the LRA against what kind usually spans: film 5-15 LU, ad 3-8, social 3-10, podcast 3-8; a very flat or wide mix gets a note), short_term_max_lufs (loudest 3 s), momentary_max_lufs (loudest 400 ms), true_peak_dbtp (4x oversampled) and sample_peak_dbfs, then pass and the problems against spec: online (-14 LUFS ±1, at most -1 dBTP: YouTube, Spotify, TikTok), ebu_r128 (-23 LUFS ±0.5, at most -1 dBTP: European broadcast) or atsc_a85 (-24 LKFS ±2, at most -2 dBTP: US TV); all three when spec is left out. loudness measures what export_video with that loudness delivers (the mix raised or lowered, its true peak held by the limiter), so a failing mix can be checked as exported: {spec: \"ebu_r128\", loudness: -23}. by_track measures each audio track alone as mixed (integrated, loudest three seconds, LRA) and, with a Voiceover track and music, the voice over the music in three named windows that differ by design: program (the whole stretch, music between lines included), speech (while the voice speaks, its lines together) and per_line (each line alone: lowest, median, highest, and where the lowest is). start and end (timeline seconds) measure part of it. It takes about a quarter of the mix's length to run (a 60 s mix, some 15 s), twice that with loudness.",
    inputSchema: obj({
      by_track: { type: "boolean", description: "Each audio track measured alone as mixed (before master normalization), with its role (describe_project names each track's; update_track sets one), and the voice's margin over the music (the dialog and music tracks, by role) by window: program, speech and per_line" },
      per_second: { type: "boolean", description: "With by_track, each track's three-second loudness every second too (long; default false: summaries only)" },
      kind: { type: "string", enum: PROGRAM_KINDS, description: "What the mix is for, to judge its loudness range: film (documentary, brand film), ad, social, podcast or any (default)" },
      spec: { type: "string", enum: SPEC_IDS, description: "Delivery spec to check; default all three" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Measure as export_video with this loudness (LUFS) delivers it; default as mixed" },
      start: { type: "number", minimum: 0, description: "Timeline seconds, default 0" },
      end: { type: "number", minimum: 0, description: "Timeline seconds, default the end" },
    }),
    call: async (h, a) => json(await h.ai("loudnessReport", a.spec === undefined ? "" : String(a.spec), given({ loudness: a.loudness, start: a.start, end: a.end, by_track: a.by_track, per_second: a.per_second, kind: a.kind }))),
  },
  {
    name: "duck_under_speech",
    description:
      `Lower music wherever the other clips with sound under it (inside compound clips too) have speech, as editable volume keyframes: one clip (clip_id), or every clip of a music track as one bed (track_id: a song cut into pieces is ducked in one call, a line across a cut dipping on both sides). A voice's balance over music depends on the window it is measured in, and the answer names it: speech (while the voice speaks, every line from its first word to its last, together) and line (each line alone); measure_loudness by_track also gives program (the whole stretch, music between lines included, which reads lower). voice_above_music_lu aims the voice that many LU over the music in the speech window; min_line_lu holds every line to at least that many LU over the music, each line's dip as deep as it needs (with voice_above_music_lu, or depth, as the usual dip); max_line_lu holds every line to at most that many, a line over a quiet passage dipping less (never raised over its volume), so a quiet intro or a last hit is not emptied: by default ${LINE_CEILING_LU} LU (or 3 over voice_above_music_lu or min_line_lu, when higher) whenever any of the three is given, and never under voice_above_music_lu (lines each under it cannot sit over it together); a line held under the ceiling moves the others so the lines together stay on voice_above_music_lu. All are measured on the rendered stems and met by measuring again; balance answers the speech window's numbers, target and met, and per_line the lines' lowest, median and highest margins, the minimum and ceiling held to, and each line with its own dip. Plain depth lowers by that many dB without measuring. Between lines: a pause shorter than min_gap (default ${DUCK_MIN_GAP} s) stays down so the music does not pump, and so does the music before a first line or after a last one that close to its start or end (no blip); a longer pause comes back up over release (default ${DUCK_RELEASE} s) and dips again 0.1 s before the next line. open_at brings the music up on chosen moments whatever their pause: timeline seconds, or marker labels ("Drop": every marker so labeled, as analyze_music and set_music_grid mark a song's drops), so a drop between lines plays at the music's level; a moment inside a line stays down under the voice. The answer lists the pauses held down (held, seconds), each open_at moment with where the music is up around it (up) or the line it falls in (inside_line), and notes a drop marker the music stays down through. Volume keys made by hand (added or changed since the last duck: a lift on a drop, a hold before a hit) are kept wherever no line speaks, in place of the duck's own in that pause, the duck's level held at the lines either side; one under a line is replaced, and hand_keys lists both. The music keeps how it was ducked: a voice line that changes later (retake_voiceover) dips it again the same way, and an edit that moves a line under it, or moves the music and its dips (cut_music, move_clip), says so.`,
    inputSchema: obj({
      clip_id: { type: "string", description: "The music clip (or give track_id)" },
      track_id: { type: "string", description: "A music track: every clip with sound on it ducked as one bed, instead of clip_id" },
      voice_above_music_lu: { type: "number", minimum: 0, maximum: 30, description: "LU the voice sits over the music while it speaks (all lines together; 10-15 for a promo); measured and met, overrides depth" },
      min_line_lu: { type: "number", minimum: 0, maximum: 30, description: "LU every line sits over the music at least (each line alone, its first word to its last); a line short of it dips deeper, measured and met" },
      max_line_lu: { type: "number", minimum: 0, maximum: 30, description: `LU every line sits over the music at most; a line past it dips less, measured and met (default ${LINE_CEILING_LU}, or 3 over voice_above_music_lu or min_line_lu when higher)` },
      depth: { type: "number", minimum: 1, maximum: 40, description: "dB to lower, default 12; with min_line_lu alone, the least dip under every line (default none)" },
      open_at: { type: "array", items: { description: "Timeline seconds (a number) or a marker label (a string)" }, description: 'Moments the music comes up at between lines: timeline seconds, or marker labels ("Drop": every marker so labeled); default none' },
      min_gap: { type: "number", minimum: 0.2, maximum: 10, description: `Seconds a pause between lines must last for the music to come up (default ${DUCK_MIN_GAP}: shorter pauses stay down, so the music does not pump)` },
      release: { type: "number", minimum: 0.05, maximum: 3, description: `Seconds the music takes to come back up after a line (default ${DUCK_RELEASE})` },
    }),
    call: async (h, a) => {
      if ((a.clip_id === undefined) === (a.track_id === undefined)) throw new Error("Give clip_id (one music clip) or track_id (every clip on a music track).");
      return json(await h.ai("duckUnderSpeech", a.clip_id === undefined ? "" : String(a.clip_id), given({ depth: a.depth, voice_above_music_lu: a.voice_above_music_lu, min_line_lu: a.min_line_lu, max_line_lu: a.max_line_lu, track_id: a.track_id, open_at: a.open_at, min_gap: a.min_gap, release: a.release })));
    },
  },
  {
    name: "reduce_noise",
    description: "Take steady background noise (hiss, hum, fans, room tone) out of a clip's sound on this computer; the clip then plays a cleaned copy (a video's sound is extracted to an audio clip first).",
    inputSchema: obj({ clip_id: clipId, strength: { type: "number", minimum: 0, maximum: 1, description: "0.5 gentle, 0.75 default, 1 strong" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("reduceNoise", String(a.clip_id), given({ strength: a.strength }))),
  },
  {
    name: "sync_audio",
    description:
      "Line up a separately recorded sound (a lav, a recorder) with the camera clip of the same take by matching their waveforms on this computer (CapCut's Sync video and audio, Resolve's Auto Sync Audio), then move the audio clip into sync, exact to the sample (one undo step; sound before 0 is trimmed off its head). Answers the offset (audio source seconds minus video source seconds) and a confidence; refuses when the sounds do not clearly match. sync_to_clip places it by a known offset instead.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The audio clip to move" },
        video_clip_id: { type: "string", description: "The camera clip; default the video with sound that plays with it longest" },
        mute_camera: { type: "boolean", description: "Set the video's volume to 0 (default false)" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("syncAudio", String(a.clip_id), given({ videoId: a.video_clip_id, muteCamera: a.mute_camera }))),
  },
  {
    name: "stabilize_clip",
    description: "Smooth a shaky video clip on this computer (CapCut's Stabilize): measures the camera's shake and moves each frame onto a smooth path, zooming slightly to hide the edges. level: least-crop, recommended (default), most-stable, or off to remove it.",
    inputSchema: obj({ clip_id: clipId, level: { type: "string", enum: ["least-crop", "recommended", "most-stable", "off"], description: "How strongly to smooth" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("stabilizeClip", String(a.clip_id), given({ level: a.level }))),
  },
  {
    name: "track_motion",
    description:
      "Pin a title, sticker or picture to a moving subject in the video under it (CapCut's Tracking): follows the subject from `at` to the end of the shorter clip on this computer and writes the layer's position keyframes, keeping the layer's offset from the subject. box is the subject in fractions of the video's picture (x, y its top-left corner); without it, a box around the layer's own center. One undoable edit.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The layer to pin (title, sticker, picture or video)" },
        at: { type: "number", minimum: 0, description: "Timeline seconds to start from; default the playhead" },
        box: { ...obj({ x: { type: "number", description: "Left edge, a fraction of the picture's width" }, y: { type: "number", description: "Top edge, a fraction of its height" }, w: { type: "number", description: "Width, a fraction of the picture's width" }, h: { type: "number", description: "Height, a fraction of its height" } }, ["x", "y", "w", "h"]), description: "The subject, as a rectangle of the video's picture" },
        video_clip_id: { type: "string", description: "The video to follow; default the one under the layer (main track first)" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("trackMotion", String(a.clip_id), given({ at: a.at, box: a.box, videoId: a.video_clip_id }))),
  },
  {
    name: "add_sound_effect",
    description: `Add built-in sound effects, made on this computer: ${Object.entries(SFX).map(([k, x]) => `${k} (${x.label}, ${x.seconds} s)`).join(", ")}. One lands at \`start\` (default the playhead), or so that it ENDS at \`end_at\`: a riser or reverse cymbal then peaks exactly there (put end_at on the drop or a cut); a hit, boom or sub drop goes at the beat with start. They land on the effects stem: an SFX track (made the first time, reused after; overlapping sounds get a second SFX track), never a gap on the voiceover or the music; track_id puts them on a track of your own. \`sounds\` places many at once, as one undo step: a whoosh on every cut of a montage in one call (it cannot go in batch). Each file is made once per project and reused. add_ambience lays continuous natural sound (wind, water, rain, city, a rocket's rumble, room tone). Answers the new clip ids.`,
    inputSchema: obj({
      name: { type: "string", enum: Object.keys(SFX), description: "Which effect (list_catalog section sound_effects has their lengths)" },
      start: { type: "number", minimum: 0, description: "Timeline seconds the sound starts" },
      end_at: { type: "number", minimum: 0, description: "Timeline seconds the sound ends instead (start = end_at - its length)" },
      volume: { type: "number", minimum: 0, maximum: 4, description: "Gain, 1 as made (0.5 is about -6 dB, 0.25 -12 dB); default 1" },
      track_id: { type: "string", description: "An audio track to put them on (default the SFX track); where a sound would overlap one there, a new track of its role just below" },
      sounds: {
        type: "array",
        description: "Many sounds in one call instead of name: each with its own name, start or end_at, volume and track_id",
        items: obj(
          {
            name: { type: "string", enum: Object.keys(SFX), description: "Which effect" },
            start: { type: "number", minimum: 0, description: "Timeline seconds it starts (default the playhead)" },
            end_at: { type: "number", minimum: 0, description: "Timeline seconds it ends instead" },
            volume: { type: "number", minimum: 0, maximum: 4, description: "Gain, default 1" },
            track_id: { type: "string", description: "Its audio track; default the call's track_id, else the SFX track" },
          },
          ["name"],
        ),
      },
    }),
    call: async (h, a) => {
      if ((a.name === undefined) === (a.sounds === undefined)) throw new Error("give name (one sound) or sounds (a list), not both");
      const list = (a.sounds ?? [a]) as { name: string; start?: number; end_at?: number; volume?: number; track_id?: string }[];
      if (!list.length) throw new Error("sounds needs at least one sound");
      const before = h.describe();
      const cues = list.map((x) => given({ name: x.name, at: x.start, endAt: x.end_at, volume: x.volume, trackId: x.track_id ?? a.track_id }));
      const r = (await h.ai("addSoundEffects", "", { sounds: cues })) as { clipIds: string[] };
      const ids = a.sounds === undefined ? { clip_id: r.clipIds[0] } : { clip_ids: r.clipIds };
      return json({ ...ids, ...(describeChanges(before, h.describe()) as object) });
    },
  },
  {
    name: "add_ambience",
    description: `Lay continuous natural sound under the pictures, made on this computer (no recordings, nothing downloaded): ${AMBIENCE_IDS.map((k) => `${k} (${AMBIENCE[k].blurb})`).join("; ")}. It runs from start (default the playhead) to end, or for length seconds (default to the end of the timeline), faded in and out (fade_in 1 s and fade_out 1.5 s by default), on the Ambience track (made the first time, reused after; never the voiceover, the music or the effects). Each bed moves slowly and at random as a recording does (gusts, waves arriving every 7 to 13 s, cars passing near and far) and its file loops without a seam; a bed past ${BED_MAX_SECONDS} s repeats it. Made at a level that sits under a voice with volume 1 (about -27 LUFS; the rocket -21, room tone -46): volume 0.5 is 6 dB quieter. The same name and seed reuse the file; another seed is another take. preview_audio with solo ambience hears it. Answers the clip ids, the file's asset id and the track. It cannot go in batch.`,
    inputSchema: obj(
      {
        name: { type: "string", enum: AMBIENCE_IDS, description: "Which bed (list_catalog section ambience describes each)" },
        start: { type: "number", minimum: 0, description: "Timeline seconds it starts; default the playhead" },
        end: { type: "number", minimum: 0, description: "Timeline seconds it ends; default the end of the timeline" },
        length: { type: "number", minimum: 0.5, description: "Seconds it lasts, instead of end" },
        fade_in: { type: "number", minimum: 0, description: "Seconds it fades in over; default 1" },
        fade_out: { type: "number", minimum: 0, description: "Seconds it fades out over; default 1.5" },
        volume: { type: "number", minimum: 0, maximum: 4, description: "Gain, 1 as made (0.5 is about -6 dB); default 1" },
        seed: { type: "integer", minimum: 1, description: "Another take of the same bed (default 1)" },
        track_id: { type: "string", description: "An audio track to put it on; default the Ambience track" },
      },
      ["name"],
    ),
    call: async (h, a) => {
      if (a.end !== undefined && a.length !== undefined) throw new Error("give end or length, not both");
      const before = h.describe();
      const r = (await h.ai("addAmbience", "", given({ name: a.name, start: a.start, end: a.end, length: a.length, fadeIn: a.fade_in, fadeOut: a.fade_out, volume: a.volume, seed: a.seed, trackId: a.track_id }))) as object;
      return json({ ...r, ...(describeChanges(before, h.describe()) as object) });
    },
  },
  {
    name: "auto_reframe",
    description:
      "Reframe a wide video into another shape on this computer (CapCut's and Premiere's Auto reframe): the canvas takes the ratio (its short side kept), the subject is followed through the clip and the clip fills the canvas with position keyframes that keep it centered. box is the subject in fractions of the picture (x, y its top-left corner) on the clip's first frame; default a square at the center. One undoable edit.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The video clip" },
        ratio: { type: "string", enum: ["9:16", "1:1", "4:5", "keep"], description: "Canvas shape; keep reframes in the current one" },
        box: { ...obj({ x: { type: "number", description: "Left edge, a fraction of the picture's width" }, y: { type: "number", description: "Top edge, a fraction of its height" }, w: { type: "number", description: "Width, a fraction of the picture's width" }, h: { type: "number", description: "Height, a fraction of its height" } }, ["x", "y", "w", "h"]), description: "The subject, as a rectangle of the video's picture" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("reframeClip", String(a.clip_id), given({ ratio: a.ratio, box: a.box }))),
  },
  // ---- music: an original score (lib/music) ----
  {
    name: "generate_music",
    description: `Compose and render an original, royalty-free score on this computer (no samples, nothing downloaded; about 10-15 s for a minute of music), imported as a WAV and placed on an audio track. The same arguments and seed give the same music. Styles: ${STYLE_IDS.map((id) => `${id} (${STYLES[id].label}: ${STYLES[id].blurb}; ${STYLES[id].bpm} BPM)`).join("; ")}. Give a length, or sections to fit the edit: [{name: "intro", bars: 4}, {name: "build", bars: 4}, {name: "drop", at: 8}, {name: "breakdown", bars: 4}, {name: "drop"}, {name: "outro", end_at: 56}]; names set what plays (intro, verse, build, drop/chorus/climax, breakdown/bridge, outro); times (at, end_at, seconds, length) land on bar lines by nudging the tempo (at most max_nudge), and fit says how close each came. Mastered to loudness (-14 LUFS) with the true peak under -1 dBTP. ending ring lets the final chord ring out over the last section (an outro: the final hit lands on its first beat, the end card's moment); stop ends on a short hit. stems also imports drums, bass, harmony and lead (they add up to the mix); place stems puts those on four grouped tracks instead of the mix. Answers the cue sheet in timeline seconds: bpm, key, chords, every bar and beat, the sections, the drops, final_hit, breaths (silences before drops), cut_points (drop, section, phrase, bar), fit, measured loudness and spectrum, the new asset and clip ids. markers adds analyze_music's markers. plan_music answers the same cue sheet without rendering: plan first, then generate with the seed it names. Placing and marking is one undo step (the files stay in the media); it cannot go in batch.`,
    inputSchema: musicSchema(true),
    call: async (h, a) => json(await h.ai("generateMusic", "", a)),
  },
  {
    name: "plan_music",
    description: "The cue sheet generate_music would answer for these arguments, at once and without rendering or changing anything: the tempo after fitting, every section's start and end, bars, beats, drops, final_hit, cut_points and how each asked-for time fit, plus the chord of every bar. Use it to try section lengths and times against the edit, then call generate_music with the same arguments and the seed it answers.",
    inputSchema: musicSchema(false),
    call: (_h, a) => json(planMusicAnswer(a)),
  },
  // ---- epic edits: the music's structure (lib/analysis/beats.ts musicStructure) ----
  {
    name: "analyze_music",
    description:
      "Read a music clip's structure on this computer, as Final Cut's beat grid shows it (song parts, bars, beats), to cut to: bpm; grid, the beats as an even grid (first_beat, beat_seconds, bar_seconds, and off_grid: the beats more than 25 ms off it); downbeats (each bar's first beat, 4 beats a bar, from where the accents fall); phrases (every 4 bars); sections, each {start, end, label, energy} with label intro, verse, build, drop, breakdown or outro and energy 0..1 (1 the loudest part); drops (every qualifying rise after a dip) and drop (the biggest the clip plays, or null); counts of beats, bars, phrases and hits. detail full also lists every beat (beats), each beat's energy 0..1 (beat_energy) and hits (strong onsets on or off the beat: drum hits, stabs), about 2-3 KB a minute of music. Sections may be as short as two bars and their bounds follow bars or phrases. The whole music file is read (once; the reading is kept for every clip of it) and placed through the clip's in-point, speed and position, so a trimmed clip keeps the file's bar phase and drops; source says what was read. All times are TIMELINE seconds, inside the clip. confidence (0..1) says how sure the tempo, the bar lines and the sections are, with a note naming the hint to give when one is low. When the music's structure is known (a cue sheet, the composer's notes), give it in the file's own seconds: bpm, first_downbeat (a bar's first beat) and cues (each part's start and label) replace what would be detected. markers also drops markers: beats (label Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (a Drop marker for every drop), one undo step; they follow the clip through moves, trims, splits and speed changes (a second the clip no longer plays loses its marker), and a second reading replaces the clip's own markers of those kinds instead of adding to them; cut_to_beats then cuts on them (grid bars or phrases), add_beat_hits hits them (marker_label Bar or Drop) and fit_music moves the drop. bpm is the tempo as the clip plays it (file_bpm, the file's own, when it is sped up). When the reading is wrong for good (bars between the kicks, a drop missed), set_music_grid keeps the right grid with the file, and every later reading uses it. Example: {\"clip_id\": \"c_3\", \"markers\": [\"bars\", \"drop\"]}.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The music clip (audio, or a video with sound)" },
        markers: { type: "array", items: { type: "string", enum: ["beats", "bars", "phrases", "sections", "drop"] }, description: "Kinds of markers to add (default none)" },
        bpm: { type: "number", minimum: 40, maximum: 240, description: "The tempo, when known: beats are tracked at it" },
        first_downbeat: { type: "number", minimum: 0, description: "A bar's first beat, in the music file's own seconds (0 for a score that starts on a bar): sets where bars start; with bpm, the whole grid" },
        cues: {
          type: "array",
          description: "The parts, when known, in the music file's own seconds: each starts at its at and runs to the next; a drop cue after another part is a drop. [{at: 0, label: 'intro'}, {at: 4, label: 'build'}, {at: 8, label: 'drop'}, {at: 32, label: 'breakdown'}, {at: 36, label: 'drop'}, {at: 48, label: 'outro'}]",
          items: obj({ at: { type: "number", minimum: 0, description: "Source seconds the part starts" }, label: { type: "string", enum: ["intro", "verse", "build", "drop", "breakdown", "outro"], description: "What the part is" } }, ["at", "label"]),
        },
        detail: { type: "string", enum: ["summary", "full"], description: "summary (default): the grid, bars, phrases, parts and drops with counts; full: also every beat, hit and beat's energy" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => {
      const full = (await h.ai("analyzeMusic", String(a.clip_id), given({ markers: a.markers, bpm: a.bpm, first_downbeat: a.first_downbeat, cues: a.cues }))) as MappedMusic;
      return json(a.detail === "full" || !Array.isArray(full?.beats) ? full : musicSummary(full));
    },
  },
  {
    name: "remove_background",
    description:
      "Remove the background of a video clip of a person or object (CapCut's Remove BG): a segmentation model on this machine makes a matte for every frame (seconds to minutes; the first run downloads the model), then the subject plays over whatever is on the tracks below. One undoable edit; set_background_removal turns it off and on again instantly.",
    inputSchema: obj({ clip_id: { type: "string", description: "Video clip id" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("removeBackground", String(a.clip_id), {})),
  },
  {
    name: "text_to_speech",
    description: `Read a title aloud in a voice made on this computer (Kokoro), placing the voice on an audio track at the title's start, as one undo step with its speech file. With no speed given it lands on a narrator's words a second (2.3-2.8; pace slow or fast moves it half a word), its speed chosen by reading and measuring. Voices (list_catalog section voices describes each): ${VOICE_IDS}. The first use downloads the speech model.`,
    inputSchema: obj({ clip_id: { type: "string", description: "The title (text clip)" }, voice: VOICE, pace: PACE, speed: SPEED, pronounce: PRONOUNCE, quality: QUALITY, finish: FINISH }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("textToSpeech", String(a.clip_id), given({ voice: a.voice, pace: a.pace, speed: a.speed, pronounce: a.pronounce, quality: a.quality, finish: a.finish }))),
  },
  {
    name: "add_voiceover",
    description: `Narrate a script, directed: every line is read on this computer (Kokoro), whole, and placed after the one before at its real length on a new Voiceover track, with a caption for each timed to its voice, as one undo step with its speech files. Pace: each line lands on its words a second over its speech (first word to last; the reader's pauses at commas and sentence ends in, its pause marks out, so a beat written into a line never makes its words faster): read_as narration (2.3-2.8, the default), ad (2.6-3.1) or social (2.8-3.4), moved half a word down by pace slow (and then never read faster than speed 1) or up by fast, or words_per_second [lowest, highest], per call or per line, held as given whatever the pace, except that a band never rushes long words: one whose top would say the line faster than ${CHOSEN_MAX_SPS} syllables a second moves down until it does not (seven syllables in three words read 1.64-2.14, not 2.3-2.8), and pace_note says so; with no speed given, each line is read, measured and read again at the speed that lands it (up to three reads; the audio is never stretched). A speed given is kept as given. Direct each line: a voice of its own (several speakers in one call), at (a timeline time, such as a beat or a cut; later lines follow it), pause_after (seconds before the next line; by default the line's ending sets it: 0.4 after a sentence, 0.1 after a comma, 0.6 after an ellipsis, 0.8 after a paragraph), pace slow or fast. Pauses inside a line are written in it: [pause] (0.5 s), [pause 0.4], [pause 300ms], [beat] (1 s) or <break time="0.4s"/>; the voice's own pause there is lengthened, so the sentence keeps its intonation, and the caption never shows the mark. A word cannot be marked for emphasis (the voice model has no such control; *word* stars are dropped, with a note): write it last in its phrase, where English puts the main stress, or [pause 0.2] before it. pronounce respells words for the voice only ({"MCP": "M C P", "OpenFrame": "Open Frame"}); captions keep the words as written. The natural finish (default) makes it sit like a recorded read: pauses at commas and sentence ends a reader's length, a low cut and a little presence, every line at one loudness, room tone under the pauses, faded edges, the voice compressor and a touch of room. Answers each line's start, end, seconds, voice, speed, words_per_second (over its speech) and target_words_per_second, and clip ids: cut the footage to them, then review_voiceover to hear it back. Voices: ${VOICE_IDS}. The first use downloads the speech model (about 325 MB at quality best); a read takes about a second with WebGPU, several on a CPU.`,
    inputSchema: obj(
      {
        lines: {
          type: "array",
          description: "The script, one sentence or two per line (a breath each)",
          items: obj(
            {
              text: { type: "string", description: 'Words to say and show, with pause marks: [pause], [pause 0.4], [pause 300ms], [beat], <break time="0.4s"/>' },
              caption: { type: "string", description: "What the caption shows instead, when it should differ from the words spoken (20% off for 'twenty percent off', a URL)" },
              at: { type: "number", minimum: 0, description: "Timeline seconds this line starts (a beat, a cut); later lines follow it; default after the line before. A line the one before runs past starts where that one ends, and a note says so" },
              voice: { ...VOICE, description: "This line's voice (another speaker); default the call's" },
              speed: { ...SPEED, description: "This line's speed, kept as given; default the call's, or chosen to land on its words a second" },
              words_per_second: { ...WPS, description: "This line's [lowest, highest] words a second; default the call's" },
              read_as: { ...READ_AS_SCHEMA, description: "This line's kind of read (narration, ad or social), whose band it lands on: another speaker's brisk radio call among narration; default the call's" },
              pause_after: { type: "number", minimum: 0, maximum: 10, description: "Seconds of silence before the next line (overrides gap and the line's ending)" },
              paragraph: { type: "boolean", description: "This line ends a paragraph: 0.8 s before the next" },
              pace: PACE,
            },
            ["text"],
          ),
        },
        voice: { ...VOICE, description: `Voice id, or a blend of voices' styles ("af_heart:60,af_bella:40"); default ${DEFAULT_VOICE}, the most natural` },
        read_as: READ_AS_SCHEMA,
        words_per_second: WPS,
        speed: { ...SPEED, description: "Every line's speed, kept as given (1 is the model's own pace, about 4.6 syllables a second); default: chosen per line to land on its words a second" },
        pronounce: PRONOUNCE,
        start: { type: "number", minimum: 0, description: "Seconds the first line starts, default 0" },
        gap: { type: "number", minimum: 0, description: "Seconds between every pair of lines, instead of each line's ending choosing" },
        quality: QUALITY,
        finish: FINISH,
        captions: { type: "boolean", description: "A caption per line (default true)" },
        enhance: { type: "boolean", description: "Even out each voice with the Enhance voice compressor (default true; finish raw has none)" },
        caption_style: { ...TEXT_STYLE_SCHEMA, description: "The captions' look, as a title's style takes it" },
        caption_y: { type: "number", description: "Captions' vertical offset from center, canvas fraction (default 0.36, or 0.05 on a tall canvas, above the apps' captions and buttons)" },
      },
      ["lines"],
    ),
    call: async (h, a) => {
      const lines = (a.lines as Record<string, unknown>[]).map((l, i) => {
        try {
          return given({ text: l.text, caption: l.caption, at: l.at, voice: l.voice, speed: l.speed, wps: readBand(l.words_per_second), readAs: l.read_as, pauseAfter: l.pause_after, paragraph: l.paragraph, pace: l.pace });
        } catch (e) {
          throw new Error(`lines[${i}]: ${(e as Error).message}`);
        }
      });
      return json(await h.voiceover(lines, given({ voice: a.voice, readAs: a.read_as, wps: readBand(a.words_per_second), speed: a.speed, pronounce: a.pronounce, start: a.start, gap: a.gap, quality: a.quality, finish: a.finish, captions: a.captions, captionStyle: a.caption_style, captionY: a.caption_y, enhance: a.enhance })));
    },
  },
  {
    name: "review_voiceover",
    description:
      `Listen back to voiceover lines on this computer: Whisper hears each voice clip and compares it with its script word by word (a misread name or a skipped word shows, with where), and each line is measured: its pace (words and syllables a second over its speech, first word to last with its pause marks out, as it was read: pause_marks_out says how many seconds; and over its clip) against the words a second it was read to (narration 2.3-2.8 unless add_voiceover was given read_as or words_per_second; pace slow or fast moves a kind's band, never a words_per_second given; any band moves down for long words, as the speed was chosen, so its top says at most ${CHOSEN_MAX_SPS} syllables a second), the silence before and after it and its longest pause, its loudness and true peak as mixed, its pitch (median and range in semitones; under 3 sounds flat) and how far it sits over the music under it in the line window (this line alone, its first word to its last; at least 8, 10-15 for a promo). Each line ends with a verdict: ok when nothing fails, otherwise what to fix, with fixes: the tool and arguments for each problem (retake_voiceover with a pronunciation or words_per_second, set_param volume, duck_under_speech min_line_lu, trim_clip). advice holds notes that do not fail the line: a pace within a tenth of its band, a speed already chosen that the voice could not bring nearer, short words drawn out. A line that differs from its script is heard again by a larger Whisper (small, downloaded once, about 250 MB) before the voice is blamed, a word heard that is not in the script too (Whisper hears \"you\" in a breath): each difference says likely recognizer (heard right the second time: no retake, a note says so) or voice, and heard_again has what it heard; minor marks a short word a letter off, which passes. match is the share of words heard as written, a word heard that is not in the script counting against it, so it is under 1 whenever a difference is listed. A misread word gets a respelling as it sounds (does as duz, home as hohm, MCP as M C P); one already respelled, or with nothing that reads differently, gets a slower read and the advice to reword. The summary counts lines ok, to fix and with advice; gives the lines' words a second (lowest, median, highest), the script's words a second with the gaps between lines in (lower than the lines'), the lines' margins over the music and the loudness spread across lines. Nothing is edited. The first use downloads Whisper (about 80 MB); each line takes a second or two.`,
    inputSchema: obj({
      clip_ids: { type: "array", items: { type: "string" }, description: "Voice clips to hear (add_voiceover's voice_clip ids); default every voiceover line" },
      music: { type: "boolean", description: "Measure each line's margin over the music tracks under it (default true)" },
      recheck: { type: "boolean", description: "Hear a line with a difference again with a larger Whisper model (small, 249 MB downloaded once), to say whether the recognizer or the voice is wrong (default true)" },
    }),
    call: async (h, a) => json(await h.ai("reviewVoiceover", ((a.clip_ids as unknown[] | undefined) ?? []).map(String), given({ music: a.music, recheck: a.recheck }))),
  },
  {
    name: "retake_voiceover",
    description:
      `Read one voiceover line again and put it in the line's place, as one undo step: new text (with pause marks), a voice, words_per_second (held as given over any pace the line keeps, moved down only so long words are not said faster than ${CHOSEN_MAX_SPS} syllables a second: pace_note says so) or read_as (the speed is then chosen by reading and measuring, as add_voiceover does, pause marks out of the pace), a speed (kept as given) or pronunciations (the pronounce fix review_voiceover suggests). With none of these, a line whose speed was chosen is landed on its words a second again, and a line read at a speed given keeps it. The voice model reads the same input the same way every time, so change something. The clip keeps its id, start and settings; its caption takes the new words and length; the old take leaves the media library. A longer take must fit before the next line unless ripple is true, which moves the lines and captions after it by the difference (the picture stays). Answers the line's new start, end, seconds, voice, speed, words_per_second (over its speech) and target_words_per_second; when the speed was chosen, speed_chosen is true and a note says how many reads it took. Music that duck_under_speech dipped under the line (or under the lines a ripple moved) is dipped again under the new take as it was asked, in the same undo step: ducking lists each, with the voice's margin over it now; music whose volume keys were edited by hand since is left alone and a note says so.`,
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The voice clip (add_voiceover's voice_clip)" },
        text: { type: "string", description: "New words, with pause marks; default the line's own" },
        caption: { type: "string", description: "What the caption shows, when it should differ from the words; default the new text as written" },
        voice: VOICE,
        read_as: READ_AS_SCHEMA,
        words_per_second: { ...WPS, description: "[lowest, highest] words a second over the line's speech; default the line's own" },
        speed: { ...SPEED, description: "Kept as given; default the line's own speed, or chosen again when it was chosen" },
        pronounce: { ...PRONOUNCE, description: "Words respelled for the voice, replacing the line's own map ({} clears it)" },
        quality: QUALITY,
        finish: FINISH,
        pace: { ...PACE, description: "The pace the line is meant to have; default the line's own" },
        ripple: { type: "boolean", description: "Move the lines and captions after it by the change in length (default false)" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("retakeVoiceover", String(a.clip_id), given({ text: a.text, caption: a.caption, voice: a.voice, readAs: a.read_as, wps: readBand(a.words_per_second), speed: a.speed, pronounce: a.pronounce, quality: a.quality, finish: a.finish, pace: a.pace, ripple: a.ripple }))),
  },
  {
    name: "auto_adjust",
    description: "Correct a video or picture clip's exposure, white balance and levels from its frame at the playhead (CapCut's Auto adjust), setting its Basic adjustment sliders.",
    inputSchema: obj({ clip_id: { type: "string", description: "Video or image clip" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("autoAdjustClip", String(a.clip_id), {})),
  },
  // ---- ads: text behind the subject, deliverables ----
  {
    name: "text_behind_subject",
    description:
      "Put titles (or stickers) behind the person or product in a video or picture clip, the 'text behind the subject' look: the clip's background is removed on this computer (a video's matte as Remove background makes it; a picture is cut out once into a new picture; the first run downloads the model), and a copy showing only the subject goes on a new track right above the titles' track, silent and grouped with the original so they move together; an adjustment layer between the copy and the clip (a grade kept under the titles) would not reach the copy, so the copy takes its grade (look, sliders, LUT, effects) as its own. The answer says where the copy went (placed) and what grade it took (graded, note). Titles below the clip are lifted above it first. Works best when a large title overlaps the subject. One undoable edit; answers the copy's id (subjectClipId).",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The video or picture clip with the person or product" },
        text_clip_ids: { type: "array", items: { type: "string" }, description: "The titles (or stickers) to put behind the subject; they must play while the video does" },
      },
      ["clip_id", "text_clip_ids"],
    ),
    call: async (h, a) => json(await h.ai("textBehindSubject", String(a.clip_id), { textIds: (a.text_clip_ids as unknown[]).map(String) })),
  },
  {
    name: "export_versions",
    description:
      "Export the deliverables of an ad in one call, each a separate file in the user's Videos folder (in a folder named after the app), or in folder (on the web, a save dialog per file), never replacing a file (a numbered name instead, with a note), the project left exactly as it is. A version is a ratio (16:9, 9:16, 1:1, 4:5, or original), optionally a duration in seconds (a cut-down: the opening and the end card are kept, the middle cut out, the music fading at the new end) and textless (titles and captions off: the master that other languages are cut from). Footage that fills the frame keeps filling it (fit fill), or fits over a blurred copy of itself (blur) or over the background (fit); where fill crops it (a 16:9 shot on 9:16 keeps a third of its width), the crop is placed on the shot's subject (what stands out in its pictures, looked at every half second) and follows it as it moves, inside what the master showed (a version wider than the master, 16:9 from 9:16, holds all of it, centered on it), keyed pushes and pans kept (pushes relax or hold eases them; reframe center keeps the old centered crop; focus [{clip_id, x, y}] puts a point of a clip's picture at the frame's center instead); titles, logos and badges keep their size against the frame's short side and are moved inside its title-safe area (on 9:16 clear of the apps' buttons and captions); a long title wraps to the new frame's safe width, or shrinks to it; an effect's pixel sizes (a blur's radius, a pixelate's blocks) and a position wiggle keep their size against the picture they are on. A compound clip that draws only part of the frame (a title card built as a compound: a box, a headline, a subhead) refits as one picture, its parts keeping their layout; when its smallest type would fall under the readable size the whole card grows to meet it, and a card that then does not fit is restacked, its rows in order with their spacing, type held at the readable size, a panel behind them keeping its margins, nothing overlapping. A shape that spans the frame (a gradient scrim, a band) keeps its share of the new frame, as footage does. On a tall version (9:16, 4:5) of a wide film, what stood side by side is stacked in the safe column: a picture (a floating window, a split screen's half, cut again wider) above the title or picture beside it, each as wide as the column, what sat on one (a label, a glow) moving with it; a split screen whose halves filled the frame edge to edge fills the new frame instead (stacked full width on a tall version, side by side full height on a square), its labels inside the safe area. Text never ends under the frame's readable size, and on 4:5 overlays keep clear of the apps' buttons as on 9:16; every title is kept inside the area check_project judges it by, measured as it measures it, with room for the outline it may suggest. overrides [{clip_id, x, y, scale, hidden}] place a clip by hand in a version after all that (a lower third raised, a headline larger, a logo hidden), kept in a saved version project. captions: burn (the default on tall versions, even from a hidden caption track: they sit in the column above the apps' captions, sized by the short side), none, or as_project (the default on the rest). Ask with versions, or with ratios and durations (every ratio at every duration) plus textless for one textless master. check: true answers one contact sheet of every version (three moments each) and exports nothing: look at it first; an orange outline marks a subject a version's framing still cuts, and subjects lists each (with the focus that keeps it); a title behind its subject (text_behind_subject) that the subject hides in a shape is outlined too and listed in titles, with the master's share to compare; a picture or graphic drawn across the burned captions in a shape (a picture-in-picture under them, measured by its mask) is outlined and listed in caption_overlaps, with the override that puts it above them (each exported version and saved project lists them too). save_projects: true saves each version as a project of its own instead (named as its file, sharing the media): open_project one to fine-tune it, then export_video. Exports that take over about four minutes answer state running: follow them with export_status. Example: {ratios: ['16:9', '9:16', '1:1'], durations: [15, 6], textless: true, loudness: -14}.",
    inputSchema: obj({
      versions: {
        type: "array",
        description: "Versions spelled out, e.g. [{ratio: '9:16', duration: 6}]",
        items: obj(
          {
            ratio: { type: "string", enum: VERSION_RATIOS, description: "Frame shape; original keeps the project's" },
            duration: { type: "number", minimum: 1, description: "Seconds; shorter than the project makes a cut-down" },
            textless: { type: "boolean", description: "Titles and captions off" },
            fit: { type: "string", enum: VERSION_FITS, description: "How full-frame footage meets a new shape: fill (default), blur, fit" },
            captions: { type: "string", enum: VERSION_CAPTIONS, description: "burn the captions in (default on 9:16 and 4:5), none, or as_project (default on the rest)" },
            name: { type: "string", description: "File name without extension; default the project's name and the version, e.g. 'Roast 9x16 6s'" },
            reframe: { type: "string", enum: REFRAMES, description: "Footage the new shape crops: framed on its subject, following it (default), or center" },
            focus: FOCUS_SCHEMA,
            pushes: PUSHES_SCHEMA,
            overrides: OVERRIDES_SCHEMA,
          },
          ["ratio"],
        ),
      },
      ratios: { type: "array", items: { type: "string", enum: VERSION_RATIOS }, description: "Every one of these shapes..." },
      durations: { type: "array", items: { type: "number", minimum: 1 }, description: "...at every one of these lengths in seconds (one as long as the project is the full version); e.g. [30, 15, 6]" },
      textless: { type: "boolean", description: "Also a textless version, in the first ratio" },
      fit: { type: "string", enum: VERSION_FITS, description: "For every version that does not say: fill (default), blur or fit" },
      captions: { type: "string", enum: VERSION_CAPTIONS, description: "For every version that does not say: burn, none or as_project; default burn on tall versions, as_project on the rest" },
      reframe: { type: "string", enum: REFRAMES, description: "For every version that does not say: subject (default) or center" },
      focus: FOCUS_SCHEMA,
      pushes: PUSHES_SCHEMA,
      overrides: OVERRIDES_SCHEMA,
      save_projects: { type: "boolean", description: "true: save each version as a project of its own to fine-tune (open_project it, edit, export_video), and export nothing" },
      keep_end: { type: "number", minimum: 0, description: "Seconds of the end every cut-down keeps; default the end card's length (add_ad_element end_card), else 0" },
      check: { type: "boolean", description: "true: answer a contact sheet of every version and export nothing" },
      check_at: { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, description: "The moments the check sheet shows, as fractions of each version's length; default [0.15, 0.5, 0.92]" },
      format: { type: "string", enum: ["mp4", "mov", "webm", "mkv"], description: "Default mp4 (H.264 + AAC)" },
      resolution: { type: "string", enum: ["480p", "720p", "1080p", "2k", "4k"], description: "Short side; default from the project" },
      quality: { type: "string", enum: ["lower", "recommended", "higher"], description: "Default recommended" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Integrated LUFS for every version's mix, e.g. -14; default as mixed" },
      folder: FOLDER,
    }),
    call: async (h, a) => {
      const master = Number((h.describe() as { duration?: number }).duration ?? 0);
      const versions = expandVersions({ versions: a.versions as VersionSpec[] | undefined, ratios: a.ratios as VersionRatio[] | undefined, durations: a.durations as number[] | undefined, textless: a.textless === true, fit: a.fit as VersionFit | undefined, captions: a.captions as VersionCaptions | undefined, reframe: a.reframe as Reframe | undefined, focus: a.focus as Focus[] | undefined, overrides: a.overrides as VersionOverride[] | undefined, pushes: a.pushes as VersionPushes | undefined }, master);
      const req = { versions, ...given({ keepEnd: a.keep_end, format: a.format, resolution: a.resolution, quality: a.quality, loudness: a.loudness, folder: a.folder }) } as VersionsRequest;
      if (a.save_projects === true) return json({ projects: await h.saveVersions(req), note: "Nothing exported. Each version is a project of its own: open_project one to fine-tune it (frame_region, set_param, set_text), then export_video; the master is open and unchanged." });
      if (a.check === true) {
        const at = (a.check_at as number[] | undefined)?.slice(0, 8);
        const shares = at?.length ? at : [0.15, 0.5, 0.92];
        const sheet = await h.versionsSheet({ ...req, ...(at?.length ? { at } : {}) });
        const subjects = Array.isArray(sheet.subjects) && sheet.subjects.length ? { subjects: sheet.subjects } : {};
        const titles = Array.isArray(sheet.titles) && sheet.titles.length ? { titles: sheet.titles } : {};
        const overlaps = Array.isArray(sheet.overlaps) && sheet.overlaps.length ? { caption_overlaps: sheet.overlaps } : {};
        return { content: [{ type: "image", data: sheet.image, mimeType: "image/jpeg" }, { type: "text", text: JSON.stringify({ versions: versions.length, note: `Nothing exported. Each row is a version at ${shares.map((x) => `${+(x * 100).toFixed(1)}%`).join(", ")} of its length; footage a version crops is framed on its subject, and an orange outline marks a subject a framing still cuts (listed in subjects), a title behind its subject that the subject hides (listed in titles), or a picture or graphic drawn across the burned captions (listed in caption_overlaps, with the override that clears it).`, ...subjects, ...titles, ...overlaps }) }] };
      }
      if (a.folder !== undefined && h.canExport?.() === false) throw new Error(FOLDER_DESKTOP_ONLY);
      const done = h.exportVersions(req);
      done.catch(() => {}); // after the wait below, export_status reports a failure
      const waited = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 240_000))]);
      return json(waited ?? { ...(h.exportStatus() as object), note: "Still exporting: call export_status." });
    },
  },
);

const APP_INDEX = new Map(APP_TOOLS.map((t) => [t.name, t]));

/**
 * The server's instructions: what a model reads before any tool. Kept to a
 * few lines on purpose (ADR-095): some clients copy them into every tool's
 * description (Codex's tool discovery did, 156 times: about 135,000 tokens
 * for the old 3.5 KB guide), so the guide itself is the help tool's
 * overview, read once when asked for.
 */
const INSTRUCTIONS = `You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable. Call help first: the steps that make a video, tool by tool; help with topic ad, epic_edit, voiceover or social_short is a playbook, with a tool's name its parameters and an example. Times are seconds; positions are fractions of the canvas from its center (x right, y down); rectangles (box, region) are a top-left corner and a size, fractions of the picture. Work in a new_project: the user's own projects stay untouched.`;

/** The guide: the moves, in the order a video gets made (help's overview). */
const GUIDE = `You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable (undo).
Conventions: times are seconds; positions are fractions of the canvas from its center (x right, y down; 0.35 is near the bottom), but rectangles (box, region) are a top-left corner and a size, fractions of the picture; scale 1 fits a picture inside the canvas; ids come from describe_project and stay stable. Edits answer with only what they changed; describe_project has the whole timeline.
The main track (the bottom video track) and what sits on it: a gap on it stays until a call closes it (ripple: true, close_gaps, lift_range); a black pause is safest as a color clip in it (add_color_clip color #000000, track_id the main track's). A clip on another track that sits on a main-track shot (over more than half of the clip: a title, a picture-in-picture, a sound effect) moves with that shot whenever an edit moves it: a ripple trim, an insert, a ripple delete, a closed gap, a speed change, a move; a clip across several shots (a voice line, a caption, a grade) moves when everything under it moved by one amount, as through an insert or a freeze before it, and stays when they moved apart; a music track's clips stay, the song being the grid the picture is cut to. Every clip an edit moves is in its answer's changed_clips, and a gap that closes is named in its notes.
Before you start: help (the tools by step), help with topic ad, epic_edit, voiceover or social_short (playbooks), help with topic design (the design rules they all follow), list_catalog (every effect, transition, animation, template, look, sound effect, voice and font by name), help with a tool's name (its parameters and an example).
To make a video:
1. new_project, so the user's projects stay untouched (open_project returns to one; list_projects finds them); set_project for the canvas shape.
2. import_media the footage, music, logo and pictures by absolute path; preview_media shows what is inside each video, to choose the moments worth using.
3. Write the script and add_voiceover (help topic voiceover: casting, pace, pauses, pronunciations): the voice and matching captions, timed to the real speech; it answers where each line landed. review_voiceover hears it back line by line; retake_voiceover fixes a line in place.
4. Lay shots under each line with add_media_clip; frame_region zooms a shot onto the part that matters and can move between two regions; for music-driven edits, Music-synced below.
5. Titles: add_text (style.stroke, style.shadow or style.background keep it readable over footage), then set_animation in and out; add_text_template for lower thirds and end cards.
6. set_transition between shots; one look over everything (set_filter or apply_lut on an adjustment clip); music on an audio track, duck_under_speech under the voice, set_fades at the end; add_sound_effect on reveals, add_ambience for the place's own sound (wind, water, rain, a city, a rocket's rumble, room tone).
7. Make many small edits at once with batch: one call, one undo step.
8. Check: preview_frames (a contact sheet of many moments), preview_motion around cuts and moves (frames in a row, with the beats), preview_audio to hear the mix or one stem (an MP3 and its measurements), check_project (the design rules, each finding naming the tool that fixes it); fix, then check again.
9. export_video writes the file to the user's Videos folder (or the absolute folder you name) and returns its path; loudness -14 suits online video.
Music: generate_music composes an original score fitted to the edit (sections with bars or times, a drop where the climax is, the final hit on the end card) and answers its cue sheet; plan_music tries a form first.
Music-synced (epic, hype, velocity) edits: add the music, analyze_music (markers bars and drop), fit_music drop_at to place the drop, cut_to_beats the shots, add_beat_hits, set_speed_ramp a shot onto a beat, add_cinematic_bars, add_sound_effect end_at (a riser into the drop), then fit_music to end it.
Sound design: set_audio_filter (a low-pass sweep opening on the drop), set_reverb, set_echo, set_tape_stop; measure_loudness checks the mix against online, ebu_r128 or atsc_a85 before export.

For an ad: set_brand first (colors, two fonts, logo), then add_text with a role, set_animation per word or letter (wordPop, typewriter, unit), add_ad_element for lower thirds, offers, calls to action and the end card, text_behind_subject for a title behind a person, set_fades on the music, and export_versions for every shape and cut-down (check: true shows them first).`;

const NO_EXPORT = "In this build (the browser) export_video and export_versions cannot write files: finish with check_project, measure_loudness and preview_frames, then tell the user to export with the app's Export button or from the desktop app.";

/** The instructions and the guide, with a word on export where this build cannot. */
const instructionsFor = (h: McpHost) => (h.canExport?.() === false ? `${INSTRUCTIONS}\n${NO_EXPORT}` : INSTRUCTIONS);
const guideFor = (h: McpHost) => (h.canExport?.() === false ? `${GUIDE}\n${NO_EXPORT}` : GUIDE);

/** Every tool, as MCP's tools/list returns them. */
export function listTools() {
  return [
    ...APP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    ...COMMANDS.map(({ name, description, input }) => ({ name, description, inputSchema: input })),
  ].map((t) => {
    const { title, ...hints } = annotations(t.name);
    return { ...t, title, annotations: hints };
  });
}

/** Guides served as resources, for clients that read them into context. */
const GUIDES: Record<string, { name: string; text: () => string }> = {
  "guide://overview": { name: "How to use these tools", text: () => helpText("overview", listTools(), GUIDE) },
  "guide://design": { name: "Design rules", text: () => DESIGN },
  ...Object.fromEntries(Object.entries(PLAYBOOKS).map(([k, b]) => [`guide://${k}`, { name: `Playbook: ${b.title}`, text: () => b.text }])),
};

/** The server's first words to a model, and help's overview guide, for the
 * generated reference. */
export const instructions = () => INSTRUCTIONS;
export const guide = () => GUIDE;

/** Where every answer names the tool set it came from (_meta), for the
 * stdio bridge (src-tauri/src/mcp.rs) to watch. */
export const TOOLS_META = "openframe/tools";

let toolsMark: string | undefined;
/**
 * A short fingerprint of the tool set (every name and schema): a client
 * lists the tools once, when it connects, so a build that adds tools or
 * parameters is invisible to it. Every answer carries this in its _meta,
 * and the stdio bridge sends notifications/tools/list_changed when it
 * changes (a rebuilt app, a hot update in development), so the client
 * lists them again.
 */
export function toolsFingerprint(): string {
  if (toolsMark) return toolsMark;
  const s = JSON.stringify(listTools());
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return (toolsMark = `${h.toString(16).padStart(8, "0")}-${s.length.toString(16)}`);
}

const ok = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result: result && typeof result === "object" && !Array.isArray(result) ? { ...result, _meta: { ...(result as { _meta?: object })._meta, [TOOLS_META]: toolsFingerprint() } } : result,
});
const fail = (id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/**
 * Handle one MCP message. Notifications (no id) return null. Tool failures
 * come back as results with isError, per the spec, so the model can read
 * the problem and retry; only protocol mistakes are JSON-RPC errors.
 */
export async function handleMcp(req: JsonRpcRequest, host: McpHost): Promise<JsonRpcResponse | null> {
  if (req.id === undefined) return null;
  const p = req.params ?? {};
  switch (req.method) {
    case "initialize":
      return ok(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        // The stdio bridge says when the tools change; over HTTP a client reconnects.
        capabilities: { tools: { listChanged: true }, resources: {}, prompts: { listChanged: false } },
        serverInfo: { name: host.name, version: host.version },
        instructions: instructionsFor(host),
      });
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, { tools: listTools() });
    case "tools/call": {
      const name = String(p.name ?? "");
      let args = (p.arguments ?? {}) as Record<string, unknown>;
      try {
        const app = APP_INDEX.get(name);
        if (app) {
          args = coerceNumbers(args, app.inputSchema) as Record<string, unknown>;
          const errs = validate(args, app.inputSchema);
          if (errs.length) throw new Error(errs.join("; "));
          // Whatever a tool that edits moved is in its answer (ADR-102);
          // a host that cannot describe the timeline answers as it would.
          const look = () => {
            try {
              return host.describe();
            } catch {
              return undefined;
            }
          };
          const before = annotations(name).readOnlyHint ? undefined : look();
          const r = await app.call(host, args);
          return ok(req.id, before ? withMoves(r, before, look()) : r);
        }
        if (!COMMANDS.some((c) => c.name === name)) {
          const meant = didYouMean(name, listTools().map((t) => t.name));
          return fail(req.id, -32602, `unknown tool ${name}${meant ? `; did you mean ${meant}?` : ""}`);
        }
        const before = host.describe();
        return ok(req.id, json(describeChanges(before, await host.exec(name, args))));
      } catch (e) {
        return ok(req.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
      }
    }
    case "resources/list":
      return ok(req.id, {
        resources: [
          { uri: "project://current", name: "Current project", description: "The full project document (JSON)", mimeType: "application/json" },
          { uri: "project://summary", name: "Timeline summary", description: "describe_project output", mimeType: "application/json" },
          { uri: "catalog://all", name: "Catalog", description: "Every effect, transition, animation, template, look, sound effect and font by name (list_catalog)", mimeType: "application/json" },
          ...Object.entries(GUIDES).map(([uri, g]) => ({ uri, name: g.name, mimeType: "text/markdown" })),
        ],
      });
    case "resources/read": {
      const uri = String(p.uri ?? "");
      const guide = GUIDES[uri];
      if (guide) return ok(req.id, { contents: [{ uri, mimeType: "text/markdown", text: guide.text() }] });
      const catalog = () => Object.fromEntries((fullCatalog() as { sections: string[] }).sections.map((s) => [s, fullCatalog(s)]));
      const body = uri === "project://current" ? host.projectJson() : uri === "project://summary" ? host.describe() : uri === "catalog://all" ? catalog() : undefined;
      if (body === undefined) return fail(req.id, -32002, `unknown resource ${uri}`);
      return ok(req.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(body) }] });
    }
    case "prompts/list":
      return ok(req.id, { prompts: PROMPTS });
    case "prompts/get": {
      try {
        return ok(req.id, promptMessages(String(p.name ?? ""), (p.arguments ?? {}) as Record<string, string>));
      } catch (e) {
        return fail(req.id, -32602, e instanceof Error ? e.message : String(e));
      }
    }
    default:
      return fail(req.id, -32601, `method not found: ${req.method}`);
  }
}
