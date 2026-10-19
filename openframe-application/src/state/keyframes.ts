// Keyframe selection and clipboard: what Delete, Copy and Paste do while
// keyframes rather than clips are selected (the keyframe panel and the
// timeline's diamonds select them). The clip handlers in actions.ts ask
// here first, so one key press means one thing everywhere.

import { copyKeys, liveRefs, pasteKeys, removeKeys, type KeyClipboard, type KeyMap, type KeyRef } from "../lib/keyframeEdit";
import { findClip, updateClip } from "../lib/project/ops";
import type { Clip, Id, Project } from "../lib/project/types";
import { store } from "./store";
import { toast } from "./toast";

let board: KeyClipboard | null = null;
/** Whether the last Copy took keyframes, so Paste picks the right clipboard. */
let keysCopiedLast = false;

/** Replace a clip's keyframe map (undefined removes the field). */
export const withKeys = (p: Project, clipId: Id, keys: KeyMap | undefined): Project =>
  updateClip(p, clipId, (c) => {
    const next = { ...c, keyframes: keys } as Clip;
    if (!keys) delete next.keyframes;
    return next;
  });

/** The selected keyframes that still exist, with their clip. */
export function selectedKeys(): { clip: Clip; keys: KeyRef[] } | null {
  const s = store.get();
  if (!s.keySel) return null;
  const clip = findClip(s.project, s.keySel.clipId)?.clip;
  const keys = clip ? liveRefs(clip.keyframes, s.keySel.keys) : [];
  return clip && keys.length ? { clip, keys } : null;
}

/** Select keyframes on a clip, making it the selected clip if it is not. */
export function selectKeys(clipId: Id, keys: KeyRef[]) {
  const s = store.get();
  if (s.selection.length !== 1 || s.selection[0] !== clipId) store.select([clipId]);
  store.set({ keySel: keys.length ? { clipId, keys } : null });
}

export function deleteSelectedKeys(): boolean {
  const sel = selectedKeys();
  if (!sel) return false;
  store.edit(sel.keys.length > 1 ? "Delete keyframes" : "Delete keyframe", (p) => withKeys(p, sel.clip.id, removeKeys(sel.clip.keyframes, sel.keys)), { keySel: null });
  return true;
}

export function copySelectedKeys(): boolean {
  const sel = selectedKeys();
  if (!sel) return false;
  board = copyKeys(sel.clip.keyframes, sel.keys);
  keysCopiedLast = true;
  return true;
}

/** A clip copy happened: Paste means clips again. */
export function forgetCopiedKeys() {
  keysCopiedLast = false;
}

export const hasCopiedKeys = () => keysCopiedLast && !!board;

/** Paste copied keyframes onto the selected clip, the earliest at the
 * playhead. Returns false when the clipboard holds clips instead. */
export function pasteKeysAtPlayhead(): boolean {
  if (!keysCopiedLast || !board) return false;
  const s = store.get();
  const clip = s.selection.length === 1 ? findClip(s.project, s.selection[0])?.clip : undefined;
  if (!clip) {
    toast("Select one clip to paste keyframes onto");
    return true;
  }
  const { keys, refs } = pasteKeys(clip, board, s.playhead - clip.start);
  if (!refs.length) {
    toast("None of the copied keyframes fit this clip at the playhead");
    return true;
  }
  store.edit(refs.length > 1 ? "Paste keyframes" : "Paste keyframe", (p) => withKeys(p, clip.id, keys), { keySel: { clipId: clip.id, keys: refs } });
  return true;
}
