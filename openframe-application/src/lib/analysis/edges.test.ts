// preview_audio's edges (film test 3.15, ADR-104): a butt splice's hole,
// a click, a tail cut dead, measured on rendered sound; music's own quiet
// moments between hits are not taken for a hole.

import { describe, expect, it } from "vitest";
import { edgeReport, ownOnset, silentJoinTarget, type AudioEdge } from "./edges";

const RATE = 48000;

it("finds a legal silent join near a cut without a beat grid, in both files", () => {
  const a = new Float32Array(16000).fill(0.1), b = a.slice();
  a.fill(0, 11000, 14000);
  b.fill(0, 12000, 14000);
  const to = silentJoinTarget(a, b, 16000, 9.5, 10, 30)!;
  expect(to).toBeGreaterThanOrEqual(10.27);
  expect(to).toBeLessThanOrEqual(10.35);
  expect(to * 30).toBeCloseTo(Math.round(to * 30), 1);
  // Silence in just one file, a zero crossing, or silence too far away
  // is not a safe place for the two pieces to hand over.
  expect(silentJoinTarget(a, new Float32Array(16000).fill(0.1), 16000, 9.5, 10, 30)).toBeUndefined();
  expect(silentJoinTarget(a, b, 16000, 9.5, 9.6, 30)).toBeUndefined();
  const sine = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 20));
  expect(silentJoinTarget(sine, sine, 16000, 9.5, 10, 30)).toBeUndefined();
});

/** Seeded noise. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

/** A second of a beat: a bass note, a pad and a hi-hat every 125 ms that
 * dies away in 20 ms, so the music has its own quiet moments. */
function music(seconds: number, seed: number, offset = 0): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE + offset;
    const hat = Math.exp(-(t % 0.125) / 0.02) * 0.2 * r();
    x[i] = 0.3 * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 220 * t + seed) + hat;
  }
  return x;
}

/** a then b at sample n, each faded by `gain` (seconds from the cut). */
function join(a: Float32Array, b: Float32Array, n: number, gain: (fromCut: number) => [number, number]): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < out.length; i++) {
    const [ga, gb] = gain((i - n) / RATE);
    out[i] = a[i] * ga + b[i] * gb;
  }
  return out;
}

const AT = 1;
const N = AT * RATE;
const edge = (o: Partial<AudioEdge> = {}): AudioEdge => ({ at: AT, kind: "join", clips: ["c_a", "c_b"], faded: 0, ...o });
const report = (x: Float32Array, e: AudioEdge) => edgeReport(x, x, RATE, 0, [e])[0];

