import { DEFAULT_PREFS, PREF_LIMITS, prefsStore, usePrefs, type Prefs } from "../state/prefs";
import { Dialog } from "./Dialog";

const ROWS: [keyof Prefs, string, string][] = [
  ["stillSeconds", "Pictures", "New pictures from the library"],
  ["layerSeconds", "Titles and effects", "Titles, stickers, effects, filters and adjustment layers"],
  ["transitionSeconds", "Transitions", "Shorter when a clip beside it is"],
];

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
          <input
            type="number"
            className="field num"
            aria-label={`${label} seconds`}
            min={PREF_LIMITS[key][0]}
            max={PREF_LIMITS[key][1]}
            step={key === "transitionSeconds" ? 0.1 : 0.5}
            defaultValue={prefs[key]}
            key={prefs[key]}
            onBlur={(e) => prefsStore.set({ [key]: Number(e.target.value) })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
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
