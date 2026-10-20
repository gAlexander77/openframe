// What each keymap action does. Edit actions are defined here on top of the
// store and ops; actions that need the engine or the platform (play, import,
// export) are filled in by the module that owns them at startup, so this
// file never imports the engine. Menus, shortcuts and toolbar buttons all
// call run(id) — one path, so they cannot disagree.

import { clampZoom } from "../lib/timeline";
import { GESTURE_CHORDS, ACTION_LABELS, buildIndex, chordOf, chordText, withChanges, type ActionId, type KeymapChanges } from "../lib/keymap";
import { breakCompound, breakProblem, compoundProblem, createCompound, newClipIds } from "../lib/project/compound";
import { createMarker, uid } from "../lib/project/defaults";
import { adjacentMarker } from "../lib/markers";
import { runCommand } from "../lib/commands";
import { enableToggle } from "../lib/clipEnable";
import { nudgeClips } from "../lib/project/gaps";
import { exportRange } from "../lib/export";
import { groupClips, regroupCopies, ungroupClips } from "../lib/project/groups";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project } from "../lib/project/types";
import { isMac } from "../platform/env";
import { copySelectedKeys, deleteSelectedKeys, forgetCopiedKeys, hasCopiedKeys, pasteKeysAtPlayhead } from "./keyframes";
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

