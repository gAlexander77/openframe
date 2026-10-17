// The Model Context Protocol, transport-agnostic: JSON-RPC 2.0 messages in,
// responses out. Tools are the command registry (ADR-006) plus app-level
// tools (import, undo, seek, a frame as an image); resources are the
// project. A desktop HTTP server, a stdio bridge or the web build's
// window API all hand messages to handleMcp, so agents see one surface
// however they connect (ADR-008).

import { COMMANDS, type JsonSchema } from "./commands";

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
  exec(name: string, args: unknown): unknown;
  describe(): unknown;
  projectJson(): unknown;
  catalog(): unknown;
  importMedia(files: { src: string; name?: string }[]): Promise<unknown>;
  undo(): unknown;
  redo(): unknown;
  seek(seconds: number): unknown;
  /** PNG of the frame at `seconds`, base64 without the data: prefix. */
  frame(seconds: number, maxWidth: number): Promise<string>;
  /** Run a local AI tool (src/state/ai.ts) by its automation name. */
  ai(tool: AiTool, target: string | string[], options: Record<string, unknown>): Promise<unknown>;
}

export type AiTool = "removeSilences" | "removeFillers" | "clipTranscript" | "splitScenes" | "markBeats" | "normalizeLoudness" | "duckUnderSpeech" | "reduceNoise" | "stabilizeClip" | "removeBackground" | "textToSpeech" | "autoAdjustClip";

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
  { name: "undo", description: "Undo the last edit.", inputSchema: obj(), call: (h) => json(h.undo()) },
  { name: "redo", description: "Redo the last undone edit.", inputSchema: obj(), call: (h) => json(h.redo()) },
  {
    name: "seek",
    description: "Move the playhead to a time in seconds.",
    inputSchema: obj({ at: { type: "number", minimum: 0, description: "Seconds" } }, ["at"]),
    call: (h, a) => json(h.seek(Number(a.at))),
  },
  {
    name: "preview_frame",
    description: "See the composited picture at a time: returns a PNG image of the frame exactly as it would export.",
    inputSchema: obj({ at: { type: "number", minimum: 0, description: "Seconds" }, max_width: { type: "integer", minimum: 64, maximum: 1920, description: "Image width, default 640" } }, ["at"]),
    call: async (h, a) => ({ content: [{ type: "image", data: await h.frame(Number(a.at), Number(a.max_width ?? 640)), mimeType: "image/png" }] }),
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
    description: "Measure clips' loudness (EBU R128) and set their volume to reach a target without clipping. -14 LUFS suits social video, -16 podcasts, -23 broadcast.",
    inputSchema: obj({ clip_ids: { type: "array", items: { type: "string" }, description: "Video or audio clip ids" }, target: { type: "number", minimum: -40, maximum: -5, description: "LUFS, default -14" } }, ["clip_ids"]),
    call: async (h, a) => json(await h.ai("normalizeLoudness", (a.clip_ids as unknown[]).map(String), given({ target: a.target }))),
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
    name: "stabilize_clip",
    description: "Smooth a shaky video clip on this computer (CapCut's Stabilize): measures the camera's shake and moves each frame onto a smooth path, zooming slightly to hide the edges. level: least-crop, recommended (default), most-stable, or off to remove it.",
    inputSchema: obj({ clip_id: clipId, level: { type: "string", enum: ["least-crop", "recommended", "most-stable", "off"], description: "How strongly to smooth" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("stabilizeClip", String(a.clip_id), given({ level: a.level }))),
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
    name: "auto_adjust",
    description: "Correct a video or picture clip's exposure, white balance and levels from its frame at the playhead (CapCut's Auto adjust), setting its Basic adjustment sliders.",
    inputSchema: obj({ clip_id: { type: "string", description: "Video or image clip" } }, ["clip_id"]),
    call: async (h, a) => json(await h.ai("autoAdjustClip", String(a.clip_id), {})),
  },
);

const APP_INDEX = new Map(APP_TOOLS.map((t) => [t.name, t]));

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
        instructions:
          "You are editing a video timeline. Call describe_project first. Times are seconds. Import media with import_media, place it with add_media_clip, check your work with preview_frame. Every edit is undoable with undo.",
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
        return ok(req.id, json(host.exec(name, args)));
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
