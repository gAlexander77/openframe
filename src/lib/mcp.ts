// The Model Context Protocol, transport-agnostic: JSON-RPC 2.0 messages in,
// responses out. Tools are the command registry (ADR-006) plus app-level
// tools (import, undo, seek, a frame as an image); resources are the
// project. A desktop HTTP server, a stdio bridge or the web build's
// window API all hand messages to handleMcp, so agents see one surface
// however they connect (ADR-008).

import { SFX } from "./sfx";
import { COMMANDS, TEXT_STYLE_SCHEMA, type JsonSchema } from "./commands";
import { SPEC_IDS } from "./analysis/delivery";

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
  /** Export without a dialog (desktop); resolves when the file is done. */
  exportVideo(options: Record<string, unknown>): Promise<unknown>;
  /** The last export_video: running (with progress), done or failed. */
  exportStatus(): unknown;
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

export type AiTool = "removeSilences" | "removeFillers" | "clipTranscript" | "splitScenes" | "markBeats" | "normalizeLoudness" | "duckUnderSpeech" | "reduceNoise" | "stabilizeClip" | "removeBackground" | "textToSpeech" | "autoAdjustClip" | "trackMotion" | "syncAudio" | "reframeClip" | "addSoundEffect" | "loudnessReport";

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
  const order = (d: Desc) => d.tracks!.map((t) => t.id);
  const kept = (x: Desc, y: Desc) => order(x).filter((id) => order(y).includes(id));
  if (!same(kept(b, a), kept(a, b))) out.track_order = order(a);
  const assets = (d: Desc) => new Map((d.assets ?? []).map((x) => [x.id, x] as const));
  const ba = assets(b), aa = assets(a);
  if ([...aa.keys()].some((id) => !ba.has(id))) out.added_assets = [...aa.values()].filter((x) => !ba.has(x.id));
  if ([...ba.keys()].some((id) => !aa.has(id))) out.removed_assets = [...ba.keys()].filter((id) => !aa.has(id));
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!["duration", "tracks", "assets"].includes(k) && !same(a[k], b[k])) out[k] = a[k] ?? null;
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
    name: "describe_project",
    description: "Read the timeline: canvas, fps, duration, assets, tracks and clips with ids and times in seconds. Call this first and after edits.",
    inputSchema: obj(),
    call: (h) => json(h.describe()),
  },
  {
    name: "list_catalog",
    description: "Names of the effects (with parameters), transitions, filters and animations the edit tools accept.",
    inputSchema: obj(),
    call: (h) => json(h.catalog()),
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
    description: "Move the playhead to a time in seconds.",
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
    name: "preview_frame",
    description: "See the composited picture at a time: returns a PNG image of the frame exactly as it would export.",
    inputSchema: obj({ at: { type: "number", minimum: 0, description: "Seconds" }, max_width: { type: "integer", minimum: 64, maximum: 1920, description: "Image width, default 640" } }, ["at"]),
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
        box: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
        video_clip_id: { type: "string", description: "The video to follow; default the one under the layer (main track first)" },
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("trackMotion", String(a.clip_id), given({ at: a.at, box: a.box, videoId: a.video_clip_id }))),
  },
  {
    name: "add_sound_effect",
    description: "Add a built-in sound effect, made on this computer: whoosh, swish, pop, click, ding, success, rise (a riser) or boom. It lands on an audio track at `start` (default the playhead); the file is made once per project and reused.",
    inputSchema: obj({ name: { type: "string", enum: Object.keys(SFX) }, start: { type: "number", minimum: 0, description: "Timeline seconds" } }, ["name"]),
    call: async (h, a) => json(await h.ai("addSoundEffect", String(a.name), given({ at: a.start }))),
  },
  {
    name: "auto_reframe",
    description:
      "Reframe a wide video into another shape on this computer (CapCut's and Premiere's Auto reframe): the canvas takes the ratio (its short side kept), the subject is followed through the clip and the clip fills the canvas with position keyframes that keep it centered. box is the subject in fractions of the picture (x, y its top-left corner) on the clip's first frame; default a square at the center. One undoable edit.",
    inputSchema: obj(
      {
        clip_id: { type: "string", description: "The video clip" },
        ratio: { type: "string", enum: ["9:16", "1:1", "4:5", "keep"], description: "Canvas shape; keep reframes in the current one" },
        box: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
      },
      ["clip_id"],
    ),
    call: async (h, a) => json(await h.ai("reframeClip", String(a.clip_id), given({ ratio: a.ratio, box: a.box }))),
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
        lines: { type: "array", description: "The script, one sentence or two per line", items: obj({ text: { type: "string", description: "Words to say (and show)" }, at: { type: "number", minimum: 0, description: "Timeline seconds; default right after the line before" } }, ["text"]) },
        voice: { type: "string", description: "Voice id, default af_heart" },
        speed: { type: "number", minimum: 0.5, maximum: 2, description: "1 is natural" },
        start: { type: "number", minimum: 0, description: "Seconds the first line starts, default 0" },
        gap: { type: "number", minimum: 0, description: "Seconds between lines, default 0.4" },
        captions: { type: "boolean", description: "A caption per line (default true)" },
        enhance: { type: "boolean", description: "Even out each voice with the Enhance voice compressor (default true)" },
        caption_style: TEXT_STYLE_SCHEMA,
        caption_y: { type: "number", description: "Captions' vertical offset from center, canvas fraction (default 0.36)" },
      },
      ["lines"],
    ),
    call: async (h, a) =>
      json(await h.voiceover(a.lines as { text: string; at?: number }[], given({ voice: a.voice, speed: a.speed, start: a.start, gap: a.gap, captions: a.captions, captionStyle: a.caption_style, captionY: a.caption_y, enhance: a.enhance }))),
  },
  {
    name: "auto_adjust",
    description: "Correct a video or picture clip's exposure, white balance and levels from its frame at the playhead (CapCut's Auto adjust), setting its Basic adjustment sliders.",
    inputSchema: obj({ clip_id: { type: "string", description: "Video or image clip" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("autoAdjustClip", String(a.clip_id), {})),
  },
);

const APP_INDEX = new Map(APP_TOOLS.map((t) => [t.name, t]));

/** What an agent reads first: the moves, in the order a video gets made. */
const INSTRUCTIONS = `You are editing a video in the user's video editor; every edit shows live and is undoable (undo).
Start with describe_project. Times are seconds; ids are stable. Edits answer with only what they changed; describe_project has the whole timeline.
To make a video:
1. new_project, so the user's projects stay untouched (open_project returns to one; list_projects finds them).
2. import_media the footage, music and pictures by absolute path.
3. Write the script and add_voiceover: the voice and matching captions, timed to the real speech; it answers where each line landed.
4. Lay shots under each line with add_media_clip; frame_region zooms a shot onto the part that matters (a screen recording's panel, a face) and can move between two regions.
5. Titles: add_text (style.background makes a box that reads over busy footage), then set_animation in and out.
6. set_transition between shots; music with add_media_clip, then duck_under_speech under the voice.
7. Make many small edits at once with batch: one call, one undo step.
8. Check with preview_frames (a contact sheet of many moments), then preview_frame for a close look.
9. export_video writes the file to the user's Videos folder and returns its path; loudness -14 suits online video.
Sound design: set_audio_filter (a low-pass sweep opening on the drop), set_reverb, set_echo, set_tape_stop; measure_loudness checks the mix against online, ebu_r128 or atsc_a85 before export.`;

/** Every tool, as MCP's tools/list returns them. */
export function listTools() {
  return [
    ...APP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    ...COMMANDS.map(({ name, description, input }) => ({ name, description, inputSchema: input })),
  ];
}

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
        capabilities: { tools: { listChanged: false }, resources: {} },
        serverInfo: { name: host.name, version: host.version },
        instructions: INSTRUCTIONS,
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
        if (app) return ok(req.id, await app.call(host, args));
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
        ],
      });
    case "resources/read": {
      const uri = String(p.uri ?? "");
      const body = uri === "project://current" ? host.projectJson() : uri === "project://summary" ? host.describe() : undefined;
      if (body === undefined) return fail(req.id, -32002, `unknown resource ${uri}`);
      return ok(req.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(body) }] });
    }
    default:
      return fail(req.id, -32601, `method not found: ${req.method}`);
  }
}
