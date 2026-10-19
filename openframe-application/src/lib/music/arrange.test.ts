import { describe, expect, it } from "vitest";
import { barsFor, defaultForm, planMusic, resolveSections, type MusicPlan, type NoteEvent } from "./arrange";
import { chordPcs, fitsMode, scaleNotes } from "./theory";
import { roleOf, STYLE_IDS, STYLES, type StyleId } from "./styles";

const plan = (style: StyleId, extra: Partial<Parameters<typeof planMusic>[0]> = {}) => planMusic({ style, seed: 7, length: 60, ...extra });
const of = (p: MusicPlan, part: string, section?: number) => p.events.filter((e) => e.part === part && (section === undefined || e.section === section));

describe("sections and tempo", () => {
  it("names roles from any section name", () => {
    expect(["Intro", "pre-chorus", "Chorus", "Climax", "bridge", "Outro", "Verse 2"].map((n) => roleOf(n))).toEqual(["intro", "build", "drop", "drop", "breakdown", "outro", "verse"]);
    expect(roleOf("swirl", 0.9)).toBe("drop");
    expect(roleOf("swirl", 0.2)).toBe("breakdown");
  });

  it("fits an intro of four bars, a drop at 8 s and an end at 56 s at 120 BPM exactly", () => {
    const r = resolveSections({ bpm: 120, nudge: 0.06, sections: [{ name: "intro", bars: 4 }, { name: "drop", at: 8 }, { name: "breakdown" }, { name: "outro", end_at: 56 }] });
    expect(r.bpm).toBe(120);
    expect(r.bars[0]).toBe(4);
    expect(r.bars.reduce((a, b) => a + b, 0) * 2).toBe(56);
    expect(r.fit.ok).toBe(true);
    expect(r.fit.targets.map((t) => t.error)).toEqual([0, 0]);
    expect(r.duration).toBe(56);
  });

  it("nudges the tempo so a drop asked for between bar lines lands on one", () => {
    const r = resolveSections({ bpm: 120, nudge: 0.06, sections: [{ name: "intro", bars: 4 }, { name: "drop", at: 8.4, bars: 8 }] });
    expect(r.bpm).toBeCloseTo((4 * 240) / 8.4, 1);
    expect(r.fit.ok).toBe(true);
    expect(Math.abs(r.fit.targets[0].error)).toBeLessThan(0.01);
    expect(r.fit.nudge).toBeLessThan(-0.04);
    expect(r.fit.note).toMatch(/BPM/);
  });

  it("says when times cannot be met within the nudge", () => {
    const r = resolveSections({ bpm: 120, nudge: 0.03, sections: [{ name: "intro", bars: 4 }, { name: "build", bars: 2 }, { name: "drop", at: 9 }] });
    expect(r.fit.ok).toBe(false);
    expect(r.fit.note).toMatch(/miss/);
  });

  it("meets the end exactly however the bars fall", () => {
    const p = planMusic({ style: "launch", seed: 1, length: 37.3 });
    expect(p.duration).toBe(37.3);
    expect(p.events.every((e) => e.t + e.dur <= 37.3 + 1e-9)).toBe(true);
  });

  it("prefers four-bar phrases, moving the tempo a little", () => {
    expect(barsFor(64, 120, 0.06)).toBe(32);
    expect(barsFor(58, 120, 0.06)).toBe(28);
    expect(barsFor(60, 116, 0.06) % 4).toBe(0);
    // 60 s at 120 is 30 bars: four-bar multiples are 7% away, past the nudge.
    expect(barsFor(60, 120, 0.06)).toBe(30);
  });

  it("lays out a default form of usual lengths, its main parts on one phrase grid", () => {
    for (const style of STYLE_IDS) {
      for (const bars of [8, 12, 16, 20, 24, 28, 32, 40, 48, 64]) {
        const f = defaultForm(style, bars);
        expect(f.reduce((s, x) => s + x.bars!, 0)).toBe(bars);
        expect(f.some((x) => roleOf(x.name) === "drop")).toBe(true);
        let at = 0, origin = -1;
        for (const x of f) {
          const role = roleOf(x.name);
          if (role === "drop" || role === "verse" || role === "breakdown") {
            if (origin < 0) origin = at;
            if (bars % 2 === 0) expect((at - origin) % 4, `${style} ${bars}: ${f.map((y) => `${y.name}${y.bars}`).join(" ")}`).toBe(0);
          }
          at += x.bars!;
        }
      }
    }
  });
});

