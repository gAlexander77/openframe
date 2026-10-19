import { describe, expect, it } from "vitest";
import { ease, interpolate } from "./keyframes";
import {
  asBezier,
  clampDelta,
  copyKeys,
  curveRange,
  dragHandle,
  EASE_PRESETS,
  handlePoints,
  keyFrames,
  keysAt,
  LINEAR_BEZIER,
  moveKeys,
  pasteKeys,
  presetOf,
  removeKeys,
  retimeKey,
  setEase,
  setValues,
  toggleKeysAt,
  type KeyMap,
} from "./keyframeEdit";
import { createColorClip } from "./project/defaults";
import type { Clip } from "./project/types";

const map = (): KeyMap => ({
  "transform.scale": [
    { f: 0, v: 1 },
    { f: 10, v: 2, ease: "easeIn" },
    { f: 20, v: 1.5 },
  ],
  opacity: [
    { f: 10, v: 1 },
    { f: 30, v: 0 },
  ],
});

describe("finding keys", () => {
  it("lists each keyed frame once and what sits on it", () => {
    expect(keyFrames(map())).toEqual([0, 10, 20, 30]);
    expect(keysAt(map(), 10)).toEqual([
      { path: "transform.scale", f: 10 },
      { path: "opacity", f: 10 },
    ]);
    expect(keyFrames(undefined)).toEqual([]);
  });
});

describe("retiming", () => {
  it("moves one key and keeps the list sorted", () => {
    const { keys, refs } = retimeKey(map(), { path: "transform.scale", f: 10 }, 25, 40);
    expect(keys["transform.scale"].map((k) => k.f)).toEqual([0, 20, 25]);
    expect(keys["transform.scale"][2]).toMatchObject({ v: 2, ease: "easeIn" });
    expect(refs).toEqual([{ path: "transform.scale", f: 25 }]);
  });

  it("never leaves two keys on one frame: the moved key wins", () => {
    const { keys } = retimeKey(map(), { path: "transform.scale", f: 10 }, 20, 40);
    expect(keys["transform.scale"]).toEqual([
      { f: 0, v: 1 },
      { f: 20, v: 2, ease: "easeIn" },
    ]);
  });

  it("clamps to the clip's frames", () => {
    expect(retimeKey(map(), { path: "opacity", f: 30 }, 99, 40).keys.opacity.at(-1)!.f).toBe(39);
    expect(retimeKey(map(), { path: "opacity", f: 10 }, -5, 40).keys.opacity[0].f).toBe(0);
  });

  it("lets a key left outside by a trim come back, never further out", () => {
    const refs = [{ path: "a", f: -4 }];
    expect(clampDelta(refs, -3, 10)).toBe(0);
    expect(clampDelta(refs, 2, 10)).toBe(2);
    expect(clampDelta(refs, 50, 10)).toBe(13);
  });

  it("moves a set across paths together, the earliest stopping the group", () => {
    const sel = [
      { path: "transform.scale", f: 10 },
      { path: "opacity", f: 30 },
    ];
    const r = moveKeys(map(), sel, 15, 40);
    expect(r.delta).toBe(9); // opacity's key hits frame 39 first
    expect(r.keys.opacity.map((k) => k.f)).toEqual([10, 39]);
    expect(r.keys["transform.scale"].map((k) => k.f)).toEqual([0, 19, 20]);
    expect(r.refs).toEqual([
      { path: "transform.scale", f: 19 },
      { path: "opacity", f: 39 },
    ]);
  });

  it("keys within a moving set never collide with each other", () => {
    const sel = [
      { path: "transform.scale", f: 0 },
      { path: "transform.scale", f: 10 },
    ];
    const r = moveKeys(map(), sel, 10, 40);
    expect(r.keys["transform.scale"].map((k) => [k.f, k.v])).toEqual([
      [10, 1],
      [20, 2],
    ]);
  });

  it("ignores refs to keys that no longer exist", () => {
    const m = map();
    const r = moveKeys(m, [{ path: "opacity", f: 11 }], 3, 40);
    expect(r.keys).toBe(m);
    expect(r.refs).toEqual([]);
  });
});

