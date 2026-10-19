// Typing into a text clip, from the editor on the canvas or the inspector's
// Text box (ADR-031). Every keystroke reaches the project at once, so the
// viewer redraws the real text as it is typed, and the whole session is one
// undo step, "Edit text". A session ends on Escape, on blur, or on a press
// anywhere outside its editor; that press ends it before its own handlers
// run, so a drag it starts opens a gesture of its own instead of finding
// ours still open.

import * as ops from "../lib/project/ops";
import type { Id } from "../lib/project/types";
import { provide, run } from "./actions";
import { store } from "./store";

let session: { id: Id; el: HTMLElement; before: string } | null = null;

const textOf = (id: Id) => {
  const c = ops.findClip(store.get().project, id)?.clip;
  return c?.type === "text" ? c.text : null;
};

function pressOutside(e: PointerEvent) {
  if (session && !session.el.contains(e.target as Node)) endTyping();
}

/** Start typing into text clip `id` from editor `el`. Again with the same
 * editor and clip, nothing happens, so every keystroke may call it. */
export function beginTyping(id: Id, el: HTMLElement) {
  if (session?.id === id && session.el === el) return;
  endTyping();
  const before = textOf(id);
  if (before === null) return;
  session = { id, el, before };
  store.beginGesture();
  window.addEventListener("pointerdown", pressOutside, true);
}

/** The editor's whole text so far. */
export function typeText(text: string) {
  if (!session) return;
  const { id } = session;
  store.previewGesture((p) => ops.updateClip(p, id, (c) => (c.type === "text" ? { ...c, text } : c)));
}

/** Commit the session as one undo step; typing that came back to the
 * starting text records nothing. Closes the canvas editor. */
export function endTyping() {
  if (!session) return;
  const { id, before } = session;
  session = null;
  window.removeEventListener("pointerdown", pressOutside, true);
  if (textOf(id) === before) store.cancelGesture();
  else store.endGesture("Edit text");
  if (store.get().textEdit === id) store.set({ textEdit: null });
}

/** Open the editor on the canvas over a text clip, as CapCut's double-click
 * on the text does: playback stops and, if the playhead is outside the
 * clip, it moves to where the clip has finished animating in. */
export function editOnCanvas(id: Id) {
  const s = store.get();
  const loc = ops.findClip(s.project, id);
  if (!loc || loc.clip.type !== "text" || loc.track.hidden) return;
  const c = loc.clip;
  if (s.playing) run("shuttleStop");
  if (s.playhead < c.start || s.playhead >= c.start + c.duration) store.seek(c.start + Math.min(c.animIn?.duration ?? 0, c.duration - 1));
  store.select([id]);
  store.set({ textEdit: id });
}

/** CapCut's Enter in a caption: split it at the caret, one undo step,
 * and go on typing in the second half. */
export function splitCaptionAt(id: Id, caret: number) {
  let second: Id | undefined;
  store.edit("Split caption", (p) => {
    const r = ops.splitCaption(p, id, caret);
    second = r.second;
    return r.project;
  });
  if (second) editOnCanvas(second);
}

provide({
  editText: () => {
    const sel = store.get().selection;
    if (sel.length === 1) editOnCanvas(sel[0]);
  },
});
