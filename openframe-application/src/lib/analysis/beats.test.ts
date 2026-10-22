import { describe, expect, it } from "vitest";
import { musicStructure, detectBeats, estimateTempo, fft, onsetEnvelope, tempoOf, trackBeats } from "./beats";

const RATE = 22050;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A drum-machine loop: a decaying low "kick" on every beat, optionally a
 * quieter high-passed noise "hat" on every off-beat, over a soft held chord. */
function clickTrack(bpm: number, seconds: number, { start = 0.25, hats = false, pad = 0.05 } = {}) {
  const pcm = new Float32Array(Math.round(seconds * RATE));
  const r = rng(7);
  const beat = 60 / bpm;
  let prev = 0;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    let v = pad * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t));
    if (t >= start) {
      const k = (t - start) % beat;
      v += 0.8 * Math.sin(2 * Math.PI * 90 * k) * Math.exp(-k / 0.06) + 0.3 * Math.sin(2 * Math.PI * 1800 * k) * Math.exp(-k / 0.01);
      const h = (t - start + beat / 2) % beat;
      const noise = r() * 2 - 1;
      const hiss = (noise - prev) / 2; // first difference: a hi-hat is high-passed noise
      prev = noise;
      if (hats && t >= start + beat / 2) v += 0.25 * hiss * Math.exp(-h / 0.015);
    }
    pcm[i] = v;
  }
  const truth: number[] = [];
  for (let t = start; t < seconds; t += beat) truth.push(t);
  return { pcm, truth };
}

/** Each detected beat's distance to the nearest true beat, seconds. */
const errors = (got: number[], truth: number[]) => got.map((t) => Math.min(...truth.map((u) => Math.abs(u - t))));

describe("fft", () => {
  it("matches a direct DFT", () => {
    const n = 64;
    const r = rng(3);
    const x = Array.from({ length: n }, () => r() * 2 - 1);
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 5, 31, 32, 63]) {
      let sr = 0;
      let si = 0;
      x.forEach((v, t) => {
        sr += v * Math.cos((-2 * Math.PI * k * t) / n);
        si += v * Math.sin((-2 * Math.PI * k * t) / n);
      });
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
  });
});

describe("onset envelope", () => {
  it("peaks at each attack, not during held notes", () => {
    const { pcm, truth } = clickTrack(120, 4);
    const { env, fps, offset } = onsetEnvelope(pcm, RATE);
    expect(fps).toBe(100);
    const thr = Math.max(...env) * 0.3;
    const peaks: number[] = [];
    for (let i = 1; i + 1 < env.length; i++) if (env[i] > thr && env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks.push(i / fps + offset);
    expect(peaks.length).toBe(truth.length);
    for (const e of errors(peaks, truth)) expect(e).toBeLessThanOrEqual(0.02);
  });
});

describe("tempo", () => {
  it("is sub-frame accurate on an impulse train", () => {
    for (const bpm of [70, 96, 128, 150]) {
      const fps = 100;
      const env = new Float32Array(fps * 30);
      for (let t = 0.1; t < 30; t += 60 / bpm) env[Math.round(t * fps)] = 1;
      expect(Math.abs(estimateTempo(env, fps).bpm - bpm)).toBeLessThan(2);
    }
  });

  it("prefers the beat over the off-beat hats (no tempo doubling)", () => {
    const { pcm } = clickTrack(90, 20, { hats: true });
    const { env, fps } = onsetEnvelope(pcm, RATE);
    expect(Math.abs(estimateTempo(env, fps).bpm - 90)).toBeLessThan(2);
  });
});

describe("detectBeats", () => {
  for (const bpm of [128, 100, 90]) {
    it(`tracks a ${bpm} BPM loop to within 10 ms and 1 BPM`, () => {
      const { pcm, truth } = clickTrack(bpm, 20, { hats: bpm === 90 });
      const res = detectBeats(pcm, RATE);
      expect(Math.abs(res.bpm - bpm)).toBeLessThan(1);
      // Every true beat found once (trimming may drop the very last one).
      expect(res.beats.length).toBeGreaterThanOrEqual(truth.length - 1);
      expect(res.beats.length).toBeLessThanOrEqual(truth.length);
      expect(Math.max(...errors(res.beats, truth))).toBeLessThanOrEqual(0.01);
    });
  }

  it("finds nothing in silence or a held tone", () => {
    expect(detectBeats(new Float32Array(RATE * 5), RATE)).toEqual({ beats: [], bpm: 0 });
    const tone = Float32Array.from({ length: RATE * 5 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / RATE));
    expect(detectBeats(tone, RATE).beats.length).toBeLessThan(3);
  });

  it("does not invent beats before the music starts", () => {
    const { pcm } = clickTrack(120, 10, { start: 3, pad: 0 });
    expect(detectBeats(pcm, RATE).beats[0]).toBeGreaterThan(2.9);
  });
});

describe("helpers", () => {
  it("tempoOf fits a slope through quantized beats", () => {
    const beats = Array.from({ length: 40 }, (_, i) => Math.round((0.5 + (i * 60) / 128) * 50) / 50);
    expect(tempoOf(beats)).toBeCloseTo(128, 0);
    expect(tempoOf([1, 2], 99)).toBe(99);
  });

  it("trackBeats follows the strong chain even when a weak off-beat comes last", () => {
    const env = new Float32Array(400);
    for (let f = 10; f < 380; f += 25) env[f] = 1; // beats ... 360
    for (let f = 22; f < 390; f += 25) env[f] = 0.6; // off-beats ... 372 + 25 = 397 > 390, last is 372
    const beats = trackBeats(env, 25);
    expect(beats.every((f) => (f - 10) % 25 === 0)).toBe(true);
    expect(beats.at(-1)).toBe(360);
  });

  it("trackBeats keeps the spacing near the period through a gap", () => {
    const env = new Float32Array(500);
    for (let f = 10; f < 500; f += 25) if (f < 200 || f > 260) env[f] = 1; // two beats missing
    const beats = trackBeats(env, 25);
    expect(beats).toContain(210);
    expect(beats).toContain(235);
  });
});


it("keeps a supplied score grid through its quiet ringing ending", () => {
  const { pcm } = clickTrack(120, 44, { start: 0 });
  pcm.fill(0, 43 * RATE);
  const m = musicStructure(pcm, RATE, { bpm: 120, firstDownbeat: 0 });
  expect(m.beats).toHaveLength(88);
  expect(m.beats.at(-1)).toBe(43.5);
});
