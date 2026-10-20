// Keymap: action id -> chord. Defaults are CapCut desktop's in-app list
// (docs/research/CapCut desktop.md §7) wherever CapCut has the action, and
// Premiere Pro's where it does not (Ctrl+K split, Shift+Delete ripple
// delete, C blade). "Mod" is Ctrl on Windows/Linux and Cmd on macOS.
// UI prose never types a chord: it calls chordLabel(id) (Conventions rule 8).

export const GESTURE_CHORDS = { viewerZoom: "Mod+wheel", addKey: "Shift+click" } as const;

export type ActionId =
  | "playPause"
  | "stepBack"
  | "stepForward"
  | "stepBack10"
  | "stepForward10"
  | "prevEdit"
  | "nextEdit"
  | "goStart"
  | "goEnd"
  | "shuttleBack"
  | "shuttleStop"
  | "shuttleForward"
  | "markIn"
  | "markOut"
  | "clearInOut"
  | "addMarker"
  | "split"
  | "splitAll"
  | "trimStartToPlayhead"
  | "trimEndToPlayhead"
  | "delete"
  | "rippleDelete"
  | "duplicate"
  | "copy"
  | "cut"
  | "paste"
  | "selectAll"
  | "deselect"
  | "undo"
  | "redo"
  | "freeze"
  | "detachAudio"
  | "createCompound"
  | "breakCompound"
  | "editText"
  | "toolSelect"
  | "toolBlade"
  | "toolRipple"
  | "toolRoll"
  | "toolSlip"
  | "toolSlide"
  | "toolStretch"
  | "toggleSnapping"
  | "toggleMagnet"
  | "toggleLinkage"
  | "togglePreviewAxis"
  | "toggleKeyframePanel"
  | "selectLeft"
  | "selectRight"
  | "toggleClipEnabled"
  | "nextMarker"
  | "prevMarker"
  | "rangeToClip"
  | "zoomIn"
  | "zoomOut"
  | "zoomFit"
  | "importMedia"
  | "newProject"
  | "openProject"
  | "saveProject"
  | "export"
  | "fullscreenPreview"
  | "insertSource"
  | "overwriteSource"
  | "liftRange"
  | "extractRange"
  | "groupClips"
  | "ungroupClips"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeLeft5"
  | "nudgeRight5"
  | "toggleLoop"
  | "playInToOut"
  | "showShortcuts"
  | "showPreferences"
  | "saveFrame";

export const DEFAULT_KEYMAP: Record<ActionId, string[]> = {
  playPause: ["Space"],
  stepBack: ["ArrowLeft"],
  stepForward: ["ArrowRight"],
  stepBack10: ["Shift+ArrowLeft"],
  stepForward10: ["Shift+ArrowRight"],
  prevEdit: ["ArrowUp"],
  nextEdit: ["ArrowDown"],
  goStart: ["Home"],
  goEnd: ["End"],
  shuttleBack: ["J"],
  shuttleStop: ["K"],
  shuttleForward: ["L"],
  markIn: ["I"],
  markOut: ["O"],
  clearInOut: ["Alt+X"],
  rangeToClip: ["Shift+X"],
  addMarker: ["M"],
  nextMarker: ["Shift+M"],
  prevMarker: ["Alt+Shift+M"],
  split: ["Mod+B", "Mod+K"],
  splitAll: ["Mod+Shift+B"],
  trimStartToPlayhead: ["Q"],
  trimEndToPlayhead: ["W"],
  delete: ["Delete", "Backspace"],
  rippleDelete: ["Shift+Delete", "Shift+Backspace"],
  duplicate: ["Mod+D"],
  copy: ["Mod+C"],
  cut: ["Mod+X"],
  paste: ["Mod+V"],
  selectAll: ["Mod+A"],
  deselect: ["Escape"],
  undo: ["Mod+Z"],
  redo: ["Mod+Shift+Z", "Mod+Y"],
  freeze: ["Alt+F"],
  detachAudio: ["Mod+Shift+S"],
  // CapCut's Create compound clip and Undo compound clip; Premiere's Nest
  // has no default chord.
  createCompound: ["Alt+G"],
  breakCompound: ["Alt+Shift+G"],
  // Not in CapCut's list (it double-clicks); Figma's and Keynote's key for
  // typing into the selected text box, and Enter is free here.
  editText: ["Enter"],
  toolSelect: ["A"],
  toggleClipEnabled: ["V"],
  selectLeft: ["["],
  selectRight: ["]"],
  toolBlade: ["B", "C"],
  // Premiere's Y slip and U slide; R and T are free in CapCut's map (its N
  // and B, Premiere's roll and ripple keys, are snapping and blade there).
  toolRipple: ["T"],
  toolRoll: ["R"],
  toolSlip: ["Y"],
  toolSlide: ["U"],
  // Premiere's Rate Stretch is R, our roll; Shift+R keeps it next to it.
  toolStretch: ["Shift+R"],
  toggleSnapping: ["N"],
  toggleLinkage: ["`"],
  togglePreviewAxis: ["S"],
  toggleMagnet: ["P"],
  toggleKeyframePanel: ["Alt+K"],
  zoomIn: ["Mod+=", "="],
  zoomOut: ["Mod+-", "-"],
  zoomFit: ["Shift+Z"],
  importMedia: ["Mod+I"],
  newProject: ["Mod+N"],
  openProject: ["Mod+O"],
  saveProject: ["Mod+S"],
  export: ["Mod+E"],
  fullscreenPreview: ["Mod+Shift+F"],
  // Premiere's Lift and Extract of the in/out range.
  // Premiere's Insert and Overwrite from the source monitor.
  insertSource: [","],
  overwriteSource: ["."],
  liftRange: [";"],
  extractRange: ["'"],
  // Premiere's Group and Ungroup.
  groupClips: ["Mod+G"],
  ungroupClips: ["Mod+Shift+G"],
  // Premiere's clip nudge: Alt+arrows a frame, with Shift five.
  nudgeLeft: ["Alt+ArrowLeft"],
  nudgeRight: ["Alt+ArrowRight"],
  nudgeLeft5: ["Alt+Shift+ArrowLeft"],
  nudgeRight5: ["Alt+Shift+ArrowRight"],
  // Resolve loops with Ctrl+/ (ours is the shortcut list); Mod+L is free.
  // Play In to Out is Premiere's Ctrl+Shift+Space.
  toggleLoop: ["Mod+L"],
  playInToOut: ["Mod+Shift+Space"],
  showShortcuts: ["Mod+/"],
  showPreferences: ["Mod+,"],
  // Premiere's Export Frame.
  saveFrame: ["Mod+Shift+E"],
};

