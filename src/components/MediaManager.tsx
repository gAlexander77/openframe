import { useEffect, useState } from "react";
import { probe } from "../engine/media";
import type { Asset } from "../lib/project/types";
import { projectWork } from "../state/projectWork";
import { applyReplacement, pickReplacement } from "../state/relink";
import { store, useEditor } from "../state/store";
import { organizeMedia } from "../lib/project/mediaOrganization";
import { MediaFolders } from "./MediaFolders";
import { Dialog } from "./Dialog";

export function MediaManager({ onClose }: { onClose: () => void }) {
  const assets = useEditor((s) => s.project.assets);
  const folders = useEditor((s) => s.project.mediaFolders);
  const [signal] = useState(() => projectWork.signal());
  const [status, setStatus] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ original: Asset; replacement: Asset } | null>(null);
  // Folder and favorite edits change the assets too; only a new location
  // needs another probe.
  const sources = assets.map((a) => `${a.id}:${a.proxy ?? a.src}`).join("|");
  useEffect(() => {
    let canceled = false;
    void (async () => {
      for (const a of store.get().project.assets) {
        if (canceled || signal.aborted) break;
        let message = "Available";
        try { if (!(await probe(a.proxy ?? a.src, a.name)).decodable) message = "Cannot decode"; }
        catch { message = "Unavailable — locate file"; }
        if (!canceled && !signal.aborted) setStatus((s) => ({ ...s, [a.id]: message }));
      }
    })();
    return () => { canceled = true; };
  }, [sources, signal]);
  return <Dialog title="Manage media" busy={busy} onClose={onClose} className="media-manager">
    <p className="lib-hint">Locate moved or missing files. Relinking updates every use in this project and preserves your edits. Undo restores the previous location.</p>
    <MediaFolders />
    <div className="media-file-list">
      {assets.length === 0 && <p>No media imported.</p>}
      {assets.map((a) => <div className="media-file" key={a.id}>
        <div><strong>{a.name}</strong><span className="media-path">{a.src}</span>{a.proxy && <span className="media-path">Editing copy: {a.proxy}</span>}<span role="status">{status[a.id] ?? "Checking…"}</span>
          <div className="media-organization"><select className="field" aria-label={`Folder for ${a.name}`} value={a.folder ?? ""} onChange={(e) => store.edit("Move media to folder", (p) => organizeMedia(p, [a.id], { folder: e.target.value }))}><option value="">Unfiled</option>{folders?.map((f) => <option key={f}>{f}</option>)}</select>
          <label><input type="checkbox" checked={!!a.favorite} onChange={(e) => store.edit("Favorite media", (p) => organizeMedia(p, [a.id], { favorite: e.target.checked }))} />Favorite {a.name}</label></div>
        </div>
        <button className="btn" disabled={busy} aria-label={`Locate ${a.name}`} onClick={async () => {
          setBusy(true); setError(""); setDraft(null);
          try { const replacement = await pickReplacement(a, signal); if (replacement) setDraft({ original: a, replacement }); }
          catch (e) { setError(e instanceof Error ? e.message : String(e)); }
          finally { setBusy(false); }
        }}>Locate…</button>
      </div>)}
    </div>
    {busy && <p role="status">Checking replacement; converting if needed…</p>}
    {draft && <section className="relink-review">
      <strong>Replacement for {draft.original.name}</strong>
      <p className="media-path">{draft.replacement.src}</p>
      <p>{draft.replacement.width && `${draft.replacement.width}×${draft.replacement.height} · `}{draft.replacement.kind === "image" ? "Still image" : `${draft.replacement.duration.toFixed(3)} seconds`}</p>
      <p className="lib-hint">Confirm this is the correct footage. Matching metadata does not guarantee matching content.</p>
      <button className="btn primary" onClick={() => {
        try { applyReplacement(draft.original, draft.replacement, signal); setStatus((s) => ({ ...s, [draft.original.id]: "Available" })); setDraft(null); setError(""); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }}>Relink file</button>
      <button className="btn ghost" onClick={() => setDraft(null)}>Discard replacement</button>
    </section>}
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <footer><button className="btn" disabled={busy} onClick={onClose}>Done</button></footer>
  </Dialog>;
}
