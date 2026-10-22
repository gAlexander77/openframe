import { DEFAULT_ADJUST } from "./project/defaults";
import type { Layer, PlanItem } from "./render/plan";

/** A derived render plan, never an edit. Chroma key, geometry, masks and
 * opacity still describe the same picture on both sides of the wipe. */
export function beforePlan(plan: PlanItem[], ids?: readonly string[]): PlanItem[] {
  const selected = (id: string) => ids === undefined || ids.includes(id) || ids.includes(id.replace(/#canvas$/, ""));
  const look = <T extends { clipId: string }>(v: T): T => selected(v.clipId)
    ? { ...v, adjust: { ...DEFAULT_ADJUST }, tone: undefined, grade: undefined, effects: [] }
    : v;
  const layer = (v: Layer): Layer => {
    let out = look(v);
    if (v.source.kind === "compound") out = { ...out, source: { ...v.source, items: beforePlan(v.source.items, ids) } };
    if (v.trackMatte?.layer) out = { ...out, trackMatte: { ...v.trackMatte, layer: layer(v.trackMatte.layer) } };
    return out;
  };
  return plan.map((i) => i.kind === "layer" ? { ...i, layer: layer(i.layer) }
    : i.kind === "transition" ? { ...i, from: layer(i.from), to: layer(i.to) } : look(i));
}
