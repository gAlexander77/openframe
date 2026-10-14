import { describe, expect, it } from "vitest";
import { detectSilences, findSilences, levelsDb, percentile, totalLength } from "./silence";

const RATE = 16000;

/** Deterministic noise so tests never flake. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `seconds` of signal: tone where `on(t)`, noise at `noiseDb` everywhere. */
function synth(seconds: number, on: (t: number) => boolean, { toneAmp = 0.5, noiseDb = -200, seed = 1 } = {}) {
  const pcm = new Float32Array(Math.round(seconds * RATE));
  const r = rng(seed);
  // Uniform noise in [-a, a] has RMS a / sqrt(3).
  const a = Math.pow(10, noiseDb / 20) * Math.sqrt(3);
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    pcm[i] = (on(t) ? toneAmp * Math.sin(2 * Math.PI * 300 * t) : 0) + (r() * 2 - 1) * a;
  }
  return pcm;
}

const near = (got: { start: number; end: number }[], want: [number, number][], tol = 0.021) => {
  expect(got.length).toBe(want.length);
  got.forEach((r, i) => {
    expect(Math.abs(r.start - want[i][0])).toBeLessThanOrEqual(tol);
    expect(Math.abs(r.end - want[i][1])).toBeLessThanOrEqual(tol);
  });
};

describe("levels", () => {
  it("measures RMS in dBFS per window, last window partial", () => {
    const pcm = new Float32Array(RATE * 0.05).fill(0.5); // 50 ms of DC at 0.5
    const lv = levelsDb(pcm, RATE, 0.02);
    expect(lv.length).toBe(3);
    for (const v of lv) expect(v).toBeCloseTo(20 * Math.log10(0.5), 4);
    expect(levelsDb(new Float32Array(320), RATE, 0.02)[0]).toBe(-120);
  });

  it("takes the noise floor as a low percentile", () => {
    expect(percentile([-10, -20, -30, -40, -50, -60, -70, -80, -90, -100, -110], 10)).toBe(-100);
    expect(percentile([], 10)).toBe(-120);
  });
});

describe("findSilences", () => {
  // The speech-gaps fixture's pattern: 1.6 s of tone every 3 s, 12 s long.
  const pattern = (t: number) => t % 3 < 1.6;

  it("finds the gaps of a clean recording, padded toward speech only", () => {
    const res = findSilences(synth(12, pattern), RATE);
    expect(res.thresholdDb).toBe(-50); // clamp: the floor of digital silence is -120
    near(res.ranges, [
      [1.7, 2.9],
      [4.7, 5.9],
      [7.7, 8.9],
      [10.7, 12], // the file's end keeps no padding
    ]);
    expect(totalLength(res.ranges)).toBeCloseTo(4.9, 1);
  });

  it("leading silence is cut to the first word minus padding", () => {
    const res = findSilences(synth(4, (t) => t >= 1 && t < 3), RATE);
    near(res.ranges, [
      [0, 0.9],
      [3.1, 4],
    ]);
  });

  it("sets the threshold from the noise floor of a noisy room", () => {
    // Hiss at -40 dBFS is louder than the -50 clamp: a fixed threshold would
    // call the whole clip speech, the floor-relative one finds the pauses.
    const pcm = synth(9, pattern, { noiseDb: -40, toneAmp: 0.2 });
    const res = findSilences(pcm, RATE);
    expect(res.floorDb).toBeGreaterThan(-42);
    expect(res.floorDb).toBeLessThan(-38);
    expect(res.thresholdDb).toBeCloseTo(res.floorDb + 8, 5);
    near(res.ranges, [
      [1.7, 2.9],
      [4.7, 5.9],
      [7.7, 9],
    ]);
    expect(findSilences(pcm, RATE, { thresholdDb: -60 }).ranges).toEqual([]);
  });

  it("an absolute threshold overrides the automatic one", () => {
    const quietSpeech = synth(6, pattern, { toneAmp: 0.003 }); // about -53 dBFS
    expect(findSilences(quietSpeech, RATE).ranges.length).toBe(1); // auto: only the ending
    expect(findSilences(quietSpeech, RATE, { thresholdDb: -70 }).ranges.length).toBe(2);
  });

  it("keeps pauses shorter than minSilence", () => {
    // Words of 0.5 s with 0.3 s pauses, then one 1 s pause.
    const on = (t: number) => (t < 2.4 ? t % 0.8 < 0.5 : t >= 3.4 && t < 4);
    const res = findSilences(synth(4, on), RATE);
    near(res.ranges, [[2.4 - 0.3 + 0.1, 3.3]]);
    near(findSilences(synth(4, on), RATE, { minSilence: 0.2 }).ranges, [
      [0.6, 0.7],
      [1.4, 1.5],
      [2.2, 3.3],
    ]);
  });

  it("a click inside a pause does not split it", () => {
    const pcm = synth(3, (t) => t < 1 || t >= 2);
    for (let i = 0; i < 80; i++) pcm[Math.round(1.5 * RATE) + i] = 0.9 * (i % 2 ? 1 : -1); // 5 ms click
    near(findSilences(pcm, RATE).ranges, [[1.1, 1.9]]);
    // With blip merging off, the click splits the pause into two short ones.
    expect(findSilences(pcm, RATE, { minSpeech: 0, minSilence: 0.6 }).ranges).toEqual([]);
  });

  it("does not chatter when the level hovers at the threshold", () => {
    // Alternating windows at -49 and -51 dBFS around a -50 threshold: with
    // hysteresis this is one state, not a comb of tiny silences.
    const lv = new Float32Array(200).map((_, i) => (i % 2 ? -51 : -49));
    const fixed = { thresholdDb: -50, padding: 0, minSpeech: 0 };
    const res = detectSilences(lv, 0.02, 4, { ...fixed, minSilence: 0.04 });
    expect(res.ranges).toEqual([]);
    const noHyst = detectSilences(lv, 0.02, 4, { ...fixed, minSilence: 0.02, hysteresisDb: 0 });
    expect(noHyst.ranges.length).toBe(100);
  });

  it("padding wider than a pause leaves nothing to cut", () => {
    expect(findSilences(synth(3, (t) => t < 1 || t >= 1.5), RATE, { padding: 0.3 }).ranges).toEqual([]);
  });

  it("returns nothing for silence-free audio and everything for pure silence", () => {
    expect(findSilences(synth(3, () => true), RATE).ranges).toEqual([]);
    expect(findSilences(new Float32Array(RATE * 2), RATE).ranges).toEqual([{ start: 0, end: 2 }]);
  });
});
