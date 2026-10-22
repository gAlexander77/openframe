import { describe, expect, it } from "vitest";
import { dbGain, DeesserProcessor, eqResponse, GateEnvelope, LookaheadLimiter } from "./dynamics";
import { BAND_DEFAULT, INSERT_DEFAULTS } from "./audioInserts";
const rate = 48000;
const sine = (hz: number, level: number, seconds = 1) => Float32Array.from({ length: seconds * rate }, (_, n) => level * Math.sin(2 * Math.PI * hz * n / rate));
const rms = (x: Float32Array, from = 0, to = x.length) => Math.sqrt(x.subarray(from, to).reduce((sum, v) => sum + v * v, 0) / (to - from));
const peak = (x: Float32Array) => x.reduce((a, b) => Math.max(a, Math.abs(b)), 0);

describe("gate envelope", () => {
  it("attenuates noise by its range and passes a tone burst, then closes after hold/release", () => {
    const gate = new GateEnvelope({ ...INSERT_DEFAULTS.gate, threshold: -35, range: 40, release: 0.03, hold: 0.05 }, rate);
    const input = Float32Array.from({ length: rate * 2 }, (_, n) => 0.0001 * Math.sin(n * 1.73) + (n >= rate / 2 && n < rate ? 0.3 * Math.sin(2 * Math.PI * 1000 * n / rate) : 0));
    const out = input.map(x => x * gate.step(Math.abs(x)));
    expect(20 * Math.log10(rms(out, 1000, 20000) / rms(input, 1000, 20000))).toBeCloseTo(-40, 3);
    expect(rms(out, 30000, 45000) / rms(input, 30000, 45000)).toBeGreaterThan(0.999);
    expect(20 * Math.log10(rms(out, 85000) / rms(input, 85000))).toBeCloseTo(-40, 1);
    expect(gate.open).toBe(false);
  });
  it("does not chatter in the 3 dB hysteresis band and honors hold", () => {
    const gate = new GateEnvelope({ ...INSERT_DEFAULTS.gate, threshold: -30, hold: 0.1 }, rate);
    for (let n = 0; n < rate / 10; n++) gate.step(dbGain(-25));
    expect(gate.open).toBe(true);
    for (let n = 0; n < rate; n++) { gate.step(dbGain(-31 + Math.sin(n / 100) * 0.7)); expect(gate.open).toBe(true); }
    for (let n = 0; n < rate * 0.08; n++) gate.step(0);
    expect(gate.open).toBe(true);
    for (let n = 0; n < rate / 2; n++) gate.step(0);
    expect(gate.open).toBe(false);
  });
  it("ratio 1 leaves a signal unchanged", () => {
    const gate = new GateEnvelope({ ...INSERT_DEFAULTS.gate, ratio: 1 }, rate);
    for (let n = 0; n < rate; n++) gate.step(0.00001);
    expect(gate.gain).toBeCloseTo(1, 9);
  });
});
it("de-esses 7 kHz while leaving a 1 kHz tone within 0.3 dB", () => {
  for (const hz of [1000, 7000]) {
    const input = sine(hz, 0.5), out = new Float32Array(input.length);
    new DeesserProcessor({ low: 5000, high: 9000, amount: 8 }, rate).process([input], [out]);
    const change = 20 * Math.log10(rms(out, rate / 2) / rms(input, rate / 2));
    if (hz === 7000) expect(change).toBeLessThan(-6); else expect(Math.abs(change)).toBeLessThan(0.3);
  }
});
it("links a de-esser's stereo detector without altering the low band on either side", () => {
  const input = sine(1000, 0.3), sib = sine(7000, 0.7), left = new Float32Array(rate), right = new Float32Array(rate);
  new DeesserProcessor({ low: 5000, high: 9000, amount: 6 }, rate).process([sib, input], [left, right]);
  expect(rms(left, rate / 2) / rms(sib, rate / 2)).toBeLessThan(0.6);
  expect(rms(right, rate / 2) / rms(input, rate / 2)).toBeGreaterThan(0.98);
});
it("keeps the de-esser flat outside its band at the drive's 0.25 calibration level", () => {
  for (const hz of [100, 500, 1000]) for (const channels of [1, 2]) {
    const input = Array.from({ length: channels }, () => sine(hz, 0.25, 2));
    const out = input.map(x => new Float32Array(x.length));
    new DeesserProcessor({ low: 5000, high: 9000, amount: 8 }, rate).process(input, out);
    out.forEach((x, ch) => {
      const change = 20 * Math.log10(rms(x, rate * 0.7, rate * 1.7) / rms(input[ch], rate * 0.7, rate * 1.7));
      expect(Math.abs(change)).toBeLessThan(0.3);
    });
  }
});
describe("lookahead limiter", () => {
  it("holds a hot sine and an isolated impulse under its ceiling", () => {
    const input = sine(997, 3); input[24000] = -9;
    const output = new Float32Array(input.length);
    new LookaheadLimiter({ ceiling: -1, release: 0.08 }, rate).process([input], [output]);
    expect(peak(output)).toBeLessThanOrEqual(dbGain(-1) + 1e-7);
    expect(peak(output)).toBeGreaterThan(dbGain(-1) - 0.01);
  });
  it("leaves quiet audio unchanged apart from lookahead and links stereo", () => {
    const input = sine(1000, 0.1), out = new Float32Array(rate);
    const limiter = new LookaheadLimiter({ ceiling: -1, release: 0.1 }, rate);
    limiter.process([input], [out]);
    expect(Array.from(out.subarray(limiter.latency))).toEqual(Array.from(input.subarray(0, rate - limiter.latency)));
    const hot = sine(997, 4), a = new Float32Array(rate), b = new Float32Array(rate);
    new LookaheadLimiter({ ceiling: -1, release: 0.1 }, rate).process([hot, input], [a, b]);
    expect(peak(a)).toBeLessThanOrEqual(dbGain(-1) + 1e-7);
    expect(peak(b)).toBeLessThan(0.04);
  });
  it("keeps exactly the same state across a cut between processing blocks", () => {
    const input = sine(997, 2), all = new Float32Array(rate), split = new Float32Array(rate), cut = 17329;
    const make = () => new LookaheadLimiter({ ceiling: -2, release: 0.2 }, rate);
    make().process([input], [all]);
    const track = make();
    track.process([input.subarray(0, cut)], [split.subarray(0, cut)]);
    track.process([input.subarray(cut)], [split.subarray(cut)]);
    expect(split).toEqual(all);
    const reset = new Float32Array(rate - cut); make().process([input.subarray(cut)], [reset]);
    expect(reset).not.toEqual(all.subarray(cut));
  });
});
it("parametric EQ measures its band-center gain and cascades enabled bands", () => {
  const band = { ...BAND_DEFAULT, freq: 1400, gain: 9, q: 2 };
  expect(20 * Math.log10(eqResponse([band], 1400))).toBeCloseTo(9, 9);
  expect(20 * Math.log10(eqResponse([band, band], 1400))).toBeCloseTo(18, 9);
  expect(eqResponse([{ ...band, on: false }], 1400)).toBe(1);
  expect(eqResponse([{ ...band, type: "notch" }], 1400)).toBeLessThan(1e-10);
  expect(eqResponse([{ ...band, type: "highpass", freq: 80, q: Math.SQRT1_2 }], 10)).toBeLessThan(0.02);
  expect(20 * Math.log10(eqResponse([{ ...band, type: "lowshelf" }], 1))).toBeCloseTo(9, 3);
  expect(20 * Math.log10(eqResponse([{ ...band, type: "highshelf" }], 23000))).toBeCloseTo(9, 3);
});
