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
