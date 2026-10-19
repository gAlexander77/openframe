// The Model Context Protocol, transport-agnostic: JSON-RPC 2.0 messages in,
// responses out. Tools are the command registry (ADR-006) plus app-level
// tools (import, undo, seek, a frame as an image); resources are the
// project. A desktop HTTP server, a stdio bridge or the web build's
// window API all hand messages to handleMcp, so agents see one surface
// however they connect (ADR-008).

import { SFX } from "./sfx";
import { COMMANDS, TEXT_STYLE_SCHEMA, validate, type JsonSchema } from "./commands";
import { annotations, DESIGN, fullCatalog, helpText, HELP_TOPICS, PLAYBOOKS, PROMPTS, promptMessages } from "./mcpGuide";
import { SPEC_IDS } from "./analysis/delivery";
import { expandVersions, VERSION_FITS, VERSION_RATIOS, type VersionFit, type VersionRatio, type VersionSpec } from "./versions";

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
  importMedia(files: { src: string; name?: string }[]): Promise<unknown>;
  undo(): unknown;
  redo(): unknown;
  seek(seconds: number): unknown;
  /** PNG of the frame at `seconds`, base64 without the data: prefix. */
  frame(seconds: number, maxWidth: number): Promise<string>;
  /** One PNG of several frames in a grid, each stamped with its time. */
  sheet(times: number[], tileWidth: number, columns: number): Promise<string>;
  /** The same, of an imported video's own frames at source seconds. */
  mediaSheet(assetId: string, times: number[], tileWidth: number, columns: number): Promise<string>;
  /** The design check (lib/designCheck.ts) of the open project. */
  checkProject(kind: string): unknown;
  /** Export without a dialog (desktop); resolves when the file is done. */
  exportVideo(options: Record<string, unknown>): Promise<unknown>;
  /** The last export_video: running (with progress), done or failed. */
  exportStatus(): unknown;
  /** export_versions: one file per version, the project left as it is. */
  exportVersions(options: VersionsRequest): Promise<unknown>;
  /** One PNG (base64) of every version at a few moments, nothing exported. */
  versionsSheet(options: VersionsRequest & { at?: number[] }): Promise<string>;
  /** Speak a script's lines and place them with captions (add_voiceover). */
  voiceover(lines: { text: string; at?: number }[], options: Record<string, unknown>): Promise<unknown>;
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

export type AiTool = "removeSilences" | "removeFillers" | "clipTranscript" | "splitScenes" | "markBeats" | "normalizeLoudness" | "duckUnderSpeech" | "reduceNoise" | "stabilizeClip" | "removeBackground" | "textToSpeech" | "autoAdjustClip" | "trackMotion" | "syncAudio" | "reframeClip" | "addSoundEffect" | "analyzeMusic" | "loudnessReport" | "textBehindSubject";

/** What export_versions hands the host: the versions spelled out, and the
 * export settings they share. */
export interface VersionsRequest {
  versions: VersionSpec[];
  keepEnd?: number;
  format?: string;
  resolution?: string;
  quality?: string;
  loudness?: number;
}

type Desc = Record<string, unknown> & { tracks?: ({ id: string; clips: { id: string }[] } & Record<string, unknown>)[]; assets?: { id: string }[] };

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

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
  const out: Record<string, unknown> = { duration: a.duration };
  const diff = <T extends { id: string }>(was: Map<string, T>, now: Map<string, T>, key: string) => {
    const added = [...now.values()].filter((x) => !was.has(x.id));
    const changed = [...now.values()].filter((x) => was.has(x.id) && !same(was.get(x.id), x));
    const removed = [...was.keys()].filter((id) => !now.has(id));
    if (added.length) out[`added_${key}`] = added;
    if (changed.length) out[`changed_${key}`] = changed;
    if (removed.length) out[`removed_${key}`] = removed;
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
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!["duration", "tracks", "assets", "markers"].includes(k) && !same(a[k], b[k])) out[k] = a[k] ?? null;
  }
  return Object.keys(out).length === 1 ? { unchanged: true, duration: a.duration } : out;
}

/** Options with the unset ones dropped, so the tool's defaults apply. */
const given = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

interface AppTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call(host: McpHost, args: Record<string, unknown>): Promise<ToolResult> | ToolResult;
}

interface ToolResult {
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  isError?: boolean;
}

