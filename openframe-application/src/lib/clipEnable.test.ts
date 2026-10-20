import { expect, it } from "vitest";
import { enableLabel, enableToggle } from "./clipEnable";

it("turns a mixed selection off, and back on only when every clip is off", () => {
  expect(enableToggle([{}])).toEqual({ enabled: false, label: "Deactivate clip" });
  expect(enableToggle([{ disabled: true }])).toEqual({ enabled: true, label: "Activate clip" });
  // The menu said "Activate clip" on the off clip and the V key then turned
  // the other one off: one rule for all of them now.
  expect(enableToggle([{ disabled: true }, {}])).toEqual({ enabled: false, label: "Deactivate 2 clips" });
  expect(enableToggle([{ disabled: true }, { disabled: true }, { disabled: true }])).toEqual({ enabled: true, label: "Activate 3 clips" });
  expect(enableLabel(true, 1)).toBe("Activate clip");
});
