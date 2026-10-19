// The in-page automation surface: `window.videoEditor`. The same command
// registry agents use (ADR-006), plus actions, state and frame access, so
// drive scripts, the future MCP bridge and the headless renderer all speak
// to the app one way. Every edit made here is undoable like a user's.

import { exportStills } from "./engine/export";
import { player } from "./engine/player";
import { COMMANDS, describeProject, runCommand } from "./lib/commands";
import { commandLabel } from "./lib/commandLabels";
import { paramAt } from "./lib/keyframes";
import { STICKERS } from "./lib/stickers";
import type { ActionId } from "./lib/keymap";
import { findClip, projectDuration } from "./lib/project/ops";
import { run } from "./state/actions";
import { agentExportStatus, exportForAgent, exportVersions, renderToUrl, stillToUrl, versionsSheet, type RenderOptions, type VersionsOptions } from "./state/export";
import { textToSpeech, voiceover, type VoiceoverOptions } from "./state/tts";
import { autoAdjustClip } from "./state/autoColor";
import { trackMotion } from "./state/tracking";
import { addSoundEffect } from "./state/sfx";
import { loudnessReport } from "./state/delivery";
import { clipTranscript } from "./state/transcript";
import { analyzeBeats, analyzeFillers, analyzeMusic, analyzeScenes, analyzeSilences, duckUnderSpeech, markBeats, normalizeLoudness, reduceNoise, removeBackground, removeFillers, removeSilences, splitScenes, stabilizeClip, syncAudio, reframeClip, textBehindSubject } from "./state/ai";
import { importLuts } from "./state/luts";
import { importFiles } from "./state/media";
import { projectWork } from "./state/projectWork";
import { execAddSticker } from "./state/stickers";
import { store } from "./state/store";
import { platform } from "./platform";
import { currentScreen, newProject, openProject, saveProjectCopy } from "./state/project";
import { APP_NAME } from "./lib/brand";
import { catalogNames, EFFECTS } from "./lib/catalog";
import { toOtio } from "./lib/interchange/otio";
import { handleMcp, type JsonRpcRequest, type JsonRpcResponse, type McpHost } from "./lib/mcp";
import { secondsToFrames } from "./lib/time";
import { sourceFrames } from "./engine/analyze";
import { checkProject, type CheckKind } from "./lib/designCheck";

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
    store.editDocument(commandLabel(name, args), (p) => runCommand(p, name, args));
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
  ai: { removeSilences, removeFillers, analyzeFillers, clipTranscript, splitScenes, markBeats, normalizeLoudness, duckUnderSpeech, reduceNoise, stabilizeClip, removeBackground, textToSpeech, autoAdjustClip, voiceover, trackMotion, syncAudio, reframeClip, addSoundEffect, analyzeMusic, loudnessReport, textBehindSubject },
  /** export_versions: one file per version (lib/versions.ts), the project
   * left as it is; versionsSheet draws them all without exporting. */
  exportVersions: (o: VersionsOptions) => (needProject(), exportVersions(o)),
  versionsSheet,
  /** The timeline as OpenTimelineIO JSON (what File > Export timeline saves). */
  otio: () => toOtio(store.document()),
};

/** The picture at each of `seconds` as PNGs, drawn as the export draws
 * it, `width` pixels wide (never wider than the canvas). The viewer's own
 * canvas is only as big as it is on screen (222 pixels wide for a 9:16
 * project), so reading it capped every preview there. The viewer seeks
 * to the last one, so the user sees where the agent is looking. */
async function grab(seconds: number[], width: number): Promise<Blob[]> {
  if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
  const p = store.get().project;
  const end = projectDuration(p);
  // Past the last frame shows the last frame, as the viewer holds it.
  const frames = seconds.map((t) => Math.min(secondsToFrames(t, p.fps), Math.max(0, end - 1)));
  store.seek(secondsToFrames(seconds.at(-1) ?? 0, p.fps));
  const w = Math.max(2, Math.round(Math.min(width, p.width)));
  return exportStills(p, frames, w, Math.max(2, Math.round((w * p.height) / p.width)));
}

/** Frames in a grid, each stamped with its label: the contact sheets. */
async function tiles(frames: { src: CanvasImageSource | null; label: string; w: number; h: number }[], tileWidth: number, columns: number): Promise<string> {
  const cols = Math.min(columns, frames.length), rows = Math.ceil(frames.length / cols), gap = 6;
  const h = Math.round((frames.find((f) => f.src)?.h ?? 9) * tileWidth / (frames.find((f) => f.src)?.w ?? 16));
  const out = new OffscreenCanvas(cols * (tileWidth + gap) + gap, rows * (h + gap) + gap);
  const ctx = out.getContext("2d")!;
  // A dark ground, so frames with white edges still read as separate tiles.
  ctx.fillStyle = "#1e1e1e";
  ctx.fillRect(0, 0, out.width, out.height);
  for (const [i, f] of frames.entries()) {
    const x = gap + (i % cols) * (tileWidth + gap), y = gap + Math.floor(i / cols) * (h + gap);
    if (f.src) ctx.drawImage(f.src, x, y, tileWidth, h);
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillRect(x + 4, y + 4, ctx.measureText(f.label).width + 10, 19);
    ctx.fillStyle = "#fff";
    ctx.fillText(f.label, x + 9, y + 18);
  }
  return png(out);
}

/** A canvas as base64 PNG, for MCP image content. */
const png = async (c: OffscreenCanvas): Promise<string> => blobToBase64(await c.convertToBlob({ type: "image/png" }));

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
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
  canExport: () => platform.kind === "desktop",
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
  frame: async (seconds, maxWidth) => blobToBase64((await grab([seconds], maxWidth))[0]),
  sheet: async (times, tileWidth, columns) => {
    const pics = await Promise.all((await grab(times, tileWidth)).map((b) => createImageBitmap(b)));
    try {
      return await tiles(times.map((t, i) => ({ src: pics[i], label: `${+t.toFixed(2)} s`, w: pics[i].width, h: pics[i].height })), tileWidth, columns);
    } finally {
      for (const b of pics) b.close();
    }
  },
  mediaSheet: async (assetId, times, tileWidth, columns) => {
    const a = store.get().project.assets.find((x) => x.id === assetId);
    if (!a) throw new Error(`No asset ${assetId}; describe_project lists them`);
    if (a.kind === "audio") throw new Error(`${a.name} is sound only; preview_media shows pictures and videos`);
    // A still is one tile: the whole picture, as imported.
    if (a.kind === "image") {
      const bmp = await createImageBitmap(await platform.blobFor(a.src));
      return tiles([{ src: bmp, label: `${bmp.width}x${bmp.height}`, w: bmp.width, h: bmp.height }], tileWidth, 1);
    }
    const pics = await sourceFrames(a, times, tileWidth);
    return tiles(times.map((t, i) => ({ src: pics[i], label: `${+t.toFixed(2)} s`, w: a.width || 16, h: a.height || 9 })), tileWidth, columns);
  },
  checkProject: (kind) => (needProject(), checkProject(store.document(), kind as CheckKind)),
  exportVideo: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return exportForAgent(options as RenderOptions);
  },
  exportStatus: () => agentExportStatus(),
  exportVersions: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return exportVersions(options as VersionsOptions);
  },
  versionsSheet: async (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return blobToBase64(await versionsSheet(options as VersionsOptions & { at?: number[] }));
  },
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
  saveCopy: async (name, open) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project first.");
    if (!(await saveProjectCopy(name, open))) throw new Error("The copy could not be saved; the app shows why.");
    return { saved: name, open: open ? name : store.document().name };
  },
};
