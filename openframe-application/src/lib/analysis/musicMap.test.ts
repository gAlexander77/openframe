import { describe, expect, it } from "vitest";
import { musicStructure } from "./beats";
import { confidenceNote, mapMusic, readMusicHints, sourceToTimeline } from "./musicMap";
import type { TimedClip } from "../project/ops";

const RATE = 22050;
const FPS = { num: 30, den: 1 };

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A drum machine at 120 BPM from 0 s: a kick every beat (louder by
 * `accent` on each bar's first), hats on the off-beats, parts in turn. */
function song(parts: { seconds: number; kick: number; hat: number; bass?: number; accent?: number }[]) {
  const seconds = parts.reduce((s, p) => s + p.seconds, 0);
  const pcm = new Float32Array(Math.round(seconds * RATE));
  const r = rng(5);
  const beat = 0.5;
  let prev = 0;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    let at = 0;
    const part = parts.find((p) => (at += p.seconds) > t) ?? parts[parts.length - 1];
    const k = t % beat;
    const bar = Math.floor(t / beat) % 4 === 0;
    const kick = part.kick + (bar ? (part.accent ?? 0) : 0);
    let v = kick * (Math.sin(2 * Math.PI * 90 * k) * Math.exp(-k / 0.06) + 0.4 * Math.sin(2 * Math.PI * 1800 * k) * Math.exp(-k / 0.01));
    const noise = r() * 2 - 1;
    if (t >= beat / 2) v += part.hat * ((noise - prev) / 2) * Math.exp(-((t + beat / 2) % beat) / 0.015);
    prev = noise;
    if (part.bass) v += part.bass * Math.sin(2 * Math.PI * 55 * t);
    pcm[i] = v;
  }
  return pcm;
}

const clip = (o: Partial<TimedClip>): TimedClip => ({ id: "c", type: "audio", assetId: "a", start: 0, duration: 30, in: 0, speed: 1, volume: 1, ...o }) as unknown as TimedClip;

// The promo's shape: a quiet intro, a drop at 8, a breakdown 32-36, a drop at 36.
const PROMO = [
  { seconds: 8, kick: 0.1, hat: 0.08 },
  { seconds: 24, kick: 0.8, hat: 0.4, bass: 0.3 },
  { seconds: 4, kick: 0.12, hat: 0.1 },
  { seconds: 12, kick: 0.8, hat: 0.4, bass: 0.3 },
];

describe("mapMusic", () => {
  const whole = musicStructure(song(PROMO), RATE);

  it("keeps the whole file's bar phase and drops in a trimmed clip", () => {
    expect(whole.drops.map((t) => Math.round(t))).toEqual([8, 36]);
    // The clip plays source 0-32 from timeline 0.
    const m = mapMusic(whole, clip({ duration: 32 * 30 }), FPS);
    expect(m.drop).toBe(8);
    expect(m.drops).toEqual([8]);
    for (const d of m.downbeats) expect(Math.abs(d / 2 - Math.round(d / 2))).toBeLessThan(0.02);
    expect(m.sections.at(-1)!.end).toBe(32);
    expect(m.beats.every((t) => t >= 0 && t < 32)).toBe(true);
  });

  it("moves the grid with the clip's in-point and its place on the timeline", () => {
    // Source 8-24 played from timeline 32: source 8 lands at 32.
    const m = mapMusic(whole, clip({ start: 32 * 30, in: 8, duration: 16 * 30 }), FPS);
    expect(m.downbeats[0]).toBe(32);
    for (const d of m.downbeats) expect(Math.abs(d / 2 - Math.round(d / 2))).toBeLessThan(0.02);
    expect(m.drops).toEqual([32]);
    expect(m.sections[0]).toMatchObject({ start: 32, end: 48, label: "drop" });
  });

  it("follows the clip's speed", () => {
    // Twice as fast: source 36 plays 18 s in.
    const m = mapMusic(whole, clip({ in: 0, speed: 2, duration: 24 * 30 }), FPS);
    expect(m.drops).toEqual([4, 18]);
    expect(m.downbeats[1] - m.downbeats[0]).toBeCloseTo(1, 1);
  });

  it("maps source seconds both ways for a reversed clip, and nothing outside it", () => {
    const fwd = sourceToTimeline(clip({ start: 30, in: 10, duration: 60 }), FPS);
    expect(fwd.at(10)).toBe(1);
    expect(fwd.at(11.5)).toBe(2.5);
    expect(fwd.at(12)).toBeNull();
    expect(fwd.edge(99)).toBe(3);
    const rev = sourceToTimeline(clip({ start: 0, in: 10, duration: 60, reverse: true } as Partial<TimedClip>), FPS);
    expect(rev.at(9)).toBeCloseTo(1, 1);
  });
});

describe("hints", () => {
  it("lays a given tempo and downbeat as the grid", () => {
    const m = musicStructure(song(PROMO.slice(0, 2)), RATE, { bpm: 120, firstDownbeat: 1 });
    expect(m.bpm).toBe(120);
    // Bars start on odd seconds because the hint says so.
    for (const d of m.downbeats) expect(Math.abs((d - 1) / 2 - Math.round((d - 1) / 2))).toBeLessThan(1e-6);
    expect(m.confidence.bars).toBe(1);
    expect(m.confidence.tempo).toBe(1);
  });

  it("takes the parts from cues, the drops with them", () => {
    const m = musicStructure(song(PROMO), RATE, { cues: [{ at: 0, label: "intro" }, { at: 4, label: "build" }, { at: 8, label: "drop" }, { at: 32, label: "breakdown" }, { at: 36, label: "drop" }, { at: 48, label: "outro" }] });
    expect(m.sections.map((s) => [s.label, s.start])).toEqual([["intro", 0], ["build", 4], ["drop", 8], ["breakdown", 32], ["drop", 36]]);
    expect(m.drops).toEqual([8, 36]);
    expect(m.confidence.sections).toBe(1);
  });

  it("is unsure of bars that nothing tells apart, and says what to give", () => {
    const loop = musicStructure(song([{ seconds: 20, kick: 0.8, hat: 0.25 }]), RATE);
    expect(loop.confidence.bars).toBeLessThan(0.4);
    expect(confidenceNote(loop.confidence, {})).toMatch(/first_downbeat/);
    expect(confidenceNote(loop.confidence, { firstDownbeat: 0 })).toBeUndefined();
    const accented = musicStructure(song([{ seconds: 20, kick: 0.4, hat: 0.2, accent: 0.5 }]), RATE);
    expect(accented.confidence.bars).toBeGreaterThan(0.6);
    expect(accented.confidence.tempo).toBeGreaterThan(0.8);
  });

  it("reads and checks the tool's arguments", () => {
    expect(readMusicHints({ bpm: 120, first_downbeat: 0, cues: [{ at: 8, label: "drop" }] })).toEqual({ bpm: 120, firstDownbeat: 0, cues: [{ at: 8, label: "drop" }] });
    expect(() => readMusicHints({ bpm: 20 })).toThrow(/bpm/);
    expect(() => readMusicHints({ cues: [{ at: 8, label: "chorus" }] })).toThrow(/label/);
  });
});
