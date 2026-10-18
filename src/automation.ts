// The in-page automation surface: `window.videoEditor`. The same command
// registry agents use (ADR-006), plus actions, state and frame access, so
// drive scripts, the future MCP bridge and the headless renderer all speak
// to the app one way. Every edit made here is undoable like a user's.

import { player } from "./engine/player";
import { COMMANDS, describeProject, runCommand } from "./lib/commands";
import { paramAt } from "./lib/keyframes";
import { STICKERS } from "./lib/stickers";
import type { ActionId } from "./lib/keymap";
import { findClip } from "./lib/project/ops";
import { run } from "./state/actions";
import { agentExportStatus, exportForAgent, renderToUrl, stillToUrl, type RenderOptions } from "./state/export";
import { textToSpeech, voiceover, type VoiceoverOptions } from "./state/tts";
import { autoAdjustClip } from "./state/autoColor";
import { trackMotion } from "./state/tracking";
import { clipTranscript } from "./state/transcript";
import { analyzeBeats, analyzeFillers, analyzeScenes, analyzeSilences, duckUnderSpeech, markBeats, normalizeLoudness, reduceNoise, removeBackground, removeFillers, removeSilences, splitScenes, stabilizeClip, syncAudio, reframeClip } from "./state/ai";
import { importLuts } from "./state/luts";
import { importFiles } from "./state/media";
import { projectWork } from "./state/projectWork";
import { execAddSticker } from "./state/stickers";
import { store } from "./state/store";
import { platform } from "./platform";
import { currentScreen, newProject, openProject } from "./state/project";
import { APP_NAME } from "./lib/brand";
import { catalogNames, EFFECTS } from "./lib/catalog";
import { toOtio } from "./lib/interchange/otio";
import { handleMcp, type JsonRpcRequest, type JsonRpcResponse, type McpHost } from "./lib/mcp";
import { secondsToFrames } from "./lib/time";

export /** Imports belong to the open project (ADR-039). On Home none is open, and
 * an empty result would read as "none of the files worked". */
function needProject() {
  if (projectWork.signal().aborted) throw new Error("No project is open: create or open one first.");
}

const automation = {
  /** Every command with its JSON Schema, for tool listing. */
  commands: () => COMMANDS.map(({ name, description, input }) => ({ name, description, input })),
  /** Run one command as an undoable edit. Throws with every problem named.
   * add_sticker returns a promise: its picture is drawn first. */
  exec(name: string, args: unknown = {}) {
    if (name === "add_sticker") return execAddSticker(args).then(() => describe());
    // Agents see and edit the whole document, whichever timeline the user
    // has open; edit_compound reaches inside compound clips (ADR-037).
    store.editDocument(name.replace(/_/g, " "), (p) => runCommand(p, name, args));
    return describe();
  },
  /** The sticker library, for add_sticker's name. */
  stickers: () => STICKERS.map(({ id, label, category }) => ({ id, label, category })),
  describe: () => describe(),
  /** The whole document (with a compound clip open, too). */
  project: () => store.document(),
  state: () => {
    const { project: _p, ...rest } = store.get();
    return rest;
  },
  action: (id: ActionId) => run(id),
  seek: (frame: number) => store.seek(frame),
  /** A parameter's value at a timeline frame, keyframes applied: what the
   * renderer will use (before in/out animations). */
  paramAt(clipId: string, path: string, frame: number) {
    const c = findClip(store.get().project, clipId)?.clip;
    if (!c) throw new Error(`no clip with id ${clipId}`);
    return paramAt(c, path, frame - c.start);
  },
  select: (ids: string[]) => store.select(ids),
  /** Import files by URL (web) or path (desktop). */
  async import(srcs: { name: string; src: string; size?: number }[]) {
    needProject();
    return importFiles(srcs.map((s) => ({ name: s.name, src: s.src, size: s.size ?? 0 })));
  },
  /** Import .cube LUTs by URL (web) or path (desktop) into project.luts;
   * apply_lut then puts one on a clip. Returns the new entries. */
  importLuts: (srcs: { name: string; src: string }[]) => (needProject(), importLuts(srcs)),
  /** Resolves once the viewer has drawn the current frame. */
  rendered: () => player.idle(),
  /** The viewer's pixels as RGBA, top row first (for frame-accuracy checks). */
  pixels: (maxWidth?: number) => player.pixels(maxWidth),
  platform: () => platform.kind,
  /** Export to memory: { url (Blob URL), size, fileName, frames, ... }. */
  render: renderToUrl,
  /** The current frame (or `frame`) as a PNG Blob URL. */
  still: stillToUrl,
  /** One MCP message in, one response out (null for notifications). */
  mcp: (req: JsonRpcRequest): Promise<JsonRpcResponse | null> => handleMcp(req, mcpHost),
  /** Local analysis without editing; times are source seconds (ADR-017).
   * Omit clipId to use the selected clip. */
  analyze: { silences: analyzeSilences, scenes: analyzeScenes, beats: analyzeBeats },
  /** The AI tools: analyze, then apply as one undoable edit.
   * removeBackground(clipId?) makes the clip's matte and turns it on; the
   * set_background_removal command toggles it afterwards. */
  ai: { removeSilences, removeFillers, analyzeFillers, clipTranscript, splitScenes, markBeats, normalizeLoudness, duckUnderSpeech, reduceNoise, stabilizeClip, removeBackground, textToSpeech, autoAdjustClip, voiceover, trackMotion, syncAudio, reframeClip },
  /** The timeline as OpenTimelineIO JSON (what File > Export timeline saves). */
  otio: () => toOtio(store.document()),
};

