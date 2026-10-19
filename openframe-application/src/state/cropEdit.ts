// The crop mode: CapCut's Crop, drawn on the viewer (ADR-048). A session
// edits a copy of one clip's crop while the viewer shows that clip whole,
// so the project only changes on Done, as one undo step, "Crop". Escape
// or Cancel drop the copy. The session also ends, applying the copy, when
// the viewer can no longer show it: another selection, playback, or the
// playhead leaving the clip; it is dropped if the clip goes away.

import { canCrop, cropClips, NO_CROP, ratioAspect, ratioCrop, type CropRatio } from "../lib/crop";
import { sourceSize } from "../lib/align";
import * as ops from "../lib/project/ops";
import type { Crop, Id } from "../lib/project/types";
import { run } from "./actions";
import { store } from "./store";

/** Open the crop mode on a clip: playback stops, the clip is selected,
 * and the playhead moves into it if it is elsewhere. */
export function beginCrop(id: Id) {
  const s = store.get();
  if (!canCrop(s.project, id)) return;
  const loc = ops.findClip(s.project, id)!;
  const c = loc.clip as Extract<typeof loc.clip, { crop: Crop }>;
  if (s.playing) run("shuttleStop");
  if (s.playhead < c.start || s.playhead >= c.start + c.duration) store.seek(c.start + Math.min(c.animIn?.duration ?? 0, c.duration - 1));
  store.select([id]);
  store.set({ cropEdit: { id, crop: { ...c.crop }, ratio: "free" } });
}

export function setCropDraft(crop: Crop) {
  const s = store.get().cropEdit;
  if (s) store.set({ cropEdit: { ...s, crop } });
}

/** Pick a shape: the largest centered crop of it, as CapCut does. Free
 * keeps the crop and lets the handles go. */
export function pickCropRatio(ratio: CropRatio) {
  const s = store.get().cropEdit;
  const c = s && ops.findClip(store.get().project, s.id)?.clip;
  if (!s || !c || c.type === "audio" || c.type === "adjustment") return;
  const src = sourceSize(store.get().project, c);
  const aspect = ratioAspect(ratio, src.w, src.h);
  store.set({ cropEdit: { ...s, ratio, crop: aspect === null ? s.crop : ratioCrop(aspect, src.w, src.h) } });
}

/** Back to the whole picture, shape free. */
export function resetCrop() {
  const s = store.get().cropEdit;
  if (s) store.set({ cropEdit: { ...s, crop: { ...NO_CROP }, ratio: "free" } });
}

/** Done: the copy becomes the clip's crop, one undo step. */
export function applyCrop() {
  const s = store.get().cropEdit;
  if (!s) return;
  // One change: the session ends with the edit, so no frame shows both.
  store.edit("Crop", (p) => cropClips(p, [s.id], s.crop), { cropEdit: null });
  if (store.get().cropEdit) store.set({ cropEdit: null }); // nothing changed
}

export function cancelCrop() {
  if (store.get().cropEdit) store.set({ cropEdit: null });
}

/** Escape cancels and Enter applies, before the app's own keys (deselect,
 * edit text), unless a field is being typed in. */
window.addEventListener("keydown", (e) => {
  if (!store.get().cropEdit || (e.key !== "Escape" && e.key !== "Enter")) return;
  const el = e.target as HTMLElement | null;
  const input = el instanceof HTMLInputElement && !["range", "checkbox", "radio", "color", "button"].includes(el.type);
  if (input || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.key === "Escape") cancelCrop();
  else applyCrop();
}, true);

// End the session when the viewer can no longer show it.
store.subscribe(() => {
  const s = store.get();
  const session = s.cropEdit;
  if (!session) return;
  const loc = ops.findClip(s.project, session.id);
  if (!loc) return cancelCrop();
  const c = loc.clip;
  const away = s.playing || s.selection.length !== 1 || s.selection[0] !== session.id || s.playhead < c.start || s.playhead >= c.start + c.duration || loc.track.hidden;
  if (away) applyCrop();
});