export const ACTION_LABELS: Record<ActionId, string> = {
  playPause: "Play / pause",
  stepBack: "Previous frame",
  stepForward: "Next frame",
  stepBack10: "Back 10 frames",
  stepForward10: "Forward 10 frames",
  prevEdit: "Previous edit point",
  nextEdit: "Next edit point",
  goStart: "Go to start",
  goEnd: "Go to end",
  shuttleBack: "Shuttle backward",
  shuttleStop: "Shuttle stop",
  shuttleForward: "Shuttle forward",
  markIn: "Mark in",
  markOut: "Mark out",
  clearInOut: "Clear range",
  rangeToClip: "Set range to clip",
  addMarker: "Add marker",
  nextMarker: "Next marker",
  prevMarker: "Previous marker",
  split: "Split",
  splitAll: "Split all tracks",
  trimStartToPlayhead: "Delete left",
  trimEndToPlayhead: "Delete right",
  delete: "Delete",
  rippleDelete: "Ripple delete",
  duplicate: "Duplicate",
  copy: "Copy",
  cut: "Cut",
  paste: "Paste",
  selectAll: "Select all",
  deselect: "Deselect",
  undo: "Undo",
  redo: "Redo",
  freeze: "Freeze frame",
  detachAudio: "Extract audio",
  createCompound: "Create compound clip",
  breakCompound: "Break apart compound clip",
  editText: "Edit text",
  toolSelect: "Selection tool",
  toggleClipEnabled: "Activate / deactivate clip",
  selectLeft: "Select clips to the left",
  selectRight: "Select clips to the right",
  toolBlade: "Split tool",
  toolRipple: "Ripple trim tool",
  toolRoll: "Roll tool",
  toolSlip: "Slip tool",
  toolSlide: "Slide tool",
  toolStretch: "Rate stretch tool",
  toggleSnapping: "Auto snapping",
  toggleLinkage: "Linkage",
  togglePreviewAxis: "Preview axis",
  toggleMagnet: "Main track magnet",
  toggleKeyframePanel: "Keyframe animation",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Zoom to fit",
  importMedia: "Import media",
  newProject: "New project",
  openProject: "Open project",
  saveProject: "Save project",
  export: "Export",
  fullscreenPreview: "Full-screen preview",
  insertSource: "Insert source at playhead",
  overwriteSource: "Overwrite source at playhead",
  liftRange: "Lift in to out",
  extractRange: "Extract in to out",
  groupClips: "Group clips",
  ungroupClips: "Ungroup clips",
  nudgeLeft: "Nudge clips one frame left",
  nudgeRight: "Nudge clips one frame right",
  nudgeLeft5: "Nudge clips five frames left",
  nudgeRight5: "Nudge clips five frames right",
  toggleLoop: "Loop playback",
  playInToOut: "Play in to out",
  showShortcuts: "Keyboard shortcuts",
  showPreferences: "Preferences",
  saveFrame: "Save frame as PNG",
};

/** Canonical chord for a keyboard event: modifiers in a fixed order, then
 * the key with letters uppercased. `mac` maps Cmd to Mod; elsewhere Ctrl. */