const json = (v: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(v) }] });

const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

/** Tools that touch the outside world or the session, not just the document. */
export const APP_TOOLS: AppTool[] = [
  {
    name: "help",
    description: "The guide to these tools. topic: overview (the tools by step; start here), ad, epic_edit or social_short (step-by-step playbooks with design rules), design (rules of thumb that make a video look professional), catalog, params (set_param paths), or any tool's name for its parameters and an example call.",
    inputSchema: obj({ topic: { type: "string", description: `overview (default), ${HELP_TOPICS.slice(1).join(", ")}, or a tool's name` } }),
    call: (h, a) => ({ content: [{ type: "text", text: helpText(a.topic === undefined ? undefined : String(a.topic), listTools(), instructionsFor(h)) }] }),
  },
  {
    name: "describe_project",
    description: "Read the timeline: canvas, fps, duration, assets, tracks and clips with ids and times in seconds. Call this first and after edits.",
    inputSchema: obj(),
    call: (h) => json(h.describe()),
  },
  {
    name: "list_catalog",
    description:
      "Every name the edit tools accept. With no section: an index of all sections (effects, transitions, animations, filters, text_templates, caption_looks, speed_presets, sound_effects, blend_modes, mask_shapes, fonts, canvas_ratios, export_presets, sticker_motions, stickers, param_paths). With a section: its details, such as each effect's parameters with ranges and defaults. section stickers with a query searches the sticker library.",
    inputSchema: obj({ section: { type: "string", description: "A section name from the index" }, query: { type: "string", description: "Search words, for section stickers" } }),
    call: (_h, a) => json(fullCatalog(a.section === undefined ? undefined : String(a.section), a.query === undefined ? undefined : String(a.query))),
  },
  {
    name: "import_media",
    description: "Import media files into the project by absolute path (desktop) or URL. Returns the new assets with their ids, for add_media_clip.",
    inputSchema: obj(
      { files: { type: "array", description: "Files to import", items: obj({ src: { type: "string", description: "Absolute path or URL" }, name: { type: "string", description: "Display name" } }, ["src"]) } },
      ["files"],
    ),
    call: async (h, a) => json(await h.importMedia(a.files as { src: string; name?: string }[])),
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
  {
    name: "open_project",
    description: "Save the project in the editor and open another, by id or by name (any case; the most recently edited wins a tie). Returns its description, as describe_project does.",
    inputSchema: obj({ project: { type: "string", description: "Project id or name" } }, ["project"]),
    call: async (h, a) => json(await h.openProject(findProject(await h.listProjects(), String(a.project)).id)),
  },
  {
    name: "new_project",
    description: "Save the project in the editor and start a new, empty one (1920x1080, 30 fps; set_project changes them). Work in one to leave the user's projects untouched.",
    inputSchema: obj({ name: { type: "string", description: "Project name; default: the date and time" } }),
    call: async (h, a) => json(await h.newProject(a.name === undefined ? undefined : String(a.name))),
  },
  {
    name: "save_project_copy",
    description: "Save the open project as a copy under a new name, sharing its media, and open the copy (default) or stay. For a variant worked by hand: a 16:9 cut of a 9:16 ad that export_versions could not lay out well, or a try that may be thrown away; the original stays as it was.",
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
    description: "See several moments at once: one PNG contact sheet of the frames at the given times, each stamped with its time. Check a whole edit in one call, then preview_frame a moment that needs a closer look.",
    inputSchema: obj(
      {
        times: { type: "array", items: { type: "number", minimum: 0 }, description: "Seconds, up to 24" },
        columns: { type: "integer", minimum: 1, maximum: 6, description: "Default 4" },
        tile_width: { type: "integer", minimum: 120, maximum: 640, description: "Width of each frame, default 320" },
      },
      ["times"],
    ),
    call: async (h, a) => {
      const times = (a.times as number[]).slice(0, 24);
      if (!times.length) throw new Error("times needs at least one time");
      return { content: [{ type: "image", data: await h.sheet(times, Number(a.tile_width ?? 320), Number(a.columns ?? 4)), mimeType: "image/png" }] };
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
        columns: { type: "integer", minimum: 1, maximum: 8, description: "Default 6" },
        tile_width: { type: "integer", minimum: 120, maximum: 480, description: "Default 240" },
      },
      ["start"],
    ),
    call: async (h, a) => {
      const start = Number(a.start), end = Number(a.end ?? start + 2), fps = Number(a.fps ?? 8);
      if (!(end > start)) throw new Error("end must be after start");
      const n = Math.min(36, Math.max(2, Math.round((end - start) * fps) + 1));
      const times = Array.from({ length: n }, (_, i) => +(start + ((end - start) * i) / (n - 1)).toFixed(3));
      const d = h.describe() as { tracks: { main?: boolean; clips: { start: number }[] }[]; markers: { at: number; label: string }[] };
      const inside = (t: number) => t >= start && t <= end;
      const cuts = (d.tracks.find((t) => t.main)?.clips ?? []).map((c) => c.start).filter((t) => t > 0 && inside(t));
      const markers = d.markers.filter((m) => inside(m.at)).map((m) => ({ at: m.at, label: m.label }));
      return {
        content: [
          { type: "image", data: await h.sheet(times, Number(a.tile_width ?? 240), Number(a.columns ?? 6)), mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ frames: times, cuts, markers }) },
        ],
      };
    },
  },
  {
    name: "preview_media",
    description: "Look inside imported media before using it: a video's own frames at source seconds (times), or `count` frames spread over the whole file (default 12), as one contact sheet; a still picture whole, labeled with its size. Use it to choose the in-points and moments worth using (a hero shot, a reaction, the action) and to see what a photo shows before framing it.",
    inputSchema: obj(
      {
        asset_id: { type: "string", description: "A video or picture asset id from describe_project or import_media" },
        times: { type: "array", items: { type: "number", minimum: 0 }, description: "Source seconds, up to 24" },
        count: { type: "integer", minimum: 2, maximum: 24, description: "Frames spread over the file when times is not given; default 12" },
        columns: { type: "integer", minimum: 1, maximum: 6, description: "Default 4" },
        tile_width: { type: "integer", minimum: 120, maximum: 640, description: "Default 320" },
      },
      ["asset_id"],
    ),
    call: async (h, a) => {
      const d = h.describe() as { assets: { id: string; kind: string; duration: number }[] };
      const asset = d.assets.find((x) => x.id === a.asset_id);
      if (!asset) throw new Error(`No asset ${a.asset_id}; describe_project lists them`);
      const n = Number(a.count ?? 12);
      const times = asset.kind === "image" ? [0] : a.times ? (a.times as number[]).slice(0, 24) : Array.from({ length: n }, (_, i) => +((asset.duration * (i + 0.5)) / n).toFixed(2));
      return { content: [{ type: "image", data: await h.mediaSheet(String(a.asset_id), times, Number(a.tile_width ?? 320), Number(a.columns ?? 4)), mimeType: "image/png" }] };
    },
  },
  {
    name: "check_project",
    description: "Check the edit against professional rules before exporting: text outside the 90% title-safe area or under the vertical apps' buttons, text too small or too short to read, captions over 20 characters a second, more than two fonts, flashes over 3 a second (seizure risk), black gaps on the main track, music ending without a fade, and by kind: an ad's end card, an epic edit's cuts on the beat. Each finding names the clip, the time and the tool that fixes it. Run it, fix, run it again.",
    inputSchema: obj({ kind: { type: "string", enum: ["ad", "epic_edit", "social_short", "any"], description: "What is being made; default any" } }),
    call: (h, a) => json(h.checkProject(String(a.kind ?? "any"))),
  },
  {
    name: "export_video",
    description:
      "Export the open project to a video file in the user's Videos folder (in a folder named after the app), with no dialog; an existing file is never replaced. Returns the file's path when done. loudness brings the mix to an integrated LUFS with its true peak held under -1 dBTP: -14 for YouTube, TikTok and Spotify, -23 for EBU R128 broadcast, -24 for ATSC A/85 US TV (held under -2 dBTP); the answer's loudness says what the mix reached. Exports that take over about four minutes answer state running: follow them with export_status.",
    inputSchema: obj({
      name: { type: "string", description: "File name without extension; default the project's name" },
      format: { type: "string", enum: ["mp4", "mov", "webm", "mkv", "gif"], description: "Default mp4 (H.264 + AAC)" },
      resolution: { type: "string", enum: ["480p", "720p", "1080p", "2k", "4k"], description: "Short side; default from the project" },
      quality: { type: "string", enum: ["lower", "recommended", "higher"], description: "Default recommended" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Integrated LUFS for the mix; default as mixed" },
      start: { type: "number", minimum: 0, description: "Export from this second" },
      end: { type: "number", minimum: 0, description: "Export to this second" },
    }),
    call: async (h, a) => {
      const done = h.exportVideo(given({ name: a.name, format: a.format, resolution: a.resolution, quality: a.quality, loudness: a.loudness, start: a.start, end: a.end }));
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
    description: "Drop a timeline marker on the beat of a music clip. Returns the BPM and beat count.",
    inputSchema: obj({ clip_id: clipId, every: { type: "integer", enum: [1, 2, 4], description: "Marker on every Nth beat (default 1)" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("markBeats", String(a.clip_id), given({ every: a.every }))),
  },
  {
    name: "normalize_loudness",
    description:
      "Measure clips' loudness (EBU R128) and set their volume to reach a target without their true peak passing the ceiling (-1 dBTP; -2 for ATSC). -14 LUFS suits social video, -16 podcasts, -23 European broadcast, -24 US TV. spec names a delivery spec instead (its target and ceiling). Each clip is measured alone: measure_loudness checks the mix.",
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
      "Measure the mix the way export renders it (48 kHz stereo, every clip's effects, tails and fades) and check it against a delivery spec before exporting. Answers integrated_lufs (BS.1770), loudness_range_lu (EBU Tech 3342 LRA), short_term_max_lufs (loudest 3 s), momentary_max_lufs (loudest 400 ms), true_peak_dbtp (4x oversampled) and sample_peak_dbfs, then pass and the problems against spec: online (-14 LUFS ±1, at most -1 dBTP: YouTube, Spotify, TikTok), ebu_r128 (-23 LUFS ±0.5, at most -1 dBTP: European broadcast) or atsc_a85 (-24 LKFS ±2, at most -2 dBTP: US TV); all three when spec is left out. loudness measures what export_video with that loudness delivers (the mix raised or lowered, its true peak held by the limiter), so a failing mix can be checked as exported: {spec: \"ebu_r128\", loudness: -23}. start and end (timeline seconds) measure part of it. It takes about a quarter of the mix's length to run (a 60 s mix, some 15 s), twice that with loudness.",
    inputSchema: obj({
      spec: { type: "string", enum: SPEC_IDS, description: "Delivery spec to check; default all three" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Measure as export_video with this loudness (LUFS) delivers it; default as mixed" },
      start: { type: "number", minimum: 0, description: "Timeline seconds, default 0" },
      end: { type: "number", minimum: 0, description: "Timeline seconds, default the end" },
    }),
    call: async (h, a) => json(await h.ai("loudnessReport", a.spec === undefined ? "" : String(a.spec), given({ loudness: a.loudness, start: a.start, end: a.end }))),
  },
  {
    name: "duck_under_speech",
    description: "Lower a music clip wherever the other clips with sound under it have speech, as editable volume keyframes (replaces its volume keyframes).",
    inputSchema: obj({ clip_id: { type: "string", description: "The music clip" }, depth: { type: "number", minimum: 1, maximum: 40, description: "dB to lower, default 12" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("duckUnderSpeech", String(a.clip_id), given({ depth: a.depth }))),
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
    description: `Add a built-in sound effect, made on this computer: ${Object.entries(SFX).map(([k, x]) => `${k} (${x.label}, ${x.seconds} s)`).join(", ")}. It lands on an audio track at \`start\` (default the playhead), or so that it ENDS at \`end_at\`: a riser or reverse cymbal then peaks exactly there (put end_at on the drop or a cut); a hit, boom or sub drop goes at the beat with start. The file is made once per project and reused.`,
    inputSchema: obj(
      {
        name: { type: "string", enum: Object.keys(SFX), description: "Which effect (list_catalog section sound_effects has their lengths)" },
        start: { type: "number", minimum: 0, description: "Timeline seconds the sound starts" },
        end_at: { type: "number", minimum: 0, description: "Timeline seconds the sound ends instead (start = end_at - its length)" },
        volume: { type: "number", minimum: 0, maximum: 4, description: "Gain, 1 as made (0.5 is about -6 dB, 0.25 -12 dB); default 1" },
      },
      ["name"],
    ),
    call: async (h, a) => {
      const before = h.describe();
      const r = (await h.ai("addSoundEffect", String(a.name), given({ at: a.start, endAt: a.end_at }))) as { clipId: string };
      if (a.volume !== undefined && a.volume !== 1) await h.exec("set_param", { clip_ids: [r.clipId], path: "volume", value: a.volume });
      return json({ clip_id: r.clipId, ...(describeChanges(before, h.describe()) as object) });
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
  // ---- epic edits: the music's structure (lib/analysis/beats.ts musicStructure) ----
  {
    name: "analyze_music",
    description:
      "Read a music clip's structure on this computer, as Final Cut's beat grid shows it (song parts, bars, beats), to cut to: bpm; every beat; downbeats (each bar's first beat, 4 beats a bar, from where the accents fall); phrases (every 4 bars); sections, each {start, end, label, energy} with label intro, verse, build, drop, breakdown or outro and energy 0..1 (1 the loudest part); beat_energy (0..1 per beat); hits (strong onsets on or off the beat: drum hits, stabs); and drop (where the biggest rise into a loud section lands, or null). All times are TIMELINE seconds, inside the clip. markers also drops markers: beats (label Beat), bars (Bar), phrases (Phrase), sections (each by name), drop (Drop), one undo step; cut_to_beats then cuts on them (grid bars or phrases), add_beat_hits hits them (marker_label Bar or Drop) and fit_music moves the drop. Example: {\"clip_id\": \"c_3\", \"markers\": [\"bars\", \"drop\"]}.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The music clip (audio, or a video with sound)" },
        markers: { type: "array", items: { type: "string", enum: ["beats", "bars", "phrases", "sections", "drop"] }, description: "Kinds of markers to add (default none)" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("analyzeMusic", String(a.clip_id), given({ markers: a.markers }))),
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
    description: "Read a title aloud in a voice made on this computer (Kokoro), placing the voice on an audio track at the title's start. Voices: af_heart, af_bella, af_nicole, am_michael, am_fenrir, bf_emma, bm_george, bm_fable. The first use downloads the speech model (about 90 MB).",
    inputSchema: obj({ clip_id: { type: "string", description: "The title (text clip)" }, voice: { type: "string", description: "Voice id, default af_heart" }, speed: { type: "number", minimum: 0.5, maximum: 2, description: "1 is natural" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("textToSpeech", String(a.clip_id), given({ voice: a.voice, speed: a.speed }))),
  },
  {
    name: "add_voiceover",
    description:
      "Narrate a script: every line is spoken on this computer (Kokoro) and placed one after another at its real length on a new Voiceover track, with a caption for each timed to its voice, as one undo step. A line's at pins it to a time. Answers each line's start, end and clip ids, so the footage can be cut to the voice. Voices: af_heart, af_bella, af_nicole, am_michael, am_fenrir, bf_emma, bm_george, bm_fable. The first use downloads the speech model (about 90 MB); a line takes a second or two.",
    inputSchema: obj(
      {
        lines: { type: "array", description: "The script, one sentence or two per line", items: obj({ text: { type: "string", description: "Words to say (and show)" }, caption: { type: "string", description: "What the caption shows instead, when it should differ from the words spoken (20% off for 'twenty percent off', a URL)" }, at: { type: "number", minimum: 0, description: "Timeline seconds; default right after the line before" } }, ["text"]) },
        voice: { type: "string", description: "Voice id, default af_heart" },
        speed: { type: "number", minimum: 0.5, maximum: 2, description: "1 is natural" },
        start: { type: "number", minimum: 0, description: "Seconds the first line starts, default 0" },
        gap: { type: "number", minimum: 0, description: "Seconds between lines, default 0.4" },
        captions: { type: "boolean", description: "A caption per line (default true)" },
        enhance: { type: "boolean", description: "Even out each voice with the Enhance voice compressor (default true)" },
        caption_style: { ...TEXT_STYLE_SCHEMA, description: "The captions' look: the same fields as add_text's style" },
        caption_y: { type: "number", description: "Captions' vertical offset from center, canvas fraction (default 0.36, or 0.05 on a tall canvas, above the apps' captions and buttons)" },
      },
      ["lines"],
    ),
    call: async (h, a) =>
      json(await h.voiceover(a.lines as { text: string; caption?: string; at?: number }[], given({ voice: a.voice, speed: a.speed, start: a.start, gap: a.gap, captions: a.captions, captionStyle: a.caption_style, captionY: a.caption_y, enhance: a.enhance }))),
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
      "Put titles (or stickers) behind the person or product in a video or picture clip, the 'text behind the subject' look: the clip's background is removed on this computer (a video's matte as Remove background makes it; a picture is cut out once into a new picture; the first run downloads the model), and a copy showing only the subject goes on a new track above the titles, silent and grouped with the original so they move together. Titles below the clip are lifted above it first. Works best when a large title overlaps the subject. One undoable edit; answers the copy's id (subjectClipId).",
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
      "Export the deliverables of an ad in one call, each a separate file in the user's Videos folder (in a folder named after the app; on the web, a save dialog per file), the project left exactly as it is. A version is a ratio (16:9, 9:16, 1:1, 4:5, or original), optionally a duration in seconds (a cut-down: the opening and the end card are kept, the middle cut out, the music fading at the new end) and textless (titles and captions off: the master that other languages are cut from). Footage that fills the frame keeps filling it (fit fill), or fits over a blurred copy of itself (blur) or over the background (fit); titles, logos and badges keep their size against the frame's short side and are moved inside its title-safe area (on 9:16 clear of the apps' buttons and captions). Ask with versions, or with ratios and durations (every ratio at every duration) plus textless for one textless master. check: true answers one contact sheet of every version (three moments each) and exports nothing: look at it first. Exports that take over about four minutes answer state running: follow them with export_status. Example: {ratios: ['16:9', '9:16', '1:1'], durations: [15, 6], textless: true, loudness: -14}.",
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
            name: { type: "string", description: "File name without extension; default the project's name and the version, e.g. 'Roast 9x16 6s'" },
          },
          ["ratio"],
        ),
      },
      ratios: { type: "array", items: { type: "string", enum: VERSION_RATIOS }, description: "Every one of these shapes..." },
      durations: { type: "array", items: { type: "number", minimum: 1 }, description: "...at every one of these lengths in seconds (one as long as the project is the full version); e.g. [30, 15, 6]" },
      textless: { type: "boolean", description: "Also a textless version, in the first ratio" },
      fit: { type: "string", enum: VERSION_FITS, description: "For every version that does not say: fill (default), blur or fit" },
      keep_end: { type: "number", minimum: 0, description: "Seconds of the end every cut-down keeps; default the end card's length (add_ad_element end_card), else 0" },
      check: { type: "boolean", description: "true: answer a contact sheet of every version and export nothing" },
      format: { type: "string", enum: ["mp4", "mov", "webm", "mkv"], description: "Default mp4 (H.264 + AAC)" },
      resolution: { type: "string", enum: ["480p", "720p", "1080p", "2k", "4k"], description: "Short side; default from the project" },
      quality: { type: "string", enum: ["lower", "recommended", "higher"], description: "Default recommended" },
      loudness: { type: "number", minimum: -40, maximum: -5, description: "Integrated LUFS for every version's mix, e.g. -14; default as mixed" },
    }),
    call: async (h, a) => {
      const master = Number((h.describe() as { duration?: number }).duration ?? 0);
      const versions = expandVersions({ versions: a.versions as VersionSpec[] | undefined, ratios: a.ratios as VersionRatio[] | undefined, durations: a.durations as number[] | undefined, textless: a.textless === true, fit: a.fit as VersionFit | undefined }, master);
      const req = { versions, ...given({ keepEnd: a.keep_end, format: a.format, resolution: a.resolution, quality: a.quality, loudness: a.loudness }) } as VersionsRequest;
      if (a.check === true) return { content: [{ type: "image", data: await h.versionsSheet(req), mimeType: "image/png" }, { type: "text", text: JSON.stringify({ versions: versions.length, note: "Nothing exported. Each row is a version at 15%, 50% and 92% of its length." }) }] };
      const done = h.exportVersions(req);
      done.catch(() => {}); // after the wait below, export_status reports a failure
      const waited = await Promise.race([done, new Promise((r) => setTimeout(() => r(null), 240_000))]);
      return json(waited ?? { ...(h.exportStatus() as object), note: "Still exporting: call export_status." });
    },
  },
);

const APP_INDEX = new Map(APP_TOOLS.map((t) => [t.name, t]));

/** What an agent reads first: the moves, in the order a video gets made. */
const INSTRUCTIONS = `You are editing a video in the user's video editor (OpenFrame); every edit shows live and is undoable (undo).
Conventions: times are seconds; positions are fractions of the canvas from its center (x right, y down; 0.35 is near the bottom), but rectangles (box, region) are a top-left corner and a size, fractions of the picture; scale 1 fits a picture inside the canvas; ids come from describe_project and stay stable. Edits answer with only what they changed; describe_project has the whole timeline.
Before you start: help (the tools by step), help with topic ad, epic_edit or social_short (playbooks with design rules), list_catalog (every effect, transition, animation, template, look, sound effect and font by name), help with a tool's name (its parameters and an example).
To make a video:
1. new_project, so the user's projects stay untouched (open_project returns to one; list_projects finds them); set_project for the canvas shape.
2. import_media the footage, music, logo and pictures by absolute path; preview_media shows what is inside each video, to choose the moments worth using.
3. Write the script and add_voiceover: the voice and matching captions, timed to the real speech; it answers where each line landed.
4. Lay shots under each line with add_media_clip; frame_region zooms a shot onto the part that matters and can move between two regions; for music-driven edits, Music-synced below.
5. Titles: add_text (style.stroke, style.shadow or style.background keep it readable over footage), then set_animation in and out; add_text_template for lower thirds and end cards.
6. set_transition between shots; one look over everything (set_filter or apply_lut on an adjustment clip); music on an audio track, duck_under_speech under the voice, set_fades at the end; add_sound_effect on reveals.
7. Make many small edits at once with batch: one call, one undo step.
8. Check: preview_frames (a contact sheet of many moments), preview_motion around cuts and moves (frames in a row, with the beats), check_project (the design rules, each finding naming the tool that fixes it); fix, then check again.
9. export_video writes the file to the user's Videos folder and returns its path; loudness -14 suits online video.
Music-synced (epic, hype, velocity) edits: add the music, analyze_music (markers bars and drop), fit_music drop_at to place the drop, cut_to_beats the shots, add_beat_hits, set_speed_ramp a shot onto a beat, add_cinematic_bars, add_sound_effect end_at (a riser into the drop), then fit_music to end it.
Sound design: set_audio_filter (a low-pass sweep opening on the drop), set_reverb, set_echo, set_tape_stop; measure_loudness checks the mix against online, ebu_r128 or atsc_a85 before export.

For an ad: set_brand first (colors, two fonts, logo), then add_text with a role, set_animation per word or letter (wordPop, typewriter, unit), add_ad_element for lower thirds, offers, calls to action and the end card, text_behind_subject for a title behind a person, set_fades on the music, and export_versions for every shape and cut-down (check: true shows them first).`;

/** The instructions, with a word on export where this build cannot. */
const instructionsFor = (h: McpHost) =>
  h.canExport?.() === false ? `${INSTRUCTIONS}\nIn this build (the browser) export_video and export_versions cannot write files: finish with check_project, measure_loudness and preview_frames, then tell the user to export with the app's Export button or from the desktop app.` : INSTRUCTIONS;

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
  "guide://overview": { name: "How to use these tools", text: () => helpText("overview", listTools(), INSTRUCTIONS) },
  "guide://design": { name: "Design rules", text: () => DESIGN },
  ...Object.fromEntries(Object.entries(PLAYBOOKS).map(([k, b]) => [`guide://${k}`, { name: `Playbook: ${b.title}`, text: () => b.text }])),
};

/** The server's first words to a model, for the generated reference. */
export const instructions = () => INSTRUCTIONS;

const ok = (id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: id ?? null, result });
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
        capabilities: { tools: { listChanged: false }, resources: {}, prompts: { listChanged: false } },
        serverInfo: { name: host.name, version: host.version },
        instructions: instructionsFor(host),
      });
    case "ping":
      return ok(req.id, {});
    case "tools/list":
      return ok(req.id, { tools: listTools() });
    case "tools/call": {
      const name = String(p.name ?? "");
      const args = (p.arguments ?? {}) as Record<string, unknown>;
      try {
        const app = APP_INDEX.get(name);
        if (app) {
          const errs = validate(args, app.inputSchema);
          if (errs.length) throw new Error(errs.join("; "));
          return ok(req.id, await app.call(host, args));
        }
        if (!COMMANDS.some((c) => c.name === name)) return fail(req.id, -32602, `unknown tool ${name}`);
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
