import { useState } from "react";
import { applyEffectPreset } from "../../lib/effectPresets";
import type { Clip } from "../../lib/project/types";
import { store } from "../../state/store";
import { deleteEffectPreset, presetLoadError, renameEffectPreset, saveEffectPreset, useEffectPresets } from "../../state/effectPresets";
import { Dialog } from "../Dialog";

export function EffectPresets({ clip, targets }: { clip?: Clip; targets: string[] }) {
  const presets = useEffectPresets();
  const [open, setOpen] = useState(false), [selected, setSelected] = useState("");
  const [name, setName] = useState(""), [error, setError] = useState("");
  const preset = presets.find((p) => p.id === selected);
  const attempt = (fn: () => void) => { try { fn(); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <><button className="btn" onClick={() => setOpen(true)}>Effect presets…</button>
    {open && <Dialog title="Effect presets" onClose={() => setOpen(false)}>
      <div className="dialog-form">
        <p className="lib-hint">Save an effect stack with its animation for reuse across projects on this device. Applying appends independent copies to {targets.length} unlocked visual {targets.length === 1 ? "clip" : "clips"}.</p>
        <label>Saved preset<select className="field" value={selected} onChange={(e) => { setSelected(e.target.value); setName(presets.find((p) => p.id === e.target.value)?.name ?? ""); }}><option value="">New preset from selected clip</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stack.effects.length} effects)</option>)}</select></label>
        <label>Preset name<input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <div className="insp-actions">
          {preset ? <><button className="btn" disabled={!name.trim()} onClick={() => attempt(() => renameEffectPreset(preset.id, name))}>Rename preset</button><button className="btn ghost" onClick={() => attempt(() => { deleteEffectPreset(preset.id); setSelected(""); setName(""); })}>Delete preset</button></> : <button className="btn" disabled={!name.trim() || !clip || !("effects" in clip) || !clip.effects.length} onClick={() => attempt(() => setSelected(saveEffectPreset(clip!.id, name)))}>Save preset</button>}
        </div>
        {(error || presetLoadError()) && <p className="dialog-error" role="alert">{error || presetLoadError()}</p>}
        <footer><button className="btn ghost" onClick={() => setOpen(false)}>Close</button><button className="btn primary" disabled={!preset || !targets.length} onClick={() => attempt(() => { store.edit(`Apply ${preset!.name} preset`, (p) => applyEffectPreset(p, targets, preset)); setOpen(false); })}>Apply preset</button></footer>
      </div>
    </Dialog>}
  </>;
}
