// What each keymap action does. Edit actions are defined here on top of the
// store and ops; actions that need the engine or the platform (play, import,
// export) are filled in by the module that owns them at startup, so this
// file never imports the engine. Menus, shortcuts and toolbar buttons all
// call run(id) — one path, so they cannot disagree.

import { ACTION_LABELS, buildIndex, chordOf, DEFAULT_KEYMAP, type ActionId } from "../lib/keymap";
import { createMarker, uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project } from "../lib/project/types";
import { isMac } from "../platform/env";
import { copySelectedKeys, deleteSelectedKeys, forgetCopiedKeys, pasteKeysAtPlayhead } from "./keyframes";
import { store } from "./store";
import { toast } from "./toast";

type Handler = () => void;
const handlers: Partial<Record<ActionId, Handler>> = {};

export function provide(map: Partial<Record<ActionId, Handler>>) {
  Object.assign(handlers, map);
}

/** Run an action. One that no module provides yet (export, until the export
 * round lands) says so rather than doing nothing: a silent primary button
 * reads as a crash. */
export function run(id: ActionId) {
  const handler = handlers[id];
  if (handler) handler();
  else toast(`${ACTION_LABELS[id]} isn't available yet`);
}

export const keymap = DEFAULT_KEYMAP;
const index = buildIndex(keymap);

/** The first chord bound to an action, for tooltips and menus. */
export const chordFor = (id: ActionId) => keymap[id]?.[0];

// ---- clipboard (in-app; clips are not useful outside the editor) -------------

let clipboard: { clips: Clip[]; trackIds: Id[]; origin: number } | null = null;

function selectedClips(p: Project) {
  const sel = new Set(store.get().selection);
  return p.tracks.flatMap((t) => t.clips.filter((c) => sel.has(c.id)).map((c) => ({ c, t })));
}

/** The magnet and linkage as currently toggled. */
export const settleOptions = () => ({ magnet: store.get().magnet, linkage: store.get().linkage });

/** An undoable edit that then applies the magnet and linkage, so every path
 * into the timeline (menus, keys, drags, library) behaves the same. */
export const edit = (label: string, fn: (p: Project) => Project) =>
  store.edit(label, (p) => {
    const next = fn(p);
    return next === p ? p : ops.settle(p, next, settleOptions());
  });

/** Frames to move per arrow press when nothing is playing. */
function stepBy(n: number) {
  const s = store.get();
  store.seek(s.playhead + n);
}

