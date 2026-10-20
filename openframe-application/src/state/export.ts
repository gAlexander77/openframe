// The export job: the dialog's open/progress/done state, and the two ways an
// export starts — the dialog (writes where the platform says) and
// automation (`window.videoEditor.render`, writes to memory). One job at a
// time, so a second export cannot fight the first for the encoder.

import { useSyncExternalStore } from "react";
import { exportProject as exportVideo, exportStill, memoryTarget, type ExportProgress, type ExportResult } from "../engine/export";
import { exportGif } from "../engine/gif";
import { captionPlan, defaultExportSettings, outputSize, planExport, renamedNote, RESOLUTIONS, safeFileName, VIDEO_FORMATS, withFormat, type AudioFormat, type ExportPlan, type ExportSettings, type VideoFormat } from "../lib/export";
import { captionsInRange, currentCaptions, toSrt, withoutCaptions } from "../lib/captions";
import type { Project } from "../lib/project/types";
import { toOtio } from "../lib/interchange/otio";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { projectDuration } from "../lib/project/ops";
import { captionCollisions, versionProject, versionSound, type CaptionCollision, type VersionSpec } from "../lib/versions";
import { hiddenNote, titlesInFront, type Hidden } from "../lib/behind";
import { measureBehind } from "./behind";
import { copyProject } from "../lib/project/copy";
import { projectSummary } from "../lib/project/summary";
import { findClip } from "../lib/project/ops";
import { onCanvas } from "../lib/follow";
import { layerAt } from "../lib/render/plan";
import type { SubjectNote } from "../lib/reframe";
import type { VisualClip } from "../lib/project/types";
import { lookAtShots } from "./subjects";
import { seenLetters, seenShots, seenTexts } from "../lib/designCheck";
import { sheetGrid, tileSize } from "../lib/sheetGrid";
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

/** The project as the export draws it (captions burned in or not), and
 * the SRT to write beside the file when asked (null: none, or no
 * captions in the range); ADR-080. */
function captionsFor(project: Project, settings: Pick<ExportSettings, "video" | "captions">, plan: ExportPlan) {
  const c = captionPlan(settings);
  const caps = c.sidecar ? captionsInRange(currentCaptions(project), framesToSeconds(plan.range.from, project.fps), framesToSeconds(plan.range.to, project.fps)) : [];
  return { project: c.burn ? project : withoutCaptions(project), srt: caps.length ? toSrt(caps) : null };
}

/** Write the SRT beside a finished export; a failure is a note, since the
 * file itself is done. */
async function writeSidecar(target: { sidecar?(ext: string, text: string): Promise<string> }, srt: string | null): Promise<{ file?: string; note?: string }> {
  if (!srt) return {};
  if (!target.sidecar) return { note: "This build cannot write the captions file." };
  try {
    return { file: await target.sidecar("srt", srt) };
  } catch (e) {
    return { note: `The captions file was not saved: ${e instanceof Error ? e.message : e}` };
  }
}

/** A GIF has its own encoder; everything else goes through mediabunny. */
const exportProject = (...a: Parameters<typeof exportVideo>) => (a[1].container === "gif" ? exportGif(...a) : exportVideo(...a));

export type ExportView =
  | { phase: "closed" }
  | { phase: "settings" }
  | { phase: "running"; plan: ExportPlan; fileName: string; progress: ExportProgress; startedAt: number }
  | { phase: "done"; plan: ExportPlan; fileName: string; result: ExportResult; reveal: (() => Promise<void>) | null; revealLabel?: string; captionsFile?: string }
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
  const { project, srt } = captionsFor(s.project, settings, plan);
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
    const side = await writeSidecar(target, srt);
    if (side.note) result.note = [result.note, side.note].filter(Boolean).join(" ");
    set({ phase: "done", plan, fileName: target.displayName, result, reveal: () => target.reveal(), revealLabel: target.revealLabel, ...(side.file ? { captionsFile: side.file } : {}) });
  } catch (e) {
    if (isAbort(e)) set({ phase: "settings" });
    else set({ phase: "failed", message: e instanceof Error ? e.message : String(e) });
  } finally {
    job = null;
  }
}

/** Options for automation: any dialog setting, plus a range in seconds;
 * an audio format (mp3, wav, m4a) makes an audio-only export. */
export type RenderOptions = Partial<Omit<ExportSettings, "format">> & { format?: VideoFormat | AudioFormat; start?: number; end?: number };

