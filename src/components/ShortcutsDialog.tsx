import { useEffect, useId, useRef, useState } from "react";
import { Pencil, RotateCw, X } from "../icons";
import { ACTION_LABELS, bindChord, chordOf, chordText, DEFAULT_KEYMAP, usersOf, type ActionId } from "../lib/keymap";
import { isMac } from "../platform/env";
import { currentKeymapChanges, keymap, setKeymapChanges } from "../state/actions";
import "./shortcuts.css";

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

/** A chord as key caps. */
function Chord({ chord }: { chord: string }) {
  const text = chordText(chord, isMac);
  return (
    <span className="shortcuts-chord" aria-label={text}>
      {(isMac ? [text] : text.split("+")).map((key, index) => (
        <kbd key={index}>{key}</kbd>
      ))}
    </span>
  );
}

/**
 * The searchable shortcut list, editable as in Premiere's Keyboard
 * Shortcuts: Edit on a row, press the new keys; a chord another action uses
 * asks before moving it. Changes are per viewer (src/state/actions.ts).
 */
export function ShortcutsDialog(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;
  const [query, setQuery] = useState("");
  // Editing a row: listening for keys, or asking about a taken chord.
  const [editing, setEditing] = useState<{ action: ActionId; chord?: string } | null>(null);
  const [, setVersion] = useState(0);
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const save = (action: ActionId, chord: string | null) => {
    setKeymapChanges(bindChord(currentKeymapChanges(), action, chord));
    setEditing(null);
    setVersion((v) => v + 1);
  };

  const groups = {
    Playback: [
      "playPause", "stepBack", "stepForward", "stepBack10", "stepForward10",
      "prevEdit", "nextEdit", "goStart", "goEnd", "shuttleBack", "shuttleStop",
      "shuttleForward", "toggleLoop", "playInToOut", "fullscreenPreview",
    ],
    Editing: [
      "split", "splitAll", "trimStartToPlayhead", "trimEndToPlayhead", "delete",
      "rippleDelete", "duplicate", "copy", "cut", "paste", "freeze", "detachAudio",
      "createCompound", "breakCompound", "toggleClipEnabled", "editText", "nudgeLeft", "nudgeRight", "nudgeLeft5", "nudgeRight5", "groupClips", "ungroupClips", "undo", "redo",
    ],
    "Selection & tools": [
      "selectAll", "deselect", "selectLeft", "selectRight", "toolSelect", "toolBlade",
      "toolRipple", "toolRoll", "toolSlip", "toolSlide",
    ],
    Timeline: [
      "toggleMagnet", "toggleSnapping", "toggleLinkage", "togglePreviewAxis", "toggleKeyframePanel",
      "zoomIn", "zoomOut", "zoomFit", "addMarker", "nextMarker", "prevMarker",
      "markIn", "markOut", "rangeToClip", "clearInOut",
    ],
    Project: [
      "newProject", "openProject", "saveProject", "importMedia", "export", "showShortcuts",
    ],
  } as const satisfies Record<string, readonly ActionId[]>;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    setQuery("");
    setEditing(null);
    searchRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const ed = editingRef.current;
      // Listening for a new chord: every key belongs to the editor.
      if (ed && !ed.chord) {
        if (MODIFIERS.has(event.key) || event.key === "Tab") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
          setEditing(null);
          return;
        }
        const chord = chordOf(event, isMac);
        if (usersOf(keymap, chord, ed.action).length) setEditing({ action: ed.action, chord });
        else save(ed.action, chord);
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Capture before the app's window-level shortcut listener.
      event.stopImmediatePropagation();
      if (ed) setEditing(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const changed = currentKeymapChanges();
  const groupedActions = new Set<ActionId>(Object.values(groups).flat());
  const otherActions = (Object.keys(DEFAULT_KEYMAP) as ActionId[])
    .filter((action) => !groupedActions.has(action));
  const sections: [string, readonly ActionId[]][] = [
    ...Object.entries(groups),
    ["Other", otherActions],
  ];
  const search = query.trim().toLowerCase();
  const visibleSections = sections.map(([title, actions]) => ({
    title,
    rows: actions.map((action) => ({
      action,
      label: ACTION_LABELS[action],
      chords: keymap[action],
    })).filter((row) =>
      row.label.toLowerCase().includes(search) ||
      row.chords.some((c) => chordText(c, isMac).toLowerCase().includes(search)),
    ),
  })).filter((section) => section.rows.length > 0);

  return (
    <div
      className="shortcuts-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        // Keep Tab inside the dialog.
        const stops = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input") ?? [])];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && at <= 0) {
          event.preventDefault();
          stops.at(-1)?.focus();
        } else if (!event.shiftKey && at === stops.length - 1) {
          event.preventDefault();
          stops[0]?.focus();
        }
      }}
    >
      <div className="shortcuts-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="shortcuts-header">
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            type="button"
            className="icon-btn"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="shortcuts-search">
          <input
            ref={searchRef}
            type="search"
            className="field"
            aria-label="Search keyboard shortcuts"
            placeholder="Search shortcuts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="shortcuts-body">
          {visibleSections.length === 0 ? (
            <p className="shortcuts-empty" role="status">No shortcut matches</p>
          ) : visibleSections.map(({ title, rows }) => (
            <section className="shortcuts-section" key={title} aria-label={title}>
              <h3>{title}</h3>
              <ul className="shortcuts-list">
                {rows.map(({ action, label, chords }) => {
                  const ed = editing?.action === action ? editing : null;
                  return (
                    <li className={`shortcuts-row${ed ? " editing" : ""}`} key={action}>
                      <span className="shortcuts-label">{label}</span>
                      {ed && !ed.chord && (
                        <span className="shortcuts-listen" role="status">
                          Press the new shortcut (Esc cancels)
                          <button type="button" className="btn ghost" onClick={() => save(action, null)}>Remove</button>
                        </span>
                      )}
                      {ed?.chord && (
                        <span className="shortcuts-conflict" role="alert">
                          <Chord chord={ed.chord} /> is used by {usersOf(keymap, ed.chord, action).map((a) => ACTION_LABELS[a]).join(", ")}.
                          <button type="button" className="btn primary" onClick={() => save(action, ed.chord!)}>Replace</button>
                          <button type="button" className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
                        </span>
                      )}
                      {!ed && (
                        <span className="shortcuts-chords">
                          {chords.length ? chords.map((chord) => <Chord key={chord} chord={chord} />) : <span className="shortcuts-none">None</span>}
                          <button type="button" className="icon-btn small shortcuts-edit" aria-label={`Change shortcut for ${label}`} data-tip="Change shortcut" onClick={() => setEditing({ action })}>
                            <Pencil size={12} />
                          </button>
                          {changed[action] && (
                            <button type="button" className="icon-btn small" aria-label={`Reset shortcut for ${label}`} data-tip="Reset to default" onClick={() => {
                              const { [action]: _, ...rest } = changed;
                              setKeymapChanges(rest);
                              setVersion((v) => v + 1);
                            }}>
                              <RotateCw size={12} />
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        <div className="shortcuts-footer">
          <button
            type="button"
            className="btn ghost"
            disabled={!Object.keys(changed).length}
            onClick={() => {
              setKeymapChanges({});
              setEditing(null);
              setVersion((v) => v + 1);
            }}
          >
            Reset all shortcuts
          </button>
        </div>
      </div>
    </div>
  );
}
