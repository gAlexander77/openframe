import { describe, expect, it } from "vitest";
import { dips, envelopeDb, pitchStats, pitchTrack, speechActivity } from "./speech";

const RATE = 16000;
function tone(seconds: number, hz: (t: number) => number, amp = 0.3): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    phase += (2 * Math.PI * hz(i / RATE)) / RATE;
    // A voice-like wave: the fundamental and two harmonics.
    x[i] = amp * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
  }
  return x;
}
const silence = (s: number) => new Float32Array(Math.round(s * RATE));
const cat = (...p: Float32Array[]) => {
  const out = new Float32Array(p.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of p) {
    out.set(x, at);
    at += x.length;
  }
  return out;
};

describe("speech activity", () => {
  it("finds where the speech starts and ends and the pauses inside it, not the short gaps", () => {
    const x = cat(silence(0.3), tone(1, () => 150), silence(0.05), tone(0.5, () => 150), silence(0.4), tone(1, () => 150), silence(0.5));
    const a = speechActivity(x, RATE)!;
    expect(a.first).toBeCloseTo(0.3, 2);
    expect(a.last).toBeCloseTo(3.25, 2);
    expect(a.pauses).toEqual([{ start: 1.85, end: 2.25 }]);
    expect(a.floorDb).toBe(-120);
    expect(a.speechDb).toBeGreaterThan(-15);
  });

  it("finds a voice model's short pauses as dips, not a consonant's closure", () => {
    const quiet = (s: number, amp: number) => tone(s, () => 150, amp);
    // A deep 80 ms pause, a shallow 40 ms closure, a 150 ms half-deep pause.
    const x = cat(silence(0.2), tone(0.8, () => 150), silence(0.08), tone(0.6, () => 150), quiet(0.04, 0.005), tone(0.6, () => 150), quiet(0.15, 0.01), tone(0.5, () => 150));
    expect(dips(x, RATE).map((d) => [d.start, d.end])).toEqual([
      [1, 1.08],
      [2.32, 2.47],
    ]);
  });

  it("hears nothing in silence", () => {
    expect(speechActivity(silence(1), RATE)).toBeNull();
    expect(envelopeDb(silence(0.1), RATE).every((v) => v === -120)).toBe(true);
  });
});

describe("pitch", () => {
  it("tracks a steady voice's fundamental", () => {
    const f0 = pitchTrack(tone(1, () => 150), RATE);
    const s = pitchStats(f0)!;
    expect(s.medianHz).toBeGreaterThanOrEqual(148);
    expect(s.medianHz).toBeLessThanOrEqual(152);
    expect(s.rangeSt).toBeLessThan(0.5);
    expect(s.voiced).toBeGreaterThan(0.9);
  });

  it("measures how far a read moves, in semitones", () => {
    // A glide over an octave: 120 to 240 Hz.
    const s = pitchStats(pitchTrack(tone(2, (t) => 120 * Math.pow(2, t / 2)), RATE))!;
    expect(s.rangeSt).toBeGreaterThan(8);
    expect(s.rangeSt).toBeLessThan(11);
  });

  it("has no pitch where there is no voice", () => {
    expect(pitchStats(pitchTrack(silence(1), RATE))).toBeNull();
  });
});
