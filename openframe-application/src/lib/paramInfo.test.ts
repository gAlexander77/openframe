import { describe, expect, it } from "vitest";
import { formatParam, paramInfo } from "./paramInfo";
import { createColorClip } from "./project/defaults";
import type { Clip } from "./project/types";

const canvas = { width: 1920, height: 1080 };
const clip = { ...createColorClip("#f00", 0, 30), effects: [{ id: "fx1", type: "glitch", enabled: true, params: { amount: 50, speed: 50 } }] } as Clip;

describe("paramInfo", () => {
  it("names parameters the way the inspector does", () => {
    expect(paramInfo("transform.scale", clip, canvas).label).toBe("Scale");
    expect(paramInfo("adjust.temperature", clip, canvas).label).toBe("Temp");
    expect(paramInfo("adjust.exposure", clip, canvas).label).toBe("Exposure");
    expect(paramInfo("effects.fx1.speed", clip, canvas).label).toBe("Glitch · Speed");
  });

  it("shows inspector units and converts back exactly", () => {
    const y = paramInfo("transform.y", clip, canvas);
    expect(y.show(0.25)).toBe(-270);
    expect(y.store(y.show(0.25))).toBeCloseTo(0.25);
    const s = paramInfo("transform.scale", clip, canvas);
    expect(formatParam(s, 1.2)).toBe("120%");
    expect(formatParam(paramInfo("transform.x", clip, canvas), 0.1)).toBe("192 px");
  });

  it("reads volume in dB with silence at the floor", () => {
    const v = paramInfo("volume", clip, canvas);
    expect(v.show(1)).toBeCloseTo(0);
    expect(v.store(-60)).toBe(0);
    expect(formatParam(v, 0.5)).toBe("-6.0 dB");
  });
});
