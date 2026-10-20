import { describe, expect, it } from "vitest";
import { keepPhase, musicStructure } from "./beats";

const RATE = 22050;

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Part {
  /** Seconds the part lasts. */
  seconds: number;
  kick: number;
  hat: number;
  /** A held 55 Hz bass under the part. */
  bass?: number;
  /** Extra kick level on each bar's first beat. */
  accent?: number;
}

/**
 * A drum machine playing parts one after another at `bpm`, the first beat
 * at `start`: a decaying kick on every beat (louder by `accent` on bar
 * starts), a noise hat on the off-beats, an optional bass. `pickup` beats
 * come before the first bar line, as a song's count-in does.
 */
function song(bpm: number, parts: Part[], { start = 0.25, pickup = 0 } = {}) {
  const seconds = parts.reduce((s, p) => s + p.seconds, start);
  const pcm = new Float32Array(Math.round(seconds * RATE));
  const r = rng(11);
  const beat = 60 / bpm;
  let prev = 0;
  for (let i = 0; i < pcm.length; i++) {
    const t = i / RATE;
    if (t < start) continue;
    let at = start;
    const part = parts.find((p) => (at += p.seconds) > t) ?? parts[parts.length - 1];
    const k = (t - start) % beat;
    const n = Math.floor((t - start) / beat);
    const bar = (n - pickup) % 4 === 0;
    const kick = part.kick + (bar ? (part.accent ?? 0) : 0);
    // A kick with a beater click, as clickTrack in beats.test.ts has.
    let v = kick * (Math.sin(2 * Math.PI * 90 * k) * Math.exp(-k / 0.06) + 0.4 * Math.sin(2 * Math.PI * 1800 * k) * Math.exp(-k / 0.01));
    const h = (t - start + beat / 2) % beat;
    const noise = r() * 2 - 1;
    if (t >= start + beat / 2) v += part.hat * ((noise - prev) / 2) * Math.exp(-h / 0.015);
    prev = noise;
    if (part.bass) v += part.bass * Math.sin(2 * Math.PI * 55 * t);
    pcm[i] = v;
  }
  return pcm;
}