/** An agent's export: the options, plus the folder to write into (desktop). */
export type AgentExportOptions = RenderOptions & { folder?: string };

/** Why a folder cannot be honored here, said rather than ignored (ADR-095). */
const FOLDER_DESKTOP_ONLY = "folder is desktop only: the browser cannot write into a folder of your choosing. Leave folder out, or export from the desktop app.";

/**
 * Export to memory and return a Blob URL with what was made. The headless
 * renderer and the drive scripts use this; the project is not changed.
 */
export async function renderToUrl(options: RenderOptions = {}) {
  if (job) throw new Error("An export is already running.");
  const s = exportSubject();
  const p = s.project;
  const { start, end, format, ...rest } = options;
  const settings: ExportSettings = withFormat({ ...defaultExportSettings(p), ...rest }, format);
  const ranged = start !== undefined || end !== undefined;
  const inOut = ranged
    ? { inPoint: start !== undefined ? secondsToFrames(start, p.fps) : null, outPoint: end !== undefined ? secondsToFrames(end, p.fps) : null }
    : s;
  if (ranged) settings.range = "inout";
  const plan = planExport(p, settings, inOut);
  const drawn = captionsFor(p, settings, plan);
  const mem = memoryTarget();
  job = new AbortController();
  try {
    const result = await exportProject(drawn.project, plan, mem, undefined, job.signal);
    const blob = new Blob([mem.bytes()], { type: plan.mime });
    // The SRT a file export writes beside it, for the drives.
    return { url: URL.createObjectURL(blob), size: blob.size, type: plan.mime, fileName: plan.fileName, plan, ...result, ...(drawn.srt ? { srt: drawn.srt } : {}) };
  } finally {
    job = null;
  }
}

/** An export an agent started (MCP export_video), for export_status. */
export type AgentExport =
  | { state: "running"; path: string; fraction: number; eta: number | null; version?: string }
  | ({ state: "done"; path: string; captions_file?: string } & ExportResult)
  | { state: "done"; path: string; versions: VersionFile[] }
  | { state: "failed"; message: string; versions?: VersionFile[] };

let agentExport: AgentExport | null = null;
export const agentExportStatus = () => agentExport;

/**
 * Export for an agent: no dialog, into the platform's agent folder under a
 * name that replaces nothing. Resolves when the file is complete; a toast
 * shows the user it is happening, agentExportStatus() follows it.
 */
