import { findAssetHighlights, type HighlightRequest } from "./state/highlights";
import { createClips } from "./state/clips";
import { exportProjects } from "./state/export";
import { createProxies, deleteProxies } from "./state/proxies";
import { playbackProxyState } from "./engine/playbackProxies";
// The in-page automation surface: `window.videoEditor`. The same command
// registry agents use (ADR-006), plus actions, state and frame access, so
// drive scripts, the future MCP bridge and the headless renderer all speak
// to the app one way. Every edit made here is undoable like a user's.

import { matchColor } from "./state/colorMatch";
import { exportStills } from "./engine/export";
import { player } from "./engine/player";
import { COMMANDS, PROJECT_FILE_COMMANDS, validate, describeProject, runAgentCommand, type CommandReport } from "./lib/commands";
import { commandLabel } from "./lib/commandLabels";
import { paramAt } from "./lib/keyframes";
import { STICKERS } from "./lib/stickers";
import type { ActionId } from "./lib/keymap";
import { findClip, projectDuration } from "./lib/project/ops";
import { run } from "./state/actions";
import { agentExportStatus, exportForAgent, exportVersions, renderToUrl, saveVersionProjects, stillToUrl, versionsSheet, type AgentExportOptions, type VersionsOptions } from "./state/export";
import { retakeVoiceover, textToSpeech, voiceover, type VoiceLine, type VoiceoverOptions } from "./state/tts";
import { reviewVoiceover } from "./state/voiceReview";
import { autoAdjustClip } from "./state/autoColor";
import { trackMotion } from "./state/tracking";
import { addSoundEffect, addSoundEffects, soundFiles } from "./state/sfx";
import { addAmbience, type AmbienceRequest } from "./state/ambience";
import { previewAudio, type AuditionRequest } from "./state/audition";
import { generateMusic } from "./state/music";
import type { SoundCue } from "./lib/sfx";
import { loudnessReport } from "./state/delivery";
import { autoCaptions } from "./state/captions";
import { clipTranscript } from "./state/transcript";
import { analyzeBeats, analyzeFillers, analyzeMusic, analyzeScenes, analyzeSilences, duckUnderSpeech, keepFilterLoudness, markBeats, normalizeLoudness, reduceNoise, removeBackground, removeFillers, removeSilences, splitScenes, stabilizeClip, syncAudio, reframeClip, textBehindSubject } from "./state/ai";
import { importLuts } from "./state/luts";
import { importEach, importFiles } from "./state/media";
import { mediaName, sourceName } from "./lib/mediaKind";
import { projectWork } from "./state/projectWork";
import { execAddSticker } from "./state/stickers";
import { store } from "./state/store";
import { agentNotice, asAgent } from "./state/toast";
import { platform } from "./platform";
import { currentScreen, listSaved, newProject, openProject, openProjectFile, collectProject, saveProjectCopy, importTimeline } from "./state/project";
import { saveTimeline, type TimelineFormat } from "./state/interchange";
import { APP_NAME } from "./lib/brand";
import { catalogNames, EFFECTS } from "./lib/catalog";
import { toOtio } from "./lib/interchange/otio";
import { handleMcp, type JsonRpcRequest, type JsonRpcResponse, type McpHost } from "./lib/mcp";
import { framesToSeconds, secondsToFrames } from "./lib/time";
import { sourceFrames } from "./engine/analyze";
import { checkProject, type CheckKind } from "./lib/designCheck";
import { measureForCheck } from "./state/check";
import { staleDuckNote, staleDucks } from "./lib/analysis/duck";
import { readFileChapters } from "./lib/chapters";
import { probe } from "./engine/media";
import type { Asset } from "./lib/project/types";

export /** Imports belong to the open project (ADR-039). On Home none is open, and
 * an empty result would read as "none of the files worked". */
function needProject() {
  if (projectWork.signal().aborted) throw new Error("No project is open: create or open one first.");
}

