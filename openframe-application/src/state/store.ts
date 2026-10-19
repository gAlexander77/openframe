// The one app store. The project document plus the editor state around it
// (selection, playhead, tools, panels) and undo history. Components subscribe
// to a slice with `useEditor(selector)`; React re-renders only when that
// slice changes, so a playhead ticking at 60 fps repaints the ruler and the
// timecode, not the whole app. No state library: useSyncExternalStore is the
// whole mechanism (ADR-005).

import { useSyncExternalStore } from "react";
import { projectWork } from "./projectWork";
import { toast } from "./toast";
import { closePath, compoundView, innerFrameAt, nestsItself, openPath, pruneCompounds, withCompoundView, type NestLevel } from "../lib/project/compound";
import { createProject } from "../lib/project/defaults";
import { DEFAULT_MEDIA_BROWSER, type MediaBrowser } from "../lib/mediaLibrary";
import { clipEnd, findClip, findCompound, projectDuration } from "../lib/project/ops";
import type { KeyRef } from "../lib/keyframeEdit";
import type { Guides } from "../lib/align";
import type { CropRatio } from "../lib/crop";
import type { Crop, Id, Project } from "../lib/project/types";
import type { TrimPreviewState } from "../lib/trimPreview";

/** select and blade are CapCut's; ripple, roll, slip and slide are the
 * Premiere/VEGAS trim tools CapCut lacks. */
export type Tool = "select" | "blade" | "ripple" | "roll" | "slip" | "slide" | "stretch";
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
  | "markers"
  | "ai";

/** A compound clip opened for editing (ADR-037): the level the document
 * needs back, and what the timeline above was showing. */
export interface NestEntry extends NestLevel {
  /** The compound clip that was opened, selected again on the way out. */
  clipId: Id;
  playhead: number;
  inPoint: number | null;
  outPoint: number | null;
}

export interface EditorState {
  /** The timeline being edited: the document itself, or inside compound
   * clips (`nest`) a view of it whose tracks and markers are the innermost
   * compound's. Every edit applies to it; `store.document()` is the whole. */
  project: Project;
  /** Compound clips opened for editing, outermost first; empty on the
   * project's own timeline. */
  nest: NestEntry[];
  selection: Id[];
  /** Explicit request to open transition settings; cleared by normal selection. */
  transitionEdit: Id | null;
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
  trimPreview: TrimPreviewState | null;
  /** Preview at a fraction of project resolution (pro editors' playback
   * resolution: full, 1/2, 1/4). */
  previewScale: 1 | 0.5 | 0.25;
  /** The Scopes panel is showing (in the media library's place). */
  scopes: boolean;
  mixer: boolean;
  /** Viewer overlays only: never saved into the project or rendered. */
  viewerGuides: Guides;
  leftTab: LeftTab;
  /** Shared Media/Audio browsing preferences, never serialized as edits. */
  mediaBrowser: MediaBrowser;
  /** Marker opened in the library editor; independent of clip selection. */
  markerEdit: Id | null;
  /** Playback starts over at the end: of the in/out range when it holds
   * the playhead, else of the timeline. Per session, never saved. */
  loop: boolean;
  /** Viewer magnification in screen pixels per project pixel (null: fit
   * the stage), and how far the picture is panned from center. Per
   * session, never saved. */
  viewerZoom: number | null;
  viewerPan: { x: number; y: number };
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
  /** The crop being drawn on the viewer (`state/cropEdit.ts`, ADR-048):
   * a copy of the clip's crop until Done, while the viewer shows that clip
   * uncropped. Never part of the project. */
  cropEdit: CropSession | null;
  /** The inspector's Mask tab is open: the viewer draws the selected
   * clip's mask with its handles instead of the transform box. */
  maskHandles: boolean;
}

export interface CropSession {
  id: Id;
  crop: Crop;
  /** The shape the handles keep. */
  ratio: CropRatio;
}

/** Undo snapshots hold the whole document, whichever timeline was open, so
 * one history covers every level and undo never depends on where it is. */
interface HistoryEntry {
  project: Project;
  label: string;
}

const HISTORY_LIMIT = 200;

