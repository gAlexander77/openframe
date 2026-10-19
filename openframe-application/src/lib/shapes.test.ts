import { describe, expect, it } from "vitest";
import { createColorClip } from "./project/defaults";
import type { ColorClip, Shape } from "./project/types";
import { cleanShape, ellipseOutlineAt, featherReach, parseColor, rectOutlineAt, resolveShape, shapeExtent, strokePx } from "./shapes";

describe("rectOutlineAt", () => {
  // A square of half size 100: perimeter 800, from the top center clockwise.
  const at = (x: number, y: number, r = 0) => rectOutlineAt(x, y, 100, 100, r);

  it("starts at the top center and runs clockwise on screen (y down)", () => {
    expect(at(0, -100)).toBeCloseTo(0, 6);
    expect(at(100, -100)).toBeCloseTo(0.125, 6); // top-right corner
    expect(at(100, 0)).toBeCloseTo(0.25, 6); // right middle
    expect(at(100, 100)).toBeCloseTo(0.375, 6);
    expect(at(0, 100)).toBeCloseTo(0.5, 6); // bottom center
    expect(at(-100, 0)).toBeCloseTo(0.75, 6); // left middle
    expect(at(-1, -100)).toBeGreaterThan(0.99); // just before the start
  });

  it("reads points near the outline, inside or out, as their nearest edge", () => {
    expect(at(50, -95)).toBeCloseTo(at(50, -100), 6);
    expect(at(50, -105)).toBeCloseTo(at(50, -100), 6);
    expect(at(96, 30)).toBeCloseTo(at(100, 30), 6);
  });

  it("goes round a rounded corner by arc length", () => {
    // Radius 40: straight top 60, quarter arc 20 pi, right side down to the middle 60.
    const total = 4 * 60 + 4 * 60 + 2 * Math.PI * 40;
    expect(at(60, -100, 40)).toBeCloseTo(60 / total, 6); // where the corner begins
    const c = 60 + 40 * Math.SQRT1_2; // the corner's middle, on the arc
    expect(at(c, -c, 40)).toBeCloseTo((60 + 10 * Math.PI) / total, 6);
    expect(at(100, -60, 40)).toBeCloseTo((60 + 20 * Math.PI) / total, 6);
  });

  it("is continuous along the whole outline", () => {
    const pts: number[] = [];
    for (let a = 0; a < 2 * Math.PI; a += 0.01) {
      // Points on a rounded square's outline, parameterized by angle.
      const x = Math.sin(a), y = -Math.cos(a);
      const k = 100 / Math.max(Math.abs(x), Math.abs(y));
      pts.push(rectOutlineAt(x * k, y * k, 100, 60, 20));
    }
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i] - pts[i - 1])).toBeLessThan(0.02);
  });
});

describe("ellipseOutlineAt", () => {
  it("measures the angle from the top, clockwise", () => {
    expect(ellipseOutlineAt(0, -50, 200, 50)).toBeCloseTo(0, 6);
    expect(ellipseOutlineAt(200, 0, 200, 50)).toBeCloseTo(0.25, 6);
    expect(ellipseOutlineAt(0, 50, 200, 50)).toBeCloseTo(0.5, 6);
    expect(ellipseOutlineAt(-200, 0, 200, 50)).toBeCloseTo(0.75, 6);
  });
});

describe("parseColor", () => {
  it("reads hex, rgb(), rgba() and names", () => {
    expect(parseColor("#fff")).toEqual([1, 1, 1, 1]);
    expect(parseColor("#ff000080")?.map((v) => +v.toFixed(3))).toEqual([1, 0, 0, 0.502]);
    expect(parseColor("#00FF00")).toEqual([0, 1, 0, 1]);
    expect(parseColor("rgba(0, 0, 255, 0.5)")).toEqual([0, 0, 1, 0.5]);
    expect(parseColor("rgb(255 0 0 / 50%)")).toEqual([1, 0, 0, 0.5]);
    expect(parseColor(" White ")).toEqual([1, 1, 1, 1]);
    expect(parseColor("transparent")).toEqual([0, 0, 0, 0]);
  });

  it("refuses what it cannot read", () => {
    expect(parseColor("#12")).toBeNull();
    expect(parseColor("blurple")).toBeNull();
    expect(parseColor("rgb(1,2)")).toBeNull();
  });
});

describe("shape geometry", () => {
  const rect: Shape = { kind: "rectangle", width: 0.5, height: 0.2, stroke: { color: "#fff", width: 10.8 } };

  it("measures the box plus the stroke's outer half", () => {
    expect(strokePx(rect, 1080)).toBeCloseTo(10.8, 6);
    expect(shapeExtent(rect, 1920, 1080)).toEqual({ w: 960 + 10.8, h: 216 + 10.8 });
  });

  it("measures a line by its length and thickness, 8 px at 1080p by default", () => {
    expect(shapeExtent({ kind: "line", width: 0.25, height: 0.1 }, 1920, 1080)).toEqual({ w: 480, h: 8 });
    expect(strokePx({ kind: "line", width: 0.25, height: 0.1 }, 540)).toBe(4);
  });
});