provide({
  undo: () => store.undo(),
  redo: () => store.redo(),

  split: () => {
    const s = store.get();
    const sel = s.selection.length ? s.selection : undefined;
    edit("Split", (p) => ops.splitAt(p, s.playhead, sel));
  },
  trimStartToPlayhead: () => {
    const s = store.get();
    edit(ACTION_LABELS.trimStartToPlayhead, (p) => {
      for (const { c } of targetsAtPlayhead(p)) p = ops.trimClip(p, c.id, "start", s.playhead, true);
      return p;
    });
  },
  trimEndToPlayhead: () => {
    const s = store.get();
    edit(ACTION_LABELS.trimEndToPlayhead, (p) => {
      for (const { c } of targetsAtPlayhead(p)) p = ops.trimClip(p, c.id, "end", s.playhead, true);
      return p;
    });
  },
  delete: () => {
    if (deleteSelectedKeys()) return;
    const sel = store.get().selection;
    if (sel.length) edit("Delete", (p) => ops.pruneEmptyTracks(ops.deleteClips(p, sel)));
  },
  rippleDelete: () => {
    const sel = store.get().selection;
    if (sel.length) edit("Ripple delete", (p) => ops.pruneEmptyTracks(ops.deleteClips(p, sel, true)));
  },
  selectAll: () => store.select(store.get().project.tracks.flatMap((t) => t.clips.map((c) => c.id))),
  // Escape lets go of selected keyframes first, then of clips.
  deselect: () => (store.get().keySel ? store.set({ keySel: null }) : store.select([])),
  copy: () => {
    if (!copySelectedKeys()) copyClips();
  },
  cut: () => {
    run("copy");
    const sel = store.get().selection;
    if (sel.length) edit("Cut", (p) => ops.pruneEmptyTracks(ops.deleteClips(p, sel)));
  },
  paste: () => {
    if (!pasteKeysAtPlayhead()) pasteAt(store.get().playhead);
  },
  duplicate: () => {
    copyClips();
    if (clipboard) pasteAt(Math.max(...clipboard.clips.map((c) => c.start + c.duration)), "Duplicate");
  },
  freeze: () => {
    const s = store.get();
    const hit = targetsAtPlayhead(s.project).find(({ c }) => c.type === "video");
    if (hit) edit("Freeze frame", (p) => ops.freezeFrame(p, hit.c.id, s.playhead, Math.round((3 * p.fps.num) / p.fps.den)));
  },
  detachAudio: () => {
    for (const id of store.get().selection) edit("Extract audio", (p) => ops.detachAudio(p, id));
  },
  addMarker: () => {
    const f = store.get().playhead;
    store.edit("Add marker", (p) => ops.addMarker(p, createMarker(f)));
  },
  markIn: () => store.set({ inPoint: store.get().playhead }),
  markOut: () => store.set({ outPoint: store.get().playhead }),
  clearInOut: () => store.set({ inPoint: null, outPoint: null }),

  stepBack: () => stepBy(-1),
  stepForward: () => stepBy(1),
  stepBack10: () => stepBy(-10),
  stepForward10: () => stepBy(10),
  goStart: () => store.seek(0),
  goEnd: () => store.seek(ops.projectDuration(store.get().project)),
  prevEdit: () => {
    const s = store.get();
    const pts = ops.editPoints(s.project).filter((x) => x < s.playhead);
    store.seek(pts.at(-1) ?? 0);
  },
  nextEdit: () => {
    const s = store.get();
    const pts = ops.editPoints(s.project).filter((x) => x > s.playhead);
    if (pts.length) store.seek(pts[0]);
  },

  toolSelect: () => store.set({ tool: "select" }),
  toolBlade: () => store.set({ tool: "blade" }),
  toolRipple: () => store.set({ tool: "ripple" }),
  toolRoll: () => store.set({ tool: "roll" }),
  toolSlip: () => store.set({ tool: "slip" }),
  toolSlide: () => store.set({ tool: "slide" }),
  toggleSnapping: () => store.set({ snapping: !store.get().snapping }),
  toggleMagnet: () => {
    const on = !store.get().magnet;
    store.set({ magnet: on });
    // Turning the magnet on closes the main track's gaps, as in CapCut.
    if (on) store.edit("Main track magnet", (p) => {
      const q = ops.compactTrack(p, ops.mainTrack(p).id);
      return ops.mainTrack(q).clips.every((c, i) => c.start === ops.mainTrack(p).clips[i].start) ? p : q;
    });
  },
  toggleLinkage: () => store.set({ linkage: !store.get().linkage }),
  togglePreviewAxis: () => store.set({ previewAxis: !store.get().previewAxis, hoverFrame: null }),
  toggleKeyframePanel: () => store.set({ keyframePanel: !store.get().keyframePanel }),
  splitAll: () => {
    const f = store.get().playhead;
    edit("Split all", (p) => ops.splitAt(p, f));
  },
  selectLeft: () => {
    const f = store.get().playhead;
    store.select(store.get().project.tracks.flatMap((t) => t.clips.filter((c) => c.start < f).map((c) => c.id)));
  },
  selectRight: () => {
    const f = store.get().playhead;
    store.select(store.get().project.tracks.flatMap((t) => t.clips.filter((c) => c.start + c.duration > f).map((c) => c.id)));
  },
  toggleClipEnabled: () => {
    const sel = store.get().selection;
    if (!sel.length) return;
    store.edit("Deactivate clip", (p) => {
      for (const id of sel) p = ops.updateClip(p, id, (c) => ({ ...c, disabled: !c.disabled }));
      return p;
    });
  },
  nextMarker: () => {
    const s = store.get();
    const m = s.project.markers.find((x) => x.frame > s.playhead);
    if (m) store.seek(m.frame);
  },
  prevMarker: () => {
    const s = store.get();
    const m = [...s.project.markers].reverse().find((x) => x.frame < s.playhead);
    if (m) store.seek(m.frame);
  },
  rangeToClip: () => {
    const s = store.get();
    const items = selectedClips(s.project);
    if (!items.length) return;
    store.set({
      inPoint: Math.min(...items.map((i) => i.c.start)),
      outPoint: Math.max(...items.map((i) => i.c.start + i.c.duration)),
    });
  },
  zoomIn: () => store.set({ zoom: Math.min(64, store.get().zoom * 1.25) }),
  zoomOut: () => store.set({ zoom: Math.max(0.02, store.get().zoom / 1.25) }),
});

