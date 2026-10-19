import { expect, it } from "vitest";
import { EFFECTS } from "./catalog";
import { applyEffectPreset, readEffectPreset, readPresetLibrary } from "./effectPresets";
import { createColorClip, createProject } from "./project/defaults";
const raw = () => ({ id: "p", name: "Look", stack: { fps: { num: 60, den: 1 }, effects: [{ id: "f", type: "blur", params: { amount: 12 }, enabled: false }], keyframes: { "effects.f.amount": [{ f: 60, v: 10, ease: [0.1, 0.2, 0.8, 1] }] } } });
it("round trips animation and applies independent IDs at the target rate", () => {
  const preset = readEffectPreset(JSON.parse(JSON.stringify(raw())));
  const p = createProject(); p.tracks[0].clips = [createColorClip("#fff", 0, 90)];
  const result = applyEffectPreset(p, [p.tracks[0].clips[0].id], preset);
  const c = result.tracks[0].clips[0];
  expect("effects" in c && c.effects[0].id).not.toBe("f");
  expect(Object.values(c.keyframes!)[0][0]).toMatchObject({ f: 30, v: 10, ease: [0.1, 0.2, 0.8, 1] });
  expect(p.tracks[0].clips[0].keyframes).toBeUndefined();
});
it("rejects corrupt or unknown preset data instead of applying arbitrary paths", () => {
  expect(() => readEffectPreset(null)).toThrow();
  const bad = raw(); bad.stack.effects[0].type = "unknown";
  expect(() => readEffectPreset(bad)).toThrow();
  const path = raw(); Object.assign(path.stack.keyframes, { "transform.scale": [{ f: 0, v: 1 }] });
  expect(() => readEffectPreset(path)).toThrow();
  const fps = raw(); fps.stack.fps.den = 0;
  expect(() => readEffectPreset(fps)).toThrow();
});
it("keeps unreadable library entries apart instead of failing the whole library", () => {
  const bad = raw(); bad.stack.effects[0].type = "renamed";
  const { presets, unreadable } = readPresetLibrary([raw(), bad]);
  expect(presets.map((p) => p.name)).toEqual(["Look"]);
  expect(unreadable).toEqual([bad]);
});
it("clamps animated values to the parameter's range", () => {
  const big = raw(); big.stack.keyframes["effects.f.amount"][0].v = 1e6;
  expect(readEffectPreset(big).stack.keyframes["effects.f.amount"][0].v).toBe(EFFECTS.blur.params.amount.max);
});
