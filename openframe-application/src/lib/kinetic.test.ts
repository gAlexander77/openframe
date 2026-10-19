import { describe, expect, it } from "vitest";
import { ANIMATIONS } from "./catalog";
import { runCommand } from "./commands";
import { caretAfter, isMoving, kineticAt, layoutAtoms, lineSweeps, rankOf, sweepAt, unitProgress, unitStates, type KineticFrame } from "./kinetic";
import { createProject, createTextClip } from "./project/defaults";
import type { Animation, TextClip } from "./project/types";
import { animationAt, planFrame } from "./render/plan";

const title = (anim: Partial<Record<"animIn" | "animOut" | "animLoop", Animation>>, text = "Big summer sale"): TextClip => ({ ...createTextClip(text, 0, 90), ...anim });

describe("staggered progress", () => {
  it("spreads units so the last lands exactly at the end", () => {
    // Three units, one after another: each gets a third.
    expect(unitProgress(1 / 3, 0, 2, 1)).toBeCloseTo(1);
    expect(unitProgress(1 / 3, 1, 2, 1)).toBeCloseTo(0);
    expect(unitProgress(1, 2, 2, 1)).toBeCloseTo(1);
    // Stagger 0: everyone together.
    expect(unitProgress(0.5, 0, 2, 0)).toBeCloseTo(0.5);
    expect(unitProgress(0.5, 2, 2, 0)).toBeCloseTo(0.5);
    // Half stagger: unit 1 starts half a unit-time after unit 0.
    expect(unitProgress(0, 0, 2, 0.5)).toBe(0);
    expect(unitProgress(1, 2, 2, 0.5)).toBe(1);
    expect(unitProgress(0.25, 1, 2, 0.5)).toBe(0);
  });

  it("orders units forward, backward, from the center and at random, deterministically", () => {
    expect([0, 1, 2, 3, 4].map((i) => rankOf(i, 5, "forward"))).toEqual([0, 1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].map((i) => rankOf(i, 5, "backward"))).toEqual([4, 3, 2, 1, 0]);
    expect([0, 1, 2, 3, 4].map((i) => rankOf(i, 5, "center"))).toEqual([2, 1, 0, 1, 2]);
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rankOf(i, 8, "random"));
    expect([...r].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => rankOf(i, 8, "random"))).toEqual(r);
  });
});

describe("units", () => {
  it("splits lines into letters that know their word, and into words and lines", () => {
    const l = layoutAtoms(["Hi you", "go"], "letter");
    expect(l.letters).toBe(7);
    expect(l.words).toBe(3);
    expect(l.atoms.map((a) => [a.line, a.start, a.word])).toEqual([[0, 0, 0], [0, 1, 0], [0, 3, 1], [0, 4, 1], [0, 5, 1], [1, 0, 2], [1, 1, 2]]);
    const w = layoutAtoms(["Hi you", "go"], "word");
    expect(w.atoms.map((a) => [a.start, a.end, a.letter, a.word])).toEqual([[0, 2, 0, 0], [3, 6, 2, 1], [0, 2, 5, 2]]);
    const ln = layoutAtoms(["Hi you", "go"], "line");
    expect(ln.atoms.map((a) => [a.line, a.start, a.end])).toEqual([[0, 0, 6], [1, 0, 2]]);
  });

  it("keeps an emoji or accented letter whole", () => {
    expect(layoutAtoms(["é👍🏽a"], "letter").letters).toBe(3);
  });
});

