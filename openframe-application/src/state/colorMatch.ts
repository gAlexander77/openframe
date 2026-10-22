import { sampleColorFrames } from "./autoColor";
import { colorMatch, matchFrames } from "../lib/colorMatch";
import { commandLabel } from "../lib/commandLabels";
import { createTrack, DEFAULT_ADJUST } from "../lib/project/defaults";
import { findClip, updateClip } from "../lib/project/ops";
import type { Clip, ImageClip, Project, VideoClip } from "../lib/project/types";
import { projectWork } from "./projectWork";
import { dismiss, toast, updateToast } from "./toast";
import { store } from "./store";

let running: AbortController | null = null;
export const cancelColorMatch = () => running?.abort();

export async function matchColor(ids: string | string[], options: { referenceClipId: string; strength?: number; matchSaturation?: boolean }) {
  if (running) throw new Error("A color match is already running");
  const p = store.get().project, session = projectWork.capture(), documentSession = projectWork.signal();
  session.throwIfAborted();
  const picture = (id: string): VideoClip | ImageClip => {
    const c = findClip(p, id)?.clip;
    if (!c || (c.type !== "video" && c.type !== "image")) throw new Error(`Choose a video or picture clip: ${id}`);
    return c;
  };
  const reference = picture(options.referenceClipId);
  const targets = [...new Set(typeof ids === "string" ? [ids] : ids)].map(picture);
  if (!targets.length) throw new Error("Choose at least one target clip");
  if (targets.some(c => c.id === reference.id)) throw new Error("The reference cannot also be a target");
  const strength = options.strength ?? 1;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("Strength must be between 0 and 1");
  if (strength === 0) return { targets: [], note: "Strength zero: no changes" };
  const controller = new AbortController();
  running = controller;
  const abort = () => controller.abort();
  session.addEventListener("abort", abort, { once: true });
  store.set({ colorMatchBusy: true });
  const signal = controller.signal;
  const tid = toast("Sampling color reference\u2026", "progress", undefined, { label: "Cancel", run: () => controller.abort() });
  try {
    const sample = async (c: VideoClip | ImageClip, before: boolean) => {
      // Keep the canvas and placement: the measurement sees the same crop,
      // transform and opacity as the viewer, with only this clip visible.
      const solo: Project = { ...p, tracks: [{ ...createTrack("video", "Sample", true), clips: [{ ...c, disabled: false, transitionOut: undefined }] }] };
      const k = Math.min(160 / p.width, 320 / p.height);
      const w = Math.max(2, Math.round(p.width * k)), h = Math.max(2, Math.round(p.height * k));
      return sampleColorFrames(solo, matchFrames(c.start, c.duration), w, h, before ? [c.id] : [], signal);
    };
    const ref = await sample(reference, false);
    const results: ({ clip_id: string } & ReturnType<typeof colorMatch>)[] = [];
    for (const [i, c] of targets.entries()) {
      updateToast(tid, { text: `Matching color ${i + 1} of ${targets.length}`, progress: i / targets.length });
      const frames = await sample(c, true);
      results.push({ clip_id: c.id, ...colorMatch(ref, frames, strength, options.matchSaturation !== false, c.adjust.curves?.luma) });
    }
    signal.throwIfAborted();
    if (store.get().project !== p) throw new Error("The project changed while matching; run Match again");
    store.edit(commandLabel("match_color", {}), q => results.reduce((next, result) => updateClip(next, result.clip_id, c => {
      if (!("adjust" in c)) return c;
      const keyframes = Object.fromEntries(Object.entries(c.keyframes ?? {}).filter(([key]) => !key.startsWith("adjust.") && !key.startsWith("effects.")));
      return { ...c, filter: undefined, effects: [], keyframes, adjust: { ...DEFAULT_ADJUST, saturation: result.saturation, curves: { ...result.curves, ...(c.adjust.curves?.luma ? { luma: c.adjust.curves.luma } : {}) } } } as Clip;
    }), q));
    return { targets: results, note: "Mean R/G/B difference in 8-bit levels before and after the sampled match. Clipped extremes are protected; different subjects may retain different means." };
  } finally {
    dismiss(tid);
    session.removeEventListener("abort", abort);
    if (running === controller) running = null;
    if (projectWork.signal() === documentSession) store.set({ colorMatchBusy: false });
  }
}