function copyClips() {
  const items = selectedClips(store.get().project);
  if (!items.length) return;
  clipboard = {
    clips: items.map((i) => i.c),
    trackIds: items.map((i) => i.t.id),
    origin: Math.min(...items.map((i) => i.c.start)),
  };
  forgetCopiedKeys();
}

/** Paste the clipboard so its earliest clip starts at `at`, each clip on the
 * track it was copied from, spilling to new tracks rather than overwriting. */
function pasteAt(at: number, label = "Paste") {
  if (!clipboard) return;
  const { clips, trackIds, origin } = clipboard;
  const pasted: Id[] = [];
  edit(label, (p) => {
    clips.forEach((c, i) => {
      const copy = { ...c, id: uid("c"), start: at + c.start - origin } as Clip;
      pasted.push(copy.id);
      const track = ops.findTrack(p, trackIds[i]) ?? p.tracks[0];
      p = ops.placeClip(p, track.id, copy, { collision: "newTrack", magnet: store.get().magnet });
    });
    return p;
  });
  store.select(pasted);
}

/** Clips under the playhead: the selection if any is there, else all of them
 * on unlocked tracks (CapCut's Q/W act on the main track clip by default). */
function targetsAtPlayhead(p: Project) {
  const f = store.get().playhead;
  const under = p.tracks.flatMap((t) =>
    t.locked ? [] : t.clips.filter((c) => c.start < f && f < c.start + c.duration).map((c) => ({ c, t })),
  );
  const sel = new Set(store.get().selection);
  const picked = under.filter((x) => sel.has(x.c.id));
  return picked.length ? picked : under.filter((x) => x.t.main).length ? under.filter((x) => x.t.main) : under;
}

/** Inputs whose keys are not text: a focused slider or swatch must not
 * swallow play, shuttle and the other shortcuts, as CapCut's never do. */
const NOT_TEXT = new Set(["range", "checkbox", "radio", "color", "button", "submit", "reset", "file"]);
/** The keys a focused slider or dropdown uses itself. */
const CONTROL_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Global key handling. Typing in a text field is left alone, Escape
 * included: it is the field's (revert, cancel, leave), and passing it on
 * deselected the clip and closed the inspector being typed in. Sliders and
 * dropdowns keep only the keys they move by, and Enter on a focused button
 * or link presses it rather than opening a title for typing. */
export function onKeyDown(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  const input = el instanceof HTMLInputElement ? el : null;
  const typing = !!el && ((!!input && !NOT_TEXT.has(input.type)) || el.tagName === "TEXTAREA" || el.isContentEditable);
  if (typing) return;
  if ((input?.type === "range" || el?.tagName === "SELECT") && CONTROL_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey) return;
  if (e.key === "Enter" && el?.closest?.("button, a, select, [role=button]")) return;
  const id = index.get(chordOf(e, isMac));
  if (!id) return;
  e.preventDefault();
  run(id);
}