describe("values, easing and removal", () => {
  it("sets values of selected keys only", () => {
    const m = map();
    const k = setValues(m, [{ path: "opacity", f: 30 }], (k) => k.v + 0.5);
    expect(k.opacity.map((x) => x.v)).toEqual([1, 0.5]);
    expect(k["transform.scale"]).toBe(m["transform.scale"]);
  });

  it("stores linear as no ease field and copies bezier arrays", () => {
    const bz: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const a = setEase(map(), [{ path: "transform.scale", f: 10 }], "linear");
    expect("ease" in a["transform.scale"][1]).toBe(false);
    const b = setEase(map(), [{ path: "transform.scale", f: 10 }], bz);
    expect(b["transform.scale"][1].ease).toEqual(bz);
    expect(b["transform.scale"][1].ease).not.toBe(bz);
  });

  it("removes keys, then empty paths, then the whole map", () => {
    const one = removeKeys(map(), [{ path: "opacity", f: 10 }, { path: "opacity", f: 30 }]);
    expect(Object.keys(one!)).toEqual(["transform.scale"]);
    const all = removeKeys(one, [0, 10, 20].map((f) => ({ path: "transform.scale", f })));
    expect(all).toBeUndefined();
  });
});

describe("section keyframe", () => {
  const clip = (): Clip => ({ ...createColorClip("#f00", 0, 60), transform: { x: 0.2, y: 0, scale: 1.5, rotation: 0, flipX: false, flipY: false } });
  const paths = ["transform.scale", "transform.x"];

  it("keys every property at its current value", () => {
    const c = toggleKeysAt(clip(), paths, 12);
    expect(c.keyframes).toEqual({ "transform.scale": [{ f: 12, v: 1.5 }], "transform.x": [{ f: 12, v: 0.2 }] });
  });

  it("fills in the missing ones, then removes them all", () => {
    const partly = { ...clip(), keyframes: { "transform.x": [{ f: 12, v: 0.4 }] } } as Clip;
    const full = toggleKeysAt(partly, paths, 12);
    expect(full.keyframes!["transform.x"]).toEqual([{ f: 12, v: 0.4 }]);
    expect(full.keyframes!["transform.scale"]).toEqual([{ f: 12, v: 1.5 }]);
    expect(toggleKeysAt(full, paths, 12).keyframes).toBeUndefined();
  });
});

describe("copy and paste", () => {
  it("pastes relative to the playhead with spacing kept", () => {
    const board = copyKeys(map(), [
      { path: "transform.scale", f: 10 },
      { path: "opacity", f: 30 },
    ])!;
    expect(board.keys).toEqual({ "transform.scale": [{ f: 0, v: 2, ease: "easeIn" }], opacity: [{ f: 20, v: 0 }] });
    const target = createColorClip("#00f", 100, 50);
    const { keys, refs } = pasteKeys(target, board, 5);
    expect(keys).toEqual({ "transform.scale": [{ f: 5, v: 2, ease: "easeIn" }], opacity: [{ f: 25, v: 0 }] });
    expect(refs).toHaveLength(2);
  });

  it("drops keys past the clip's end and paths the clip cannot hold", () => {
    const board = { keys: { opacity: [{ f: 0, v: 1 }, { f: 40, v: 0 }], "effects.fx9.amount": [{ f: 0, v: 3 }] } };
    const { keys } = pasteKeys(createColorClip("#00f", 0, 30), board, 2);
    expect(keys).toEqual({ opacity: [{ f: 2, v: 1 }] });
  });

  it("replaces keys already on the pasted frames", () => {
    const c = { ...createColorClip("#00f", 0, 30), keyframes: { opacity: [{ f: 2, v: 0.1 }, { f: 9, v: 0.3 }] } } as Clip;
    const { keys } = pasteKeys(c, { keys: { opacity: [{ f: 0, v: 1 }] } }, 2);
    expect(keys!.opacity).toEqual([{ f: 2, v: 1 }, { f: 9, v: 0.3 }]);
  });

  it("copies nothing from an empty selection", () => {
    expect(copyKeys(map(), [])).toBeNull();
  });
});

