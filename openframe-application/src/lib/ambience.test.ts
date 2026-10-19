import { describe, expect, it } from "vitest";
import { AMBIENCE, BED_MAX_SECONDS, bedFrames, makeBed, placeBed } from "./ambience";
import { LoudnessMeter } from "./analysis/loudness";
import { balance, stats, type Balance } from "./music/measure";
import { createProject, createTrack } from "./project/defaults";
import { addTrack } from "./project/ops";
import type { Asset } from "./project/types";

// Each bed is held to what recordings of its kind measure (ADR-098): where
// its energy sits, how it moves, and that it has no seam and no clicks.
// Twenty-four seconds of each, made once.
const RATE = 48000, SECONDS = 24;
const beds = new Map<string, { L: Float32Array; R: Float32Array; mono: Float32Array; b: Balance }>();
const bed = (id: string) => {
  let x = beds.get(id);
  if (!x) {
    const [L, R] = makeBed(id, SECONDS, RATE, 1);
    x = { L, R, mono: L.map((v, i) => (v + R[i]) / 2), b: balance(L, R, RATE) };
    beds.set(id, x);
  }
  return x;
};
const octave = (b: Balance, hz: number) => b.octaves.find((o) => o.hz === hz)!.db;
const loudest = (b: Balance) => b.octaves.reduce((m, o) => (o.db > m.db ? o : m)).hz;

/** Loudness in dB of 400 ms windows every 100 ms: how the bed moves. */
function envelope(x: Float32Array): number[] {
  const w = 0.4 * RATE, h = 0.1 * RATE, out: number[] = [];
  for (let s = 0; s + w <= x.length; s += h) {
    let e = 0;
    for (let i = s; i < s + w; i++) e += x[i] * x[i];
    out.push(10 * Math.log10(e / w + 1e-12));
  }
  return out;
}
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const smooth = (a: number[], k: number) => a.map((_, i) => mean(a.slice(Math.max(0, i - k), i + k + 1)));
function autocorr(a: number[], lag: number) {
  const m = mean(a), v = a.reduce((s, x) => s + (x - m) ** 2, 0);
  let c = 0;
  for (let i = 0; i + lag < a.length; i++) c += (a[i] - m) * (a[i + lag] - m);
  return c / v;
}

/** The worst 10 ms jump in slope against the 200 ms around it: a click
 * (a step, a broken loop) stands far out of its surroundings. */
function clickRatio(x: Float32Array) {
  const d = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) d[i] = x[i] - x[i - 1];
  const w = 0.01 * RATE;
  let worst = 0;
  for (let s = 0; s + w <= d.length; s += w) {
    let m = 0;
    for (let i = s; i < s + w; i++) m = Math.max(m, Math.abs(d[i]));
    const a = Math.max(0, s - 10 * w), b = Math.min(d.length, s + 11 * w);
    let e = 0;
    for (let i = a; i < b; i++) e += d[i] * d[i];
    worst = Math.max(worst, m / Math.sqrt(e / (b - a) + 1e-20));
  }
  return worst;
}

