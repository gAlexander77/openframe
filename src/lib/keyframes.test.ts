import { describe, expect, it } from "vitest";
import { ease, getPath, interpolate, setPath, upsertKey } from "./keyframes";

describe("paths", () => {
  const clip = {
    transform: { x: 0.25 },
    effects: [{ id: "e1", type: "blur", params: { amount: 40 } }],
  };
  it("reads nested fields and effect params by id", () => {
    expect(getPath(clip, "transform.x")).toBe(0.25);
    expect(getPath(clip, "effects.e1.amount")).toBe(40);
    expect(getPath(clip, "effects.missing.amount")).toBeUndefined();
  });
  it("sets immutably, sharing untouched branches", () => {
    const next = setPath(clip, "effects.e1.amount", 10);
    expect(getPath(next, "effects.e1.amount")).toBe(10);
    expect(getPath(clip, "effects.e1.amount")).toBe(40);
    expect(next.transform).toBe(clip.transform);
  });
});

describe("interpolation", () => {
  const keys = [
    { f: 0, v: 0 },
    { f: 10, v: 100, ease: "hold" as const },
    { f: 20, v: 50 },
  ];
  it("holds outside the keys and steps on hold", () => {
    expect(interpolate(keys, -5)).toBe(0);
    expect(interpolate(keys, 5)).toBe(50);
    expect(interpolate(keys, 15)).toBe(100);
    expect(interpolate(keys, 25)).toBe(50);
  });
  it("eases like CSS", () => {
    expect(ease("easeInOut", 0.5)).toBeCloseTo(0.5, 4);
    expect(ease("easeIn", 0.25)).toBeLessThan(0.25);
    expect(ease("easeOut", 0.25)).toBeGreaterThan(0.25);
    expect(ease([0, 0, 1, 1], 0.3)).toBeCloseTo(0.3, 4);
  });
  it("upsert replaces a key on the same frame", () => {
    const k = upsertKey(keys, { f: 10, v: 7 });
    expect(k.map((x) => x.v)).toEqual([0, 7, 50]);
  });
});