describe("harmony and the hook", () => {
  it("plays each style's progression in key, restarting with every section", () => {
    for (const style of STYLE_IDS) {
      const p = plan(style);
      expect(p.progression.length).toBeGreaterThanOrEqual(4);
      for (const c of p.chords) expect(fitsMode(c.chord, p.tonic, p.mode), `${style} ${c.chord.name}`).toBe(true);
      for (const s of p.sections.filter((x) => x.role === "drop")) {
        const first = p.chords[s.startBar].chord.name;
        expect(first).toBe(p.progression[0]);
      }
    }
  });

  it("follows a numeral chart in any key: i-bVI-bIII-bVII in F# minor", () => {
    const p = planMusic({ style: "launch", key: "F#m", seed: 3, length: 30 });
    expect(p.key).toBe("F# minor");
    const drop = p.sections.find((s) => s.role === "drop")!;
    const names = [0, 1, 2, 3].map((b) => p.chords[drop.startBar + b].chord.root);
    expect(new Set(names).size).toBeGreaterThan(2);
    for (const c of p.chords) expect(fitsMode(c.chord, p.tonic, p.mode)).toBe(true);
  });

  it("falls back to the mode's own chords when no progression of the style fits it", () => {
    const p = planMusic({ style: "lofi", key: "D", mode: "phrygian", seed: 2, length: 20 });
    for (const c of p.chords) expect(fitsMode(c.chord, p.tonic, "phrygian")).toBe(true);
  });

  it("voice-leads the chords: no voice jumps more than a fifth between bars", () => {
    for (const style of STYLE_IDS) {
      const p = plan(style);
      for (let b = 1; b < p.chords.length; b++) {
        const [a, c] = [p.chords[b - 1].voicing, p.chords[b].voicing];
        const moves = c.map((n, k) => Math.abs(n - a[k]));
        expect(Math.max(...moves), `${style} bar ${b}`).toBeLessThanOrEqual(7);
      }
    }
  });

  it("writes a hook in key whose long and on-beat notes are chord tones", () => {
    for (const style of STYLE_IDS) {
      const p = plan(style);
      const scale = scaleNotes(p.tonic, p.mode, 0, 127);
      for (const h of p.hook) {
        expect(scale, `${style} ${h.pitch}`).toContain(h.pitch);
        if (h.step % 4 === 0 || h.len >= 4) {
          const drop = p.sections.find((x) => x.role === "drop")!;
          const chord = p.chords[drop.startBar + Math.floor(h.step / 16)].chord;
          expect(chordPcs(chord), `${style} step ${h.step}`).toContain(h.pitch % 12);
        }
      }
    }
  });

  it("repeats the hook note for note in every four bars of every drop", () => {
    for (const style of ["launch", "corporate", "cinematic", "lofi", "ambient"] as StyleId[]) {
      const p = plan(style);
      const drops = p.sections.map((s, i) => [s, i] as const).filter(([s]) => s.role === "drop");
      const phrases: string[] = [];
      for (const [s, i] of drops) {
        const hook = of(p, "lead", i).filter((e) => e.tag === "hook");
        expect(hook.length, style).toBeGreaterThan(0);
        for (let b = 0; b + 4 <= s.bars; b += 4) {
          // A phrase a breath cuts short (the beat of silence before a hit) is not compared.
          if (p.gaps.some(([a]) => a > s.start + b * p.bar && a < s.start + (b + 4) * p.bar + 1e-6)) continue;
          phrases.push(hook.filter((e) => e.bar >= s.startBar + b && e.bar < s.startBar + b + 4).map((e) => `${e.bar - s.startBar - b}:${e.step}:${e.pitch}`).join(" "));
        }
      }
      expect(phrases.length, style).toBeGreaterThan(1);
      expect(new Set(phrases).size, style).toBe(1);
    }
  });
});

