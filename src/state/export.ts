// The export job: the dialog's open/progress/done state, and the two ways an
// export starts — the dialog (writes where the platform says) and
// automation (`window.videoEditor.render`, writes to memory). One job at a
// time, so a second export cannot fight the first for the encoder.

import { useSyncExternalStore } from "react";
import { exportProject as exportVideo, exportStill, memoryTarget, type ExportProgress, type ExportResult } from "../engine/export";
import { exportGif } from "../engine/gif";
import { defaultExportSettings, outputSize, planExport, RESOLUTIONS, safeFileName, VIDEO_FORMATS, type ExportPlan, type ExportSettings } from "../lib/export";
import { toOtio } from "../lib/interchange/otio";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { projectDuration } from "../lib/project/ops";
import { versionProject, type VersionSpec } from "../lib/versions";
import { platform } from "../platform";
import { provide } from "./actions";
import { rootInPoint, rootOutPoint, store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

/** What Export renders: the whole project with its own range, even while a
 * compound clip is open (CapCut exports the project; ADR-037). */
function exportSubject() {
  const s = store.get();
  return { project: store.document(), inPoint: rootInPoint(s), outPoint: rootOutPoint(s) };
}

/** A GIF has its own encoder; everything else goes through mediabunny. */
const exportProject = (...a: Parameters<typeof exportVideo>) => (a[1].container === "gif" ? exportGif(...a) : exportVideo(...a));

export type ExportView =
  | { phase: "closed" }
  | { phase: "settings" }
  | { phase: "running"; plan: ExportPlan; fileName: string; progress: ExportProgress; startedAt: number }
  | { phase: "done"; plan: ExportPlan; fileName: string; result: ExportResult; reveal: (() => Promise<void>) | null; revealLabel?: string }
  | { phase: "failed"; message: string };

let view: ExportView = { phase: "closed" };
let job: AbortController | null = null;
const listeners = new Set<() => void>();

function set(v: ExportView) {
  view = v;
  listeners.forEach((l) => l());
}

export const exportView = () => view;

export function useExportView(): ExportView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
  );
}

export function openExportDialog() {
  if (view.phase === "closed" || view.phase === "failed") set({ phase: "settings" });
}

/** Close the dialog. A running export keeps it open: cancel first. */
export function closeExportDialog() {
  if (view.phase !== "running") set({ phase: "closed" });
}

export function backToSettings() {
  if (view.phase !== "running") set({ phase: "settings" });
}

