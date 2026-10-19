import { describe, expect, it } from "vitest";
import { parseTyped } from "./numberInput";

describe("parseTyped", () => {
  it("reads plain, signed and decimal numbers", () => {
    expect(parseTyped("50")).toBe(50);
    expect(parseTyped(" -12.5 ")).toBe(-12.5);
    expect(parseTyped("+3")).toBe(3);
    expect(parseTyped(".5")).toBe(0.5);
  });

  it("gives nothing for an empty or junk field, so it keeps its value", () => {
    for (const junk of ["", "   ", "abc", "-", ".", "1e3", "12abc3", "x5"]) expect(parseTyped(junk), junk).toBeNull();
  });

  it("reads a decimal comma as a point", () => {
    expect(parseTyped("1,5")).toBe(1.5);
    expect(parseTyped("-0,25")).toBe(-0.25);
    expect(parseTyped("1,500.5")).toBe(1500.5);
  });

  it("ignores a unit after the number", () => {
    expect(parseTyped("50 %")).toBe(50);
    expect(parseTyped("2s")).toBe(2);
    expect(parseTyped("1.5x")).toBe(1.5);
    expect(parseTyped("-3 dB")).toBe(-3);
    expect(parseTyped("440Hz")).toBe(440);
    expect(parseTyped("45°")).toBe(45);
  });
});
