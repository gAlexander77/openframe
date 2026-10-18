// The overshooting eases (ADR-060): spring, elastic, bounce.
import { describe, expect, it } from "vitest";
import { readEffectPreset } from "./effectPresets";
import { asBezier, EASE_IDS, easeById, handlePoints } from "./keyframeEdit";
import { ease, interpolate, NAMED_EASES } from "./keyframes";

const curve = (name: "spring" | "elastic" | "bounce") => Array.from({ length: 1001 }, (_, i) => ease(name, i / 1000));

describe("overshooting eases", () => {
  it("start at 0 and land exactly on 1", () => {
    for (const name of ["spring", "elastic", "bounce"] as const) {
      expect(ease(name, 0)).toBeCloseTo(0, 9);
      expect(ease(name, 1)).toBeCloseTo(1, 9);
    }
  });

  it("spring passes the target once by about a fifth, then settles", () => {
    const c = curve("spring");
    expect(Math.max(...c)).toBeGreaterThan(1.15);
    expect(Math.max(...c)).toBeLessThan(1.3);
    // Settled within a percent over the last fifth.
    expect(c.slice(800).every((v) => Math.abs(v - 1) < 0.01)).toBe(true);
  });

  it("elastic snaps past further and wobbles", () => {
    expect(Math.max(...curve("elastic"))).toBeGreaterThan(1.3);
  });

  it("bounce never passes the target but turns back", () => {
    const c = curve("bounce");
    expect(Math.max(...c)).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.slice(1).some((v, i) => v < c[i] - 1e-6)).toBe(true);
  });

  it("drive keyframes", () => {
    const keys = [{ f: 0, v: 10, ease: "spring" as const }, { f: 30, v: 20 }];
    const vs = Array.from({ length: 31 }, (_, f) => interpolate(keys, f));
    expect(Math.max(...vs)).toBeGreaterThan(21);
    expect(vs[30]).toBe(20);
  });
});

describe("names", () => {
  it("an unknown name reads as linear instead of failing the frame", () => {
    expect(ease("wobble" as never, 0.3)).toBeCloseTo(0.3, 12);
  });

  it("are presets, with no bezier handles", () => {
    for (const id of ["spring", "elastic", "bounce"]) {
      expect(EASE_IDS).toContain(id);
      expect(NAMED_EASES).toContain(id);
      expect(easeById(id)).toBe(id);
      expect(asBezier(easeById(id))).toBeNull();
    }
    expect(handlePoints({ f: 0, v: 0, ease: "spring" }, { f: 10, v: 1 })).toBeNull();
  });

  it("are accepted in effect presets", () => {
    const preset = {
      id: "p",
      name: "Pop",
      stack: { fps: { num: 30, den: 1 }, effects: [{ id: "fx1", type: "blur", params: { amount: 10 } }], keyframes: { "effects.fx1.amount": [{ f: 0, v: 0, ease: "bounce" }, { f: 10, v: 20 }] } },
    };
    expect(readEffectPreset(preset).stack.keyframes["effects.fx1.amount"][0].ease).toBe("bounce");
  });
});