let state: EditorState = {
  project: createProject(),
  nest: [],
  selection: [],
  transitionEdit: null,
  playhead: 0,
  playing: false,
  zoom: 4,
  tool: "select",
  magnet: true,
  snapping: true,
  linkage: true,
  previewAxis: false,
  hoverFrame: null,
  trimPreview: null,
  previewScale: 1,
  scopes: false,
  mixer: false,
  viewerGuides: "off",
  leftTab: "media",
  mediaBrowser: { ...DEFAULT_MEDIA_BROWSER },
  markerEdit: null,
  loop: false,
  viewerZoom: null,
  viewerPan: { x: 0, y: 0 },
  inPoint: null,
  outPoint: null,
  undoLabel: null,
  redoLabel: null,
  revision: 0,
  keyframePanel: false,
  keySel: null,
  textEdit: null,
  cropEdit: null,
  maskHandles: false,
};

let past: HistoryEntry[] = [];
let future: HistoryEntry[] = [];
/** Project at the start of a drag gesture; previews derive from it. */
let gestureBase: Project | null = null;
/** The document at the start of the gesture, for its undo entry. */
let gestureDoc: Project | null = null;
/** An open run (beginRun): its edits undo as one step, this entry, which
 * holds the document from before the first (null until that edit). */
let run: { entry: HistoryEntry | null } | null = null;

/** Record `doc` (the document before an edit) as an undo step, or, inside
 * a run that already has its step, fold the edit into that one. */
function record(doc: Project, label: string) {
  if (run?.entry && past.at(-1) === run.entry) run.entry.label = label;
  else {
    const entry = { project: doc, label };
    past.push(entry);
    if (past.length > HISTORY_LIMIT) past.shift();
    if (run) run.entry = entry;
  }
  future = [];
}

/** The whole document, put back together from the open view (memoized). */
let docCache: { project: Project; nest: NestEntry[]; doc: Project } | null = null;
export function documentOf(s: EditorState): Project {
  if (!s.nest.length) return s.project;
  if (docCache?.project !== s.project || docCache.nest !== s.nest) docCache = { project: s.project, nest: s.nest, doc: closePath(s.project, s.nest) };
  return docCache.doc;
}