export function cancelExport() {
  job?.abort();
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * Export with the dialog's settings. Must be called straight from the click
 * handler: the web's save dialog needs that user gesture.
 */
export async function startExport(settings: ExportSettings) {
  if (job) return;
  const s = exportSubject();
  const plan = planExport(s.project, settings, s);
  const project = s.project;
  const controller = new AbortController();
  job = controller;
  try {
    const target = await platform.createExportTarget(plan.fileName.replace(/\.[^.]+$/, ""), plan.extension);
    if (!target) {
      set({ phase: "settings" }); // save dialog canceled
      return;
    }
    const startedAt = performance.now();
    const running = (progress: ExportProgress) => set({ phase: "running", plan, fileName: target.displayName, progress, startedAt });
    running({ phase: "preparing", done: 0, total: plan.frames, fraction: 0, fps: 0, eta: null });
    const result = await exportProject(project, plan, target, running, controller.signal);
    set({ phase: "done", plan, fileName: target.displayName, result, reveal: () => target.reveal(), revealLabel: target.revealLabel });
  } catch (e) {
    if (isAbort(e)) set({ phase: "settings" });
    else set({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
  } finally {
    job = null;
  }
}

/** Options for automation: any dialog setting, plus a range in seconds. */
export type RenderOptions = Partial<ExportSettings> & { start?: number; end?: number };

/**
 * Export to memory and return a Blob URL with what was made. The headless
 * renderer and the drive scripts use this; the project is not changed.
 */
export async function renderToUrl(options: RenderOptions = {}) {
  if (job) throw new Error("An export is already running.");
  const s = exportSubject();
  const p = s.project;
  const { start, end, ...rest } = options;
  const settings: ExportSettings = { ...defaultExportSettings(p), ...rest };
  const ranged = start !== undefined || end !== undefined;
  const inOut = ranged
    ? { inPoint: start !== undefined ? secondsToFrames(start, p.fps) : null, outPoint: end !== undefined ? secondsToFrames(end, p.fps) : null }
    : s;
  if (ranged) settings.range = "inout";
  const plan = planExport(p, settings, inOut);
  const mem = memoryTarget();
  job = new AbortController();
  try {
    const result = await exportProject(p, plan, mem, undefined, job.signal);
    const blob = new Blob([mem.bytes()], { type: plan.mime });
    return { url: URL.createObjectURL(blob), size: blob.size, type: plan.mime, fileName: plan.fileName, plan, ...result };
  } finally {
    job = null;
  }
}

/** An export an agent started (MCP export_video), for export_status. */
export type AgentExport =
  | { state: "running"; path: string; fraction: number; eta: number | null; version?: string }
  | ({ state: "done"; path: string } & ExportResult)
  | { state: "done"; path: string; versions: VersionFile[] }
  | { state: "failed"; message: string; versions?: VersionFile[] };

let agentExport: AgentExport | null = null;
export const agentExportStatus = () => agentExport;

/**
 * Export for an agent: no dialog, into the platform's agent folder under a
 * name that replaces nothing. Resolves when the file is complete; a toast
 * shows the user it is happening, agentExportStatus() follows it.
 */
export async function exportForAgent(options: RenderOptions = {}): Promise<AgentExport> {
  const make = platform.createAgentExportTarget;
  if (!make) throw new Error("Agents can export from the desktop app only.");
  if (job) throw new Error("An export is already running.");
  const s = exportSubject();
  const p = s.project;
  const { start, end, ...rest } = options;
  const settings: ExportSettings = { ...defaultExportSettings(p), ...rest };
  // A container takes only some codecs (WebM: VP9 or AV1).
  const codecs = VIDEO_FORMATS[settings.format].codecs;
  if (!codecs.includes(settings.codec)) settings.codec = codecs[0];
  const ranged = start !== undefined || end !== undefined;
  const inOut = ranged
    ? { inPoint: start !== undefined ? secondsToFrames(start, p.fps) : null, outPoint: end !== undefined ? secondsToFrames(end, p.fps) : null }
    : { inPoint: null, outPoint: null };
  if (ranged) settings.range = "inout";
  const plan = planExport(p, settings, inOut);
  job = new AbortController();
  const tid = toast("Exporting for an AI agent", "progress");
  try {
    const target = await make.call(platform, safeFileName(settings.name), plan.extension);
    const path = target.displayName;
    agentExport = { state: "running", path, fraction: 0, eta: null };
    const result = await exportProject(p, plan, target, (pr) => {
      agentExport = { state: "running", path, fraction: +pr.fraction.toFixed(3), eta: pr.eta === null ? null : +pr.eta.toFixed(1) };
      updateToast(tid, { progress: pr.fraction });
    }, job.signal);
    agentExport = { state: "done", path, ...result };
    toast(`Exported ${path.split(/[\\/]/).pop()}`);
    return agentExport;
  } catch (e) {
    agentExport = { state: "failed", message: e instanceof Error ? e.message : String(e) };
    throw e;
  } finally {
    job = null;
    dismiss(tid);
  }
}

/**
 * Save the frame under the playhead as a PNG wherever the platform puts
 * exports (CapCut's "export still frame"). Call from the click handler.
 * Returns the file's name, or null when the save dialog was canceled.
 */
export async function saveStill(name: string, resolution?: ExportSettings["resolution"]): Promise<string | null> {
  const target = await platform.createExportTarget(`${safeFileName(name)} frame`, "png");
  if (!target) return null;
  const s = store.get();
  // Without a resolution, the project's own size.
  const short = resolution ? (RESOLUTIONS.find((r) => r.id === resolution)?.short ?? 1080) : Math.min(s.project.width, s.project.height);
  const { width, height } = outputSize(s.project, short);
  const blob = await exportStill(s.project, s.playhead, width, height);
  const w = target.writable.getWriter();
  await w.write({ type: "write", data: new Uint8Array(await blob.arrayBuffer()), position: 0 });
  await w.close();
  if (target.revealLabel) await target.reveal();
  return target.displayName;
}

/**
 * Save the timeline as OpenTimelineIO (.otio) for Resolve, Premiere's OTIO
 * plugin and other editors. Call from the click handler. Returns the
 * file's name, or null when the save dialog was canceled.
 */
export async function saveOtio(): Promise<string | null> {
  const p = store.document();
  const target = await platform.createExportTarget(safeFileName(p.name), "otio");
  if (!target) return null;
  const w = target.writable.getWriter();
  await w.write({ type: "write", data: new TextEncoder().encode(JSON.stringify(toOtio(p), null, 2)), position: 0 });
  await w.close();
  if (target.revealLabel) await target.reveal();
  return target.displayName;
}

/** The current frame (or `frame`) as a PNG Blob URL at a preset size. */
export async function stillToUrl(frame?: number, resolution: ExportSettings["resolution"] = "1080p") {
  const s = store.get();
  const short = RESOLUTIONS.find((r) => r.id === resolution)?.short ?? 1080;
  const { width, height } = outputSize(s.project, short);
  const blob = await exportStill(s.project, frame ?? s.playhead, width, height);
  return { url: URL.createObjectURL(blob), size: blob.size, width, height };
}

/** The player's camera button and Mod+Shift+E: the frame under the
 * playhead at the project's size, without opening the export dialog. */
export async function saveFrame() {
  const p = store.get().project;
  if (!p.tracks.some((t) => t.clips.length)) return toast("Add something to the timeline first");
  try {
    const name = await saveStill(p.name);
    if (name) toast(`Saved ${name}`);
  } catch (e) {
    toast(`Couldn't save the frame: ${e instanceof Error ? e.message : e}`, "error");
  }
}

// ---- versions (export_versions) ---------------------------------------------------

export interface VersionsOptions extends Partial<Pick<ExportSettings, "format" | "resolution" | "quality" | "loudness">> {
  versions: VersionSpec[];
  /** Seconds of the end kept in every cut-down; default the end card's. */
  keepEnd?: number;
}

export interface VersionFile {
  name: string;
  path: string;
  ratio: string;
  width: number;
  height: number;
  seconds: number;
  bytes: number;
  textless?: true;
}

/** The versions as projects, from the document as it is now. */
function versionProjects(o: Pick<VersionsOptions, "versions" | "keepEnd">) {
  const master = store.document();
  const keep = o.keepEnd === undefined ? undefined : secondsToFrames(o.keepEnd, master.fps);
  return o.versions.map((v) => ({ spec: v, project: versionProject(master, v, keep) }));
}

/**
 * export_versions: one file per version of the open project (lib/versions.ts:
 * other shapes, cut-downs, a textless master), rendered one after another
 * into the agent folder on desktop, or through the save dialog on the web.
 * The project in the editor is never changed. agentExportStatus() follows
 * it; the answer lists every file.
 */
export async function exportVersions(o: VersionsOptions): Promise<AgentExport> {
  if (job) throw new Error("An export is already running.");
  const items = versionProjects(o);
  const made: VersionFile[] = [];
  job = new AbortController();
  const tid = toast(`Exporting ${items.length} versions`, "progress");
  try {
    for (const [i, { spec, project: q }] of items.entries()) {
      const chosen = Object.fromEntries(Object.entries({ format: o.format, resolution: o.resolution, quality: o.quality, loudness: o.loudness }).filter(([, v]) => v !== undefined));
      const settings: ExportSettings = { ...defaultExportSettings(q), name: q.name, ...chosen };
      const codecs = VIDEO_FORMATS[settings.format].codecs;
      if (!codecs.includes(settings.codec)) settings.codec = codecs[0];
      const plan = planExport(q, settings, { inPoint: null, outPoint: null });
      const name = safeFileName(q.name);
      const target = platform.createAgentExportTarget ? await platform.createAgentExportTarget(name, plan.extension) : await platform.createExportTarget(name, plan.extension);
      if (!target) throw new Error("The save dialog was canceled or could not open (a browser opens it only after a click; the desktop app saves without one).");
      const path = target.displayName;
      const version = `${i + 1} of ${items.length}`;
      const step = (f: number) => (i + f) / items.length;
      agentExport = { state: "running", path, fraction: +step(0).toFixed(3), eta: null, version };
      const result = await exportProject(q, plan, target, (pr) => {
        agentExport = { state: "running", path, fraction: +step(pr.fraction).toFixed(3), eta: pr.eta === null ? null : +pr.eta.toFixed(1), version };
        updateToast(tid, { progress: step(pr.fraction) });
      }, job.signal);
      // The web without a save dialog renders into private storage first.
      if (target.revealLabel === "Download") await target.reveal();
      made.push({ name: q.name, path, ratio: spec.ratio, width: plan.video?.width ?? 0, height: plan.video?.height ?? 0, seconds: +plan.seconds.toFixed(3), bytes: result.bytes, ...(spec.textless ? { textless: true as const } : {}) });
    }
    agentExport = { state: "done", path: made.at(-1)!.path, versions: made };
    toast(`Exported ${made.length} versions`);
    return agentExport;
  } catch (e) {
    agentExport = { state: "failed", message: e instanceof Error ? e.message : String(e), ...(made.length ? { versions: made } : {}) };
    throw e;
  } finally {
    job = null;
    dismiss(tid);
  }
}

/** One PNG with a row per version: the frames at those shares of each
 * version, each stamped with its time, so an agent sees every shape and
 * cut before rendering any. */
export async function versionsSheet(o: Pick<VersionsOptions, "versions" | "keepEnd"> & { at?: number[]; tileHeight?: number }): Promise<Blob> {
  const items = versionProjects(o);
  const at = o.at?.length ? o.at : [0.15, 0.5, 0.92];
  const th = o.tileHeight ?? 220, gap = 6, label = 22;
  const rows = items.map(({ project: q }) => ({ q, tw: Math.round((th * q.width) / q.height) }));
  const width = Math.max(...rows.map((r) => gap + at.length * (r.tw + gap)), 480);
  const out = new OffscreenCanvas(width, gap + rows.length * (label + th + gap));
  const g = out.getContext("2d")!;
  g.fillStyle = "#1b1d22";
  g.fillRect(0, 0, out.width, out.height);
  for (const [ri, { q, tw }] of rows.entries()) {
    const y = gap + ri * (label + th + gap);
    const length = projectDuration(q);
    g.fillStyle = "#e8eaed";
    g.font = "bold 14px sans-serif";
    g.fillText(`${q.name} · ${q.width}x${q.height} · ${+framesToSeconds(length, q.fps).toFixed(2)} s`, gap + 2, y + 16);
    for (const [ci, share] of at.entries()) {
      const frame = Math.min(length - 1, Math.max(0, Math.round(share * length)));
      const bmp = await createImageBitmap(await exportStill(q, frame, tw * 2, th * 2));
      const x = gap + ci * (tw + gap);
      g.drawImage(bmp, x, y + label, tw, th);
      bmp.close();
      const t = `${+framesToSeconds(frame, q.fps).toFixed(2)} s`;
      g.font = "bold 12px sans-serif";
      g.fillStyle = "rgba(0, 0, 0, 0.75)";
      g.fillRect(x + 4, y + label + 4, g.measureText(t).width + 10, 18);
      g.fillStyle = "#fff";
      g.fillText(t, x + 9, y + label + 17);
    }
  }
  // JPEG like the other contact sheets: a PNG sheet of footage can pass the
  // 3.75 MB a client may hand a model, which then posterizes it (ADR-073).
  return out.convertToBlob({ type: "image/jpeg", quality: 0.98 });
}

provide({ export: openExportDialog, saveFrame: () => void saveFrame() });
