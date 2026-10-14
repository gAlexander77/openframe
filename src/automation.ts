// The in-page automation surface: `window.videoEditor`. The same command
// registry agents use (ADR-006), plus actions, state and frame access, so
// drive scripts, the future MCP bridge and the headless renderer all speak
// to the app one way. Every edit made here is undoable like a user's.

import { player } from "./engine/player";
import { COMMANDS, describeProject, runCommand } from "./lib/commands";
import { paramAt } from "./lib/keyframes";
import type { ActionId } from "./lib/keymap";
import { findClip } from "./lib/project/ops";
import { run } from "./state/actions";
import { renderToUrl, stillToUrl } from "./state/export";
import { analyzeBeats, analyzeScenes, analyzeSilences, duckUnderSpeech, markBeats, normalizeLoudness, removeSilences, splitScenes } from "./state/ai";
import { importLuts } from "./state/luts";
import { importFiles } from "./state/media";
import { store } from "./state/store";
import { platform } from "./platform";
import { APP_NAME } from "./lib/brand";
import { catalogNames, EFFECTS } from "./lib/catalog";
import { toOtio } from "./lib/interchange/otio";
import { handleMcp, type JsonRpcRequest, type JsonRpcResponse, type McpHost } from "./lib/mcp";
import { secondsToFrames } from "./lib/time";

export const automation = {
  /** Every command with its JSON Schema, for tool listing. */
  commands: () => COMMANDS.map(({ name, description, input }) => ({ name, description, input })),
  /** Run one command as an undoable edit. Throws with every problem named. */
  exec(name: string, args: unknown = {}) {
    store.edit(name.replace(/_/g, " "), (p) => runCommand(p, name, args));
    return describeProject(store.get().project);
  },
  describe: () => describeProject(store.get().project),
  project: () => store.get().project,
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
    return importFiles(srcs.map((s) => ({ name: s.name, src: s.src, size: s.size ?? 0 })));
  },
  /** Import .cube LUTs by URL (web) or path (desktop) into project.luts;
   * apply_lut then puts one on a clip. Returns the new entries. */
  importLuts: (srcs: { name: string; src: string }[]) => importLuts(srcs),
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
  /** The AI tools: analyze, then apply as one undoable edit. */
  ai: { removeSilences, splitScenes, markBeats, normalizeLoudness, duckUnderSpeech },
  /** The timeline as OpenTimelineIO JSON (what File > Export timeline saves). */
  otio: () => toOtio(store.get().project),
};

declare global {
  interface Window {
    videoEditor: typeof automation;
  }
}

window.videoEditor = automation;

// ---- MCP ------------------------------------------------------------------------
// The live host behind src/lib/mcp.ts. Transports (desktop HTTP/stdio bridge,
// a browser extension, tests) post JSON-RPC to window.videoEditor.mcp.

const mcpHost: McpHost = {
  name: APP_NAME,
  version: __APP_VERSION__,
  exec: (name, args) => automation.exec(name, args),
  describe: () => automation.describe(),
  projectJson: () => store.get().project,
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
    store.seek(secondsToFrames(seconds, store.get().project.fps));
    await new Promise((r) => setTimeout(r, 20));
    await player.idle();
    const px = player.pixels();
    if (!px) throw new Error("the viewer is not showing (open a project first)");
    const src = new OffscreenCanvas(px.width, px.height);
    src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
    const k = Math.min(1, maxWidth / px.width);
    const out = new OffscreenCanvas(Math.round(px.width * k), Math.round(px.height * k));
    out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
    const bytes = new Uint8Array(await (await out.convertToBlob({ type: "image/png" })).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  ai: (tool, target, options) => (automation.ai[tool] as (t: unknown, o: unknown) => Promise<unknown>)(target, options),
};
