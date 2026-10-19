import { describe, expect, it } from "vitest";
import { planMusic, type MusicRequest } from "./arrange";
import { renderMusic } from "./render";
import { balance, monoAt, stats } from "./measure";
import { musicStructure } from "../analysis/beats";
import { TruePeakMeter, toDbtp } from "../analysis/truePeak";
import { renderEvent, VOICED } from "./instruments";
import { STEM_OF, STEMS, STYLE_IDS, type Part } from "./styles";

// Renders are seconds of work each: these stay short. The headless drive
// (scripts/drive/generate-music.js) renders every style at full length.
const RATE = 24000;
const short = (style: MusicRequest["style"], extra: Partial<MusicRequest> = {}) => planMusic({ style, seed: 11, sections: [{ name: "intro", bars: 2 }, { name: "build", bars: 2 }, { name: "drop", bars: 4 }, { name: "outro", bars: 2 }], ...extra });

describe("rendering", { timeout: 60000 }, () => {
  it("masters to -14 LUFS under -1 dBTP, clean: no clipping, no DC, silent at the end", () => {
    const r = renderMusic(short("launch"), { rate: RATE, stems: true });
    expect(Math.abs(r.master.lufs + 14)).toBeLessThan(0.3);
    expect(r.master.true_peak_dbtp).toBeLessThanOrEqual(-0.95);
    const s = stats(r.mix[0], r.mix[1]);
    expect(s.clipped).toBe(0);
    expect(Math.abs(s.dc[0])).toBeLessThan(1e-4);
    expect(Math.abs(s.dc[1])).toBeLessThan(1e-4);
    const n = r.mix[0].length;
    expect(r.mix[0][n - 1]).toBe(0);
    expect(r.mix[1][n - 1]).toBe(0);
    // Starts without a click: the first samples rise from silence.
    expect(Math.abs(r.mix[0][0])).toBeLessThan(1e-3);
  });

  it("adds the stems up to the mix exactly", () => {
    const r = renderMusic(short("corporate"), { rate: RATE, stems: true });
    let worst = 0;
    for (let i = 0; i < r.mix[0].length; i++) {
      for (const c of [0, 1] as const) {
        const sum = STEMS.reduce((a, s) => a + r.stems![s][c][i], 0);
        worst = Math.max(worst, Math.abs(sum - r.mix[c][i]));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("is the same sample for sample for the same seed", () => {
    const p = short("lofi");
    const [a, b] = [renderMusic(p, { rate: RATE }), renderMusic(p, { rate: RATE })];
    expect(a.mix[0]).toEqual(b.mix[0]);
    expect(a.mix[1]).toEqual(b.mix[1]);
  });

  it("meets another loudness target, true peak held", () => {
    const r = renderMusic(short("ambient"), { rate: RATE, loudness: -18 });
    expect(Math.abs(r.master.lufs + 18)).toBeLessThan(0.3);
    const tp = new TruePeakMeter(2);
    tp.push(r.mix, r.mix[0].length);
    expect(toDbtp(tp.peak)).toBeLessThanOrEqual(-0.95);
  });

  it("voices every part with no click at either end of a note", () => {
    const n = RATE * 4;
    for (const part of VOICED as Part[]) {
      const out = { L: new Float32Array(n), R: new Float32Array(n), send: new Float32Array(n) };
      const style = part === "taiko" || part === "braam" || part === "ostinato" ? "cinematic" : part === "keys" || part === "vinyl" ? "lofi" : "launch";
      renderEvent({ part, t: 0.5, dur: 1, pitch: STEM_OF[part] === "bass" ? 40 : 64, vel: 0.8, bar: 0, step: 0, section: 0 }, { rate: RATE, style, beat: 0.5, out, gain: 1, send: 0.2, pan: 0, cutoffAt: () => 3000, seed: 1 }, new Map());
      const peak = out.L.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak, part).toBeGreaterThan(1e-3);
      expect(Number.isFinite(peak), part).toBe(true);
      // Silent before the note, and back to silence at the buffer's end.
      expect(Math.abs(out.L[Math.round(0.5 * RATE) - 1]), part).toBe(0);
      expect(Math.abs(out.L[n - 1]), part).toBeLessThan(1e-3 * peak + 1e-6);
      // No step bigger than the note's own peak at its first sample.
      expect(Math.abs(out.L[Math.round(0.5 * RATE)]), part).toBeLessThan(0.6 * peak + 1e-6);
    }
  });
});

describe("what analyze_music hears", { timeout: 60000 }, () => {
  it("finds the tempo, the drop and the sections the plan wrote", () => {
    const p = planMusic({ style: "launch", seed: 4, sections: [{ name: "intro", bars: 4 }, { name: "build", bars: 4 }, { name: "drop", bars: 8 }, { name: "outro", bars: 2 }] });
    const r = renderMusic(p, { rate: 22050 });
    const m = musicStructure(monoAt(r.mix[0], r.mix[1], r.rate, 22050), 22050);
    expect(Math.abs(m.bpm - p.bpm)).toBeLessThan(1);
    expect(m.drops.length).toBe(1);
    expect(Math.abs(m.drops[0] - p.drops[0])).toBeLessThanOrEqual(p.bar);
    // (A ring-out outro has no onsets for the beat tracker: analyze_music
    // hears it as the end of the drop before it.)
    for (const s of p.sections.slice(1, -1)) expect(m.sections.some((x) => Math.abs(x.start - s.start) <= p.bar), `${s.name} at ${s.start}`).toBe(true);
  });
});

describe("balance", { timeout: 90000 }, () => {
  it("measures each style's spectrum in a plausible range", () => {
    for (const style of STYLE_IDS) {
      const r = renderMusic(short(style), { rate: RATE });
      const b = balance(r.mix[0], r.mix[1], r.rate);
      expect(b.low + b.mid + b.high).toBeCloseTo(1, 3);
      expect(b.low, style).toBeGreaterThan(0.25);
      expect(b.mid, style).toBeGreaterThan(0.03);
      expect(b.slope, style).toBeLessThan(1);
      expect(b.slope, style).toBeGreaterThan(-8);
    }
  });
});

describe("brightness", { timeout: 120000 }, () => {
  it("tilts the balance both ways, the loudness and true peak held, the stems still adding up", () => {
    const plan = short("corporate");
    const at = (b: number) => renderMusic(plan, { rate: RATE, brightness: b, stems: b === 1 });
    const [dark, plain, bright] = [at(-1), at(0), at(1)];
    const bal = (r: ReturnType<typeof at>) => balance(r.mix[0], r.mix[1], RATE);
    const [d, p, b] = [bal(dark), bal(plain), bal(bright)];
    expect(b.high).toBeGreaterThan(p.high * 2);
    expect(d.high).toBeLessThan(p.high / 2);
    expect(b.low).toBeLessThan(p.low);
    expect(b.slope).toBeGreaterThan(p.slope);
    for (const r of [dark, plain, bright]) {
      expect(Math.abs(r.master.lufs + 14)).toBeLessThan(0.3);
      expect(r.master.true_peak_dbtp).toBeLessThanOrEqual(-0.95);
    }
    let worst = 0;
    for (let i = 0; i < bright.mix[0].length; i += 7) worst = Math.max(worst, Math.abs(STEMS.reduce((a, s) => a + bright.stems![s][0][i], 0) - bright.mix[0][i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it("brightens the launch style by default, as measured against its reference", () => {
    const plan = short("launch");
    const def = renderMusic(plan, { rate: RATE }), set = renderMusic(plan, { rate: RATE, brightness: 0.4 });
    expect(Array.from(def.mix[0].subarray(0, 4000))).toEqual(Array.from(set.mix[0].subarray(0, 4000)));
  });
});