describe("ambience beds", { timeout: 60_000 }, () => {
  it("are made at their length and loudness, peaks under -1 dBFS, stereo, no offset, the same for a seed", () => {
    for (const [id, def] of Object.entries(AMBIENCE)) {
      const { L, R } = bed(id);
      expect(L.length, id).toBe(SECONDS * RATE);
      const m = new LoudnessMeter(RATE, 2);
      m.push([L, R], L.length);
      expect(Math.abs(m.integrated() - def.lufs), id).toBeLessThan(1);
      const s = stats(L, R);
      expect(m.peak, id).toBeLessThanOrEqual(0.9);
      expect(Math.max(...s.dc.map(Math.abs)), id).toBeLessThan(1e-3);
      // Wide but whole: neither mono nor two unrelated (or opposed) sides.
      expect(s.correlation, id).toBeGreaterThan(0.1);
      expect(s.correlation, id).toBeLessThan(0.85);
    }
    const again = makeBed("wind", 4, RATE, 1)[0], other = makeBed("wind", 4, RATE, 2)[0];
    expect(again.subarray(RATE * 3.5, RATE * 3.5 + 500)).toEqual(makeBed("wind", 4, RATE, 1)[0].subarray(RATE * 3.5, RATE * 3.5 + 500));
    expect(other.subarray(RATE * 3.5, RATE * 3.5 + 500)).not.toEqual(again.subarray(RATE * 3.5, RATE * 3.5 + 500));
  });

  it("put their energy where recordings of their kind do", () => {
    // Wind: mostly under 500 Hz, falling off above (no whistle on top).
    const w = bed("wind").b;
    expect(w.low).toBeGreaterThan(0.5);
    expect(w.slope).toBeLessThan(-2);
    expect(loudest(w)).toBeLessThanOrEqual(250);
    // A brook: bubbles ring from a few hundred hertz to a few kilohertz.
    const st = bed("stream").b;
    expect(st.mid).toBeGreaterThan(0.85);
    expect(st.low).toBeLessThan(0.05);
    expect(loudest(st)).toBeGreaterThanOrEqual(500);
    expect(loudest(st)).toBeLessThanOrEqual(2000);
    // A waterfall: a broadband roar, flat within a few dB from 63 Hz to 4 kHz.
    const wf = bed("waterfall").b;
    const mid = [63, 125, 250, 500, 1000, 2000, 4000].map((hz) => octave(wf, hz));
    expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(7);
    expect(wf.high).toBeGreaterThan(0.05);
    // Surf: a low roar whose breaks reach high (the hiss of the wash).
    const sf = bed("surf").b;
    expect(sf.low).toBeGreaterThan(0.3);
    expect(sf.low).toBeLessThan(0.75);
    expect(octave(sf, 8000)).toBeGreaterThan(-16);
    // Rain: a hiss of drops, its energy high.
    const rn = bed("rain").b;
    expect(rn.high).toBeGreaterThan(0.25);
    expect(rn.low).toBeLessThan(0.05);
    expect(loudest(rn)).toBeGreaterThanOrEqual(2000);
    expect(loudest(rn)).toBeLessThanOrEqual(8000);
    // A rocket heard from afar: a deep roar, loudest under 125 Hz.
    const rk = bed("rocket").b;
    expect(rk.low).toBeGreaterThan(0.6);
    expect(loudest(rk)).toBeLessThanOrEqual(125);
    // A street: engines low, tires near a kilohertz.
    const ct = bed("city").b;
    expect(ct.low).toBeGreaterThan(0.45);
    expect(octave(ct, 1000)).toBeGreaterThan(-9);
    // Room tone: soft, sloping down like air and ventilation.
    const rt = bed("roomTone").b;
    expect(rt.slope).toBeLessThan(0);
    expect(rt.slope).toBeGreaterThan(-6);
  });

  it("move as the real thing does: gusts, waves and cars come and go slowly; water, rain and a room hold steady; nothing repeats", () => {
    const moves = (id: string) => {
      const env = envelope(bed(id).mono);
      return { env, std: std(env), slow: std(smooth(env, 5)) ** 2 / std(env) ** 2 };
    };
    for (const [id, lo, hi] of [["wind", 3, 9], ["surf", 4, 10], ["city", 3, 9]] as const) {
      const m = moves(id);
      expect(m.std, id).toBeGreaterThan(lo);
      expect(m.std, id).toBeLessThan(hi);
      // Over seconds, not a flutter.
      expect(m.slow, id).toBeGreaterThan(0.8);
    }
    for (const [id, hi] of [["waterfall", 1.5], ["rain", 2], ["roomTone", 1], ["rocket", 2], ["stream", 3]] as const) {
      const m = moves(id);
      expect(m.std, id).toBeLessThan(hi);
      // Never dead still either: a frozen bed sounds like a loop.
      expect(m.std, id).toBeGreaterThan(0.15);
    }
    // No pattern comes round again: the movement does not correlate with
    // itself at any lag from 2 to 15 seconds.
    for (const id of Object.keys(AMBIENCE)) {
      const env = moves(id).env;
      for (const lag of [2, 4, 6, 8, 10, 12, 15]) expect(autocorr(env, lag * 10), `${id} at ${lag} s`).toBeLessThan(0.7);
    }
  });

  it("loop without a seam and have no clicks", () => {
    for (const id of Object.keys(AMBIENCE)) {
      const { mono } = bed(id);
      const n = mono.length;
      // The last sample runs on into the first as any sample into the next.
      const steps = new Float32Array(n - 1);
      for (let i = 0; i < n - 1; i++) steps[i] = Math.abs(mono[i + 1] - mono[i]);
      steps.sort();
      expect(Math.abs(mono[0] - mono[n - 1]), id).toBeLessThanOrEqual(steps[Math.floor(steps.length * 0.999)]);
      // Across the join the level moves no more than it does anywhere else.
      const joined = new Float32Array(4 * RATE);
      joined.set(mono.subarray(n - 2 * RATE), 0);
      joined.set(mono.subarray(0, 2 * RATE), 2 * RATE);
      const at = envelope(joined), all = envelope(mono);
      const jumps = all.slice(1).map((v, i) => Math.abs(v - all[i])).sort((a, b) => a - b);
      const seam = Math.max(...at.slice(14, 22).map((v, i) => Math.abs(v - at[13 + i])));
      expect(seam, id).toBeLessThanOrEqual(jumps[Math.floor(jumps.length * 0.99)] + 0.25);
      // No click: rain's drops and the rocket's crackle are transients by
      // nature, still far from a digital step.
      expect(clickRatio(mono), id).toBeLessThan(id === "rain" || id === "rocket" ? 30 : 12);
    }
  });
});

