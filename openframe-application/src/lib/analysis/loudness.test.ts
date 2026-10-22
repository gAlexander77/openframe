import { describe, expect, it } from "vitest";
import { applyLimiter, blockPeaks, kWeighting, LIMIT_BLOCK, limiterGains, LiveLoudness, LoudnessMeter, normalizeGain } from "./loudness";
import { toDbtp, TruePeakMeter } from "./truePeak";

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

  it("counts mono once, as the mix's equal-power center pan plays it", () => {
    // -3 dB in each speaker: the same power as the one channel at full level.
    expect(measure(48000, 1, [0], -10).integrated()).toBeCloseTo(-13.01, 1);
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

  it.each([1, 2])("agrees with remeasured %i-channel PCM using linear true peaks", (channels) => {
    const rate = 48000;
    // Mono as the center panner delivers it; stereo already has two
    // channels. A brief high-frequency burst makes the mono peak-limited
    // and exposes intersample peaks; the steady stereo can reach target.
    const planes = Array.from({ length: 2 }, () => Float32Array.from({ length: rate }, (_, i) => {
      const taper = Math.min(1, i / 480, (rate - 1 - i) / 480);
      return taper * (channels === 1
        ? (i >= 24000 && i < 24480 ? 0.5 : 0.05) * Math.SQRT1_2 * Math.sin(2 * Math.PI * i / 4 + Math.PI / 4)
        : 0.15 * Math.sin(2 * Math.PI * 997 * i / rate));
    }));
    // Same streaming meters and final true-peak flush as measureMix.
    const read = (pcm: Float32Array[]) => {
      const meter = new LoudnessMeter(rate, 2), tp = new TruePeakMeter(2);
      for (let at = 0; at < rate; at += 4096) {
        const chunk = pcm.map((p) => p.subarray(at, at + 4096));
        meter.push(chunk, chunk[0].length); tp.push(chunk, chunk[0].length);
      }
      tp.flush();
      return { lufs: meter.integrated(), peak: tp.peak, sample: meter.peak };
    };
    const input = read(planes), target = -10, ceilingDb = -1;
    const n = normalizeGain(input.lufs, target, input.peak, { ceilingDb });
    const output = read(planes.map((p) => p.map((x) => x * n.gain)));
    const gainDb = 20 * Math.log10(n.gain);
    expect(output.lufs).toBeCloseTo(input.lufs + gainDb, 5);
    expect(toDbtp(output.peak)).toBeCloseTo(toDbtp(input.peak) + gainDb, 5);
    expect(toDbtp(output.peak)).toBeLessThanOrEqual(ceilingDb + 1e-6);
    if (channels === 1) {
      expect(n.limitedBy).toBe("peak");
      expect(toDbtp(output.peak)).toBeCloseTo(ceilingDb, 5);
      expect(toDbtp(input.peak) - toDbtp(input.sample)).toBeGreaterThan(2);
      expect(output.lufs).toBeLessThan(target);
    } else {
      expect(n.limitedBy).toBeNull();
      expect(output.lufs).toBeCloseTo(target, 5);
    }
  });

  it("stays in the inspector's range and leaves silence alone", () => {
    expect(normalizeGain(-60, -14, 0.001)).toEqual({ gain: Math.pow(10, 12 / 20), limitedBy: "range" });
    expect(normalizeGain(-Infinity, -14, 0)).toEqual({ gain: 1, limitedBy: null });
    expect(20 * Math.log10(normalizeGain(-5, -14, 1).gain)).toBeCloseTo(-9, 6);
  });
});

describe("LiveLoudness", () => {
  it("reads momentary, short-term and integrated from 100 ms steps", () => {
    const live = new LiveLoudness();
    // -23 LUFS steady: mean square 10^((-23 + 0.691) / 10).
    const ms = Math.pow(10, (-23 + 0.691) / 10);
    for (let i = 0; i < 3; i++) live.push(ms);
    expect(live.momentary()).toBe(-Infinity); // under 400 ms yet
    for (let i = 0; i < 40; i++) live.push(ms);
    expect(live.momentary()).toBeCloseTo(-23, 5);
    expect(live.shortTerm()).toBeCloseTo(-23, 5);
    expect(live.integrated()).toBeCloseTo(-23, 5);
    // Silence after: momentary falls away; integrated is gated and holds,
    // but for the three blocks that straddle the edge (-23.15).
    for (let i = 0; i < 40; i++) live.push(0);
    expect(live.momentary()).toBe(-Infinity);
    expect(Math.abs(live.integrated() + 23)).toBeLessThan(0.2);
    live.reset();
    expect(live.integrated()).toBe(-Infinity);
  });
});

describe("export's limiter", () => {
  // One second at 48 kHz: a quiet tone with a loud burst in the middle, the
  // shape of speech over a soft bed. Rendered in two windows, as export does.
  const rate = 48000, ceiling = 10 ** (-1 / 20);
  const tone = () => {
    const d = new Float32Array(rate);
    for (let i = 0; i < rate; i++) d[i] = (i >= 24000 && i < 24480 ? 0.9 : 0.1) * Math.sin((2 * Math.PI * 440 * i) / rate);
    return d;
  };

  it("raises the mix by the whole gain and holds every sample under the ceiling", () => {
    const peaks = new Float32Array(Math.ceil(rate / LIMIT_BLOCK) + 1);
    const whole = tone();
    blockPeaks([whole.subarray(0, 20000)], 0, peaks);
    blockPeaks([whole.subarray(20000)], 20000, peaks);
    const gain = 2; // the burst would reach 1.8: 6 dB over the ceiling
    const gains = limiterGains(peaks, gain, ceiling);
    const out = tone();
    applyLimiter([out.subarray(0, 20000)], 0, gain, gains);
    applyLimiter([out.subarray(20000)], 20000, gain, gains);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(ceiling + 1e-6);
    // Away from the burst the quiet part gets the full gain untouched.
    expect(Math.max(...out.subarray(0, 20000).map(Math.abs))).toBeCloseTo(0.2, 2);
    expect(Math.max(...out.subarray(40000).map(Math.abs))).toBeCloseTo(0.2, 2);
    // The reduction starts before the burst: the lookahead the offline pass allows.
    expect(gains[Math.floor(24000 / LIMIT_BLOCK) - 1]).toBeLessThan(1);
  });

  it("leaves a mix alone when nothing reaches the ceiling", () => {
    const peaks = new Float32Array(10).fill(0.3);
    expect([...limiterGains(peaks, 2, ceiling)].every((g) => g === 1)).toBe(true);
  });
});
