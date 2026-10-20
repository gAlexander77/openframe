import { expect, it } from "vitest";
import { COMMANDS } from "./commands";
import { commandLabel } from "./commandLabels";
it("gives every registered command a sentence-case undo label", () => {
  for (const { name } of COMMANDS) {
    const label = commandLabel(name);
    expect(label).toMatch(/^[A-Z][^_]+$/);
    expect(label).not.toBe(name.replace(/_/g, " "));
  }
});
it("names the parameter and provides a readable fallback", () => {
  expect(commandLabel("add_media_clip")).toBe("Add clip");
  expect(commandLabel("set_param", { path: "opacity" })).toBe("Change opacity");
  expect(commandLabel("set_param", { path: "transform.scaleY" })).toBe("Change scale y");
  expect(commandLabel("future_command")).toBe("Future command");
});
it("names what the new picture and sound commands do, as the inspector does (ADR-109)", () => {
  // A border's or colorize's own parameter, not "Change width" or "Change amount".
  expect(commandLabel("set_param", { path: "border.width" })).toBe("Change border width");
  expect(commandLabel("set_param", { path: "adjust.colorize.amount" })).toBe("Change colorize amount");
  expect(commandLabel("set_param", { path: "adjust.exposure" })).toBe("Change exposure");
  expect(commandLabel("set_param", { path: "transform.x" })).toBe("Change position x");
  expect(commandLabel("set_param", { path: "compressor.threshold" })).toBe("Change compressor threshold");
  expect(commandLabel("set_param", { path: "eq.low" })).toBe("Change EQ low");
  expect(commandLabel("set_param", { path: "effects.fx_1.amount" })).toBe("Change amount");
  // The timeline's own words for turning clips off and on.
  expect(commandLabel("set_clip_enabled", { clip_ids: ["a"], enabled: false })).toBe("Deactivate clip");
  expect(commandLabel("set_clip_enabled", { clip_ids: ["a", "b"], enabled: true })).toBe("Activate 2 clips");
  expect(commandLabel("set_clip_enabled")).toBe("Change clip enabled");
  expect(commandLabel("set_colorize", { clip_ids: ["a"], color: "#ffb347" })).toBe("Colorize");
  expect(commandLabel("set_colorize", { clip_ids: ["a"], off: true })).toBe("Remove colorize");
  expect(commandLabel("set_border", { clip_ids: ["a"], off: true })).toBe("Remove border");
  expect(commandLabel("set_border", { clip_ids: ["a"], width: 8 })).toBe("Change border");
  expect(commandLabel("set_crossfade", { clip_id: "a", seconds: 0.5 })).toBe("Crossfade");
  expect(commandLabel("set_crossfade", { clip_id: "a", seconds: 0 })).toBe("Remove crossfade");
  expect(commandLabel("set_compressor", { clip_ids: ["a"], preset: "off" })).toBe("Compressor off");
  expect(commandLabel("set_music_grid", { clip_id: "a", bpm: 120 })).toBe("Change music grid");
  expect(commandLabel("cut_music", { clip_id: "a", from: 1, to: 2 })).toBe("Cut music");
});