/** The view of `doc` at the open compounds, as deep as they still exist. */
function reopen(doc: Project): Pick<EditorState, "project" | "nest"> {
  if (!state.nest.length) return { project: doc, nest: state.nest };
  const { view, levels } = openPath(doc, state.nest.map((e) => e.id));
  const nest = levels.map((l, i) => ({ ...state.nest[i], ...l }));
  return { project: view, nest };
}

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

  /** The whole document: what is saved, exported and described to agents,
   * whichever timeline is open. */
  document: () => documentOf(state),

  /** Apply an edit with undo. `fn` returns the same object for a no-op,
   * which records nothing. Inside a compound clip, an edit that would make
   * an open compound play itself is refused. */
  edit(label: string, fn: (p: Project) => Project, extra: Partial<EditorState> = {}) {
    let next = fn(state.project);
    if (next === state.project) return;
    if (state.nest.length && nestsItself(next, state.nest)) {
      toast("A compound clip can't contain itself.", "error");
      return;
    }
    record(documentOf(state), label);
    // Compounds nothing plays any more go, judged on the whole document:
    // a view cannot see the timelines above it.
    if (!state.nest.length) next = pruneCompounds(next);
    setProject({ ...next, updatedAt: Date.now() }, extra);
  },

  /** An edit of the whole document rather than the open timeline (media
   * that every level uses), with undo. */
  editDocument(label: string, fn: (doc: Project) => Project) {
    const doc = documentOf(state);
    const next = fn(doc);
    if (next === doc) return;
    record(doc, label);
    const { project, nest } = reopen(pruneCompounds({ ...next, updatedAt: Date.now() }));
    setProject(project, { nest });
  },

  /** Drags: every pointer move recomputes from the gesture's starting
   * project, so nothing accumulates rounding, and the whole drag is one undo
   * step when it ends. */
  beginGesture() {
    gestureBase = state.project;
    gestureDoc = documentOf(state);
  },
  /** A step of the open drag. Without one, a control's change that came
   * with no press (a script setting its value, assistive technology) is
   * one edit of its own when `label` names it, and nothing otherwise. */
  previewGesture(fn: (p: Project) => Project, label?: string) {
    if (gestureBase) setProject(fn(gestureBase));
    else if (label) store.edit(label, fn);
  },
  endGesture(label: string) {
    const base = gestureBase;
    const doc = gestureDoc;
    gestureBase = gestureDoc = null;
    if (!base || !doc || base === state.project) return;
    record(doc, label);
    setProject({ ...state.project, updatedAt: Date.now() });
  },
  cancelGesture() {
    if (gestureBase) setProject(gestureBase);
    gestureBase = gestureDoc = null;
    set({ trimPreview: null });
  },

  /** A run of whole edits that undoes as one step (ADR-072): a native color
   * picker sends a value per pointer move, each an ordinary edit through its
   * caller's path, and the run folds them into one undo entry until endRun.
   * Opening one inside an open run does nothing; undo, redo and load end it. */
  beginRun() {
    run ??= { entry: null };
  },
  endRun() {
    run = null;
  },

  /** The undo and redo steps, nearest first (Premiere's History panel). */
  history: () => ({ undo: past.map((e) => e.label).reverse(), redo: future.map((e) => e.label).reverse() }),

  undo() {
    run = null;
    const entry = past.pop();
    if (!entry) return;
    future.push({ project: documentOf(state), label: entry.label });
    restore(entry.project);
  },
  redo() {
    run = null;
    const entry = future.pop();
    if (!entry) return;
    past.push({ project: documentOf(state), label: entry.label });
    restore(entry.project);
  },

  /**
   * Open a compound clip for editing (double-click, CapCut's Edit compound
   * clip): the timeline shows its nested timeline, the playhead on the
   * inner frame it was showing. Returns false when `clipId` is not one.
   */
  openCompound(clipId: Id): boolean {
    const loc = findClip(state.project, clipId);
    if (!loc || loc.clip.type !== "compound" || !findCompound(state.project, loc.clip.compoundId)) return false;
    const c = loc.clip;
    const p = state.project;
    const entry: NestEntry = { id: c.compoundId, tracks: p.tracks, markers: p.markers, fps: p.fps, clipId, playhead: state.playhead, inPoint: state.inPoint, outPoint: state.outPoint };
    const view = compoundView(p, c.compoundId);
    const at = state.playhead >= c.start && state.playhead < clipEnd(c) ? innerFrameAt(c, state.playhead, p.fps) : 0;
    set({ ...away, project: view, nest: [...state.nest, entry], selection: [], playhead: Math.max(0, Math.min(at, projectDuration(view))) });
    return true;
  },

  /** Go back out to nesting level `depth` (0: the project's own timeline),
   * the breadcrumb's job. The level left gets its playhead, range and the
   * compound clip selected back. */
  closeCompound(depth = state.nest.length - 1) {
    if (depth < 0 || depth >= state.nest.length) return;
    let view = state.project;
    for (let i = state.nest.length - 1; i >= depth; i--) {
      const l = state.nest[i];
      view = withCompoundView({ ...view, tracks: l.tracks, markers: l.markers, fps: l.fps }, l.id, view);
    }
    const back = state.nest[depth];
    const doc = depth === 0 ? pruneCompounds(view) : view;
    set({
      ...away,
      project: doc,
      nest: state.nest.slice(0, depth),
      selection: [back.clipId],
      playhead: back.playhead,
      inPoint: back.inPoint,
      outPoint: back.outPoint,
      ...(doc !== view ? { revision: state.revision + 1 } : {}),
    });
  },

  /** Replace the document wholesale (open, new). History starts over. */
  load(project: Project) {
    projectWork.open();
    gestureBase = gestureDoc = null;
    run = null;
    past = [];
    future = [];
    set({
      project,
      nest: [],
      selection: [],
      transitionEdit: null,
      playhead: 0,
      playing: false,
      inPoint: null,
      outPoint: null,
      keySel: null,
      textEdit: null,
      cropEdit: null,
      trimPreview: null,
      markerEdit: null,
      mediaBrowser: { ...DEFAULT_MEDIA_BROWSER, view: state.mediaBrowser.view, sort: state.mediaBrowser.sort },
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
    set({ selection: ids, keySel: null, transitionEdit: null });
  },
};

/** The project's own timeline's in and out points, wherever the editor is:
 * export renders the project, not the compound clip open in it. */
export const rootInPoint = (s: EditorState) => (s.nest.length ? s.nest[0].inPoint : s.inPoint);
export const rootOutPoint = (s: EditorState) => (s.nest.length ? s.nest[0].outPoint : s.outPoint);

/** Editor state that belongs to one timeline: moving between levels drops it. */
const away: Partial<EditorState> = { keySel: null, textEdit: null, trimPreview: null, markerEdit: null, hoverFrame: null, inPoint: null, outPoint: null };

/** Put a document from history back, staying as deep in compound clips as
 * it still allows (an undone Create compound clip takes you out). */
function restore(doc: Project) {
  const depth = state.nest.length;
  const { project, nest } = reopen(doc);
  if (nest.length === depth) return setProject(project, { nest });
  const back = state.nest[nest.length];
  setProject(project, { ...away, nest, playhead: back.playhead, inPoint: back.inPoint, outPoint: back.outPoint });
}

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