describe("kinetic frames", () => {
  it("plays a typewriter per letter and leaves the whole layer alone", () => {
    const c = title({ animIn: { type: "typewriter", duration: 30 } });
    const k = kineticAt(c, 15, ANIMATIONS)!;
    expect(k.in).toMatchObject({ type: "typewriter", unit: "letter", stagger: 1, order: "forward", t: 0.5 });
    expect(animationAt(c, 0).opacity).toBe(1);
    expect(kineticAt(c, 30, ANIMATIONS)).toBeUndefined();
    // Half way, 7 of the 13 letters show (the 7th just typed), hard on or off.
    const laid = layoutAtoms(["Big summer sale"], "letter");
    const op = unitStates(laid.atoms, laid, k, ANIMATIONS).map((s) => s.opacity);
    expect(op.filter((o) => o === 1).length).toBe(7);
    expect(op.every((o) => o === 0 || o === 1)).toBe(true);
    expect(caretAfter(k, laid.letters, ANIMATIONS)).toBe(7);
  });

  it("deletes from the end as a typewriter out", () => {
    const c = title({ animOut: { type: "typewriter", duration: 30 } });
    const k = kineticAt(c, 75, ANIMATIONS)!;
    expect(k.out).toMatchObject({ order: "backward", t: 0.5 });
    const laid = layoutAtoms(["Big summer sale"], "letter");
    const op = unitStates(laid.atoms, laid, k, ANIMATIONS).map((s) => s.opacity);
    expect(op[0]).toBe(1);
    expect(op[op.length - 1]).toBe(0);
  });

  it("runs any animation per word when asked, rising from below", () => {
    const c = title({ animIn: { type: "rise", duration: 20, unit: "word", stagger: 1 } });
    expect(animationAt(c, 5).y).toBe(0);
    const k = kineticAt(c, 5, ANIMATIONS)!;
    const laid = layoutAtoms(["Big summer sale"], "word");
    const [a, b, z] = unitStates(laid.atoms, laid, k, ANIMATIONS);
    expect(a.opacity).toBeGreaterThan(0.5);
    expect(a.y).toBeGreaterThan(0);
    expect(b.opacity).toBe(0);
    expect(z.y).toBeCloseTo(0.08 * (1080 / 96));
    // A rise without a unit still moves the whole title.
    expect(animationAt(title({ animIn: { type: "rise", duration: 20 } }), 5).y).toBeGreaterThan(0);
  });

  it("pops words past full size before they settle", () => {
    const c = title({ animIn: { type: "wordPop", duration: 30 } });
    const laid = layoutAtoms(["Big summer sale"], "word");
    const scales = [8, 12, 16].map((r) => unitStates(laid.atoms, laid, kineticAt(c, r, ANIMATIONS)!, ANIMATIONS)[0].scale);
    expect(Math.max(...scales)).toBeGreaterThan(1.02);
  });

  it("waves a loop through the letters", () => {
    const c = title({ animLoop: { type: "float", duration: 30, unit: "letter", stagger: 1 } });
    const k = kineticAt(c, 0, ANIMATIONS)!;
    const laid = layoutAtoms(["Big"], "letter");
    const ys = unitStates(laid.atoms, laid, k, ANIMATIONS).map((s) => s.y);
    expect(new Set(ys.map((y) => y.toFixed(4))).size).toBe(3);
  });

  it("sweeps a marker in across lines by width, and out again", () => {
    const c = title({ animIn: { type: "highlightSweep", duration: 20 }, animOut: { type: "underlineWipe", duration: 20 } });
    const kin = kineticAt(c, 10, ANIMATIONS)!;
    // Half way in, the underline that sweeps out later is already drawn.
    expect(sweepAt(kin, ANIMATIONS)).toEqual({ marker: 0.5, underline: 1 });
    expect(sweepAt(kineticAt(c, 89, ANIMATIONS)!, ANIMATIONS)!.underline).toBeLessThan(0.1);
    // Between the two, the marker swept in stays: a still frame.
    const rest = kineticAt(c, 45, ANIMATIONS)!;
    expect(sweepAt(rest, ANIMATIONS)).toEqual({ marker: 1, underline: 1 });
    expect(isMoving(rest)).toBe(false);
    expect(isMoving(kin)).toBe(true);
    expect(lineSweeps([300, 100], 0.5)).toEqual([2 / 3, 0]);
    expect(lineSweeps([300, 100], 1)).toEqual([1, 1]);
  });

  it("travels to the rasterizer through the render plan", () => {
    let p = createProject();
    p = runCommand(p, "add_text", { text: "Hello there", start: 0, duration: 3 });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "set_animation", { clip_id: id, slot: "in", type: "wordPop", duration: 1, order: "center" });
    const at = (f: number) => {
      const item = planFrame(p, f)[0];
      return item.kind === "layer" && item.layer.source.kind === "text" ? item.layer.source.kinetic : "none";
    };
    expect((at(10) as KineticFrame).in).toMatchObject({ type: "wordPop", order: "center" });
    expect(at(60)).toBeUndefined();
  });
});

describe("set_animation per unit", () => {
  const setup = () => {
    let p = createProject();
    p = runCommand(p, "add_text", { text: "Hello", start: 0, duration: 3 });
    p = runCommand(p, "add_color_clip", { color: "#000", start: 0, duration: 3 });
    const [text, color] = p.tracks.flatMap((t) => t.clips).sort((a) => (a.type === "text" ? -1 : 1));
    return { p, text: text.id, color: color.id };
  };

  it("stores unit, stagger and order on a title", () => {
    const { p, text } = setup();
    const q = runCommand(p, "set_animation", { clip_id: text, slot: "out", type: "drop", unit: "letter", stagger: 0.3, order: "random", duration: 0.6 });
    expect((q.tracks.flatMap((t) => t.clips).find((c) => c.id === text) as TextClip).animOut).toEqual({ type: "drop", duration: 18, unit: "letter", stagger: 0.3, order: "random" });
  });

  it("refuses kinetic presets and units on pictures, loops in the wrong slot, and units on sweeps", () => {
    const { p, text, color } = setup();
    expect(() => runCommand(p, "set_animation", { clip_id: color, slot: "in", type: "typewriter" })).toThrow(/text clips only/);
    expect(() => runCommand(p, "set_animation", { clip_id: color, slot: "in", type: "rise", unit: "word" })).toThrow(/text clips only/);
    expect(() => runCommand(p, "set_animation", { clip_id: text, slot: "in", type: "pulse" })).toThrow(/slot loop/);
    expect(() => runCommand(p, "set_animation", { clip_id: text, slot: "loop", type: "rise" })).toThrow(/slot in or out/);
    expect(() => runCommand(p, "set_animation", { clip_id: text, slot: "in", type: "highlightSweep", unit: "word" })).toThrow(/no unit/);
  });
});
