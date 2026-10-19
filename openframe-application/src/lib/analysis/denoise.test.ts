import { expect, it } from "vitest";
import { applyMask, denoise } from "./denoise";

const rate = 16000;
const rms = (x: Float32Array, a = 0, b = x.length) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
// A deterministic hiss.
function noise(n: number, level: number) {
  let s = 1;
  return Float32Array.from({ length: n }, () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647 - 0.5) * 2 * level;
  });
}

it("passes audio through unchanged with a mask of ones", () => {
  const x = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i / 7) * 0.5);
  const y = applyMask(x, Array.from({ length: Math.ceil((x.length + 2048) / 512) }, () => new Float32Array(1025).fill(1)));
  // Away from the edges, overlap-add rebuilds the signal.
  for (let i = 2048; i < 6000; i += 97) expect(y[i]).toBeCloseTo(x[i], 4);
});

it("takes hiss out of the pauses and keeps the tone", () => {
  // Two seconds: hiss throughout, a 440 Hz tone in the middle second.
  const n = 2 * rate;
  const hiss = noise(n, 0.05);
  const x = Float32Array.from(hiss, (v, i) => v + (i >= rate / 2 && i < (3 * rate) / 2 ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate) : 0));
  const [y] = denoise([x], { strength: 1 });
  const pauseBefore = rms(x, 0, rate / 4), pauseAfter = rms(y, 0, rate / 4);
  expect(pauseAfter).toBeLessThan(pauseBefore * 0.35);
  // The tone keeps most of its level.
  expect(rms(y, rate * 0.75, rate * 1.25)).toBeGreaterThan(rms(x, rate * 0.75, rate * 1.25) * 0.85);
});
