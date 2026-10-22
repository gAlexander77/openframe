import { expect, it } from "vitest";
import { beforePlan } from "./viewerCompare";
import { createAdjustmentClip, createColorClip, createProject, DEFAULT_ADJUST } from "./project/defaults";
import { planFrame, type Layer, type PlanItem } from "./render/plan";

function graded() {
  const c = createColorClip("#789abc", 0, 60);
  return { ...c, id: "a", adjust: { ...c.adjust, saturation: 40, curves: { r: [[0, 0], [1, 0.8]] as [number, number][] } }, filter: { type: "warm", intensity: 1 }, effects: [{ id: "fx", type: "blur", enabled: true, params: { amount: 10 } }], chromaKey: { enabled: true, color: "#00ff00", similarity: 0.2, smoothness: 0.1, spill: 0.1 } };
}
it("leaves the document and original plan untouched and resets only look fields", () => {
  const p = createProject();
  p.tracks[0].clips = [graded()];
  const snapshot = structuredClone(p), plan = planFrame(p, 10), original = structuredClone(plan);
  const result = beforePlan(plan, ["a"]);
  expect(p).toEqual(snapshot);
  expect(plan).toEqual(original);
  expect(beforePlan(plan, ["other"])).toEqual(plan);
  const a = plan[0].kind === "layer" ? plan[0].layer : null;
  expect(result).toEqual([{ kind: "layer", layer: { ...a, adjust: DEFAULT_ADJUST, grade: undefined, tone: undefined, effects: [] } }]);
  if (!a) throw new Error("layer missing");
  expect(beforePlan([{ kind: "layer", layer: { ...a, clipId: "a#canvas" } }], ["a"])).toMatchObject([{ layer: { adjust: DEFAULT_ADJUST, effects: [] } }]);
});

it("handles transitions, adjustment layers, nested compounds and track mattes", () => {
  const p = createProject();
  p.tracks[0].clips = [graded()];
  const a = (planFrame(p, 1)[0] as { kind: "layer"; layer: Layer }).layer;
  const b: Layer = { ...a, clipId: "b", trackMatte: { layer: a, mode: "alpha" }, source: { kind: "compound", compoundId: "k", frame: 1, items: [{ kind: "layer", layer: a }] } };
  const adjust = createAdjustmentClip(0, 60);
  p.tracks[0].clips = [{ ...adjust, adjust: { ...adjust.adjust, saturation: 80 } }];
  const plan: PlanItem[] = [{ kind: "transition", type: "dissolve", progress: 0.5, from: a, to: b }, ...planFrame(p, 1)];
  const before = beforePlan(plan);
  const tr = before[0];
  expect(tr.kind).toBe("transition");
  if (tr.kind !== "transition") throw new Error("transition missing");
  expect(tr.from.adjust).toEqual(DEFAULT_ADJUST);
  expect(tr.to.trackMatte?.layer?.grade).toBeUndefined();
  expect(tr.to.source.kind === "compound" && tr.to.source.items).toEqual(beforePlan([{ kind: "layer", layer: a }]));
  expect(before[1]).toMatchObject({ kind: "adjust", adjust: DEFAULT_ADJUST, effects: [] });
});
