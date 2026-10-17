import { expect, it } from "vitest";
import { AH, AW, shiftBetween, spectrum, stabilization } from "./stabilize";

/** A view into a fixed random texture (like real footage: detail at many
 * scales, nothing repeating), moved by (sx, sy) pixels. */
const TEX = 256;
const tex = (() => {
  let s = 7;
  const r = Float32Array.from({ length: TEX * TEX }, () => ((s = (s * 16807) % 2147483647) / 2147483647) * 255);
  // Blur once so sub-pixel moves interpolate smoothly.
  return Float32Array.from(r, (_, i) => (r[i] + r[(i + 1) % r.length] + r[(i + TEX) % r.length] + r[(i + TEX + 1) % r.length]) / 4);
})();
function frame(sx: number, sy: number) {
  const g = new Float32Array(AW * AH);
  for (let y = 0; y < AH; y++)
    for (let x = 0; x < AW; x++) {
      const u = x - sx + 60, v = y - sy + 60;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const at = (a: number, b: number) => tex[b * TEX + a];
      g[y * AW + x] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  return g;
}

it("measures how far a frame moved, to a fraction of a pixel", () => {
  const a = spectrum(frame(0, 0));
  for (const [sx, sy] of [[3, 0], [0, -2], [5.5, 1.5], [-4, 3]]) {
    const m = shiftBetween(a, spectrum(frame(sx, sy)));
    expect(m.dx).toBeCloseTo(sx, 0);
    expect(m.dy).toBeCloseTo(sy, 0);
  }
});

it("cancels shake and keeps a deliberate pan", () => {
  // A steady pan of 1 px a frame plus shake of +-3 px.
  const moves = Array.from({ length: 120 }, (_, i) => ({ dx: 1 + (i % 2 ? 3 : -3), dy: 0 }));
  const s = stabilization(moves, "recommended");
  // The shaken path plus its correction is the smooth one: neighbors differ
  // by about the pan, not the shake.
  let path = 0;
  const fixed = [0, ...moves.map((m) => (path += m.dx / AW))].map((p, i) => p + s.x[i]);
  const steps = fixed.slice(1).map((v, i) => (v - fixed[i]) * AW);
  for (const d of steps.slice(10, -10)) expect(Math.abs(d - 1)).toBeLessThan(0.5);
  expect(s.zoom).toBeGreaterThan(1);
  expect(s.zoom).toBeLessThanOrEqual(1.15);
});

it("never zooms past its level and holds corrections inside the margin", () => {
  const moves = Array.from({ length: 60 }, (_, i) => ({ dx: i < 30 ? 20 : -20, dy: 0 }));
  const s = stabilization(moves, "least-crop");
  expect(s.zoom).toBe(1.08);
  expect(Math.max(...s.x.map(Math.abs))).toBeLessThanOrEqual(0.04 + 1e-9);
});
