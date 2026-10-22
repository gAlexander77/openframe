import { memoryOwners } from "../engine/memory";
import { retainedBytes } from "../lib/memory";
// The project check (lib/designCheck.ts) run for a person: the library's
// Check tab, File > Check project and the export dialog's Check row
// (ADR-111). The same measuring an agent's check_project runs (it calls
// measureForCheck from here), with progress, cancel, and the last result
// kept while the tab is closed. It runs on request only: measuring renders
// frames and decodes sound, too slow for every edit.

import { useSyncExternalStore } from "react";
import { exportStills } from "../engine/export";
import { decodeMono } from "../engine/analyze";
import { hiddenNote } from "../lib/behind";
import { boxPixels, measureLook, tailLevels, unevenFade } from "../lib/contrast";
import { checkProject, contrastTargets, joinTargets, tailTargets, withoutTitles, type CheckKind, type Measured } from "../lib/designCheck";
import { getAsset } from "../lib/project/ops";
import type { Id, Project } from "../lib/project/types";
import { joinEdge } from "./audition";
import { measureBehind } from "./behind";
import { projectWork } from "./projectWork";
import { store } from "./store";

export interface MeasureProgress {
  /** 0..1 */
  fraction: number;
  /** What is being measured, in words. */
  stage: string;
}

const aborted = () => new DOMException("The check was canceled.", "AbortError");

/** Joins of audio clips measured at most: each renders 1.8 s of its track
 * and decodes a little of each file around the cut (ADR-119). A song cut
 * on its bars has a few; a voiceover of lines end to end a few dozen. */
export const MAX_JOINS = 24;

/**
 * What check_project measures before it judges (ADR-068, ADR-097): every
 * title's contrast with the picture behind it at a few moments of its life
 * (designCheck.titleMoments), rendered as export draws it with every title
 * off, its box, shadow and outline counted, and the fixes it names tried
 * on the same pixels; each long music clip's last seconds, decoded; and
 * each join of audio clips, rendered on its track (ADR-119). A
 * failure to measure falls back to the check's own guess and the answer
 * says why; it never fails the check. `progress` hears each step; `signal`
 * stops it between steps (an AbortError).
 */
export async function measureForCheck(p: Project, opts: { progress?: (p: MeasureProgress) => void; signal?: AbortSignal; sound?: boolean } = {}): Promise<Measured> {
  const out: Measured = {};
  const { targets, skipped } = contrastTargets(p);
  const frames = [...new Set(targets.flatMap((t) => [...t.samples, ...(t.fades ?? [])].map((s) => s.frame)))].sort((a, b) => a - b);
  const tails = opts.sound === false ? [] : tailTargets(p);
  const allJoins = opts.sound === false ? [] : joinTargets(p), joins = allJoins.slice(0, MAX_JOINS);
  // Rendering a frame, decoding a sound's end and hearing a join take about as long.
  const steps = Math.max(1, frames.length + 1 + tails.length + joins.length);
  let done = 0;
  const step = (stage: string, n = 1) => {
    if (opts.signal?.aborted) throw aborted();
    opts.progress?.({ fraction: Math.min(1, done / steps), stage });
    done += n;
  };
  if (targets.length) {
    try {
      // Without its titles, at a width that is plenty for a luminance.
      // Inside compound clips too: their titles are measured where shown.
      const bare = withoutTitles(p);
      const w = Math.min(640, p.width), h = Math.max(2, Math.round((w * p.height) / p.width)), k = w / p.width;
      const contrast: NonNullable<Measured["contrast"]> = {};
      const fades: NonNullable<Measured["fades"]> = {};
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext("2d", { willReadFrequently: true })!;
      // A few frames a render, so a long film's titles do not hold every
      // picture in memory at once.
      for (let i = 0; i < frames.length; i += 8) {
        const batch = frames.slice(i, i + 8);
        step(`Measuring the titles' contrast: frame ${Math.min(i + batch.length, frames.length)} of ${frames.length}`, batch.length);
        const pics = await exportStills(bare, batch, w, h);
        for (const [j, frame] of batch.entries()) {
          const bmp = await createImageBitmap(pics[j]);
          g.drawImage(bmp, 0, 0, w, h);
          bmp.close();
          const rgba = g.getImageData(0, 0, w, h).data;
          for (const t of targets) {
            // The middle of a fade: does it fade as one (ADR-118)? The
            // worst is the one that loses a part earliest in the fade.
            const fade = t.fades?.find((x) => x.frame === frame);
            if (fade) {
              const px = boxPixels(rgba, w, { left: fade.box.left * k, right: fade.box.right * k, top: fade.box.top * k, bottom: fade.box.bottom * k });
              const u = unevenFade(t.look, px);
              if (u && !(fades[t.clipId] && fades[t.clipId].opacity >= u.opacity)) fades[t.clipId] = { ...u, frame, fixes: t.fixes.filter((x) => !unevenFade(x.look, px)).map((x) => x.say) };
            }
            const s = t.samples.find((x) => x.frame === frame);
            if (!s) continue;
            const px = boxPixels(rgba, w, { left: s.box.left * k, right: s.box.right * k, top: s.box.top * k, bottom: s.box.bottom * k });
            const m = measureLook(t.look, px);
            if (!m || (contrast[t.clipId] && contrast[t.clipId].ratio <= m.ratio)) continue;
            contrast[t.clipId] = { ...m, frame, fixes: t.fixes.map((x) => ({ say: x.say, ratio: measureLook(x.look, px)?.ratio ?? 0 })) };
          }
        }
      }
      out.contrast = contrast;
      if (Object.keys(fades).length) out.fades = fades;
      out.moments = frames.length;
      if (skipped) out.contrastNote = `${skipped} titles past the first 40 were not measured`;
    } catch (e) {
      if (opts.signal?.aborted) throw aborted();
      // Say why, so an agent knows the contrast findings are guesses.
      out.contrastNote = `not measured, the picture could not be rendered here (${e instanceof Error ? e.message : String(e)}); titles over footage without an outline, shadow or box are tips instead`;
    }
  } else if (p.tracks.some((t) => t.clips.some((c) => c.type === "text" && !c.disabled))) out.contrastNote = "no title is on screen long enough to measure";
  // Titles behind their subject: how much the subject hides (ADR-103).
  step("Looking for titles behind their subject");
  try {
    const texts = new Map(p.tracks.flatMap((t) => t.clips).flatMap((c) => (c.type === "text" ? [[c.id, c.text] as const] : [])));
    out.hidden = (await measureBehind(p)).flatMap((h) => {
      const say = hiddenNote(p, h, texts.get(h.titleId) ?? "");
      return say ? [{ clipId: h.titleId, frame: h.frame, ...say }] : [];
    });
  } catch {
    // Unrenderable here: the check goes on without it.
  }
  for (const [i, t] of tails.entries()) {
    step(`Listening to how the sounds end: ${i + 1} of ${tails.length}`);
    const a = getAsset(p, t.assetId);
    if (!a?.hasAudio) continue;
    try {
      const rate = 8000;
      (out.tails ??= {})[t.clipId] = tailLevels(await decodeMono(a, t.from, t.to, rate), rate);
    } catch {
      // Unreadable sound: the check keeps its plain rule.
    }
  }
  // Each join of audio clips, heard on its track (ADR-119).
  for (const [i, j] of joins.entries()) {
    step(`Listening to where sounds meet: ${i + 1} of ${joins.length}`);
    try {
      const r = await joinEdge(p, j.trackId, j.at, opts.signal ?? new AbortController().signal);
      if (r) (out.joins ??= []).push(r);
    } catch {
      if (opts.signal?.aborted) throw aborted();
      // Unreadable sound: that join goes unjudged.
    }
  }
  if (allJoins.length > joins.length) out.joinsNote = `the first ${joins.length} of ${allJoins.length} joins of audio clips were measured`;
  if (opts.signal?.aborted) throw aborted();
  return out;
}

