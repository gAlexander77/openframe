// Keymap: action id -> chord. Defaults follow CapCut desktop where CapCut has
// the action and Premiere Pro where it does not (J/K/L, I/O, ripple trims),
// per docs/research. "Mod" is Ctrl on Windows/Linux and Cmd on macOS.
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
  | "toolSelect"
  | "toolBlade"
  | "toggleSnapping"
  | "toggleMagnet"
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
  clearInOut: ["Mod+Shift+X"],
  addMarker: ["M"],
  split: ["Mod+B", "Mod+K"],
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
  detachAudio: ["Alt+Shift+D"],
  toolSelect: ["A", "V"],
  toolBlade: ["B", "C"],
  toggleSnapping: ["N"],
  toggleMagnet: ["Mod+Shift+M"],
  zoomIn: ["Mod+=", "="],
  zoomOut: ["Mod+-", "-"],
  zoomFit: ["Shift+Z"],
  importMedia: ["Mod+I"],
  newProject: ["Mod+N"],
  openProject: ["Mod+O"],
  saveProject: ["Mod+S"],
  export: ["Mod+E"],
  fullscreenPreview: ["Alt+Enter"],
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
  clearInOut: "Clear in and out",
  addMarker: "Add marker",
  split: "Split at playhead",
  trimStartToPlayhead: "Trim start to playhead",
  trimEndToPlayhead: "Trim end to playhead",
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
  toolSelect: "Select tool",
  toolBlade: "Split tool",
  toggleSnapping: "Snapping",
  toggleMagnet: "Main track magnet",
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