describe("resolveShape", () => {
  const clip = (shape: Shape, keyframes?: ColorClip["keyframes"]): ColorClip => ({ ...createColorClip("#f00", 0, 60), shape, ...(keyframes ? { keyframes } : {}) });

  it("fills defaults: square corners, fully drawn", () => {
    const s = resolveShape(clip({ kind: "rectangle", width: 0.3, height: 0.1 }), 0)!;
    expect([s.radius, s.draw]).toEqual([0, 1]);
    expect(resolveShape(createColorClip("#f00", 0, 10), 0)).toBeUndefined();
  });

  it("reads keyed numbers at the frame", () => {
    const c = clip({ kind: "line", width: 0.3, height: 0.1, stroke: { color: "#fff", width: 4 } }, {
      "shape.draw": [{ f: 0, v: 0 }, { f: 20, v: 1 }],
      "shape.stroke.width": [{ f: 0, v: 4 }, { f: 20, v: 24 }],
    });
    const s = resolveShape(c, 10)!;
    expect(s.draw).toBeCloseTo(0.5, 6);
    expect(s.stroke!.width).toBeCloseTo(14, 6);
    expect(resolveShape(c, 40)!.draw).toBe(1);
  });

  it("clamps draw and radius into 0..1", () => {
    const s = resolveShape(clip({ kind: "rectangle", width: 0.3, height: 0.1 }, { "shape.draw": [{ f: 0, v: 1.4 }], "shape.radius": [{ f: 0, v: -1 }] }), 0)!;
    expect([s.draw, s.radius]).toEqual([1, 0]);
  });
});

describe("cleanShape", () => {
  it("keeps a valid shape and its optional parts", () => {
    const s = { kind: "rectangle", width: 0.4, height: 0.1, radius: 0.5, fill: false, gradient: { from: "#000", to: "#fff", angle: 90 }, stroke: { color: "#fff", width: 6 }, draw: 0.3 };
    expect(cleanShape(s)).toEqual(s);
  });

  it("drops what is not one and clamps the rest", () => {
    expect(cleanShape({ kind: "star", width: 1, height: 1 })).toBeUndefined();
    expect(cleanShape("rectangle")).toBeUndefined();
    expect(cleanShape({ kind: "ellipse", width: -2, height: "x", radius: 3, draw: 1, stroke: { color: "#fff" } })).toEqual({ kind: "ellipse", width: 0.001, height: 0.1, radius: 1 });
  });
});

describe("feather and radial gradients (ADR-069)", () => {
  const clip = (shape: Shape, keyframes?: ColorClip["keyframes"]): ColorClip => ({ ...createColorClip("#f00", 0, 60), shape, ...(keyframes ? { keyframes } : {}) });

  it("resolve a crisp edge and a centered radial fill out to the box's sides", () => {
    const s = resolveShape(clip({ kind: "ellipse", width: 0.3, height: 0.3, gradient: { from: "#fff", to: "#0000", angle: 0, kind: "radial" } }), 0)!;
    expect(s.feather).toBe(0);
    expect(s.gradient).toEqual({ from: "#fff", to: "#0000", angle: 0, kind: "radial", x: 0, y: 0, radius: 1 });
    // A linear one gains nothing.
    expect(resolveShape(clip({ kind: "rectangle", width: 0.3, height: 0.1, gradient: { from: "#fff", to: "#000", angle: 90 } }), 0)!.gradient).toEqual({ from: "#fff", to: "#000", angle: 90 });
  });

  it("key the feather and the radial center and radius", () => {
    const c = clip({ kind: "ellipse", width: 0.3, height: 0.3, feather: 40, gradient: { from: "#fff", to: "#000", angle: 0, kind: "radial" } }, {
      "shape.feather": [{ f: 0, v: 0 }, { f: 10, v: 200 }],
      "shape.gradient.radius": [{ f: 0, v: 0.5 }, { f: 10, v: 1.5 }],
      "shape.gradient.x": [{ f: 0, v: -0.2 }, { f: 10, v: 0.2 }],
    });
    const s = resolveShape(c, 5)!;
    expect(s.feather).toBeCloseTo(100, 6);
    expect(s.gradient).toMatchObject({ radius: 1, x: 0, y: 0 });
    expect(resolveShape(clip({ kind: "ellipse", width: 0.3, height: 0.3, feather: 40 }, { "shape.feather": [{ f: 0, v: -9 }] }), 0)!.feather).toBe(0);
  });

  it("load from JSON: kept when valid, defaults left out, nonsense dropped", () => {
    const radial = { kind: "ellipse", width: 0.4, height: 0.4, feather: 120, gradient: { from: "#fff", to: "#0000", angle: 0, kind: "radial", x: 0.1, radius: 0.8 } };
    expect(cleanShape(radial)).toEqual(radial);
    expect(cleanShape({ kind: "ellipse", width: 0.4, height: 0.4, feather: -3, gradient: { from: "#fff", to: "#000", kind: "radial", x: 0, y: 0, radius: 1 } })).toEqual({ kind: "ellipse", width: 0.4, height: 0.4, gradient: { from: "#fff", to: "#000", angle: 0, kind: "radial" } });
    expect(cleanShape({ kind: "ellipse", width: 0.4, height: 0.4, gradient: { from: "#fff", to: "#000", kind: "conic" } })!.gradient).toEqual({ from: "#fff", to: "#000", angle: 0 });
  });

  it("reaches three sigma (three quarters of the feather) past the outline", () => {
    expect(featherReach(200, 1080)).toBe(150);
    expect(featherReach(200, 2160)).toBe(300);
    expect(featherReach(0, 1080)).toBe(0);
  });
});