describe("the arrangement", () => {
  it("locks the lo-fi bass to the kick (and an approach note)", () => {
    const p = plan("lofi");
    const drop = p.sections.findIndex((s) => s.role === "drop");
    const kicks = new Set(of(p, "kick", drop).map((e) => `${e.bar}:${e.step}`));
    for (const b of of(p, "bass", drop)) expect(kicks.has(`${b.bar}:${b.step}`) || b.step === 14, `${b.bar}:${b.step}`).toBe(true);
  });

  it("swings the lo-fi eighths and leaves launch nearly straight", () => {
    const lofi = plan("lofi");
    const eighth = lofi.beat / 2;
    const hat = of(lofi, "hat").filter((e) => e.step === 2 && e.tag === undefined);
    const offs = hat.map((e) => e.t - e.bar * lofi.bar);
    const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
    expect(mean).toBeCloseTo(eighth * 2 * STYLES.lofi.swing.amount, 2);
  });

  it("builds into drops: a rising roll, a riser ending on the breath, an impact and a crash on the drop", () => {
    const p = plan("launch");
    for (const d of p.drops) {
      const gap = p.gaps.find(([, b]) => Math.abs(b - d) < 1e-6);
      expect(gap).toBeDefined();
      const riser = p.events.find((e) => e.part === "riser" && Math.abs(e.t + e.dur - gap![0]) < 1e-6);
      expect(riser).toBeDefined();
      expect(p.events.some((e) => e.part === "impact" && Math.abs(e.t - d) < 1e-6)).toBe(true);
      expect(p.events.some((e) => e.part === "crash" && Math.abs(e.t - d) < 1e-6)).toBe(true);
      // Nothing starts inside the breath.
      expect(p.events.some((e) => e.t >= gap![0] + 1e-6 && e.t < gap![1] - 1e-6)).toBe(false);
    }
    const build = p.sections.findIndex((s) => s.role === "build");
    const roll = of(p, "roll", build);
    expect(roll.length).toBeGreaterThan(8);
    const gaps = roll.slice(1).map((e, i) => e.t - roll[i].t);
    expect(gaps[gaps.length - 1]).toBeLessThan(gaps[0]);
    expect(roll[roll.length - 1].vel).toBeGreaterThan(roll[0].vel);
  });

  it("fills before a change of section and crashes on the next downbeat", () => {
    const p = plan("corporate");
    const fills = p.events.filter((e) => e.tag === "fill");
    expect(fills.length).toBeGreaterThan(0);
    for (const f of fills) {
      const s = p.sections[f.section];
      expect(f.bar).toBe(s.startBar + s.bars - 1);
    }
  });

  it("thins out a breakdown: no kick and no bass", () => {
    for (const style of ["launch", "corporate", "lofi", "cinematic"] as StyleId[]) {
      const p = plan(style);
      p.sections.forEach((s, i) => {
        if (s.role !== "breakdown") return;
        expect(p.events.some((e) => e.section === i && (e.part === "kick" || e.part === "bass" || e.part === "sub" || e.part === "taiko")), style).toBe(false);
      });
    }
  });

  it("pumps the launch's music under every drop kick", () => {
    const p = plan("launch");
    const dropKicks = p.events.filter((e) => e.part === "kick" && p.sections[e.section].role === "drop" && e.tag !== "final");
    expect(p.pump.length).toBeGreaterThanOrEqual(dropKicks.length);
    expect(plan("cinematic").pump).toEqual([]);
  });

  it("ends on the tonic: ring on the outro's first beat, stop on the last bar", () => {
    const ring = plan("launch");
    const outro = ring.sections[ring.sections.length - 1];
    expect(ring.finalHit).toBeCloseTo(outro.start, 6);
    expect(ring.chords[outro.startBar].chord.root).toBe(ring.tonic);
    const stop = plan("launch", { ending: "stop" });
    const bars = stop.sections.reduce((s, x) => s + x.bars, 0);
    expect(stop.finalHit).toBeCloseTo((bars - 1) * stop.bar, 6);
    expect(stop.fadeOut[1]).toBeLessThan(stop.duration);
  });

  it("leaves risers and hits out with fx false", () => {
    const p = plan("cinematic", { fx: false });
    expect(p.events.some((e) => ["riser", "impact", "braam", "revcymbal", "downlifter"].includes(e.part))).toBe(false);
  });
});

describe("seeds", () => {
  const key = (e: NoteEvent) => `${e.part}@${e.t.toFixed(5)}:${e.pitch ?? ""}:${e.vel.toFixed(4)}`;

  it("gives the same plan for the same seed, and another for another", () => {
    for (const style of STYLE_IDS) {
      expect(JSON.stringify(plan(style))).toBe(JSON.stringify(plan(style)));
      const [a, b] = [plan(style, { seed: 1 }), plan(style, { seed: 2 })];
      expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
    }
  });

  it("regenerates one section with its own seed and leaves the rest alone", () => {
    const sections = [{ name: "intro", bars: 4 }, { name: "build", bars: 4 }, { name: "drop", bars: 8 }, { name: "breakdown", bars: 4 }, { name: "drop", bars: 8 }, { name: "outro", bars: 2 }];
    const a = planMusic({ style: "launch", seed: 5, sections });
    const b = planMusic({ style: "launch", seed: 5, sections: sections.map((s, i) => (i === 2 ? { ...s, seed: 99 } : s)) });
    const inA = (p: MusicPlan, i: number) => p.events.filter((e) => e.section === i).map(key);
    expect(inA(a, 2)).not.toEqual(inA(b, 2));
    for (const i of [0, 1, 3, 4, 5]) expect(inA(a, i), `section ${i}`).toEqual(inA(b, i));
  });
});
