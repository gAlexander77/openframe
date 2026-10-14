import { describe, expect, it } from "vitest";
import { kWeighting, LoudnessMeter, normalizeGain } from "./loudness";

/** `seconds` of a 997 Hz sine at `dbfs` peak on the channels in `on`. */
function measure(rate: number, channels: number, on: number[], dbfs: number, seconds = 5, silenceAfter = 0) {
  const m = new LoudnessMeter(rate, channels);
  const amp = Math.pow(10, dbfs / 20);
  const n = Math.round(seconds * rate);
  const total = n + Math.round(silenceAfter * rate);
  const chunk = 4096;
  const planes = Array.from({ length: channels }, () => new Float32Array(chunk));
  for (let off = 0; off < total; off += chunk) {
    const frames = Math.min(chunk, total - off);
    for (let i = 0; i < frames; i++) {
      const k = off + i;
      const x = k < n ? amp * Math.sin((2 * Math.PI * 997 * k) / rate) : 0;
      for (let ch = 0; ch < channels; ch++) planes[ch][i] = on.includes(ch) ? x : 0;
    }
    m.push(planes, frames);
  }
  return m;
}

describe("loudness (BS.1770)", () => {
  it("computes the standard's K-weighting at 48 kHz", () => {
    const [shelf, hp] = kWeighting(48000);
    const want = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
    shelf.forEach((c, i) => expect(c).toBeCloseTo(want[i], 9));
    expect(hp[3]).toBeCloseTo(-1.99004745483398, 9);
    expect(hp[4]).toBeCloseTo(0.99007225036621, 9);
  });

  it("reads a 0 dBFS 997 Hz sine in one channel as -3.01 LUFS", () => {
    expect(measure(48000, 2, [0], 0).integrated()).toBeCloseTo(-3.01, 1);
  });

  it("reads it in both channels as 0 LUFS, at 44.1 kHz too", () => {
    expect(measure(48000, 2, [0, 1], 0).integrated()).toBeCloseTo(0, 1);
    expect(measure(44100, 2, [0, 1], -20).integrated()).toBeCloseTo(-20, 1);
  });

  it("counts mono twice, as it plays on both speakers", () => {
    expect(measure(48000, 1, [0], -10).integrated()).toBeCloseTo(-10, 1);
  });

  it("gates out silence and is -Infinity when there is only silence", () => {
    // 6 s of silence would pull an ungated mean to -24.8; gated, only the
    // three blocks straddling the tone's end count (-21.2, -23, -26 LUFS).
    expect(measure(48000, 2, [0, 1], -20, 3, 6).integrated()).toBeCloseTo(-20.22, 1);
    expect(measure(48000, 2, [], 0).integrated()).toBe(-Infinity);
  });

  it("tracks the sample peak", () => {
    expect(measure(48000, 2, [0, 1], -6).peak).toBeCloseTo(Math.pow(10, -6 / 20), 3);
  });
});

describe("normalizeGain", () => {
  it("gains to the target when there is headroom", () => {
    const n = normalizeGain(-20, -14, 0.25);
    expect(20 * Math.log10(n.gain)).toBeCloseTo(6, 6);
    expect(n.limitedBy).toBeNull();
  });

  it("stops at the peak ceiling", () => {
    const n = normalizeGain(-20, -14, 0.8);
    expect(0.8 * n.gain).toBeCloseTo(Math.pow(10, -1 / 20), 6);
    expect(n.limitedBy).toBe("peak");
  });

  it("stays in the inspector's range and leaves silence alone", () => {
    expect(normalizeGain(-60, -14, 0.001)).toEqual({ gain: Math.pow(10, 12 / 20), limitedBy: "range" });
    expect(normalizeGain(-Infinity, -14, 0)).toEqual({ gain: 1, limitedBy: null });
    expect(20 * Math.log10(normalizeGain(-5, -14, 1).gain)).toBeCloseTo(-9, 6);
  });
});
