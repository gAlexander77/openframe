// The export job: the dialog's open/progress/done state, and the two ways an
// export starts — the dialog (writes where the platform says) and
// automation (`window.videoEditor.render`, writes to memory). One job at a
// time, so a second export cannot fight the first for the encoder.

import { useSyncExternalStore } from "react";
import { exportProject, exportStill, memoryTarget, type ExportProgress, type ExportResult } from "../engine/export";
import { defaultExportSettings, outputSize, planExport, RESOLUTIONS, safeFileName, type ExportPlan, type ExportSettings } from "../lib/export";
import { toOtio } from "../lib/interchange/otio";
import { secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { provide } from "./actions";
import { store } from "./store";

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
  const s = store.get();
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
  const s = store.get();
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

/**
 * Save the frame under the playhead as a PNG wherever the platform puts
 * exports (CapCut's "export still frame"). Call from the click handler.
 * Returns the file's name, or null when the save dialog was canceled.
 */
export async function saveStill(name: string, resolution: ExportSettings["resolution"]): Promise<string | null> {
  const target = await platform.createExportTarget(`${safeFileName(name)} frame`, "png");
  if (!target) return null;
  const s = store.get();
  const short = RESOLUTIONS.find((r) => r.id === resolution)?.short ?? 1080;
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
  const p = store.get().project;
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

provide({ export: openExportDialog });
