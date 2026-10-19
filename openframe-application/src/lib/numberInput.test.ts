import { describe, expect, it } from "vitest";
import { boundedNumber, parseTyped } from "./numberInput";

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

it("bounds committed music and export drafts without treating blanks as zero", () => {
  expect(boundedNumber("120", 40, 220)).toBe(120);
  expect(boundedNumber("1", 40, 220)).toBe(40);
  expect(boundedNumber("900", 4, 300)).toBe(300);
  expect(boundedNumber("", 4, 300)).toBeNull();
  expect(boundedNumber("0.75", 0.5, 400)).toBe(0.75);
  expect(boundedNumber("12.9", 0, Infinity, true)).toBe(12);
});
