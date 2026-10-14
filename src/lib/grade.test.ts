import { describe, expect, it } from "vitest";
import {
  applyHsl,
  applyWheels,
  balanceToPuck,
  bandsAt,
  cleanGrade,
  gradeRgb,
  HSL_BANDS,
  hslToRgb,
  hueToPuck,
  puckToBalance,
  resolveGrade,
  rgbToHsl,
  type WheelParams,
} from "./grade";
import { identityLut } from "./lut";
import { createColorClip, createProject } from "./project/defaults";
import type { Clip, Grade } from "./project/types";

const shifts = (band: string, h: number, s: number, l: number) => {
  const v = new Array(24).fill(0);
  const i = HSL_BANDS.indexOf(band as never);
  v[i * 3] = h;
  v[i * 3 + 1] = s;
  v[i * 3 + 2] = l;
  return v;
};
const close = (a: number[], b: number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

describe("HSL", () => {
  it("converts to HSL and back", () => {
    for (const c of [[0.75, 0, 0], [0.2, 0.6, 0.9], [1, 1, 1], [0.1, 0.1, 0.4]] as [number, number, number][]) {
      close(hslToRgb(rgbToHsl(c)), c, 9);
    }
    close(rgbToHsl([0, 0.75, 0.75]), [0.5, 1, 0.375], 9);
  });

  it("weights two neighboring bands that always sum to one", () => {
    expect(bandsAt(0)).toEqual({ a: 0, b: 1, t: 0 });
    expect(bandsAt(60)).toEqual({ a: 2, b: 3, t: 0 });
    expect(bandsAt(340)).toMatchObject({ a: 7, b: 0 });
    expect(bandsAt(15).t).toBeCloseTo(0.5, 9);
  });

  it("changes only the chosen color range", () => {
    const desat = shifts("red", 0, -1, 0);
    const red = applyHsl([0.75, 0, 0], desat);
    expect(red[0] - red[1]).toBeCloseTo(0, 6); // gray now
    for (const other of [[0.75, 0.75, 0], [0, 0.75, 0], [0, 0, 0.75], [0.75, 0, 0.75], [0, 0.75, 0.75], [0.5, 0.5, 0.5]] as [number, number, number][]) {
      close(applyHsl(other, desat), other, 9);
    }
  });

  it("turns hue toward the neighbors and changes lightness", () => {
    const [h] = rgbToHsl(applyHsl([0.75, 0, 0], shifts("red", 1, 0, 0)));
    expect(h * 360).toBeCloseTo(30, 4);
    const lighter = applyHsl([0.75, 0, 0], shifts("red", 0, 0, 1));
    expect(rgbToHsl(lighter)[2]).toBeCloseTo(0.375 + 0.625 * 0.5, 6);
  });
});

describe("wheels", () => {
  const zero: WheelParams = { lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0], offset: [0, 0, 0] };

  it("lift moves blacks with white pinned; gain moves whites with black pinned", () => {
    const lift = { ...zero, lift: [0.2, 0.2, 0.2] as [number, number, number] };
    close(applyWheels([0, 0, 0], lift), [0.1, 0.1, 0.1]);
    close(applyWheels([1, 1, 1], lift), [1, 1, 1]);
    const gain = { ...zero, gain: [-0.5, -0.5, -0.5] as [number, number, number] };
    close(applyWheels([0, 0, 0], gain), [0, 0, 0]);
    close(applyWheels([1, 1, 1], gain), [0.5, 0.5, 0.5]);
  });

  it("gamma bends the middle and keeps both ends", () => {
    const g = { ...zero, gamma: [1, 1, 1] as [number, number, number] };
    close(applyWheels([0.25, 0, 1], g), [0.5, 0, 1]);
  });

  it("puck and balance round-trip, and a balance carries no luma", () => {
    const bal = puckToBalance(0.3, -0.4);
    expect(0.2126 * bal.r + 0.7152 * bal.g + 0.0722 * bal.b).toBeCloseTo(0, 9);
    close(balanceToPuck(bal.r, bal.g, bal.b), [0.3, -0.4], 9);
    // red sits up and slightly left, where the vectorscope draws it
    const [x, y] = hueToPuck(0, 50);
    expect(Math.hypot(x, y)).toBeCloseTo(0.5, 9);
    expect((Math.atan2(y, x) * 180) / Math.PI).toBeCloseTo(103, 0);
    expect(puckToBalance(...hueToPuck(240, 100)).b).toBeGreaterThan(50);
  });
});

describe("resolveGrade", () => {
  const withGrade = (g: Grade, keyframes?: Clip["keyframes"]): Clip => {
    const c = createColorClip("#808080", 0, 100);
    return { ...c, adjust: { ...c.adjust, ...g }, keyframes } as Clip;
  };

  it("leaves an ungraded clip alone", () => {
    expect(resolveGrade(createProject(), withGrade({}) as never, 0)).toBeUndefined();
    expect(resolveGrade(createProject(), withGrade({ hsl: { red: { hue: 0, saturation: 0, lightness: 0 } }, curves: { luma: [[0, 0], [1, 1]] } }) as never, 0)).toBeUndefined();
  });

  it("resolves keyframed wheels and adds luminance to each channel", () => {
    const clip = withGrade({ wheels: { lift: { r: 10, g: 0, b: -10, y: 5 } } }, { "adjust.wheels.lift.y": [{ f: 0, v: 0 }, { f: 10, v: 20 }] });
    const g = resolveGrade(createProject(), clip as never, 5)!;
    close(g.wheels!.lift, [0.2, 0.1, 0]);
    close(g.wheels!.gain, [0, 0, 0]);
  });

  it("finds the LUT's file and drops it at zero intensity", () => {
    const p = { ...createProject(), luts: [{ id: "l1", name: "Look", src: "look.cube", kind: "3d" as const, size: 33 }] };
    expect(resolveGrade(p, withGrade({ lut: { id: "l1", intensity: 0.4 } }) as never, 0)?.lut).toEqual({ src: "look.cube", intensity: 0.4 });
    expect(resolveGrade(p, withGrade({ lut: { id: "l1", intensity: 0 } }) as never, 0)).toBeUndefined();
  });
});

describe("gradeRgb", () => {
  it("an identity LUT at full intensity changes nothing", () => {
    const g = { lut: { src: "x", intensity: 1 } };
    close(gradeRgb([0.2, 0.5, 0.9], g, identityLut("3d", 17)), [0.2, 0.5, 0.9]);
  });
});

describe("cleanGrade", () => {
  it("keeps known parts, fills numbers, drops junk", () => {
    const a = cleanGrade({
      exposure: 3,
      hsl: { red: { hue: 10 }, chartreuse: { hue: 5 } },
      curves: { luma: [[1, 1], [0, 0]], r: "bad" },
      wheels: { lift: { y: 4 }, sparkle: {} },
      lut: { id: "l1" },
    });
    expect(a).toEqual({
      exposure: 3,
      hsl: { red: { hue: 10, saturation: 0, lightness: 0 } },
      curves: { luma: [[0, 0], [1, 1]] },
      wheels: { lift: { r: 0, g: 0, b: 0, y: 4 } },
      lut: { id: "l1", intensity: 1 },
    });
    expect(cleanGrade({ exposure: 0, hsl: {}, curves: { r: [] } })).toEqual({ exposure: 0 });
  });
});
