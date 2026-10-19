import { describe, expect, it } from "vitest";
import { speechActivity } from "./analysis/speech";
import { fadeEdges, finishTake, FINISHES, highpass, joinTakes, measureTake, peaking, resizePauses, roomTone, runBiquad } from "./voiceTake";

const RATE = 8000;
/** Speech stand-in: a 220 Hz tone with a syllable-rate wobble, at `amp`. */
function voiced(seconds: number, amp = 0.3): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * 220 * i) / RATE) * (0.75 + 0.25 * Math.sin((2 * Math.PI * 4 * i) / RATE));
  return x;
}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));
function cat(...parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const rmsDb = (x: Float32Array) => 10 * Math.log10(x.reduce((s, v) => s + v * v, 0) / x.length);
const gainAt = (b: ReturnType<typeof highpass>, f: number) => {
  const tone = new Float32Array(RATE);
  for (let i = 0; i < tone.length; i++) tone[i] = Math.sin((2 * Math.PI * f * i) / RATE);
  const y = runBiquad(tone, b).subarray(RATE / 2);
  return rmsDb(y) - rmsDb(tone.subarray(RATE / 2));
};

describe("filters", () => {
  it("cuts the low end under 80 Hz and leaves speech alone", () => {
    const hp = highpass(80, RATE);
    expect(gainAt(hp, 20)).toBeLessThan(-20);
    expect(gainAt(hp, 80)).toBeCloseTo(-3, 0);
    expect(Math.abs(gainAt(hp, 1000))).toBeLessThan(0.1);
  });

  it("lifts presence by the gain asked, only around its frequency", () => {
    const pk = peaking(2000, RATE, 2, 0.9);
    expect(gainAt(pk, 2000)).toBeCloseTo(2, 1);
    expect(Math.abs(gainAt(pk, 200))).toBeLessThan(0.3);
  });
});

describe("room tone and fades", () => {
  it("makes a quiet pink hiss at the level asked, the same each time for a seed", () => {
    const t = roomTone(RATE, -72, 5);
    expect(rmsDb(t)).toBeCloseTo(-72, 1);
    expect(roomTone(100, -72, 5)).toEqual(roomTone(100, -72, 5));
    expect(roomTone(100, -72, 6)).not.toEqual(roomTone(100, -72, 5));
  });

  it("fades both edges to zero so a cut never clicks", () => {
    const x = fadeEdges(voiced(0.5).map(() => 1), RATE, 0.01, 0.03);
    expect(x[0]).toBe(0);
    expect(x.at(-1)).toBeLessThan(0.01);
    expect(x[Math.round(0.2 * RATE)]).toBe(1);
  });
});

describe("pauses", () => {
  it("sets a pause to the length asked and leaves the speech either side untouched", () => {
    const a = voiced(1), b = voiced(1);
    const x = cat(a, silence(0.2), b);
    const act = speechActivity(x, RATE)!;
    expect(act.pauses).toHaveLength(1);
    const p = act.pauses[0];
    const y = resizePauses(x, RATE, [{ ...p, seconds: 0.6 }]);
    expect(y.length / RATE).toBeCloseTo(x.length / RATE + 0.6 - (p.end - p.start), 3);
    const after = speechActivity(y, RATE)!;
    expect(after.pauses[0].end - after.pauses[0].start).toBeCloseTo(0.6, 1);
    // The words themselves are the same samples.
    expect(Array.from(y.subarray(0, a.length - 400))).toEqual(Array.from(x.subarray(0, a.length - 400)));
    expect(Array.from(y.subarray(y.length - b.length + 400))).toEqual(Array.from(x.subarray(x.length - b.length + 400)));
  });

  it("shortens a pause too", () => {
    const x = cat(voiced(1), silence(0.8), voiced(1));
    const p = speechActivity(x, RATE)!.pauses[0];
    const y = resizePauses(x, RATE, [{ ...p, seconds: 0.3 }]);
    const q = speechActivity(y, RATE)!.pauses[0];
    expect(q.end - q.start).toBeCloseTo(0.3, 1);
  });

  it("joins two takes with exactly the silence asked between their speech", () => {
    const a = cat(silence(0.1), voiced(1), silence(0.25));
    const b = cat(silence(0.3), voiced(1), silence(0.1));
    for (const want of [1, 0.2]) {
      const y = joinTakes(a, 1.1, b, 0.3, RATE, want);
      const act = speechActivity(y, RATE)!;
      expect(act.pauses).toHaveLength(1);
      expect(act.pauses[0].end - act.pauses[0].start).toBeCloseTo(want, 1);
    }
  });
});

describe("the finish", () => {
  const take = () => cat(silence(0.4), voiced(1.5, 0.05), silence(0.5));

  it("natural: brings every take to one loudness, with room tone and faded edges", () => {
    const quiet = finishTake(take(), RATE, FINISHES.natural);
    const loud = finishTake(take().map((v) => v * 4), RATE, FINISHES.natural);
    expect(measureTake(quiet.audio, RATE).lufs).toBeCloseTo(-23, 0);
    expect(measureTake(loud.audio, RATE).lufs).toBeCloseTo(-23, 0);
    expect(quiet.gainDb).toBeGreaterThan(loud.gainDb);
    // Trimmed to the speech with a breath either side.
    expect(quiet.audio.length / RATE).toBeCloseTo(1.5 + 0.06 + 0.2, 1);
    expect(quiet.audio[0]).toBe(0);
    // The silence after the speech is room tone, not digital silence.
    const tail = quiet.audio.subarray(quiet.audio.length - Math.round(0.15 * RATE), quiet.audio.length - Math.round(0.05 * RATE));
    expect(rmsDb(tail)).toBeGreaterThan(-90);
    expect(rmsDb(tail)).toBeLessThan(-60);
  });

  it("holds the peak at -1 dBFS whatever the loudness asks", () => {
    const spiky = take();
    spiky[Math.round(0.8 * RATE)] = 0.9;
    const { audio } = finishTake(spiky, RATE, { ...FINISHES.clean, loudness: -10 });
    expect(measureTake(audio, RATE).peak).toBeLessThanOrEqual(Math.pow(10, -1 / 20) + 1e-6);
  });

  it("raw: the model's read trimmed, its level untouched", () => {
    const x = take();
    const { audio, gainDb } = finishTake(x, RATE, FINISHES.raw);
    expect(gainDb).toBe(0);
    expect(measureTake(audio, RATE).peak).toBeCloseTo(measureTake(x, RATE).peak, 2);
  });
});