export async function exportForAgent(options: AgentExportOptions = {}): Promise<AgentExport> {
  const make = platform.createAgentExportTarget;
  if (!make) throw new Error(options.folder !== undefined ? FOLDER_DESKTOP_ONLY : "Agents can export from the desktop app only.");
  if (job) throw new Error("An export is already running.");
  const s = exportSubject();
  const p = s.project;
  const { start, end, format, folder, ...rest } = options;
  const settings: ExportSettings = withFormat({ ...defaultExportSettings(p), ...rest }, format);
  const ranged = start !== undefined || end !== undefined;
  const inOut = ranged
    ? { inPoint: start !== undefined ? secondsToFrames(start, p.fps) : null, outPoint: end !== undefined ? secondsToFrames(end, p.fps) : null }
    : { inPoint: null, outPoint: null };
  if (ranged) settings.range = "inout";
  const plan = planExport(p, settings, inOut);
  const drawn = captionsFor(p, settings, plan);
  job = new AbortController();
  const tid = toast("Exporting the video", "progress");
  try {
    const target = await make.call(platform, safeFileName(settings.name), plan.extension, folder);
    const path = target.displayName;
    const renamed = renamedNote(`${safeFileName(settings.name)}.${plan.extension}`, path);
    agentExport = { state: "running", path, fraction: 0, eta: null };
    const result = await exportProject(drawn.project, plan, target, (pr) => {
      agentExport = { state: "running", path, fraction: +pr.fraction.toFixed(3), eta: pr.eta === null ? null : +pr.eta.toFixed(1) };
      updateToast(tid, { progress: pr.fraction });
    }, job.signal);
    const side = await writeSidecar(target, drawn.srt);
    const note = [result.note, side.note, renamed].filter(Boolean).join(" ");
    if (note) result.note = note;
    agentExport = { state: "done", path, ...result, ...(side.file ? { captions_file: side.file } : {}) };
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
  /** Desktop: an absolute folder to write every version into instead of
   * the Videos folder (created if missing). */
  folder?: string;
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
  /** What did not go as asked (a codec, a loudness the peaks held short),
   * and the numbered name the file took (renamedNote). */
  note?: string;
  /** With a loudness target: what the mix reached (LUFS, dBTP), as
   * export_video answers it. */
  loudness?: { integrated: number; truePeak: number };
  /** Good news: the mix normalized to its target, and how. */
  info?: string;
  /** Where its framing cuts a shot's subject, if anywhere. */
  subjects?: SubjectReport[];
  /** Titles behind their subject that the subject hides in this shape. */
  titles?: TitleReport[];
  /** Pictures and graphics drawn across the burned captions in this shape. */
  caption_overlaps?: CaptionCollision[];
}

/** A title behind its subject (text_behind_subject) that a version's
 * shape lets the subject hide (lib/behind.ts). */
export interface TitleReport {
  clip_id: string;
  subject_clip_id: string;
  /** Version seconds. */
  at: number;
  /** The share of its letters the subject covers there, and in the master. */
  hidden: number;
  master?: number;
  note: string;
  /** What to do about it, or what the version did (the title shown in
   * front: its subject's copy off in that version). */
  fix?: string;
  done?: string;
}

/** A subject a version's framing cuts, as an agent reads it. */
export interface SubjectReport {
  clip_id: string;
  /** Version seconds. */
  at: number;
  /** The share of the subject inside the frame. */
  kept: number;
  /** The subject, fractions of the clip's picture from its top left. */
  subject: { x: number; y: number; w: number; h: number };
  note: string;
}

/** One report per shot: its worst moment. */
function reportOf(notes: SubjectNote[]): SubjectReport[] {
  const worst = new Map<string, SubjectNote>();
  for (const n of notes) if (!worst.has(n.clipId) || n.kept < worst.get(n.clipId)!.kept) worst.set(n.clipId, n);
  return [...worst.values()].map((n) => {
    const s = n.subject, cx = +((s.left + s.right) / 2).toFixed(2), cy = +((s.top + s.bottom) / 2).toFixed(2);
    return {
      clip_id: n.clipId,
      at: n.at,
      kept: n.kept,
      subject: { x: +s.left.toFixed(3), y: +s.top.toFixed(3), w: +(s.right - s.left).toFixed(3), h: +(s.bottom - s.top).toFixed(3) },
      note: n.wide
        ? `the subject is wider than this frame (${Math.round(n.kept * 100)}% of it shows): fit "blur" or "fit" shows it whole`
        : `the subject is cut by the frame (${Math.round(n.kept * 100)}% of it shows): reframe "subject" (the default), or focus {clip_id: "${n.clipId}", x: ${cx}, y: ${cy}}`,
    };
  });
}

/** The versions as projects, from the document as it is now: footage a
 * version crops is framed on its subject (state/subjects.ts looks at the
 * shots once, lib/reframe.ts places each crop). */
async function versionProjects(o: Pick<VersionsOptions, "versions" | "keepEnd">) {
  const master = store.document();
  const keep = o.keepEnd === undefined ? undefined : secondsToFrames(o.keepEnd, master.fps);
  const reshaped = o.versions.some((v) => v.ratio !== "original");
  const looks = reshaped ? await lookAtShots(master) : undefined;
  const made = o.versions.map((v) => {
    const notes: SubjectNote[] = [];
    return { spec: v, project: versionProject(master, v, keep, looks, notes), notes };
  });
  // Titles behind their subject: how much the subject hides in each shape,
  // against the master (ADR-103); one hidden past the limit shows in front
  // instead (its subject's copy off in that version), unless the version's
  // overrides place the title or the copy by hand.
  const before = reshaped ? await safely(() => measureBehind(master)) : [];
  const out = [];
  for (const m of made) {
    let project = m.project, titles: TitleReport[] = [];
    if (before.length) {
      const hidden = await safely(() => measureBehind(project));
      const front = titlesInFront(project, hidden, new Set((m.spec.overrides ?? []).map((x) => x.clip_id)));
      titles = titleReports(project, hidden, before, front.off);
      project = front.project;
    }
    // Only where the shot is seen: not under an end card or another shot.
    const runs = m.notes.length ? seenShots(project, true) : [];
    const seen = (n: SubjectNote) => {
      const f = secondsToFrames(n.at, project.fps);
      return runs.some((r) => r.clipId === n.clipId && f >= r.start && f < r.start + r.duration);
    };
    // A picture or graphic across the burned captions (ADR-116).
    out.push({ spec: m.spec, project, notes: m.notes.filter(seen), titles, overlaps: captionCollisions(project) });
  }
  return out;
}

/** A measurement that cannot render here is left out, not a failure. */
async function safely(f: () => Promise<Hidden[]>): Promise<Hidden[]> {
  try {
    return await f();
  } catch {
    return [];
  }
}

/** The titles a version's subject hides past the limit, as an agent reads
 * them; `off`: the subject copies turned off for them (titlesInFront). */
function titleReports(q: Project, hidden: Hidden[], master: Hidden[], off: string[]): TitleReport[] {
  const text = new Map(q.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === "text" ? [[c.id, c.text] as const] : [])));
  return hidden.flatMap((h) => {
    const was = master.find((x) => x.titleId === h.titleId)?.share;
    const say = hiddenNote(q, h, text.get(h.titleId) ?? "", was);
    if (!say) return [];
    const done = off.includes(h.subjectId) ? `its subject's copy ${h.subjectId} is off in this version, so the title reads whole in front of it (an override {clip_id: "${h.subjectId}", hidden: false} keeps it behind, with the title moved: {clip_id: "${h.titleId}", y})` : undefined;
    return [{ clip_id: h.titleId, subject_clip_id: h.subjectId, at: +framesToSeconds(h.frame, q.fps).toFixed(2), hidden: h.share, ...(was !== undefined ? { master: was } : {}), note: say.message, ...(done ? { done } : { fix: say.fix }) }];
  });
}

