// The one app store. The project document plus the editor state around it
// (selection, playhead, tools, panels) and undo history. Components subscribe
// to a slice with `useEditor(selector)`; React re-renders only when that
// slice changes, so a playhead ticking at 60 fps repaints the ruler and the
// timecode, not the whole app. No state library: useSyncExternalStore is the
// whole mechanism (ADR-005).

import { useSyncExternalStore } from "react";
import { createProject } from "../lib/project/defaults";
import { projectDuration } from "../lib/project/ops";
import type { KeyRef } from "../lib/keyframeEdit";
import type { Id, Project } from "../lib/project/types";

/** select and blade are CapCut's; ripple, roll, slip and slide are the
 * Premiere/VEGAS trim tools CapCut lacks. */
export type Tool = "select" | "blade" | "ripple" | "roll" | "slip" | "slide";
export type LeftTab =
  | "media"
  | "audio"
  | "text"
  | "stickers"
  | "effects"
  | "transitions"
  | "filters"
  | "adjustment"
  | "captions"
  | "ai";

export interface EditorState {
  project: Project;
  selection: Id[];
  /** Current frame. */
  playhead: number;
  playing: boolean;
  /** Pixels per frame on the timeline. */
  zoom: number;
  tool: Tool;
  magnet: boolean;
  snapping: boolean;
  /** CapCut's linkage: overlays above a main-track clip move with it. */
  linkage: boolean;
  /** CapCut's preview axis: hovering the timeline previews that frame. */
  previewAxis: boolean;
  /** Frame under the mouse while the preview axis is on, else null. */
  hoverFrame: number | null;
  /** Preview at a fraction of project resolution (pro editors' playback
   * resolution: full, 1/2, 1/4). */
  previewScale: 1 | 0.5 | 0.25;
  leftTab: LeftTab;
  /** In/out range for export and three-point edits, frames. */
  inPoint: number | null;
  outPoint: number | null;
  /** Last change the user can undo, for the history list and toasts. */
  undoLabel: string | null;
  redoLabel: string | null;
  /** Bumped on every project change so autosave can debounce on it. */
  revision: number;
  /** CapCut's keyframe animation panel under the timeline tracks. */
  keyframePanel: boolean;
  /** Selected keyframes, on one clip at a time. Cleared whenever the clip
   * selection changes; refs to keys an undo removed are simply ignored. */
  keySel: { clipId: Id; keys: KeyRef[] } | null;
  /** The text clip being typed into on the canvas, else null
   * (`state/textEdit.ts`, ADR-031). */
  textEdit: Id | null;
}

interface HistoryEntry {
  project: Project;
  label: string;
}

const HISTORY_LIMIT = 200;

let state: EditorState = {
  project: createProject(),
  selection: [],
  playhead: 0,
  playing: false,
  zoom: 4,
  tool: "select",
  magnet: true,
  snapping: true,
  linkage: true,
  previewAxis: false,
  hoverFrame: null,
  previewScale: 1,
  leftTab: "media",
  inPoint: null,
  outPoint: null,
  undoLabel: null,
  redoLabel: null,
  revision: 0,
  keyframePanel: false,
  keySel: null,
  textEdit: null,
};

let past: HistoryEntry[] = [];
let future: HistoryEntry[] = [];
/** Project at the start of a drag gesture; previews derive from it. */
let gestureBase: Project | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<EditorState>) {
  state = { ...state, ...patch };
  emit();
}

function labels(): Pick<EditorState, "undoLabel" | "redoLabel"> {
  return {
    undoLabel: past.at(-1)?.label ?? null,
    redoLabel: future.at(-1)?.label ?? null,
  };
}

/** Drop selected ids that no longer exist after an edit. */
function liveSelection(p: Project, sel: Id[]): Id[] {
  if (!sel.length) return sel;
  const ids = new Set(p.tracks.flatMap((t) => t.clips.map((c) => c.id)));
  const kept = sel.filter((id) => ids.has(id));
  return kept.length === sel.length ? sel : kept;
}

function setProject(project: Project, extra: Partial<EditorState> = {}) {
  set({
    project,
    selection: liveSelection(project, extra.selection ?? state.selection),
    revision: state.revision + 1,
    ...labels(),
    ...extra,
  });
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  set,

  /** Apply an edit with undo. `fn` returns the same object for a no-op,
   * which records nothing. */
  edit(label: string, fn: (p: Project) => Project, extra: Partial<EditorState> = {}) {
    const next = fn(state.project);
    if (next === state.project) return;
    past.push({ project: state.project, label });
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    setProject({ ...next, updatedAt: Date.now() }, extra);
  },

  /** Drags: every pointer move recomputes from the gesture's starting
   * project, so nothing accumulates rounding, and the whole drag is one undo
   * step when it ends. */
  beginGesture() {
    gestureBase = state.project;
  },
  previewGesture(fn: (p: Project) => Project) {
    if (!gestureBase) return;
    setProject(fn(gestureBase));
  },
  endGesture(label: string) {
    const base = gestureBase;
    gestureBase = null;
    if (!base || base === state.project) return;
    past.push({ project: base, label });
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
    setProject({ ...state.project, updatedAt: Date.now() });
  },
  cancelGesture() {
    if (gestureBase) setProject(gestureBase);
    gestureBase = null;
  },

  undo() {
    const entry = past.pop();
    if (!entry) return;
    future.push({ project: state.project, label: entry.label });
    setProject(entry.project);
  },
  redo() {
    const entry = future.pop();
    if (!entry) return;
    past.push({ project: state.project, label: entry.label });
    setProject(entry.project);
  },

  /** Replace the document wholesale (open, new). History starts over. */
  load(project: Project) {
    past = [];
    future = [];
    set({
      project,
      selection: [],
      playhead: 0,
      playing: false,
      inPoint: null,
      outPoint: null,
      keySel: null,
      textEdit: null,
      revision: state.revision + 1,
      ...labels(),
    });
  },

  seek(frame: number) {
    const end = Math.max(0, projectDuration(state.project));
    const f = Math.max(0, Math.min(Math.round(frame), end));
    if (f !== state.playhead) set({ playhead: f });
  },

  select(ids: Id[]) {
    set({ selection: ids, keySel: null });
  },
};

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
