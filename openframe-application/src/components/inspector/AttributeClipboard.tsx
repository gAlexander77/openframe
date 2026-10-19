import { useState } from "react";
import { ATTRIBUTE_GROUPS, ATTRIBUTE_LABELS, pasteAttributes, supportsAttributes, type AttributeClipboard as Snapshot, type AttributeGroup } from "../../lib/attributes";
import { findClip } from "../../lib/project/ops";
import type { Clip } from "../../lib/project/types";
import { copyClipAttributes, useCopiedAttributes } from "../../state/attributes";
import { store, useEditor } from "../../state/store";
import { Dialog } from "../Dialog";

export function AttributeClipboard({ clip }: { clip?: Clip }) {
  const copied = useCopiedAttributes();
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState(false);
  const ids = clip ? [clip.id] : selection;
  return <div className="insp-actions attribute-actions">
    {clip && <button className="btn ghost" onClick={() => copyClipAttributes(clip.id)}>Copy attributes</button>}
    <button className="btn ghost" disabled={!copied || !ids.length} onClick={() => setOpen(true)}>Paste attributes…</button>
    {open && copied && <PasteAttributes copied={copied} ids={ids} onClose={() => setOpen(false)} />}
  </div>;
}

function PasteAttributes({ copied, ids, onClose }: { copied: Snapshot; ids: string[]; onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const can = (group: AttributeGroup) => supportsAttributes(copied.clip, group) && ids.every((id) => { const loc = findClip(project, id); return loc && !loc.track.locked && supportsAttributes(loc.clip, group); });
  const [groups, setGroups] = useState<AttributeGroup[]>(() => ATTRIBUTE_GROUPS.filter(can));
  const [replace, setReplace] = useState(false), [error, setError] = useState("");
  const selected = groups.filter(can);
  return <Dialog title="Paste attributes" onClose={onClose}>
    <div className="dialog-form">
      <p className="lib-hint">Choose settings from {copied.clip.name ?? copied.clip.type} for {ids.length} selected {ids.length === 1 ? "clip" : "clips"}. Checked groups replace their settings and animation; effects append unless replaced below. Timing and source offsets stay unchanged.</p>
      {ATTRIBUTE_GROUPS.map((group) => <label className="dialog-check" key={group}><input type="checkbox" checked={selected.includes(group)} disabled={!can(group)} onChange={(e) => setGroups(e.target.checked ? [...groups, group] : groups.filter((g) => g !== group))} />{ATTRIBUTE_LABELS[group]}</label>)}
      <p className="lib-hint">Unavailable groups require compatible clips on unlocked tracks.</p>
      <label className="dialog-check"><input type="checkbox" checked={replace} disabled={!selected.includes("effects")} onChange={(e) => setReplace(e.target.checked)} />Replace existing effects</label>
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <footer><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!selected.length} onClick={() => {
        try { store.edit("Paste attributes", (p) => pasteAttributes(p, ids, copied, selected, replace)); onClose(); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }}>Paste selected attributes</button></footer>
    </div>
  </Dialog>;
}
