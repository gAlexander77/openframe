import type { AudioClip, CompoundClip, VideoClip } from "../../lib/project/types";
import { INSERT_NAMES } from "../../lib/audioInserts";
import { runCommand } from "../../lib/commands";
import { store } from "../../state/store";
import { AudioInserts, InsertControls, InsertPresets } from "../AudioInserts";
import { Section } from "./controls";
export function DynamicsSection({ clip }: { clip: AudioClip | VideoClip | CompoundClip }) {
  return <Section title="Dynamics" defaultOpen={!!clip.inserts?.length}>
    <InsertPresets target={{ clip_id: clip.id }} />
    {(["gate", "deesser", "limiter", "eq"] as const).map(type => {
      const insert = clip.inserts?.find(i => i.type === type);
      const name = INSERT_NAMES[type];
      return <div className="audio-dynamics-slot" key={type}><label><input type="checkbox" aria-label={name} checked={insert?.on ?? false} onChange={e => store.edit(`${name} ${e.target.checked ? "on" : "off"}`, p => runCommand(p, "set_dynamics", { clip_id: clip.id, [type]: { on: e.target.checked } }))} />{name}</label>{insert?.on && <InsertControls insert={insert} more />}</div>;
    })}
    {!!clip.inserts?.length && <details><summary>Insert order and other effects</summary><AudioInserts target={{ clip_id: clip.id }} inserts={clip.inserts} /></details>}
  </Section>;
}
