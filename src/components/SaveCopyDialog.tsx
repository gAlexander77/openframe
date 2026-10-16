import { useState } from "react";
import { uid } from "../lib/project/defaults";
import { saveProjectCopy } from "../state/project";
import { store } from "../state/store";
import { Dialog } from "./Dialog";

export function SaveCopyDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(() => `${store.get().project.name} copy`);
  const [copyId] = useState(() => uid("p"));
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Dialog title="Save a copy" busy={busy} onClose={onClose}>
    <form className="dialog-form" onSubmit={async (e) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true); setError("");
      try { if (await saveProjectCopy(name, open, copyId)) onClose(); else setError("The copy was not saved. Resolve the storage problem and retry."); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      finally { setBusy(false); }
    }}>
      <label>Project name<input className="field" autoFocus value={name} maxLength={120} required disabled={busy} onFocus={(e) => e.target.select()} onChange={(e) => setName(e.target.value)} /></label>
      <p className="lib-hint">Create an independent version of your edits. Both versions reference the same media files; this does not back up the footage.</p>
      <label className="dialog-check"><input type="checkbox" checked={open} disabled={busy} onChange={(e) => setOpen(e.target.checked)} />Open the copy after saving</label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <footer><button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save copy"}</button></footer>
    </form>
  </Dialog>;
}