/**
 * export_versions: one file per version of the open project (lib/versions.ts:
 * other shapes, cut-downs, a textless master), rendered one after another
 * into the agent folder on desktop, or through the save dialog on the web.
 * The project in the editor is never changed. agentExportStatus() follows
 * it; the answer lists every file.
 */
export async function exportVersions(o: VersionsOptions): Promise<AgentExport> {
  if (o.folder !== undefined && !platform.createAgentExportTarget) throw new Error(FOLDER_DESKTOP_ONLY);
  if (job) throw new Error("An export is already running.");
  const items = await versionProjects(o);
  const made: VersionFile[] = [];
  job = new AbortController();
  const tid = toast(`Exporting ${items.length} versions`, "progress");
  try {
    for (const [i, { spec, project: q, notes, titles, overlaps }] of items.entries()) {
      const chosen = Object.fromEntries(Object.entries({ format: o.format, resolution: o.resolution, quality: o.quality, loudness: o.loudness }).filter(([, v]) => v !== undefined));
      const settings: ExportSettings = { ...defaultExportSettings(q), name: q.name, ...chosen };
      const codecs = VIDEO_FORMATS[settings.format].codecs;
      if (!codecs.includes(settings.codec)) settings.codec = codecs[0];
      const plan = planExport(q, settings, { inPoint: null, outPoint: null });
      const name = safeFileName(q.name);
      const target = platform.createAgentExportTarget ? await platform.createAgentExportTarget(name, plan.extension, o.folder) : await platform.createExportTarget(name, plan.extension);
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
      // The web's dialog names the file as the person chooses: no note there.
      const renamed = platform.createAgentExportTarget ? renamedNote(`${name}.${plan.extension}`, path) : undefined;
      made.push({ name: q.name, path, ratio: spec.ratio, width: plan.video?.width ?? 0, height: plan.video?.height ?? 0, seconds: +plan.seconds.toFixed(3), bytes: result.bytes, ...(spec.textless ? { textless: true as const } : {}), ...versionSound(result, renamed), ...(notes.length ? { subjects: reportOf(notes) } : {}), ...(titles.length ? { titles } : {}), ...(overlaps.length ? { caption_overlaps: overlaps } : {}) });
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
 * cut before rendering any. A tile where the framing cuts a shot's
 * subject outlines the subject in orange and says so; the reports list
 * every such shot with its worst moment. */
export async function versionsSheet(o: Pick<VersionsOptions, "versions" | "keepEnd"> & { at?: number[]; tileWidth?: number }): Promise<{ blob: Blob; subjects: { version: string; reports: SubjectReport[] }[]; titles: { version: string; reports: TitleReport[] }[]; overlaps: { version: string; reports: CaptionCollision[] }[] }> {
  const items = await versionProjects(o);
  const at = o.at?.length ? o.at : [0.15, 0.5, 0.92];
  const gap = 6, label = 22;
  // Each version's moments wrap into rows inside the sheet's width (ADR-115).
  const blocks = items.map(({ project: q, notes, titles, overlaps }) => {
    const { tw, th } = tileSize(q.width, q.height, o.tileWidth);
    return { q, notes, titles, overlaps, tw, th, ...sheetGrid(tw, at.length, gap) };
  });
  const tops: number[] = [];
  let height = gap;
  for (const b of blocks) {
    tops.push(height);
    height += label + b.rows * (b.th + gap);
  }
  const width = Math.max(...blocks.map((b) => gap + b.columns * (b.tw + gap)), 480);
  const out = new OffscreenCanvas(width, height);
  const g = out.getContext("2d")!;
  g.fillStyle = "#1b1d22";
  g.fillRect(0, 0, out.width, out.height);
  for (const [ri, { q, tw, th, columns, notes, titles, overlaps }] of blocks.entries()) {
    const top = tops[ri];
    const length = projectDuration(q);
    g.fillStyle = "#e8eaed";
    g.font = "bold 14px sans-serif";
    g.fillText(`${q.name} · ${q.width}x${q.height} · ${+framesToSeconds(length, q.fps).toFixed(2)} s`, gap + 2, top + 16);
    for (const [i, share] of at.entries()) {
      const frame = Math.min(length - 1, Math.max(0, Math.round(share * length)));
      const bmp = await createImageBitmap(await exportStill(q, frame, tw * 2, th * 2));
      const ci = i % columns;
      // y + label is the tile's top, as before: a wrapped row sits one tile lower.
      const y = top + Math.floor(i / columns) * (th + gap);
      const x = gap + ci * (tw + gap);
      g.drawImage(bmp, x, y + label, tw, th);
      bmp.close();
      const t = `${+framesToSeconds(frame, q.fps).toFixed(2)} s`;
      g.font = "bold 12px sans-serif";
      g.fillStyle = "rgba(0, 0, 0, 0.75)";
      g.fillRect(x + 4, y + label + 4, g.measureText(t).width + 10, 18);
      g.fillStyle = "#fff";
      g.fillText(t, x + 9, y + label + 17);
      // A subject this framing cuts near this moment: outlined where it is.
      const sec = framesToSeconds(frame, q.fps);
      const shown = seenShots(q, true).find((r) => frame >= r.start && frame < r.start + r.duration)?.clipId;
      const n = notes.filter((m) => m.clipId === shown && Math.abs(m.at - sec) <= 0.6).sort((a, b) => Math.abs(a.at - sec) - Math.abs(b.at - sec))[0];
      const c = n && (findClip(q, n.clipId)?.clip as VisualClip | undefined);
      const l = c && layerAt(q, c, frame);
      if (n && c && l) {
        const k = tw / q.width;
        const a = onCanvas(q, c, l, n.subject.left, n.subject.top), b = onCanvas(q, c, l, n.subject.right, n.subject.bottom);
        const bx = x + Math.min(a.x, b.x) * k, by = y + label + Math.min(a.y, b.y) * k, bw = Math.abs(b.x - a.x) * k, bh = Math.abs(b.y - a.y) * k;
        g.save();
        g.beginPath();
        g.rect(x, y + label, tw, th);
        g.clip();
        g.strokeStyle = g.fillStyle = "#ff9f1a";
        g.lineWidth = 2;
        g.setLineDash([5, 3]);
        g.strokeRect(bx, by, bw, bh);
        g.setLineDash([]);
        // Off the frame: a triangle on the edge it lies past, at its height.
        const cy = Math.max(y + label + 8, Math.min(y + label + th - 8, by + bh / 2));
        const side = bx >= x + tw ? 1 : bx + bw <= x ? -1 : 0;
        if (side) {
          const ex = side > 0 ? x + tw - 2 : x + 2;
          g.beginPath();
          g.moveTo(ex, cy);
          g.lineTo(ex - side * 12, cy - 8);
          g.lineTo(ex - side * 12, cy + 8);
          g.fill();
        }
        g.restore();
        const say = n.wide ? "subject too wide" : "subject cut";
        g.font = "bold 12px sans-serif";
        g.fillStyle = "rgba(0, 0, 0, 0.75)";
        g.fillRect(x + 4, y + label + th - 24, g.measureText(say).width + 10, 18);
        g.fillStyle = "#ff9f1a";
        g.fillText(say, x + 9, y + label + th - 11);
      }
      // A title its subject hides in this shape, showing now: outlined.
      for (const t of titles) {
        const s = seenTexts(q).find((x) => x.c.id === t.clip_id && frame >= x.start && frame < x.start + x.duration);
        const b = s && seenLetters(q, s, frame)?.box;
        if (!b) continue;
        const k = tw / q.width;
        g.save();
        g.beginPath();
        g.rect(x, y + label, tw, th);
        g.clip();
        g.strokeStyle = "#ff9f1a";
        g.lineWidth = 2;
        g.setLineDash([5, 3]);
        g.strokeRect(x + b.left * k, y + label + b.top * k, (b.right - b.left) * k, (b.bottom - b.top) * k);
        g.restore();
        const say = t.done ? "title in front" : "title " + Math.round(t.hidden * 100) + "% hidden";
        g.font = "bold 12px sans-serif";
        g.fillStyle = "rgba(0, 0, 0, 0.75)";
        g.fillRect(x + 4, y + label + th - 46, g.measureText(say).width + 10, 18);
        g.fillStyle = "#ff9f1a";
        g.fillText(say, x + 9, y + label + th - 33);
      }
      // A picture or graphic across the captions showing now: outlined
      // where it shows (a porthole's circle, not its whole frame).
      for (const c of overlaps) {
        const clip = findClip(q, c.clip_id)?.clip;
        if (!clip || frame < clip.start || frame >= clip.start + clip.duration) continue;
        const k = tw / q.width, b = c.box;
        g.save();
        g.beginPath();
        g.rect(x, y + label, tw, th);
        g.clip();
        g.strokeStyle = "#ff9f1a";
        g.lineWidth = 2;
        g.setLineDash([5, 3]);
        g.strokeRect(x + b.left * k, y + label + b.top * k, (b.right - b.left) * k, (b.bottom - b.top) * k);
        g.restore();
        const say = `${c.layer} the captions`;
        g.font = "bold 12px sans-serif";
        g.fillStyle = "rgba(0, 0, 0, 0.75)";
        g.fillRect(x + 4, y + label + th - 68, g.measureText(say).width + 10, 18);
        g.fillStyle = "#ff9f1a";
        g.fillText(say, x + 9, y + label + th - 55);
      }
    }
  }
  // JPEG like the other contact sheets: a PNG sheet of footage can pass the
  // 3.75 MB a client may hand a model, which then posterizes it (ADR-073).
  const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.98 });
  return { blob, subjects: items.map((it) => ({ version: it.project.name, reports: reportOf(it.notes) })).filter((x) => x.reports.length), titles: items.map((it) => ({ version: it.project.name, reports: it.titles })).filter((x) => x.reports.length), overlaps: items.map((it) => ({ version: it.project.name, reports: it.overlaps })).filter((x) => x.reports.length) };
}

/**
 * export_versions with save_projects: each version saved as a project of
 * its own (named as its file would be, sharing the master's media), to
 * fine-tune by hand or with tools and export from there; nothing is
 * exported and the master stays open and as it was.
 */
export async function saveVersionProjects(o: Pick<VersionsOptions, "versions" | "keepEnd">): Promise<{ id: string; name: string; width: number; height: number; seconds: number; subjects?: SubjectReport[]; titles?: TitleReport[]; caption_overlaps?: CaptionCollision[] }[]> {
  const items = await versionProjects(o);
  const saved = [];
  for (const { project: q, notes, titles, overlaps } of items) {
    const copy = copyProject(q, q.name);
    await platform.saveProject(copy, projectSummary(copy));
    saved.push({ id: copy.id, name: copy.name, width: copy.width, height: copy.height, seconds: +framesToSeconds(projectDuration(copy), copy.fps).toFixed(3), ...(notes.length ? { subjects: reportOf(notes) } : {}), ...(titles.length ? { titles } : {}), ...(overlaps.length ? { caption_overlaps: overlaps } : {}) });
  }
  toast(`Saved ${saved.length} version${saved.length === 1 ? "" : "s"} as projects`);
  return saved;
}

provide({ export: openExportDialog, saveFrame: () => void saveFrame() });
