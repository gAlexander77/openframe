import { describe, expect, it } from "vitest";
import { createColorClip } from "./project/defaults";
import type { ColorClip, Shape } from "./project/types";
import { blurredCover, cleanShape, ellipseOutlineAt, featherReach, parseColor, rectOutlineAt, resolveShape, shapeExtent, strokePx, trimCover } from "./shapes";

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

describe("a feather blurs the shape (ADR-099)", () => {
  // The truth: the shape's inside convolved with the Gaussian on a fine grid.
  const brute = (inside: (x: number, y: number) => boolean, qx: number, qy: number, s: number) => {
    const step = s / 30, reach = 4 * s;
    let sum = 0, all = 0;
    for (let y = -reach + step / 2; y < reach; y += step)
      for (let x = -reach + step / 2; x < reach; x += step) {
        const g = Math.exp(-(x * x + y * y) / (2 * s * s));
        all += g;
        if (inside(qx + x, qy + y)) sum += g;
      }
    return sum / all;
  };
  const roundBox = (bx: number, by: number, r: number) => (x: number, y: number) => {
    const ex = Math.abs(x) - bx + r, ey = Math.abs(y) - by + r;
    return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - r <= 0;
  };
  const worst = (cover: (x: number, y: number) => number, inside: (x: number, y: number) => boolean, bx: number, by: number, s: number) => {
    let w = 0;
    for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
      const [x, y] = [(i / 4) * (bx + 2 * s), (j / 3) * (by + 2 * s)];
      w = Math.max(w, Math.abs(cover(x, y) - brute(inside, x, y, s)));
    }
    return w * 255;
  };

  it("matches a true Gaussian blur of a long ellipse, a rectangle and a rounded rectangle to a level or two of 255", () => {
    // The launch-film case that creased: an ellipse 960 x 162 feathered 300.
    expect(worst((x, y) => blurredCover(x, y, 480, 81, 480, 81, 75), (x, y) => (x / 480) ** 2 + (y / 81) ** 2 <= 1, 480, 81, 75)).toBeLessThan(2);
    expect(worst((x, y) => blurredCover(x, y, 240, 65, 0, 0, 100), roundBox(240, 65, 0), 240, 65, 100)).toBeLessThan(2);
    expect(worst((x, y) => blurredCover(x, y, 144, 81, 28, 28, 40), roundBox(144, 81, 28), 144, 81, 40)).toBeLessThan(2);
  });

  it("has no crease or pinch: smooth through a long ellipse's middle, peaked at its center", () => {
    // The old Gaussian of the distance jumped here: along x the center was
    // 480 px deep, along y only 81.
    const row = Array.from({ length: 201 }, (_, i) => blurredCover(i - 100, 0, 480, 81, 480, 81, 75));
    const col = Array.from({ length: 201 }, (_, i) => blurredCover(0, i - 100, 480, 81, 480, 81, 75));
    const steps = (v: number[]) => Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
    expect(steps(row)).toBeLessThan(0.002);
    expect(steps(col)).toBeLessThan(0.005);
    expect(row[100]).toBeCloseTo(col[100], 9);
    expect(Math.max(...row, ...col)).toBe(row[100]);
  });

  it("is spent where the quad ends: three sigma past every side", () => {
    // featherReach grows the quad by three sigma; nothing past it may show.
    for (const [bx, by, cx, cy] of [[480, 81, 480, 81], [240, 65, 0, 0], [144, 81, 28, 28]])
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        expect(blurredCover(bx + 225, (by + 225) * t, bx, by, cx, cy, 75) * 255).toBeLessThan(0.5);
        expect(blurredCover((bx + 225) * t, by + 225, bx, by, cx, cy, 75) * 255).toBeLessThan(0.5);
      }
  });

  it("keeps a straight edge a Gaussian step centered on it, and a big shape's middle full", () => {
    // Phi, the standard normal's CDF (Abramowitz-Stegun 26.2.17).
    const Phi = (z: number) => {
      const t = 1 / (1 + 0.2316419 * Math.abs(z));
      const p = 0.3989423 * Math.exp((-z * z) / 2) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return z > 0 ? 1 - p : p;
    };
    for (const d of [-100, -50, 0, 50, 100]) expect(blurredCover(400 + d, 0, 400, 300, 0, 0, 50)).toBeCloseTo(Phi(-d / 50), 3);
    expect(blurredCover(0, 0, 400, 300, 40, 40, 50)).toBeGreaterThan(0.9999);
  });

  it("blurs a trimmed outline's two ends along it, as soft as its sides", () => {
    const per = 1000, s = 20;
    // Drawn 0..0.6 of the way: half at each end, full between, nothing in the gap.
    expect(trimCover(0, 0.6, per, s)).toBeCloseTo(0.5, 3);
    expect(trimCover(0.6, 0.6, per, s)).toBeCloseTo(0.5, 3);
    expect(trimCover(0.3, 0.6, per, s)).toBeGreaterThan(0.999);
    expect(trimCover(0.8, 0.6, per, s)).toBeLessThan(0.001);
    // Just before the start (round from the top, counterclockwise) as soft as just past the end.
    expect(trimCover(1 - 0.02, 0.6, per, s)).toBeCloseTo(trimCover(0.62, 0.6, per, s), 6);
    expect(trimCover(0.4, 0, per, s)).toBe(0);
  });
});