describe("musicStructure", () => {
  it("finds the tempo, every beat and bars of four in a steady loop", () => {
    const pcm = song(128, [{ seconds: 20, kick: 0.8, hat: 0.25 }]);
    const m = musicStructure(pcm, RATE);
    expect(Math.abs(m.bpm - 128)).toBeLessThan(0.5);
    const beat = 60 / 128;
    for (const t of m.beats) expect(Math.abs(t - (0.25 + beat * Math.round((t - 0.25) / beat)))).toBeLessThan(0.02);
    // Nothing tells the bar lines apart, so the first beat starts bar one.
    expect(m.downbeats[0]).toBe(m.beats[0]);
    expect(m.downbeats[1]).toBe(m.beats[4]);
    expect(m.energy).toHaveLength(m.beats.length);
    expect(m.sections).toEqual([{ start: 0, end: 20.25, label: "verse", energy: expect.any(Number) }]);
    expect(m.drop).toBeNull();
    // Every kick is a hit; the quieter hats mostly are not.
    for (const t of m.beats) expect(m.hits.some((h) => Math.abs(h - t) < 0.03)).toBe(true);
    expect(m.hits.length).toBeLessThan(m.beats.length * 2);
  });

  it("starts bars on the accented beat after a pickup", () => {
    const pcm = song(120, [{ seconds: 24, kick: 0.4, hat: 0.2, accent: 0.5 }], { pickup: 1 });
    const m = musicStructure(pcm, RATE);
    expect(Math.abs(m.bpm - 120)).toBeLessThan(0.5);
    // The first beat is the pickup; bar one starts on the second.
    const first = m.beats.findIndex((t) => Math.abs(t - m.downbeats[0]) < 1e-6);
    expect(Math.abs(m.downbeats[0] - 0.75)).toBeLessThan(0.02);
    expect(first).toBe(m.beats.findIndex((t) => Math.abs(t - 0.75) < 0.02));
    for (let k = 1; k < m.downbeats.length; k++) expect(Math.abs(m.downbeats[k] - m.downbeats[k - 1] - 2)).toBeLessThan(0.03);
  });

  it("names a quiet intro and the drop, and finds where the drop lands", () => {
    // 16 s at a quarter of the level, then the drop with bass: 18 dB up.
    const pcm = song(120, [
      { seconds: 16, kick: 0.1, hat: 0.08 },
      { seconds: 16, kick: 0.8, hat: 0.4, bass: 0.3 },
    ]);
    const m = musicStructure(pcm, RATE);
    expect(Math.abs(m.bpm - 120)).toBeLessThan(0.5);
    expect(m.sections.map((s) => s.label)).toEqual(["intro", "drop"]);
    expect(m.drop).not.toBeNull();
    expect(Math.abs(m.drop! - 16.25)).toBeLessThan(0.03);
    expect(m.sections[1].start).toBe(m.drop);
    expect(m.sections[0].energy).toBeLessThan(0.5);
    expect(m.sections[1].energy).toBeGreaterThan(0.85);
    // The drop is a bar line and a phrase start.
    expect(m.downbeats).toContain(m.drop);
    expect(m.phrases).toContain(m.drop);
    // Beats are found through the quiet intro too.
    expect(m.beats[0]).toBeLessThan(1);
  });

  it("calls a quiet part between two drops a breakdown, rising into the second a build", () => {
    const pcm = song(120, [
      { seconds: 16, kick: 0.8, hat: 0.4, bass: 0.3 },
      { seconds: 16, kick: 0.12, hat: 0.1 },
      { seconds: 16, kick: 0.8, hat: 0.4, bass: 0.3 },
    ]);
    const m = musicStructure(pcm, RATE);
    expect(m.sections.map((s) => s.label)).toEqual(["drop", "breakdown", "drop"]);
    expect(Math.abs(m.drop! - 32.25)).toBeLessThan(0.03);
    // Swelling into the drop instead, the quiet part is a build.
    const swell = song(120, [
      { seconds: 4, kick: 0.1, hat: 0.08 },
      { seconds: 4, kick: 0.16, hat: 0.12 },
      { seconds: 4, kick: 0.25, hat: 0.18 },
      { seconds: 4, kick: 0.4, hat: 0.25 },
      { seconds: 16, kick: 0.8, hat: 0.4, bass: 0.3 },
    ]);
    const b = musicStructure(swell, RATE);
    // Its first steps may read as an intro; the last quiet part is a build.
    expect(b.sections.map((s) => s.label).slice(-2)).toEqual(["build", "drop"]);
    expect(Math.abs(b.drop! - 16.25)).toBeLessThan(0.03);
  });
  it("keeps two-bar breakdowns and reports each rise, with the biggest separately", () => {
    const m = musicStructure(song(120, [
      { seconds: 4, kick: 0.1, hat: 0.08 },
      { seconds: 12, kick: 0.8, hat: 0.4, bass: 0.3 },
      { seconds: 4, kick: 0.12, hat: 0.1 },
      { seconds: 12, kick: 0.8, hat: 0.4, bass: 0.3 },
    ]), RATE);
    expect(m.drops).toHaveLength(2);
    expect(m.drops[0]).toBeCloseTo(4.25, 1);
    expect(m.drops[1]).toBeCloseTo(20.25, 1);
    expect(m.drops).toContain(m.drop);
    const low = m.sections.find(s => s.label === "breakdown")!;
    expect(low.start).toBeCloseTo(16.25, 1);
    expect(low.end).toBeCloseTo(20.25, 1);
    for (const s of m.sections.slice(1)) expect(m.downbeats).toContain(s.start);
  });

});

describe("one beat phase through a song", () => {
  it("keeps an intro of off-beat hats with no kick on the song's beats", () => {
    // 8 s of hats alone (on the "and" of every beat), then the kick comes in.
    const pcm = song(128, [{ seconds: 7.5, kick: 0, hat: 0.4 }, { seconds: 22.5, kick: 0.8, hat: 0.4, bass: 0.2 }], { start: 0 });
    const m = musicStructure(pcm, RATE);
    const beat = 60 / 128;
    // Every beat within 30 ms of the grid, the intro's included (tracked, they sat on the hats, a half beat late).
    const off = (t: number) => Math.abs(t / beat - Math.round(t / beat)) * beat;
    expect(m.beats.filter((t) => t < 7.5).length).toBeGreaterThan(8);
    expect(Math.max(...m.beats.map(off))).toBeLessThan(0.03);
    expect(m.bpm).toBeCloseTo(128, 0);
  });

  it("leaves beats alone when the song is not steady, and a short run that may be a fill", () => {
    const steady = Array.from({ length: 40 }, (_, i) => i * 0.5);
    expect(keepPhase(steady)).toEqual(steady);
    // Three beats a half beat late: a fill or a push, kept.
    const push = steady.map((t, i) => (i >= 10 && i < 13 ? t + 0.25 : t));
    expect(keepPhase(push)).toEqual(push);
    // Eight: an intro tracked on the off-beat, moved onto the line.
    const late = steady.map((t, i) => (i < 8 ? t + 0.25 : t));
    keepPhase(late).forEach((t, i) => expect(t).toBeCloseTo(i * 0.5, 6));
    // A song that speeds up half way has no one line: as tracked.
    const faster = Array.from({ length: 40 }, (_, i) => (i < 20 ? i * 0.5 : 10 + (i - 20) * 0.4));
    expect(keepPhase(faster)).toEqual(faster);
  });
});
