import { findClip } from "../../lib/project/ops";
import type { Clip } from "../../lib/project/types";
import { copyEffects, pasteEffects, useCopiedEffects } from "../../state/effects";
import { useEditor } from "../../state/store";
import { EffectPresets } from "./EffectPresets";

export function EffectClipboard({ clip }: { clip?: Clip }) {
  const copied = useCopiedEffects();
  const project = useEditor(s => s.project);
  const selection = useEditor(s => s.selection);
  const ids = clip ? [clip.id] : selection;
  const targets = ids.filter(id => {
    const loc = findClip(project, id);
    return loc && "effects" in loc.clip && !loc.track.locked;
  });
  return <>
    <div className="insp-actions">
      {clip && <button className="btn" disabled={!("effects" in clip) || !clip.effects.length} onClick={() => copyEffects(clip.id)}>Copy effects</button>}
      <button className="btn" disabled={!copied?.effects.length || !targets.length} onClick={() => pasteEffects(targets)}>
        {clip ? "Paste effects" : `Paste effects to ${targets.length} clips`}
      </button>
      <EffectPresets clip={clip} targets={targets} />
    </div>
    {copied?.effects.length ? <p className="insp-hint">Paste adds {copied.effects.length} copied effect{copied.effects.length === 1 ? "" : "s"} and their keyframes. Existing effects stay.</p> : null}
    {targets.length < ids.length && <p className="insp-hint">Only unlocked visual clips receive effects.</p>}
  </>;
}