export type CheckReport = ReturnType<typeof checkProject>;

/** A finished check: what it found, and what it looked at. */
export interface CheckRun {
  kind: CheckKind;
  report: CheckReport;
  /** The document it checked, for the findings' names. */
  doc: Project;
  projectId: Id;
  /** The store's revision when it started: a later one means the project
   * changed since. */
  revision: number;
}

export interface CheckState {
  /** The kind picked in the tab; File > Check project and Export use it too. */
  kind: CheckKind;
  job: (MeasureProgress & { abort: AbortController }) | null;
  last: CheckRun | null;
  error: string | null;
}

let state: CheckState = { kind: "any", job: null, last: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<CheckState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

memoryOwners.register("project_check", () => ({ bytes: retainedBytes(state.last), count: state.last ? 1 : 0, estimated: true }), () => { state.job?.abort.abort(); set({ last: null, error: null }); });

export const checkStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  setKind: (kind: CheckKind) => set({ kind }),
};

export function useCheck<T>(selector: (s: CheckState) => T): T {
  return useSyncExternalStore(checkStore.subscribe, () => selector(state));
}

/** The last check, if it was of the open project. */
export const lastCheck = (s: CheckState = state): CheckRun | null => (s.last && s.last.projectId === store.document().id ? s.last : null);

/** Is the last check older than the project's last change? */
export const isStale = (run: CheckRun) => run.revision !== store.get().revision;

/** Check the open project as `kind` (default the tab's). One at a time: a
 * request while one runs is ignored. Closing the project cancels it. */
export async function runCheck(kind: CheckKind = state.kind): Promise<CheckRun | null> {
  const session = projectWork.signal();
  if (state.job || session.aborted) return null;
  const abort = new AbortController();
  const stop = () => abort.abort();
  session.addEventListener("abort", stop);
  const doc = store.document();
  const revision = store.get().revision;
  set({ kind, error: null, job: { fraction: 0, stage: "Starting the check", abort } });
  try {
    const measured = await measureForCheck(doc, { signal: abort.signal, progress: (p) => state.job?.abort === abort && set({ job: { ...p, abort } }) });
    const run: CheckRun = { kind, report: checkProject(doc, kind, measured), doc, projectId: doc.id, revision };
    set({ job: null, last: run });
    return run;
  } catch (e) {
    const canceled = abort.signal.aborted;
    set({ job: null, error: canceled ? null : `The check didn't finish: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  } finally {
    session.removeEventListener("abort", stop);
  }
}

export const cancelCheck = () => state.job?.abort.abort();

/** Show the Check tab; with `run`, start a check (File > Check project,
 * the export dialog's Check project). */
export function openCheck(run = false) {
  store.set({ leftTab: "check", scopes: false });
  if (run) void runCheck();
}
