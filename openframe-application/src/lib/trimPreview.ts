import { findClip, isTimed, sourceTimeAt } from "./project/ops";
import type { Clip, Project } from "./project/types";

export interface TrimPreviewState { kind: "trim" | "ripple" | "roll" | "slip" | "slide"; id: string; edge?: "start" | "end" }
export interface TrimFrame { clip: Clip; frame: number; source: number | null; label: string; project: Project }

/** Read the applied edit, not pointer intent: source limits may clamp a drag. */
export function trimFrames(p: Project, state: TrimPreviewState): TrimFrame[] {
  const loc = findClip(p, state.id);
  if (!loc) return [];
  const { clip, track, clipIndex } = loc;
  const panel = (c: Clip, end: boolean, label: string): TrimFrame => {
    const frame = c.start + (end ? c.duration - 1 : 0);
    return { clip: c, frame, source: isTimed(c) ? sourceTimeAt(c, frame, p.fps) : null, label,
      project: { ...p, tracks: [{ ...track, hidden: false, clips: [{ ...c, disabled: false, ...("transitionOut" in c ? { transitionOut: undefined } : {}) }] }] } };
  };
  if (state.kind === "roll") {
    const left = state.edge === "start" ? track.clips[clipIndex - 1] : clip;
    const right = state.edge === "start" ? clip : track.clips[clipIndex + 1];
    if (left && right && left.start + left.duration === right.start) return [panel(left, true, "Outgoing · Last frame"), panel(right, false, "Incoming · First frame")];
  }
  if (state.kind === "slide") {
    const left = track.clips[clipIndex - 1], right = track.clips[clipIndex + 1];
    if (left && right && left.start + left.duration === clip.start && clip.start + clip.duration === right.start) return [panel(left, true, "Previous · Last frame"), panel(right, false, "Next · First frame")];
  }
  return [panel(clip, false, "First frame"), panel(clip, true, "Last frame")];
}
