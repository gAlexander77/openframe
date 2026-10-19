import { describe, expect, it } from "vitest";
import { animThumb, THUMB_H, THUMB_W } from "./animThumb";
import { ANIMATIONS } from "./catalog";

const inPresets = Object.keys(ANIMATIONS).filter((k) => ANIMATIONS[k].from || ANIMATIONS[k].text);
const loops = Object.keys(ANIMATIONS).filter((k) => ANIMATIONS[k].loop);

describe("animThumb", () => {
  it("draws every preset differently from every other in its slot", () => {
    for (const [slot, list] of [["in", inPresets], ["out", inPresets], ["loop", loops]] as const) {
      const seen = new Map<string, string>();
      for (const k of list) {
        const key = JSON.stringify(animThumb(k, slot, ANIMATIONS));
        expect(seen.get(key), `${slot} ${k} looks like ${seen.get(key)}`).toBeUndefined();
        seen.set(key, k);
      }
    }
  });

  it("shows where a layer comes from: a slide from the right starts right, a rise below", () => {
    const ghost = (k: string) => animThumb(k, "in", ANIMATIONS).find((m) => m.kind === "ghost")!;
    expect(ghost("slideLeft").x).toBeGreaterThan(THUMB_W / 2);
    expect(ghost("slideRight").x).toBeLessThan(THUMB_W / 2);
    expect(ghost("rise").y).toBeGreaterThan(THUMB_H / 2);
    expect(ghost("drop").y).toBeLessThan(THUMB_H / 2);
    expect(ghost("zoomIn").scale).toBeLessThan(1);
    expect(ghost("zoomOut").scale).toBeGreaterThan(1);
    expect(ghost("spin").rotation).not.toBe(0);
    // A fade or a blur in place shows on the layer itself.
    const layer = (k: string) => animThumb(k, "in", ANIMATIONS).find((m) => m.kind === "solid")!;
    expect(layer("fade").opacity).toBeLessThan(1);
    expect(layer("blurIn").blur).toBe(true);
    expect(animThumb("fade", "in", ANIMATIONS).some((m) => m.kind === "ghost")).toBe(false);
  });

  it("swings a loop both ways and keeps tiny loops visible", () => {
    const ghosts = animThumb("float", "loop", ANIMATIONS).filter((m) => m.kind === "ghost");
    expect(ghosts).toHaveLength(2);
    expect(Math.min(...ghosts.map((g) => g.y))).toBeLessThanOrEqual(THUMB_H / 2 - 3);
    expect(Math.max(...ghosts.map((g) => g.y))).toBeGreaterThanOrEqual(THUMB_H / 2 + 3);
  });

  it("draws titles' presets as units part-way, with a caret for the typewriter", () => {
    const tw = animThumb("typewriter", "in", ANIMATIONS);
    expect(tw.filter((m) => m.kind === "unit")).toHaveLength(6);
    expect(tw.some((m) => m.kind === "caret")).toBe(true);
    expect(animThumb("lineRise", "in", ANIMATIONS).filter((m) => m.kind === "unit")).toHaveLength(2);
    expect(animThumb("highlightSweep", "in", ANIMATIONS).some((m) => m.kind === "marker")).toBe(true);
  });

  it("keeps every mark's center inside the frame and draws nothing for None", () => {
    for (const k of Object.keys(ANIMATIONS))
      for (const m of animThumb(k, ANIMATIONS[k].loop ? "loop" : "in", ANIMATIONS)) {
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(THUMB_W);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(THUMB_H);
      }
    expect(animThumb(null, "in", ANIMATIONS)).toEqual([]);
  });
});
