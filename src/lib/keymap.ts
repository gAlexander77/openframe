// Keymap: action id -> chord. Defaults are CapCut desktop's in-app list
// (docs/research/CapCut desktop.md §7) wherever CapCut has the action, and
// Premiere Pro's where it does not (Ctrl+K split, Shift+Delete ripple
// delete, C blade). "Mod" is Ctrl on Windows/Linux and Cmd on macOS.
// UI prose never types a chord: it calls chordLabel(id) (Conventions rule 8).

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
  | "editText"
  | "toolSelect"
  | "toolBlade"
  | "toolRipple"
  | "toolRoll"
  | "toolSlip"
  | "toolSlide"
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
  | "showShortcuts";

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
  showShortcuts: ["Mod+/"],
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
  showShortcuts: "Keyboard shortcuts",
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

/** Reverse index: chord -> action. Later bindings for the same chord lose. */
export function buildIndex(map: Record<ActionId, string[]>): Map<string, ActionId> {
  const index = new Map<string, ActionId>();
  for (const [id, chords] of Object.entries(map) as [ActionId, string[]][]) {
    for (const c of chords) if (!index.has(c)) index.set(c, id);
  }
  return index;
}

/** How a chord reads on this platform: Ctrl+B on Windows, ⌘B on a Mac. */
export function chordText(chord: string, mac: boolean): string {
  const names: Record<string, string> = mac
    ? { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Delete: "⌦", Backspace: "⌫", Escape: "Esc", Enter: "↩" }
    : { Mod: "Ctrl", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Delete: "Del" };
  const parts = chord.split("+").map((p) => names[p] ?? p);
  return mac ? parts.join("") : parts.join("+");
}
