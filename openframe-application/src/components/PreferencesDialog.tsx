import { useState } from "react";
import { TRANSITIONS } from "../lib/catalog";
import { parseTyped } from "../lib/numberInput";
import { DEFAULT_PREFS, prefsStore, usePrefs, type SecondsPref } from "../state/prefs";
import { Toggle, useCommitOnLeave } from "./inspector/controls";
import { Dialog } from "./Dialog";

const ROWS: [SecondsPref, string, string][] = [
  ["stillSeconds", "Pictures", "New pictures from the library"],
  ["layerSeconds", "Titles and effects", "Titles, stickers, effects, filters and adjustment layers"],
  ["transitionSeconds", "Transitions", "New video transitions; shorter when a clip beside it is"],
  ["audioCrossfadeSeconds", "Audio crossfades", "Shorter when the join has less sound to overlap"],
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
      <label className="prefs-row prefs-transition"><span>Default video transition</span><select className="field" aria-label="Default video transition" value={prefs.transitionType} onChange={(e) => prefsStore.set({ transitionType: e.target.value })}>{Object.entries(TRANSITIONS).map(([id, d]) => <option key={id} value={id}>{d.label}</option>)}</select></label>
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
      <h3 className="prefs-head prefs-gap">Playback</h3>
      <div className="prefs-row prefs-switch">
        <span>
          Audio scrubbing
          <small>Hear short snippets of sound while dragging the playhead</small>
        </span>
        <Toggle label="Audio scrubbing" on={prefs.audioScrub} onChange={(v) => prefsStore.set({ audioScrub: v })} />
      </div>
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