// The viewer's own shortcuts over the defaults (the shortcuts panel edits
// them); per viewer, like the layout, never in the project.
const KEYMAP_KEY = "ve.keymap";
let keymapChanges: KeymapChanges = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEYMAP_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
})();
export let keymap = withChanges(keymapChanges);
let index = buildIndex(keymap);
export const currentKeymapChanges = () => keymapChanges;
export function setKeymapChanges(next: KeymapChanges) {
  keymapChanges = next;
  keymap = withChanges(next);
  index = buildIndex(keymap);
  try {
    localStorage.setItem(KEYMAP_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the shortcuts last this session */
  }
}

/** The first chord bound to an action, for tooltips and menus. */
export const chordFor = (id: ActionId) => keymap[id]?.[0];

/** A pointer gesture as this platform writes it ("Shift+click", "⇧click"). */
export const gestureText = (id: keyof typeof GESTURE_CHORDS) => chordText(GESTURE_CHORDS[id], isMac);

/** A tooltip with the action's current chord: "Split (Ctrl+B)". */
export function tipFor(id: ActionId | "viewerZoom", label = id === "viewerZoom" ? "Viewer zoom" : ACTION_LABELS[id]) {
  const c = id === "viewerZoom" ? GESTURE_CHORDS[id] : chordFor(id);
  return c ? `${label} (${chordText(c, isMac)})` : label;
}

// ---- clipboard (in-app; clips are not useful outside the editor) -------------

let clipboard: { clips: Clip[]; trackIds: Id[]; origin: number } | null = null;

export const canPaste = () => hasCopiedKeys() || !!clipboard;

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

/** Premiere's Lift (gap stays) or Extract (closes) of the in/out range on
 * every unlocked track; the marks go with it. */
function takeRange(ripple: boolean) {
  const s = store.get();
  if (s.inPoint === null && s.outPoint === null) return toast("Mark In and Out on the timeline first");
  const { from, to } = exportRange(s.project, "inout", s.inPoint, s.outPoint);
  if (to <= from) return;
  edit(ripple ? "Extract" : "Lift", (p) => ops.liftRange(p, from, to, ripple));
  store.set({ inPoint: null, outPoint: null });
  store.seek(from);
}

/** Premiere's Alt+arrow: the selected clips by frames, when they fit. */
function nudge(frames: number) {
  const ids = store.get().selection;
  if (ids.length) edit("Nudge", (p) => nudgeClips(p, ids, frames));
}

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
  // CapCut's Alt+G: the selection becomes one clip playing a nested
  // timeline (ADR-037).
  createCompound: () => {
    const s = store.get();
    const problem = compoundProblem(s.project, s.selection);
    if (problem) return void toast(problem);
    let made: Id | null = null;
    edit(ACTION_LABELS.createCompound, (p) => {
      const r = createCompound(p, s.selection);
      made = r.clipId;
      return r.project;
    });
    if (made) store.select([made]);
  },
  breakCompound: () => {
    const s = store.get();
    const ids = s.selection.filter((id) => ops.findClip(s.project, id)?.clip.type === "compound");
    const problem = ids.length ? ids.map((id) => breakProblem(s.project, id)).find(Boolean) : "Select a compound clip to break apart.";
    if (problem) return void toast(problem);
    const before = s.project;
    edit("Break apart", (p) => ids.reduce((q, id) => breakCompound(q, id), p));
    if (store.get().project !== before) store.select(newClipIds(before, store.get().project));
  },
  addMarker: () => {
    const f = store.get().playhead;
    store.edit("Add marker", (p) => ops.addMarker(p, createMarker(f)));
  },
  markIn: () => store.set({ inPoint: store.get().playhead }),
  markOut: () => store.set({ outPoint: store.get().playhead }),
  clearInOut: () => store.set({ inPoint: null, outPoint: null }),
  toggleLoop: () => store.set({ loop: !store.get().loop }),
  // The source monitor provides these while it is open.
  insertSource: () => toast("Open a clip in the source monitor first (double-click it in the library)"),
  overwriteSource: () => toast("Open a clip in the source monitor first (double-click it in the library)"),
  liftRange: () => takeRange(false),
  extractRange: () => takeRange(true),
  groupClips: () => {
    const ids = store.get().selection;
    if (ids.length > 1) store.edit("Group clips", (p) => groupClips(p, ids));
  },
  ungroupClips: () => store.edit("Ungroup clips", (p) => ungroupClips(p, store.get().selection)),
  nudgeLeft: () => nudge(-1),
  nudgeRight: () => nudge(1),
  nudgeLeft5: () => nudge(-5),
  nudgeRight5: () => nudge(5),

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
  toolStretch: () => store.set({ tool: "stretch" }),
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
  // One switch for the selection, through the command an agent runs
  // (ADR-109): toggling each clip turned a mixed selection inside out
  // under a menu item that named only the clicked clip.
  toggleClipEnabled: () => {
    const p = store.get().project;
    const clips = store.get().selection.map((id) => ops.findClip(p, id)?.clip).filter((c): c is Clip => !!c);
    if (!clips.length) return;
    const { enabled, label } = enableToggle(clips);
    store.edit(label, (q) => runCommand(q, "set_clip_enabled", { clip_ids: clips.map((c) => c.id), enabled }));
  },
  nextMarker: () => {
    const s = store.get();
    const m = adjacentMarker(s.project.markers, s.playhead, 1);
    if (m) store.set({ playhead: m.frame, hoverFrame: null });
  },
  prevMarker: () => {
    const s = store.get();
    const m = adjacentMarker(s.project.markers, s.playhead, -1);
    if (m) store.set({ playhead: m.frame, hoverFrame: null });
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
  zoomIn: () => store.set({ zoom: clampZoom(store.get().zoom * 1.25) }),
  zoomOut: () => store.set({ zoom: clampZoom(store.get().zoom / 1.25) }),
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
  const { trackIds, origin } = clipboard;
  const clips = regroupCopies(clipboard.clips);
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

/** The action a key press is bound to, for a dialog that answers a few of
 * the app's shortcuts itself (dialogs keep the rest from the editor). */
export const actionFor = (e: KeyboardEvent) => index.get(chordOf(e, isMac));

/** Home keeps project entry points, Help and Preferences (per viewer, not
 * per project), without editing the closed project. */
export function onHomeKeyDown(e: KeyboardEvent) {
  const id = index.get(chordOf(e, isMac));
  if (id !== "newProject" && id !== "openProject" && id !== "showShortcuts" && id !== "showPreferences") return;
  e.preventDefault();
  run(id);
}
