import { useState } from "react";
import { parseTyped } from "../lib/numberInput";
import { DEFAULT_PREFS, prefsStore, usePrefs, type Prefs } from "../state/prefs";
import { useCommitOnLeave } from "./inspector/controls";
import { Dialog } from "./Dialog";

const ROWS: [keyof Prefs, string, string][] = [
  ["stillSeconds", "Pictures", "New pictures from the library"],
  ["layerSeconds", "Titles and effects", "Titles, stickers, effects, filters and adjustment layers"],
  ["transitionSeconds", "Transitions", "Shorter when a clip beside it is"],
];

/** A length in seconds: what was typed applies on Enter, on leaving the
 * field, and when the dialog closes under it (Escape, Done); a cleared or
 * junk field keeps its value, and "1,5" is 1.5 (ADR-072). Out of range
 * clamps to PREF_LIMITS. */
function SecondsField({ label, value, onSet }: { label: string; value: number; onSet: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    setText(null);
    const n = parseTyped(raw);
    if (n !== null) onSet(n);
  };
  useCommitOnLeave(text, commit);
  return (
    <input
      className="field num"
      inputMode="decimal"
      aria-label={`${label} seconds`}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== null && commit(text)}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

/** Premiere's Preferences > Timeline: the lengths new items start at. */
export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  return (
    <Dialog title="Preferences" onClose={onClose} className="prefs-dialog">
      <h3 className="prefs-head">Default lengths</h3>
      {ROWS.map(([key, label, hint]) => (
        <label key={key} className="prefs-row">
          <span>
            {label}
            <small>{hint}</small>
          </span>
          <SecondsField label={label} value={prefs[key]} onSet={(v) => prefsStore.set({ [key]: v })} />
          <span className="prefs-unit">s</span>
        </label>
      ))}
      <footer>
        <button className="btn ghost" onClick={() => prefsStore.set(DEFAULT_PREFS)}>
          Reset to defaults
        </button>
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </Dialog>
  );
}