describe("bezier handles", () => {
  const a = { f: 10, v: 0 };
  const b = { f: 30, v: 100 };

  it("reads named eases as their CSS beziers, hold as none", () => {
    expect(asBezier("easeInOut")).toEqual([0.42, 0, 0.58, 1]);
    expect(asBezier(undefined)).toEqual(LINEAR_BEZIER);
    expect(asBezier("hold")).toBeNull();
  });

  it("places handles in frame and value space", () => {
    const h = handlePoints({ ...a, ease: [0.25, 0.1, 0.75, 0.9] }, b)!;
    expect(h.out).toEqual({ f: 15, v: 10 });
    expect(h.in).toEqual({ f: 25, v: 90 });
    expect(handlePoints({ ...a, ease: "hold" }, b)).toBeNull();
  });

  it("round-trips a dragged handle", () => {
    const bz = dragHandle({ ...a, ease: "easeIn" }, b, "out", { f: 14, v: 30 });
    expect(bz).toEqual([0.2, 0.3, 1, 1]);
    const h = handlePoints({ ...a, ease: bz }, b)!;
    expect(h.out.f).toBeCloseTo(14);
    expect(h.out.v).toBeCloseTo(30);
  });

  it("keeps time inside the segment so the curve never runs backward", () => {
    expect(dragHandle(a, b, "in", { f: 99, v: 50 })[2]).toBe(1);
    expect(dragHandle(a, b, "out", { f: -5, v: 50 })[0]).toBe(0);
  });

  it("allows overshoot within limits and keeps height on a flat segment", () => {
    expect(dragHandle(a, b, "in", { f: 20, v: 160 })[3]).toBe(1.6);
    expect(dragHandle(a, b, "in", { f: 20, v: 1e6 })[3]).toBe(4);
    const flat = dragHandle({ f: 0, v: 5, ease: [0.1, 0.2, 0.3, 0.4] }, { f: 10, v: 5 }, "out", { f: 5, v: 99 });
    expect(flat).toEqual([0.5, 0.2, 0.3, 0.4]);
  });
});

describe("presets", () => {
  it("every preset starts at 0 and ends at 1", () => {
    for (const p of EASE_PRESETS) {
      if (p.ease === "hold") continue;
      expect(ease(p.ease, 0), p.id).toBeCloseTo(0, 4);
      expect(ease(p.ease, 1), p.id).toBeCloseTo(1, 4);
    }
  });

  it("overshoot passes the target once; anticipate dips first", () => {
    const xs = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
    expect(Math.max(...xs.map((x) => ease([0.34, 1.56, 0.64, 1], x)))).toBeGreaterThan(1.05);
    expect(Math.min(...xs.map((x) => ease([0.36, 0, 0.66, -0.56], x)))).toBeLessThan(-0.05);
  });

  it("recognizes a key's preset, named or bezier", () => {
    expect(presetOf(undefined)!.id).toBe("linear");
    expect(presetOf("hold")!.id).toBe("hold");
    expect(presetOf([0.34, 1.56, 0.64, 1])!.id).toBe("overshoot");
    expect(presetOf([0.1, 0.1, 0.2, 0.2])).toBeNull();
  });
});

describe("value range", () => {
  it("includes overshoot between keys", () => {
    const keys = [{ f: 0, v: 0, ease: [0.34, 1.56, 0.64, 1] as [number, number, number, number] }, { f: 24, v: 10 }];
    const r = curveRange(keys);
    expect(r.min).toBe(0);
    expect(r.max).toBeGreaterThan(10.5);
    expect(interpolate(keys, 24)).toBe(10);
  });

  it("maps through display units", () => {
    expect(curveRange([{ f: 0, v: 0.5 }, { f: 10, v: 1 }], (v) => v * 100)).toEqual({ min: 50, max: 100 });
  });
});