const automation = {
  createClips,
  exportProjects,
  /** Every command with its JSON Schema, for tool listing. */
  commands: () => [...COMMANDS, ...PROJECT_FILE_COMMANDS].map(({ name, description, input }) => ({ name, description, input })),
  /** Run one command as an undoable edit. Throws with every problem named.
   * add_sticker returns a promise: its picture is drawn first. */
  exec(name: string, args: unknown = {}) {
    // The pure registry has no session playhead; source edits without a
    // destination mark use the same fallback as the source monitor.
    if (name === "edit_from_source" && args && typeof args === "object" && !Array.isArray(args)) {
      const marks = args as Record<string, unknown>;
      if (marks.timeline_in === undefined && marks.timeline_out === undefined) args = { ...marks, timeline_in: framesToSeconds(store.get().playhead, store.get().project.fps) };
    }
    const fileCommand = PROJECT_FILE_COMMANDS.find(c => c.name === name);
    if (fileCommand) {
      const problems = validate(args, fileCommand.input);
      if (problems.length) throw new Error(problems.join("; "));
      if (name === "export_timeline") { needProject(); const a = args as { format: TimelineFormat; folder?: string }; return saveTimeline(a.format, a.folder, true); }
      if (name === "import_timeline") return importTimeline((args as { file?: string }).file).then(r => r ? { ...r, project: describe() } : { opened: false });
      if (name === "collect_project") { needProject(); return collectProject(true, (args as { folder?: string }).folder); }
      return openProjectFile((args as { path?: string }).path).then(opened => ({ opened, project: opened ? describe() : null }));
    }
    const report: CommandReport = {};
    if (name === "add_sticker") return execAddSticker(args, report).then(() => ({ ...describe(), ...report }));
    // A callout's click is made first, as add_sound_effect's files are, and
    // lands with the callout in one edit (ADR-120).
    const callout = args as { sound?: unknown; to?: { sound?: unknown }[] } | null;
    if (name === "add_callout" && (callout?.sound === true || (Array.isArray(callout?.to) && callout.to.some((t) => t?.sound === true)))) {
      return soundFiles(["click"]).then(({ add, done }) => {
        store.editDocument(commandLabel(name, args), (p) => runAgentCommand(add(p), name, args, report, store.get().linkage));
        done();
        return { ...describe(), ...report };
      });
    }
    // keep_loudness measures the clip with and without the filter first (ADR-114).
    if (name === "set_audio_filter" && (args as { keep_loudness?: unknown } | null)?.keep_loudness === true) {
      const problems = validate(args, COMMANDS.find((c) => c.name === name)!.input);
      if (problems.length) throw new Error(problems.join("; "));
      return keepFilterLoudness(args as Record<string, unknown>).then((notes) => ({ ...describe(), notes }));
    }
    // Agents see and edit the whole document, whichever timeline the user
    // has open; edit_compound reaches inside compound clips (ADR-037).
    // The timeline's linkage applies, its magnet never does (ADR-102).
    const before = store.document();
    store.editDocument(commandLabel(name, args), (p) => runAgentCommand(p, name, args, report, store.get().linkage));
    if (report.sourceEdit) store.set({ inPoint: null, outPoint: null });
    // A voice line moved or resized under music ducked for it: the dip
    // stays where the line was, and the answer says so (ADR-104).
    for (const d of staleDucks(before, store.document())) (report.notes ??= []).push(staleDuckNote(d));
    return { ...describe(), ...report };
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
  async import(srcs: { name?: string; src: string; size?: number }[]) {
    needProject();
    return importFiles(srcs.map((s) => ({ name: mediaName(s), src: s.src, size: s.size ?? 0 })));
  },
  /** Import .cube LUTs by URL (web) or path (desktop) into project.luts;
   * apply_lut then puts one on a clip. Returns the new entries. */
  importLuts: (srcs: { name: string; src: string }[]) => (needProject(), importLuts(srcs)),
  /** Resolves once the viewer has drawn the current frame. */
  rendered: () => player.idle(),
  /** Call `fn(frame)` after every frame the viewer draws; returns the
   * unsubscribe. Drives time playback with it (stalls, dropped frames). */
  onFrame: (fn: (frame: number) => void) => player.onFrame(fn),
  /** Playback health: frames dropped in the current run, the measured
   * decode speed (pixels a second) and the cuts prepared lately, with how
   * far ahead each started and how long its decode took (ADR-074). */
  playbackStats: () => ({ dropped: player.drawn.dropped, decodeRate: Math.round(player.decodeRate), prepared: player.prepared.slice() }),
  /** The viewer's pixels as RGBA, top row first (for frame-accuracy checks). */
  pixels: (maxWidth?: number) => player.pixels(maxWidth),
  platform: () => platform.kind,
  /** Export to memory: { url (Blob URL), size, fileName, frames, ... }. */
  render: renderToUrl,
  /** The current frame (or `frame`) as a PNG Blob URL. */
  still: stillToUrl,
  /** One MCP message in, one response out (null for notifications). */
  mcp: (req: JsonRpcRequest): Promise<JsonRpcResponse | null> => (req.method === "tools/call" ? agentCall(req) : handleMcp(req, mcpHost)),
  /** Local analysis without editing; times are source seconds (ADR-017).
   * Omit clipId to use the selected clip. */
  analyze: { silences: analyzeSilences, scenes: analyzeScenes, beats: analyzeBeats },
  /** The AI tools: analyze, then apply as one undoable edit.
   * removeBackground(clipId?) makes the clip's matte and turns it on; the
   * set_background_removal command toggles it afterwards. */
  ai: { autoCaptions, generateMusic, removeSilences, removeFillers, analyzeFillers, clipTranscript, splitScenes, markBeats, normalizeLoudness, duckUnderSpeech, reduceNoise, stabilizeClip, removeBackground, textToSpeech, autoAdjustClip, matchColor, voiceover, trackMotion, syncAudio, reframeClip, addSoundEffect, addSoundEffects, addAmbience, analyzeMusic, loudnessReport, textBehindSubject, retakeVoiceover, reviewVoiceover },
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
 * project), so reading it capped every preview there. Each is drawn at the
 * canvas's size (its short side at most 1080) and brought down, so a
 * title weighs what it weighs in the exported file (drawn at 640 wide it
 * looked heavier: ADR-098). The viewer seeks to the last one, so the user
 * sees where the agent is looking. */
async function grab(seconds: number[], width: number, before = false, beforeClipIds?: string[]): Promise<Blob[]> {
  if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
  const p = store.get().project;
  const end = projectDuration(p);
  // Past the last frame shows the last frame, as the viewer holds it.
  const frames = seconds.map((t) => Math.min(secondsToFrames(t, p.fps), Math.max(0, end - 1)));
  store.seek(secondsToFrames(seconds.at(-1) ?? 0, p.fps));
  const w = Math.max(2, Math.round(Math.min(width, p.width)));
  // ponytail: past 1080 on the short side the type is large enough that
  // drawing at the full 4K canvas would change nothing but the time taken.
  const k = Math.min(1, 1080 / Math.min(p.width, p.height));
  const big = { width: Math.max(w, Math.round(p.width * k)), height: Math.max(2, Math.round(p.height * k)) };
  return exportStills(p, frames, w, Math.max(2, Math.round((w * p.height) / p.width)), big, before ? { clipIds: beforeClipIds } : undefined);
}

/** Frames in a grid, each with its label on a strip under it: the contact
 * sheets. The label sits outside the picture (ADR-121): stamped on its top
 * left it hid the third film test's section labels, which then looked
 * clipped. */
async function tiles(frames: { src: CanvasImageSource | null; label: string; w: number; h: number }[], tileWidth: number, columns: number): Promise<string> {
  const cols = Math.min(columns, frames.length), rows = Math.ceil(frames.length / cols), gap = 6, strip = 18;
  const h = Math.round((frames.find((f) => f.src)?.h ?? 9) * tileWidth / (frames.find((f) => f.src)?.w ?? 16));
  const out = new OffscreenCanvas(cols * (tileWidth + gap) + gap, rows * (h + strip + gap) + gap);
  const ctx = out.getContext("2d")!;
  // A dark ground, so frames with white edges still read as separate tiles.
  ctx.fillStyle = "#1e1e1e";
  ctx.fillRect(0, 0, out.width, out.height);
  for (const [i, f] of frames.entries()) {
    const x = gap + (i % cols) * (tileWidth + gap), y = gap + Math.floor(i / cols) * (h + strip + gap);
    if (f.src) ctx.drawImage(f.src, x, y, tileWidth, h);
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.fillText(f.label, x + 2, y + h + 14);
  }
  return jpeg(out);
}

/**
 * A contact sheet as base64 JPEG, for MCP image content (ADR-073). A sheet
 * is photographs: as PNG sixteen 480 px frames of footage ran to 4.6 MB,
 * past the 3.75 MB an MCP client may pass a model, and Claude Code shrinks
 * an oversized PNG by re-encoding it with a 256-color palette, which bands
 * every sky. As JPEG the same sheet is under 1 MB; at 0.98 a dark sky keeps
 * nine-tenths of its levels (0.92 made 8-pixel blocks of a smooth one), and
 * a client that still shrinks it re-encodes a JPEG as a JPEG. Single frames
 * stay PNG: drives compare their pixels exactly.
 */
const jpeg = async (c: OffscreenCanvas): Promise<string> => blobToBase64(await c.convertToBlob({ type: "image/jpeg", quality: 0.98 }));

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
  const doc = store.document();
  const summary = describeProject(doc);
  const assets = summary.assets.map((a) => {
    const asset = doc.assets.find((x) => x.id === a.id)!;
    return asset.playbackProxy ? { ...a, proxy: playbackProxyState(asset) } : a;
  });
  return { ...summary, assets, ...(nest.length ? { open_compounds: nest.map((e) => e.id) } : {}) };
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

/** An AI agent's tool call (an MCP client, or the docked assistant): its
 * toasts are the agent's, and a change to the project is announced at the
 * top with the Bot icon, so the user knows the agent made it. */
async function agentCall(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const before = store.document();
  const res = await asAgent(() => handleMcp(req, mcpHost));
  if (store.document() !== before) agentNotice(commandLabel(String(req.params?.name ?? ""), req.params?.arguments));
  return res;
}

const mcpHost: McpHost = {
  createClips: request => (needProject(), createClips(request)),
  exportProjects,
  name: APP_NAME,
  version: __APP_VERSION__,
  canExport: () => platform.kind === "desktop",
  exec: (name, args) => automation.exec(name, args),
  describe: () => automation.describe(),
  projectJson: () => store.document(),
  catalog: () => ({ ...catalogNames(), effectParams: Object.fromEntries(Object.entries(EFFECTS).map(([k, d]) => [k, d.params])) }),
  createProxies: (ids, size) => (needProject(), createProxies(ids, size)),
  deleteProxies: (ids) => (needProject(), deleteProxies(ids)),
  importMedia: async (files) => {
    needProject();
    // `name` is only the library's label; the file says what it is (ADR-095).
    const out = await importEach(files.map((f) => ({ name: f.name ?? sourceName(f.src), src: f.src, size: 0 })));
    return out.map((o) =>
      "asset" in o ? { id: o.asset.id, name: o.asset.name, kind: o.asset.kind, duration: o.asset.duration, width: o.asset.width, height: o.asset.height }
      : "lut" in o ? { lut_id: o.lut.id, name: o.lut.name, kind: "lut" }
      : { src: o.file.src, name: o.file.name, error: o.error },
    );
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
  frame: async (seconds, maxWidth, before, beforeClipIds) => blobToBase64((await grab([seconds], maxWidth, before, beforeClipIds))[0]),
  sheet: async (times, tileWidth, columns, before, beforeClipIds) => {
    const pics = await Promise.all((await grab(times, tileWidth, before, beforeClipIds)).map((b) => createImageBitmap(b)));
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
  fileSheet: async (src, given, count, tileWidth, columns) => {
    // A file read where it is, never imported: an export looked at as delivered.
    const name = sourceName(src);
    let info: Awaited<ReturnType<typeof probe>>;
    try {
      info = await probe(src, name);
    } catch (e) {
      throw new Error(`${src} could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!info.hasVideo) throw new Error(`${name} is sound only; preview_media shows pictures and videos`);
    const asset = { id: "file", kind: info.kind, name, src, duration: info.duration, width: info.width, height: info.height, hasVideo: info.hasVideo, hasAudio: info.hasAudio } as Asset;
    const times = info.kind === "image" ? [0] : given ?? Array.from({ length: count }, (_, i) => +((info.duration * (i + 0.5)) / count).toFixed(2));
    const pics = info.kind === "image" ? [await createImageBitmap(await platform.blobFor(src))] : await sourceFrames(asset, times, tileWidth);
    const image = await tiles(times.map((t, i) => ({ src: pics[i], label: info.kind === "image" ? `${info.width}x${info.height}` : `${+t.toFixed(2)} s`, w: info.width || 16, h: info.height || 9 })), tileWidth, info.kind === "image" ? 1 : columns);
    let chapters: Awaited<ReturnType<typeof readFileChapters>> = [];
    let chapterNote = "Chapter inspection reads Nero MP4/MOV chapter tables (as OpenFrame writes); other containers and QuickTime chapter tracks are not inspected.";
    try { chapters = await readFileChapters((at, bytes) => platform.head(src, bytes, at)); }
    catch (e) { chapterNote += ` Could not inspect chapters: ${e instanceof Error ? e.message : String(e)}`; }
    return { image, file: { chapters, chapters_note: chapterNote, file: src, kind: info.kind, seconds: +info.duration.toFixed(3), width: info.width, height: info.height, ...(info.fps ? { fps: info.fps } : {}), audio: info.hasAudio, frames: times } };
  },
  audition: async (options) => {
    const r = await previewAudio(options as AuditionRequest);
    return { ...(r.audio ? { data: await blobToBase64(new Blob([r.audio.data as Uint8Array<ArrayBuffer>])), mimeType: r.audio.mimeType } : {}), summary: r.summary };
  },
  checkProject: async (kind) => {
    needProject();
    const p = store.document();
    return checkProject(p, kind as CheckKind, await measureForCheck(p));
  },
  exportVideo: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return exportForAgent(options as AgentExportOptions);
  },
  exportStatus: () => agentExportStatus(),
  exportVersions: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return exportVersions(options as VersionsOptions);
  },
  versionsSheet: async (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    // A sheet of photographs too: sent as JPEG (jpeg above).
    const sheet = await versionsSheet(options as VersionsOptions & { at?: number[]; times?: number[] });
    const bmp = await createImageBitmap(sheet.blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return { image: await jpeg(c), subjects: sheet.subjects, titles: sheet.titles, overlaps: sheet.overlaps, callouts: sheet.callouts, options: sheet.options, coverage: sheet.coverage, text_overlaps: sheet.text_overlaps };
  },
  saveVersions: (options) => {
    if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
    return saveVersionProjects(options as VersionsOptions);
  },
  voiceover: (lines, options) => (needProject(), voiceover(lines as unknown as VoiceLine[], options as VoiceoverOptions)),
  ai: (tool, target, options) =>
    tool === "findHighlights" ? (needProject(), findAssetHighlights(options as HighlightRequest))
    : tool === "autoCaptions" ? (needProject(), autoCaptions("", options))
    : tool === "addSoundEffects" ? addSoundEffects(options.sounds as SoundCue[])
    : tool === "addAmbience" ? (needProject(), addAmbience(options as unknown as AmbienceRequest))
    : tool === "generateMusic" ? (needProject(), generateMusic(options))
    : (automation.ai[tool] as (t: unknown, o: unknown) => Promise<unknown>)(target, options),
  listProjects: async () => {
    const open = currentScreen() === "editor" ? store.document().id : null;
    // Recently deleted projects are not offered (ADR-078).
    const { live: saved } = await listSaved();
    // A new project is saved once it is touched (state/project.ts); until
    // then it is listed as the open one all the same.
    const doc = store.document();
    const listed = open && !saved.some((x) => x.id === open) ? [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, duration: framesToSeconds(projectDuration(doc), doc.fps), width: doc.width, height: doc.height }, ...saved] : saved;
    return listed.map(({ id, name, updatedAt, duration, width, height }) => ({ id, name, updatedAt, duration, width, height, ...(id === open ? { open: true } : {}) }));
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
