import { useEffect, useId, useRef, useState } from "react";
import { X } from "../icons";
import { ACTION_LABELS, chordText, DEFAULT_KEYMAP, type ActionId } from "../lib/keymap";
import { isMac } from "../platform/env";
import "./shortcuts.css";

export function ShortcutsDialog(props: { open: boolean; onClose: () => void }) {
  const { open, onClose } = props;
  const [query, setQuery] = useState("");
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const groups = {
    Playback: [
      "playPause", "stepBack", "stepForward", "stepBack10", "stepForward10",
      "prevEdit", "nextEdit", "goStart", "goEnd", "shuttleBack", "shuttleStop",
      "shuttleForward", "toggleLoop", "playInToOut", "fullscreenPreview",
    ],
    Editing: [
      "split", "splitAll", "trimStartToPlayhead", "trimEndToPlayhead", "delete",
      "rippleDelete", "duplicate", "copy", "cut", "paste", "freeze", "detachAudio",
      "toggleClipEnabled", "editText", "nudgeLeft", "nudgeRight", "nudgeLeft5", "nudgeRight5", "undo", "redo",
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      // Capture before the app's window-level shortcut listener.
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

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
      chords: DEFAULT_KEYMAP[action].map((chord) => ({
        chord,
        text: chordText(chord, isMac),
      })),
    })).filter((row) =>
      row.label.toLowerCase().includes(search) ||
      row.chords.some(({ text }) => text.toLowerCase().includes(search)),
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
        // The close button and search field are the only tab stops.
        if (event.shiftKey && document.activeElement === closeRef.current) {
          event.preventDefault();
          searchRef.current?.focus();
        } else if (!event.shiftKey && document.activeElement === searchRef.current) {
          event.preventDefault();
          closeRef.current?.focus();
        }
      }}
    >
      <div className="shortcuts-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
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
                {rows.map(({ action, label, chords }) => (
                  <li className="shortcuts-row" key={action}>
                    <span className="shortcuts-label">{label}</span>
                    <span className="shortcuts-chords">
                      {chords.map(({ chord, text }) => (
                        <span className="shortcuts-chord" key={chord} aria-label={text}>
                          {(isMac ? [text] : text.split("+")).map((key, index) => (
                            <kbd key={index}>{key}</kbd>
                          ))}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
