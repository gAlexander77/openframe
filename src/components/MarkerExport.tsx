import { useEffect, useRef, useState } from "react";
import { Download, X } from "../icons";
import { markerText, type MarkerTextFormat } from "../lib/markerText";
import { projectDuration } from "../lib/project/ops";
import type { Marker } from "../lib/project/types";
import { saveMarkerText } from "../state/markers";
import { useEditor } from "../state/store";
import { toast } from "../state/toast";

export function MarkerExport({ markers, onClose }: { markers: Marker[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const project = useEditor((s) => s.project);
  const [format, setFormat] = useState<MarkerTextFormat>("notes");
  const [busy, setBusy] = useState(false);
  const result = markerText(markers, project.fps, projectDuration(project), format);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="marker-export" aria-labelledby="marker-export-title"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onKeyDown={(e) => e.stopPropagation()}>
      <header><strong id="marker-export-title">Export markers</strong><button className="icon-btn small" aria-label="Close marker export" disabled={busy} onClick={onClose}><X size={16} /></button></header>
      <label className="marker-export-format">Format
        <select className="field" aria-label="Marker export format" value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as MarkerTextFormat)}>
          <option value="notes">Timecoded notes (.txt)</option>
          <option value="chapters">YouTube chapters (.txt)</option>
        </select>
      </label>
      <p className="lib-hint">{result.count} displayed markers. Times refer to the full timeline.</p>
      <textarea className="field num" aria-label="Marker export preview" readOnly value={result.text} onFocus={(e) => e.target.select()} />
      {format === "chapters" && <div className="marker-export-checks" role="status">
        {result.issues.length ? <><strong>Review chapter timing</strong><ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></> : <span>Chapter timestamps meet the timing requirements.</span>}
        <p className="lib-hint">Chapter times round down to whole seconds. You can save a draft with timing issues and revise its markers later.</p>
      </div>}
      <footer><button className="btn primary" disabled={busy || !result.text} onClick={async () => {
        setBusy(true);
        try {
          const name = await saveMarkerText(result.text, format);
          if (name) { toast(`Saved ${name}`); onClose(); }
        } catch (error) { toast(error instanceof Error ? error.message : String(error), "error"); }
        finally { setBusy(false); }
      }}><Download size={14} /> {busy ? "Saving…" : "Save text"}</button><button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button></footer>
    </dialog>
  );
}