describe("a join of two pieces of a song", () => {
  const a = music(2, 1), b = music(2, 2, 16);

  it("finds the hole a butt cut's 4 ms click guard leaves (the film's splice)", () => {
    // On a hit, as it dies away, and in the quiet before the next.
    for (const at of [1, 1.01, 1.04, 1.1]) {
      const n = Math.round(at * RATE);
      const butt = join(a, b, n, (t) => (t < 0 ? [Math.min(1, -t / 0.004), 0] : [0, Math.min(1, t / 0.004)]));
      const r = report(butt, edge({ at }));
      expect(r.dip_db).toBeLessThanOrEqual(-10);
      expect(r.verdict).toMatch(/hole/);
      expect(r.fix).toEqual({ tool: "set_crossfade", args: { clip_id: "c_a", seconds: 0.03 } });
    }
  });

  it("finds a silent stretch at the cut longer than the hole's own sides (a packet a cold decoder lost)", () => {
    const lost = join(a, b, N, (t) => (t < 0 ? [Math.min(1, -t / 0.004), 0] : t < 0.026 ? [0, 0] : [0, 1]));
    const r = report(lost, edge());
    expect(r.dip_db).toBeLessThanOrEqual(-20);
    expect(r.verdict).toMatch(/hole|dropout/);
  });

  it("calls an equal-power crossfade ending at the cut clean", () => {
    const x = 0.03;
    const faded = join(a, b, N, (t) => (t < -x ? [1, 0] : t < 0 ? [Math.sin((Math.PI / 2) * (-t / x)), Math.sin((Math.PI / 2) * ((t + x) / x))] : [0, 1]));
    const r = report(faded, edge({ faded: x }));
    expect(r.dip_db).toBeGreaterThan(-10);
    expect(r.click_db ?? 0).toBeLessThan(6);
    expect(r.verdict).toBe("clean");
  });

  it("does not take the music's own quiet moments between hits for a hole", () => {
    // Uncut, judged at many places between and on the hats.
    const whole = music(2, 3);
    for (const at of [0.5, 0.56, 0.6, 0.66, 0.7, 0.98, 1.02, 1.1, 1.24]) expect(report(whole, edge({ at })).verdict).toBe("clean");
  });

  it("finds a click: a sample step steeper than any around it", () => {
    const step = join(a, b, N, (t) => (t < 0 ? [1, 0] : [0, 1]));
    for (let i = N; i < N + 10; i++) step[i] += 0.8;
    const r = report(step, edge());
    expect(r.click_db).toBeGreaterThanOrEqual(6);
    expect(r.verdict).toMatch(/click/);
    // The file coming in has no such step: still a click.
    expect(report(step, edge({ onset: ownOnset(b, RATE, N) })).verdict).toMatch(/click/);
  });

  it("does not call the downbeat a cut lands on a click when the file has that attack itself", () => {
    // A quiet intro cut to a drop whose kick starts at its peak (a
    // synthesized kick), the way cut_music lands a join on the downbeat: the
    // kick's first sample step is steeper than anything in the intro or in
    // the kick's own body, so it read as a 7.7 dB click on a clean join.
    const intro = music(2, 5).map((v) => v * 0.15);
    const drop = new Float32Array(2 * RATE);
    for (let i = 0; i < drop.length; i++) {
      const t = (i - N) / RATE;
      // The build's tone, then the kick on top of it.
      drop[i] = 0.3 * Math.sin(2 * Math.PI * 200 * t) + (t >= 0 ? 0.9 * Math.cos(2 * Math.PI * 60 * t) * Math.exp(-t / 0.12) : 0);
    }
    const x = 0.03;
    const faded = join(intro, drop, N, (t) => (t < -x ? [1, 0] : t < 0 ? [Math.sin((Math.PI / 2) * (-t / x)), Math.sin((Math.PI / 2) * ((t + x) / x))] : [0, 1]));
    expect(report(faded, edge({ faded: x })).verdict).toMatch(/click/);
    const r = report(faded, edge({ faded: x, onset: ownOnset(drop, RATE, N) }));
    expect(r.click_db ?? 0).toBeLessThan(6);
    expect(r.verdict).not.toMatch(/click/);
  });
});

describe("a join's level", () => {
  // A song cut on its bars lands just before a downbeat: the 300 ms after
  // the cut hold the kick, those before the bar's end, so every such join
  // read "the level jumps up 15 dB" though the file does the same there.
  const quiet = music(2, 6).map((v) => v * 0.15), loud = music(2, 7);
  const onBeat = new Float32Array(2 * RATE);
  for (let i = 0; i < onBeat.length; i++) onBeat[i] = i < N ? quiet[i] : loud[i];
  const x = 0.03;
  const faded = (a: Float32Array, b: Float32Array) => join(a, b, N, (t) => (t < -x ? [1, 0] : t < 0 ? [Math.sin((Math.PI / 2) * (-t / x)), Math.sin((Math.PI / 2) * ((t + x) / x))] : [0, 1]));
  it("is told when it moves more than the incoming file does there", () => {
    // The second piece's file is as loud before its in-point as after: the cut made the jump.
    const r = report(faded(quiet, loud), edge({ faded: x, cameIn: 0 }));
    expect(r.step_db).toBeGreaterThan(12);
    expect(r.verdict).toMatch(/jumps up/);
  });
  it("is the music's own when the incoming file jumps as much there", () => {
    const r = report(faded(quiet, onBeat), edge({ faded: x, cameIn: -16 }));
    expect(r.step_db).toBeGreaterThan(12);
    expect(r.verdict).not.toMatch(/jumps|drops/);
    // Unknown (the file's start too near), as before.
    expect(report(faded(quiet, onBeat), edge({ faded: x })).verdict).toMatch(/jumps up/);
  });
});

