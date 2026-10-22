import { expect, it } from "vitest";
import { colorMatch, matchFrames } from "./colorMatch";
import { curveFn } from "./curves";

type Rgb = [number, number, number];
const y = (c: Rgb) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
function image(transform: (c: Rgb) => Rgb = c => c, colorful = false) {
  const data = new Uint8ClampedArray(2048 * 4);
  for (let i = 0; i < 2048; i++) {
    const v = 0.15 + i / 2047 * 0.6;
    const c: Rgb = colorful ? [v, 0.2 + (i % 101) / 100 * 0.5, 0.2 + (i % 239) / 238 * 0.5] : [v, v, v];
    data.set([...transform(c).map(v => v * 255), 255], i * 4);
  }
  return data;
}
function error(reference: Uint8ClampedArray, target: Uint8ClampedArray, result: ReturnType<typeof colorMatch>) {
  const fns = (["r", "g", "b"] as const).map(ch => curveFn(result.curves[ch]!));
  let worst = 0;
  for (let i = 0; i < target.length; i += 4) {
    const c = [target[i], target[i + 1], target[i + 2]].map(v => v / 255) as Rgb, l = y(c);
    for (let k = 0; k < 3; k++) {
      const value = Math.min(1, Math.max(0, l + (c[k] - l) * (1 + result.saturation / 100)));
      worst = Math.max(worst, Math.abs(reference[i + k] - fns[k](value) * 255));
    }
  }
  return worst;
}

it("matching a frame to itself produces identity and no saturation change", () => {
  const f = image(c => c, true), result = colorMatch([f], [f]);
  expect(colorMatch([image()], [image()]).saturation).toBe(0);
  expect(result.saturation).toBeCloseTo(0);
  for (const points of Object.values(result.curves)) for (const [x, y] of points) expect(y).toBeCloseTo(x, 8);
});

it.each(["red gain", "gamma", "desaturation"])("reverses a known %s within two levels on unclipped synthetic pixels", kind => {
  const colorful = kind === "desaturation";
  const reference = image(c => c, colorful);
  const target = image(c => kind === "red gain" ? [c[0] * 1.12, c[1], c[2]] : kind === "gamma" ? c.map(v => v ** 1.2) as Rgb : c.map(v => y(c) + (v - y(c)) * 0.7) as Rgb, colorful);
  const result = colorMatch([reference], [target], 1, colorful);
  expect(error(reference, target, result)).toBeLessThanOrEqual(2);
  expect(Math.max(...result.after)).toBeLessThan(0.8);
});

it("strength zero gives identity, including saturation", () => {
  const r = colorMatch([image()], [image(c => c.map(v => v ** 1.2) as Rgb)], 0);
  for (const points of Object.values(r.curves)) for (const [x, y] of points) expect(y).toBe(x);
  expect(r.saturation).toBe(0);
});

it("protects black and white and bounds actual cubic slopes for extreme distributions", () => {
  const r = colorMatch([image(c => c.map(v => v > 0.4 ? 1 : 0) as Rgb)], [image(c => c.map(v => 0.4 + v * 0.1) as Rgb)], 1, false);
  for (const points of Object.values(r.curves)) {
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)).toEqual([1, 1]);
    const f = curveFn(points);
    for (let i = 0; i < 4096; i++) {
      const slope = (f((i + 1) / 4096) - f(i / 4096)) * 4096;
      expect(slope).toBeGreaterThanOrEqual(0.4 - 1e-6);
      expect(slope).toBeLessThanOrEqual(2.5 + 1e-6);
    }
  }
});

it("uses all frames and samples only inside the middle 90%", () => {
  expect(matchFrames(100, 101)).toEqual([105, 128, 150, 173, 195]);
  expect(matchFrames(12, 1)).toEqual([12, 12, 12, 12, 12]);
  const a = image(), b = image(c => c.map(v => v * 0.9) as Rgb);
  const combined = colorMatch([a, b], [a, b]);
  expect(Math.max(...combined.before)).toBe(0);
  expect(() => colorMatch([], [])).toThrow("No pixels");
});

it("fits in the retained master curve's domain without modifying it", () => {
  const reference = image(), target = image();
  const master: [number, number][] = [[0, 0], [0.5, 0.42], [1, 1]];
  const original = structuredClone(master), fn = curveFn(master);
  const result = colorMatch([reference], [target], 1, false, master);
  const mapped = new Uint8ClampedArray(target);
  for (let i = 0; i < mapped.length; i += 4) for (let k = 0; k < 3; k++) mapped[i + k] = fn(target[i + k] / 255) * 255;
  expect(error(reference, mapped, result)).toBeLessThanOrEqual(2);
  expect(master).toEqual(original);
  expect(result.curves.r!.length).toBeLessThan(40);
});
