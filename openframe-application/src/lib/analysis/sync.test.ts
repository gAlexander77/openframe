import { describe, expect, it } from "vitest";
import { findLag, MIN_CONFIDENCE, SYNC_RATE } from "./sync";

const R = SYNC_RATE;

/** A seeded generator, so every run hears the same take. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A speech stand-in: syllables of random length, pitch and loudness (a
 * voiced buzz, sometimes with a hiss), with random pauses between. */
function take(seconds: number, seed: number): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(seconds * R));
  let at = Math.round(0.2 * R);
  while (at < out.length) {
    const len = Math.round((0.08 + rand() * 0.25) * R);
    const f0 = 100 + rand() * 150;
    const amp = 0.1 + rand() * 0.5;
    const hiss = rand() < 0.3 ? 0.5 : 0;
    for (let i = 0; i < len && at + i < out.length; i++) {
      const t = i / R;
      const env = Math.min(1, i / (0.01 * R)) * Math.exp(-t / (len / R / 2));
      const voiced = Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.3 * Math.sin(6 * Math.PI * f0 * t);
      out[at + i] += amp * env * (voiced + hiss * (2 * rand() - 1));
    }
    at += len + Math.round((0.03 + rand() * (rand() < 0.15 ? 0.8 : 0.25)) * R);
  }
  return out;
}

const slice = (x: Float32Array, from: number, to: number) => x.slice(Math.round(from * R), Math.round(to * R));

/** A camera's microphone: thin (high-passed), in a room (two echoes). */
function camera(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  const a = Math.exp((-2 * Math.PI * 300) / R);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < x.length; i++) {
    prevOut = a * (prevOut + x[i] - prevIn);
    prevIn = x[i];
    out[i] = prevOut;
  }
  const echo = Float32Array.from(out);
  for (const [ms, g] of [[35, 0.4], [80, 0.25]]) {
    const d = Math.round((ms / 1000) * R);
    for (let i = d; i < out.length; i++) echo[i] += g * out[i - d];
  }
  return echo;
}

/** A lav into a recorder: warm (low-passed), quieter, with hiss. */
function lav(x: Float32Array, gain: number, noise: number, seed: number): Float32Array {
  const rand = rng(seed);
  const a = Math.exp((-2 * Math.PI * 900) / R);
  let y = 0;
  return Float32Array.from(x, (s) => (y = (1 - a) * s + a * y) * gain + noise * (2 * rand() - 1));
}

describe("findLag", () => {
  const master = take(40, 1);

  it("finds where a lav recording lines up with the camera's sound, to a millisecond", () => {
    // The recorder started 1.37 s before the camera.
    const cam = camera(slice(master, 5, 17));
    const rec = lav(slice(master, 5 - 1.37, 40), 0.3, 0.02, 2);
    const m = findLag(cam, rec, R);
    expect(Math.abs(m.lag - 1.37)).toBeLessThan(0.002);
    expect(m.score).toBeGreaterThan(0.8);
    expect(m.confidence).toBeGreaterThan(0.5);
  });

  it("finds a recorder that started after the camera, between frames", () => {
    const cam = camera(slice(master, 5, 20));
    const rec = lav(slice(master, 6.4237, 40), 0.5, 0.01, 3);
    const m = findLag(cam, rec, R);
    expect(Math.abs(m.lag - (5 - 6.4237))).toBeLessThan(0.002);
  });

  it("matches when only part of the take overlaps", () => {
    // Camera 0-12 s, recorder from 8 s: a third of the camera's sound.
    const cam = camera(slice(master, 0, 12));
    const rec = lav(slice(master, 8, 30), 0.4, 0.02, 4);
    const m = findLag(cam, rec, R);
    expect(Math.abs(m.lag + 8)).toBeLessThan(0.002);
    expect(m.confidence).toBeGreaterThan(MIN_CONFIDENCE);
  });

  it("holds up under heavy noise", () => {
    const cam = camera(slice(master, 10, 25));
    const rec = lav(slice(master, 7, 40), 0.3, 0.08, 5);
    const m = findLag(cam, rec, R);
    expect(Math.abs(m.lag - 3)).toBeLessThan(0.005);
    expect(m.confidence).toBeGreaterThan(MIN_CONFIDENCE);
  });

  it("scores two different takes below the threshold", () => {
    const cam = camera(slice(master, 5, 17));
    const rec = lav(take(30, 9), 0.4, 0.02, 6);
    const m = findLag(cam, rec, R);
    expect(m.confidence).toBeLessThan(MIN_CONFIDENCE);
    // Every lag fits about as badly as the best one.
    expect(m.runnerUp).toBeGreaterThan(m.score * 0.7);
  });

  it("says when a repeating sound makes the match a guess", () => {
    // A click every half second: every multiple of 0.5 s fits as well.
    const clicks = new Float32Array(20 * R);
    for (let t = 0.3; t < 20; t += 0.5) for (let i = 0; i < 0.02 * R; i++) clicks[Math.round(t * R) + i] = Math.sin(i * 0.9) * Math.exp(-i / 20);
    const m = findLag(slice(clicks, 2, 10), slice(clicks, 0.5, 20), R);
    expect(m.score).toBeGreaterThan(0.9);
    expect(m.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it("searches only within maxLag", () => {
    const cam = camera(slice(master, 5, 17));
    const rec = lav(slice(master, 5 - 1.37, 40), 0.3, 0.02, 2);
    expect(Math.abs(findLag(cam, rec, R, { maxLag: 1 }).lag)).toBeLessThanOrEqual(1);
  });

  it("finds nothing in silence", () => {
    const m = findLag(new Float32Array(5 * R), slice(master, 0, 10), R);
    expect(m.confidence).toBe(0);
  });
});