describe("an end, and a start", () => {
  const a = music(2, 4);
  const cut = join(a, a, N, (t) => (t < 0 ? [Math.min(1, -t / 0.004), 0] : [0, 0]));

  it("finds a sound cut off while its file still rings on", () => {
    const r = report(cut, edge({ kind: "end", clips: ["c_a"], goesOn: 0 }));
    expect(r.tail_cut_db).toBeGreaterThan(40);
    expect(r.verdict).toMatch(/cut off while it still rings/);
    expect(r.fix).toEqual({ tool: "set_fades", args: { clip_ids: ["c_a"], fade_out: 0.3 } });
    // Faded out, or at the end of its file (nothing goes on): clean.
    expect(report(cut, edge({ kind: "end", clips: ["c_a"], goesOn: 0, faded: 0.3 })).verdict).toBe("clean");
    expect(report(cut, edge({ kind: "end", clips: ["c_a"], goesOn: -60 })).verdict).toBe("clean");
  });

  it("finds a clip come in mid-sound with no fade", () => {
    const start = join(a, a, N, (t) => (t < 0 ? [0, 0] : [Math.min(1, t / 0.004), 0]));
    expect(report(start, edge({ kind: "start", clips: ["c_b"], cameIn: -1 })).verdict).toMatch(/comes in mid-sound/);
    expect(report(start, edge({ kind: "start", clips: ["c_b"], cameIn: -40 })).verdict).toBe("clean");
  });

  it("leaves out edges in silence and too near the stretch's ends", () => {
    expect(edgeReport(new Float32Array(RATE * 2), new Float32Array(RATE * 2), RATE, 0, [edge()])).toEqual([]);
    expect(edgeReport(a, a, RATE, 0, [edge({ at: 0.05 })])).toEqual([]);
  });
});

describe("a cut inside a ring-out (film test 2, ADR-114)", () => {
  // A chord dying away 8 dB a second, cut at 1.5 s onto a part 10 dB over
  // where the tail had fallen, joined over 30 ms.
  const at = 1.5, n = Math.round(at * RATE);
  const amp = (t: number) => 0.5 * Math.pow(10, (-8 * t) / 20);
  const x = new Float32Array(3 * RATE);
  for (let i = 0; i < x.length; i++) {
    const t = i / RATE;
    const k = Math.min(1, Math.max(0, (i - n + 0.03 * RATE) / (0.03 * RATE)));
    x[i] = (amp(t) * (1 - k) + amp(at) * Math.pow(10, 10 / 20) * k) * Math.sin(2 * Math.PI * 220 * t);
  }
  const ring = (o: Partial<AudioEdge>) => report(x, edge({ at, faded: 0.03, ...o }));

  it("flags a step in the tail that neither file makes there, at half a plain join's size", () => {
    // The tail would have gone on dying (1 dB), the part after is steady.
    const r = ring({ goesOn: -1, cameIn: 0 });
    expect(r.step_db).toBeGreaterThan(8);
    expect(r.step_db).toBeLessThan(12);
    expect(r.verdict).toMatch(/jumps up .* dB inside a ring-out/);
    expect(r.fix).toEqual({ tool: "set_crossfade", args: { clip_id: "c_a", seconds: 0.25 } });
  });

  it("calls the same step clean when the music makes it there itself, and says so", () => {
    // The tester's outro: its file steps 6.0 dB on the bar the cut took out,
    // and the join 6.9; a step the outgoing file makes uncut, or the
    // incoming one at its in-point, is the music's.
    for (const own of [{ goesOn: 8.5 }, { cameIn: -8.5 }]) {
      const r = ring({ goesOn: -1, cameIn: 0, ...own });
      expect(r.verdict).toBe("clean");
      expect(r.step_note).toMatch(/^the music steps 8.5 dB there itself/);
    }
  });
});
