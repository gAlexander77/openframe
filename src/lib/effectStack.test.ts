import { describe, expect, it } from "vitest";
import { editEffects, effectClip } from "./effectStack";
import { runCommand, describeProject } from "./commands";
import { effectDefaults } from "./catalog";
import { createColorClip, createProject } from "./project/defaults";
import { addClip, mainTrack } from "./project/ops";

function fixture() {
  let p = createProject();
  const clip = createColorClip("#80a040", 0, 90);
  clip.effects = [
    { id: "fx1", type: "blur", enabled: true, params: { amount: 80 } },
    { id: "fx10", type: "posterize", enabled: false, params: { levels: 8 } },
  ];
  clip.keyframes = {
    "effects.fx1.amount": [{ f: 0, v: 20 }, { f: 60, v: 80 }],
    "effects.fx10.levels": [{ f: 0, v: 8 }],
    "transform.scale": [{ f: 0, v: 1 }],
  };
  p = addClip(p, mainTrack(p).id, clip);
  return { p, id: clip.id };
}

describe("effect stack editing", () => {
  it("moves the effect with stable IDs and animation, without mutating the source", () => {
    const { p, id } = fixture();
    const next = editEffects(p, id, "move_down", "fx1");
    expect(effectClip(next, id).effects.map(e => e.id)).toEqual(["fx10", "fx1"]);
    expect(effectClip(p, id).effects.map(e => e.id)).toEqual(["fx1", "fx10"]);
    expect(effectClip(next, id).keyframes).toEqual(effectClip(p, id).keyframes);
    expect(editEffects(p, id, "move_up", "fx1")).toBe(p);
    expect(editEffects(p, id, "move_down", "fx10")).toBe(p);
  });

  it("reset clears only that effect's keys and preserves its enabled state", () => {
    const { p, id } = fixture();
    const clip = effectClip(editEffects(p, id, "reset", "fx10"), id);
    expect(clip.effects[1]).toEqual({ id: "fx10", type: "posterize", enabled: false, params: effectDefaults("posterize") });
    expect(Object.keys(clip.keyframes!)).toEqual(["effects.fx1.amount", "transform.scale"]);
  });

  it("removal keeps similarly prefixed effects and their keys", () => {
    const { p, id } = fixture();
    const clip = effectClip(editEffects(p, id, "remove", "fx1"), id);
    expect(clip.effects.map(e => e.id)).toEqual(["fx10"]);
    expect(Object.keys(clip.keyframes!)).toEqual(["effects.fx10.levels", "transform.scale"]);
  });

  it("clear keeps all non-effect settings and keys", () => {
    const { p, id } = fixture();
    const clip = effectClip(editEffects(p, id, "clear"), id);
    expect(clip.effects).toEqual([]);
    expect(clip.keyframes).toEqual({ "transform.scale": [{ f: 0, v: 1 }] });
    expect(clip).toEqual({ ...effectClip(p, id), effects: [], keyframes: clip.keyframes });
  });

  it("enable/disable all changes no parameters or keys and repeated changes are no-ops", () => {
    const { p, id } = fixture();
    const next = editEffects(p, id, "disable");
    expect(effectClip(next, id).effects.every(e => !e.enabled)).toBe(true);
    expect(effectClip(next, id).keyframes).toEqual(effectClip(p, id).keyframes);
    expect(editEffects(next, id, "disable")).toBe(next);
    expect(effectClip(editEffects(next, id, "enable", "fx1"), id).effects.map(e => e.enabled)).toEqual([true, false]);
  });

  it("rejects missing effects, missing IDs and edits on locked tracks", () => {
    const { p, id } = fixture();
    expect(() => editEffects(p, id, "remove")).toThrow(/effect_id/);
    expect(() => editEffects(p, id, "remove", "missing")).toThrow(/No effect/);
    expect(() => editEffects(p, "missing", "clear")).toThrow(/No clip/);
    const locked = { ...p, tracks: p.tracks.map(t => ({ ...t, locked: true })) };
    expect(() => editEffects(locked, id, "clear")).toThrow(/Unlock/);
  });

  it("commands expose IDs, seed defaults, and validate stack actions", () => {
    const { p, id } = fixture();
    const next = runCommand(p, "add_effect", { clip_id: id, type: "glow", params: { amount: 25 } });
    expect(effectClip(next, id).effects[2].params).toEqual({ ...effectDefaults("glow"), amount: 25 });
    expect(describeProject(next).tracks[0].clips[0].effectStack?.[0]).toMatchObject({ id: "fx1", enabled: true });
    expect(effectClip(runCommand(next, "edit_effects", { clip_id: id, action: "clear" }), id).effects).toEqual([]);
    expect(() => runCommand(p, "edit_effects", { clip_id: id, action: "shuffle" })).toThrow(/must be one of/);
  });
});