export function chordOf(
  e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean },
  mac: boolean,
): string {
  let key = e.key;
  if (key === " ") key = "Space";
  else if (key.length === 1) {
    // Shift changes e.key ("+" for "="); the physical code keeps chords stable.
    if (e.code?.startsWith("Key")) key = e.code.slice(3);
    else if (e.code?.startsWith("Digit")) key = e.code.slice(5);
    else if (e.code === "Equal") key = "=";
    else if (e.code === "Minus") key = "-";
    else if (e.code === "Slash") key = "/";
    else if (e.code === "Backquote") key = "`";
    else if (e.code === "BracketLeft") key = "[";
    else if (e.code === "BracketRight") key = "]";
    else if (e.code === "Period") key = ".";
    else if (e.code === "Comma") key = ",";
    else key = key.toUpperCase();
  }
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push("Mod");
  if (mac && e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, key].join("+");
}

export type Keymap = Record<ActionId, string[]>;
/** A viewer's changes: an action listed takes exactly those chords. */
export type KeymapChanges = Partial<Keymap>;

/** The defaults with a viewer's changes; anything unreadable is ignored. */
export function withChanges(changes: unknown): Keymap {
  const map = { ...DEFAULT_KEYMAP };
  if (changes && typeof changes === "object") {
    for (const [id, chords] of Object.entries(changes)) {
      if (id in DEFAULT_KEYMAP && Array.isArray(chords) && chords.every((c) => typeof c === "string")) map[id as ActionId] = chords;
    }
  }
  return map;
}

/** The actions besides `except` that a chord triggers. */
export const usersOf = (map: Keymap, chord: string, except?: ActionId) =>
  (Object.keys(map) as ActionId[]).filter((id) => id !== except && map[id].includes(chord));

/** Give `id` exactly `chord`, taking it from any action that had it (the
 * caller has asked first). A change back to the defaults is dropped. */
export function bindChord(changes: KeymapChanges, id: ActionId, chord: string | null): KeymapChanges {
  const map = withChanges(changes);
  const next: KeymapChanges = { ...changes, [id]: chord ? [chord] : [] };
  if (chord) for (const other of usersOf(map, chord, id)) next[other] = map[other].filter((c) => c !== chord);
  for (const k of Object.keys(next) as ActionId[]) if (JSON.stringify(next[k]) === JSON.stringify(DEFAULT_KEYMAP[k])) delete next[k];
  return next;
}

/** Reverse index: chord -> action. Later bindings for the same chord lose. */
export function buildIndex(map: Record<ActionId, string[]>): Map<string, ActionId> {
  const index = new Map<string, ActionId>();
  for (const [id, chords] of Object.entries(map) as [ActionId, string[]][]) {
    for (const c of chords) if (!index.has(c)) index.set(c, id);
  }
  return index;
}

/** What holds the keyboard focus, as the shortcuts see it (state/actions.ts
 * reads it off the element): a text field; a slider; a dropdown; a
 * control a key presses (a button, switch, checkbox, radio, tab or menu
 * item); a link; or nothing of the kind (the body, the timeline's clips,
 * the viewer). `keyboard`: the focus came with a key (Tab, a menu's
 * arrows), not with a click, which leaves a button focused by the way. */
export interface Focused {
  kind: "text" | "slider" | "dropdown" | "control" | "link" | "none";
  keyboard: boolean;
}

/** The keys a focused slider or dropdown uses itself. */
const CONTROL_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/**
 * Does the focused element keep this key press for itself, rather than the
 * app's shortcut taking it? Typing keeps every key, Escape included.
 * Sliders and dropdowns keep only the keys they move by. Enter presses a
 * focused button or link. Space presses a button, switch, checkbox or menu
 * item (or opens a dropdown) that the keyboard reached, as everywhere on
 * the web: it played the timeline instead (ADR-109's gap, ADR-111). A
 * control left focused by a mouse click does not keep it, so Space still
 * plays after clicking a tool or a tab, as in CapCut; nor does the
 * timeline, the viewer or the page, where Space is play.
 */
export function focusKeeps(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, f: Focused): boolean {
  if (f.kind === "text") return true;
  if ((f.kind === "slider" || f.kind === "dropdown") && CONTROL_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey) return true;
  if (e.key === "Enter" && (f.kind === "control" || f.kind === "link" || f.kind === "dropdown")) return true;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  return e.key === " " && plain && f.keyboard && (f.kind === "control" || f.kind === "dropdown");
}

/** How a chord reads on this platform: Ctrl+B on Windows, ⌘B on a Mac. */
export function chordText(chord: string, mac: boolean): string {
  const names: Record<string, string> = mac
    ? { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Delete: "⌦", Backspace: "⌫", Escape: "Esc", Enter: "↩" }
    : { Mod: "Ctrl", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Delete: "Del" };
  const parts = chord.split("+").map((p) => names[p] ?? p);
  return mac ? parts.join("") : parts.join("+");
}