/** The viewer's picture at `seconds`, exactly as it draws. */
async function grab(seconds: number): Promise<OffscreenCanvas> {
  store.seek(secondsToFrames(seconds, store.get().project.fps));
  await new Promise((r) => setTimeout(r, 20));
  await player.idle();
  const px = player.pixels();
  if (!px) throw new Error("the viewer is not showing (open a project first)");
  const c = new OffscreenCanvas(px.width, px.height);
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  return c;
}

/** A canvas as base64 PNG, for MCP image content. */
async function png(c: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** describeProject of the whole document, plus the compound clips the user
 * has open, outermost first. */
function describe() {
  // On the home screen the store still holds the last project: say so.
  if (currentScreen() === "home") return { screen: "home", note: "No project is open. list_projects and open_project, or new_project." };
  const nest = store.get().nest;
  return { ...describeProject(store.document()), ...(nest.length ? { open_compounds: nest.map((e) => e.id) } : {}) };
}

declare global {
  interface Window {
    openFrame: typeof automation;
    /** The name from before the rename to OpenFrame; scripts keep working. */
    videoEditor: typeof automation;
  }
}

window.openFrame = window.videoEditor = automation;

// ---- MCP ------------------------------------------------------------------------
// The live host behind src/lib/mcp.ts. Transports (desktop HTTP/stdio bridge,
// a browser extension, tests) post JSON-RPC to window.videoEditor.mcp.

const mcpHost: McpHost = {
  name: APP_NAME,
  version: __APP_VERSION__,
  exec: (name, args) => automation.exec(name, args),
  describe: () => automation.describe(),
  projectJson: () => store.document(),
  catalog: () => ({ ...catalogNames(), effectParams: Object.fromEntries(Object.entries(EFFECTS).map(([k, d]) => [k, d.params])) }),
  importMedia: async (files) => {
    const assets = await automation.import(files.map((f) => ({ name: f.name ?? f.src.split(/[\\/]/).pop()!, src: f.src })));
    return assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, width: a.width, height: a.height }));
  },
  undo: () => {
    store.undo();
    return automation.describe();
  },
  redo: () => {
    store.redo();
    return automation.describe();
  },
  seek: (seconds) => {
    store.seek(secondsToFrames(seconds, store.get().project.fps));
    return { playhead: seconds };
  },
  frame: async (seconds, maxWidth) => {
    const src = await grab(seconds);
    const k = Math.min(1, maxWidth / src.width);
    const out = new OffscreenCanvas(Math.round(src.width * k), Math.round(src.height * k));
    out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
    return png(out);
  },
  sheet: async (times, tileWidth, columns) => {
    const cols = Math.min(columns, times.length), rows = Math.ceil(times.length / cols), gap = 6;
    let out: OffscreenCanvas | null = null;
    for (const [i, t] of times.entries()) {
      const src = await grab(t);
      const w = tileWidth, h = Math.round((src.height * w) / src.width);
      out ??= new OffscreenCanvas(cols * (w + gap) + gap, rows * (h + gap) + gap);
      const ctx = out.getContext("2d")!;
      const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + gap);
      ctx.drawImage(src, x, y, w, h);
      const label = `${+t.toFixed(2)} s`;
      ctx.font = "bold 13px sans-serif";
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.fillRect(x + 4, y + 4, ctx.measureText(label).width + 10, 19);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 9, y + 18);
    }
    return png(out!);
  },
  exportVideo: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return exportForAgent(options as RenderOptions);
  },
  exportStatus: () => agentExportStatus(),
  voiceover: (lines, options) => (needProject(), voiceover(lines, options as VoiceoverOptions)),
  ai: (tool, target, options) => (automation.ai[tool] as (t: unknown, o: unknown) => Promise<unknown>)(target, options),
  listProjects: async () => {
    const open = currentScreen() === "editor" ? store.document().id : null;
    return (await platform.listProjects()).map(({ id, name, updatedAt, duration, width, height }) => ({ id, name, updatedAt, duration, width, height, ...(id === open ? { open: true } : {}) }));
  },
  openProject: async (id) => {
    // false: a navigation was already under way, or it failed (with a toast).
    if (!(await openProject(id))) throw new Error("The project could not be opened; the app shows why.");
    return automation.describe();
  },
  newProject: async (name) => {
    if (!(await newProject(name ? { name } : {}))) throw new Error("A new project could not be started; the app shows why.");
    return automation.describe();
  },
};