describe("placing a bed", () => {
  const asset = (seconds: number): Asset => ({ id: "a_bed", kind: "audio", name: "Wind 12s.wav", src: "w.wav", duration: seconds, hasVideo: false, hasAudio: true, role: "ambience", sound: { id: "wind", seed: 1 } });

  it("lays it on the Ambience track, faded, at its level, never on the voice", () => {
    let p = createProject();
    const vo = { ...createTrack("audio", "Voiceover"), role: "dialog" as const };
    p = addTrack({ ...p, assets: [asset(12)] }, vo);
    const r = placeBed(p, p.assets[0], { start: 2, end: 14, fadeIn: 1, fadeOut: 2, volume: 0.6 });
    const t = r.project.tracks.find((x) => x.id === r.trackId)!;
    expect(t).toMatchObject({ name: "Ambience", role: "ambience" });
    expect(r.clipIds).toHaveLength(1);
    expect(t.clips[0]).toMatchObject({ start: 60, duration: 360, fadeIn: 30, fadeOut: 60, volume: 0.6 });
    // A second bed over it gets a second ambience track (two beds layer).
    const again = placeBed(r.project, p.assets[0], { start: 4, end: 8 });
    expect(again.trackId).not.toBe(r.trackId);
    expect(again.project.tracks.find((x) => x.id === again.trackId)!.role).toBe("ambience");
  });

  it("repeats a file shorter than the bed end to end, on its loop point, fading only the ends", () => {
    const p = { ...createProject(), assets: [asset(BED_MAX_SECONDS)] };
    const r = placeBed(p, p.assets[0], { start: 0, end: BED_MAX_SECONDS * 2 + 10 });
    const clips = r.project.tracks.find((x) => x.id === r.trackId)!.clips;
    expect(clips).toHaveLength(3);
    const per = bedFrames(BED_MAX_SECONDS, p);
    expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, per], [per, per], [2 * per, 300]]);
    expect(clips.map((c) => ("fadeIn" in c ? [c.fadeIn, c.fadeOut] : []))).toEqual([[30, 0], [0, 0], [0, 45]]);
    // A short bed: the fades meet in the middle at most.
    const short = placeBed(p, p.assets[0], { start: 0, end: 1, fadeIn: 3, fadeOut: 3 });
    const c = short.project.tracks.find((x) => x.id === short.trackId)!.clips[0];
    expect("fadeIn" in c && c.fadeIn + c.fadeOut).toBeLessThanOrEqual(c.duration);
  });
});
