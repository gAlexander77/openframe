// The score generator's arranger: from a request (style, tempo, key,
// sections or a length, seed) to a plan: sections on bars, a tempo nudged
// so the asked-for times land on bar lines, chords voice-led bar by bar,
// a hook, and every note and hit of every part as an event in seconds.
// Pure and seeded: the same request gives the same plan, which the tests
// read (progressions, the hook repeating, fills, risers) and render.ts
// plays. Times are seconds from the music's first sample.

import { bassNote, chordFromRoman, chordPcs, diatonicNumeral, fitsMode, keyName, MODES, nearestIn, parseKey, scaleNotes, voiceLead, type Chord, type Mode } from "./theory";
import { ROLE_ENERGY, roleOf, STEM_OF, STYLES, type Part, type Role, type Stem, type StyleId, type StyleSpec } from "./styles";

// ---- seeded randomness ------------------------------------------------------------

/** FNV-1a over the parts: one 32-bit seed per (song seed, purpose, index). */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("\u0001")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small, fast generator with independent streams per seed. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let z = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** Roughly normal, mean 0, deviation 1 (the sum of three uniforms). */
  gauss() {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
}

export const rngFor = (...parts: (string | number)[]) => new Rng(hashSeed(...parts));

// ---- the request ------------------------------------------------------------------

export type Ending = "ring" | "stop";

export interface SectionRequest {
  /** Any name; intro, verse, build, drop (chorus, climax), breakdown
   * (bridge) and outro set what plays (roleOf). */
  name: string;
  bars?: number;
  /** Its length in seconds, rounded to whole bars at the tempo. */
  seconds?: number;
  /** Seconds into the music where it must start, or end. */
  at?: number;
  end_at?: number;
  /** 0..1: how full and loud (default by role). */
  energy?: number;
  /** Regenerate just this section's drums, fills and touches. */
  seed?: number;
}

export interface MusicRequest {
  style: StyleId;
  bpm?: number;
  key?: string;
  mode?: Mode;
  /** Seconds in all, when no sections are given (default 60). */
  length?: number;
  sections?: SectionRequest[];
  seed: number;
  ending?: Ending;
  /** Risers, impacts, reverse cymbals and braams (default true). */
  fx?: boolean;
  /** How far the tempo may move to fit times, a fraction (default 0.06). */
  max_nudge?: number;
  /** The master's tilt, -1 (darker) .. 1 (brighter), for the render; default
   * the style's (render.ts tiltEq). The plan does not depend on it. */
  brightness?: number;
}

export interface NoteEvent {
  part: Part;
  /** Seconds from the music's start (swing and timing applied). */
  t: number;
  /** Seconds it sounds (one-shot drums: how long it may ring). */
  dur: number;
  /** MIDI note (tuned parts, toms and taiko). */
  pitch?: number;
  /** 0..1. */
  vel: number;
  /** Bar from the start and 16th step in it, before swing. */
  bar: number;
  step: number;
  section: number;
  tag?: "hook" | "teaser" | "fill" | "final" | "counter" | "thin";
}

export interface PlannedSection {
  name: string;
  role: Role;
  startBar: number;
  bars: number;
  start: number;
  end: number;
  energy: number;
  seed: number;
}

export interface FitTarget {
  what: string;
  wanted: number;
  got: number;
  error: number;
}

export interface FitReport {
  bpm: number;
  requested_bpm: number;
  /** The tempo change made to fit, a fraction (0.02 is 2% faster). */
  nudge: number;
  targets: FitTarget[];
  /** Whether every target landed within a 16th note. */
  ok: boolean;
  note: string;
}

export interface MusicPlan {
  style: StyleId;
  bpm: number;
  tonic: number;
  mode: Mode;
  key: string;
  seed: number;
  ending: Ending;
  fx: boolean;
  /** Seconds a beat and a bar last. */
  beat: number;
  bar: number;
  /** Seconds the file lasts: exactly the asked-for end. */
  duration: number;
  sections: PlannedSection[];
  /** The chord of every bar, its voicing and bass note. */
  chords: { bar: number; chord: Chord; voicing: number[]; bass: number }[];
  progression: string[];
  /** The hook, as steps from its first bar (64 steps, four bars). */
  hook: { step: number; len: number; pitch: number }[];
  events: NoteEvent[];
  /** Seconds where a drop lands after something quieter. */
  drops: number[];
  /** The last big hit: the final chord. */
  finalHit: number;
  /** Silences before drops, [from, to) seconds. */
  gaps: [number, number][];
  /** Kick hits the sidechain ducks the music under (seconds). */
  pump: number[];
  /** The pad's low-pass over time, [seconds, Hz] breakpoints. */
  padCutoff: [number, number][];
  /** Where everything fades out to silence, [from, to] seconds. */
  fadeOut: [number, number];
  fit: FitReport;
}

// ---- sections and tempo ------------------------------------------------------------

const DEFAULT_LENGTH = 60;
const DEFAULT_NUDGE = 0.06;
/** The longest score: memory in the worker is about 60 bytes a sample
 * (stems, sends, the mix and the files), some 860 MB for five minutes.
 * ponytail: render in chunks to go longer. */
export const MAX_SECONDS = 300;

/** Each style's default form, in order: a part's share of the piece and
 * whether a short piece may leave it out (lowest `opt` first). */
const FORMS: Record<StyleId, { role: Role; share: number; opt?: number }[]> = {
  launch: [{ role: "intro", share: 1 }, { role: "build", share: 1, opt: 3 }, { role: "drop", share: 2 }, { role: "breakdown", share: 1, opt: 2 }, { role: "build", share: 0.5, opt: 1 }, { role: "drop", share: 2, opt: 2 }, { role: "outro", share: 1 }],
  cinematic: [{ role: "intro", share: 1 }, { role: "build", share: 1, opt: 3 }, { role: "drop", share: 2 }, { role: "breakdown", share: 1, opt: 2 }, { role: "build", share: 0.5, opt: 1 }, { role: "drop", share: 2, opt: 2 }, { role: "outro", share: 1 }],
  corporate: [{ role: "intro", share: 0.5 }, { role: "verse", share: 1, opt: 3 }, { role: "build", share: 0.3, opt: 4 }, { role: "drop", share: 2 }, { role: "breakdown", share: 1, opt: 1 }, { role: "drop", share: 2, opt: 2 }, { role: "outro", share: 1 }],
  lofi: [{ role: "intro", share: 0.5 }, { role: "drop", share: 2 }, { role: "breakdown", share: 1, opt: 1 }, { role: "drop", share: 2, opt: 2 }, { role: "outro", share: 1 }],
  ambient: [{ role: "intro", share: 1 }, { role: "verse", share: 1, opt: 3 }, { role: "drop", share: 2 }, { role: "breakdown", share: 1, opt: 1 }, { role: "drop", share: 1.5, opt: 2 }, { role: "outro", share: 1 }],
};

/** The lengths a part of each kind usually has, in bars: phrases of four
 * and eight, two for a short intro, build or outro. */
const SIZES: Record<Role, number[]> = { intro: [2, 4, 8], verse: [4, 8, 16], build: [2, 4, 8], drop: [4, 8, 12, 16, 24, 32], breakdown: [2, 4, 8, 16], outro: [2, 4, 8] };

const NAMES: Record<Role, string> = { intro: "Intro", verse: "Verse", build: "Build", drop: "Drop", breakdown: "Breakdown", outro: "Outro" };

/** `total` split by `weights` into whole numbers of at least `mins` (the
 * share each asks for, the rounding left over to the largest remainders). */
export function distribute(total: number, weights: number[], mins: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const minSum = mins.reduce((a, b) => a + b, 0);
  const rest = Math.max(0, total - minSum);
  const w = weights.reduce((a, b) => a + b, 0) || 1;
  const ideal = weights.map((x) => (rest * x) / w);
  const out = ideal.map((x, i) => mins[i] + Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = ideal.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

/**
 * The default form of a style in `bars` bars: every part a usual length
 * (SIZES) where the total allows, as near its share as can be, parts left
 * out of a short piece. Found by trying every combination (a form has at
 * most seven parts).
 */
export function defaultForm(style: StyleId, bars: number, ending: Ending = "ring"): SectionRequest[] {
  // A sting: a bar or two of drop, an intro and outro as it grows.
  if (bars < 8) {
    const intro = bars >= 5 ? 2 : bars >= 4 ? 1 : 0, outro = ending === "stop" ? 0 : bars >= 7 ? 2 : bars >= 3 ? 1 : 0;
    return [{ name: NAMES.intro, bars: intro }, { name: NAMES.drop, bars: Math.max(1, bars - intro - outro) }, { name: NAMES.outro, bars: outro }].filter((x) => x.bars > 0);
  }
  // A long piece goes round again: another breakdown, build and drop
  // before the outro, rather than drops that never end.
  // A hard stop ends at full tilt: the last drop runs to the final hit.
  let form = ending === "stop" ? FORMS[style].filter((f) => f.role !== "outro") : FORMS[style];
  const tail = form[form.length - 1].role === "outro" ? 1 : 0;
  const middle = form.slice(form.findIndex((f) => f.role === "breakdown"), form.length - tail);
  if (bars > 64 && middle.length) form = [...form.slice(0, form.length - tail), ...middle.map((f) => ({ ...f, opt: undefined })), ...form.slice(form.length - tail)];
  let best: number[] | null = null;
  let bestCost = Infinity;
  // Usual lengths first; odd ones only when the total leaves no choice.
  let sizes = form.map((f) => [...(f.opt ? [0] : []), ...SIZES[f.role]]);
  const pick: number[] = [];
  // The most the parts from i on can add: a branch that cannot reach the
  // total is cut, which keeps a ten-part search quick.
  let most: number[] = [];
  const reach = () => (most = sizes.map((_, i) => sizes.slice(i).reduce((t, z) => t + Math.max(...z), 0)));
  reach();
  const walk = (i: number, sum: number) => {
    if (sum > bars || (i < form.length && sum + most[i] < bars)) return;
    if (i === form.length) {
      if (sum !== bars) return;
      const kept = form.reduce((s, f, k) => s + (pick[k] ? f.share : 0), 0);
      let cost = 0;
      form.forEach((f, k) => {
        if (!pick[k]) cost += 2 + (f.opt ?? 0);
        else {
          cost += Math.abs(pick[k] - (f.share / kept) * bars) / 2;
          if (!SIZES[f.role].includes(pick[k])) cost += 6;
        }
      });
      // A second drop shorter than the first sounds like an afterthought.
      const drops = pick.filter((x, k) => x && form[k].role === "drop");
      if (drops.length > 1 && drops[1] < drops[0] / 2) cost += 2;
      // Two drops back to back are one long drop: the second goes with its breakdown.
      const present = form.filter((_, k) => pick[k]);
      if (present.some((f, k) => k > 0 && f.role === "drop" && present[k - 1].role === "drop")) cost += 50;
      // A build leads into a drop, or it is not a build.
      if (present.some((f, k) => f.role === "build" && present[k + 1]?.role !== "drop")) cost += 50;
      // The main parts keep to one four-bar phrase grid, counted from the
      // first of them (a two-bar intro shifts it, a two-bar build before a
      // drop pairs with a two-bar breakdown): listeners, and analyze_music,
      // hear phrases.
      let at = 0;
      let origin = -1;
      form.forEach((f, k) => {
        if (pick[k] && (f.role === "drop" || f.role === "verse" || f.role === "breakdown")) {
          if (origin < 0) origin = at;
          if ((at - origin) % 4 !== 0) cost += 4;
        }
        at += pick[k];
      });
      if (cost < bestCost) [best, bestCost] = [[...pick], cost];
      return;
    }
    for (const x of sizes[i]) {
      pick.push(x);
      walk(i + 1, sum + x);
      pick.pop();
    }
  };
  walk(0, 0);
  if (!best) {
    // An odd total: an odd intro, build, breakdown or outro takes it, never a drop.
    sizes = form.map((f) => [...(f.opt ? [0] : []), ...new Set([...SIZES[f.role], ...(f.role === "drop" ? [6] : [1, 3, 5])])]);
    reach();
    walk(0, 0);
  }
  const counts: number[] = best ?? distribute(bars, form.map((f) => f.share), form.map(() => 1));
  return form.map((f, i) => ({ name: NAMES[f.role], bars: counts[i] })).filter((x) => x.bars > 0);
}

/**
 * The number of bars for a piece of `length` seconds near `bpm`: a
 * multiple of four if the tempo can move that far (at most `nudge`), else
 * of two, else the nearest; the tempo then fits it exactly.
 */
export function barsFor(length: number, bpm: number, nudge: number): number {
  const ideal = length / barSeconds(bpm);
  let best = Math.max(1, Math.round(ideal));
  let bestCost = Infinity;
  for (let b = Math.max(1, Math.floor(ideal * (1 - nudge)) - 1); b <= Math.ceil(ideal * (1 + nudge)) + 1; b++) {
    const change = Math.abs(b / ideal - 1);
    if (change > nudge + 1e-9) continue;
    const cost = (b % 4 === 0 ? 0 : b % 2 === 0 ? 1 : 3) + change * 40;
    if (cost < bestCost) [best, bestCost] = [b, cost];
  }
  return best;
}

const barSeconds = (bpm: number) => 240 / bpm;

interface Resolved {
  bpm: number;
  bars: number[];
  duration: number;
  fit: FitReport;
}

/**
 * Bars per section and the tempo. Times asked for (a section's at or
 * end_at, seconds, the total length) must land on bar lines, so the tempo
 * moves (at most `nudge`) to the one that lands them best; sections with no
 * bars share what is left between two fixed times by their role. The file
 * then lasts exactly the asked-for length (the last bar stretches or
 * shortens a little into the ending), and the report says how each time fit.
 */
export function resolveSections(req: { bpm: number; sections: SectionRequest[]; length?: number; nudge: number }): Resolved {
  const S = req.sections.length;
  // Fixed times at section boundaries (boundary k starts section k).
  const anchors = new Map<number, { t: number; what: string }>();
  anchors.set(0, { t: 0, what: "start" });
  req.sections.forEach((s, k) => {
    if (s.at !== undefined && k > 0) anchors.set(k, { t: s.at, what: `${s.name} starts` });
    if (s.end_at !== undefined) anchors.set(k + 1, { t: s.end_at, what: `${s.name} ends` });
  });
  if (req.length !== undefined && !anchors.has(S)) anchors.set(S, { t: req.length, what: "end" });
  const keys = [...anchors.keys()].sort((a, b) => a - b);
  for (let i = 1; i < keys.length; i++) {
    if (anchors.get(keys[i])!.t <= anchors.get(keys[i - 1])!.t) throw new Error(`Section times must increase: ${anchors.get(keys[i])!.what} at ${anchors.get(keys[i])!.t} s comes before ${anchors.get(keys[i - 1])!.what}`);
  }
  // Free sections share a span as parts of their kind usually do: the
  // drops and verses carry it, the rest stay short.
  const weight = (s: SectionRequest) => ({ drop: 4, verse: 2, build: 1, intro: 1, breakdown: 1, outro: 1 })[roleOf(s.name, s.energy)];

  const barsAt = (bpm: number): { bars: number[]; err: number } => {
    const bar = barSeconds(bpm);
    const bars = req.sections.map((s) => (s.bars !== undefined ? s.bars : s.seconds !== undefined ? Math.max(1, Math.round(s.seconds / bar)) : -1));
    let err = 0;
    for (let i = 0; i + 1 < keys.length; i++) {
      const [a, b] = [keys[i], keys[i + 1]];
      const span = anchors.get(b)!.t - anchors.get(a)!.t;
      const free: number[] = [];
      let fixed = 0;
      for (let k = a; k < b; k++) {
        if (req.sections[k].bars !== undefined) fixed += req.sections[k].bars!;
        else free.push(k);
      }
      if (free.length) {
        const total = Math.max(fixed + free.length, Math.round(span / bar));
        const hints = free.map((k) => (req.sections[k].seconds !== undefined ? req.sections[k].seconds! / bar : weight(req.sections[k])));
        distribute(total - fixed, hints, free.map(() => 1)).forEach((n, j) => (bars[free[j]] = n));
      }
    }
    // Sections after the last anchor without bars: by seconds or a default.
    bars.forEach((n, k) => {
      if (n < 0) bars[k] = ({ drop: 8, verse: 8, build: 4, intro: 4, breakdown: 4, outro: 4 } as const)[roleOf(req.sections[k].name, req.sections[k].energy)];
    });
    let t = 0, endErr = 0;
    for (let k = 0; k <= S; k++) {
      const a = anchors.get(k);
      // The end is met exactly whatever the bars (the last section rings or
      // is cut by part of a bar), so it only breaks ties; a last section
      // squeezed under half a bar is what it must avoid.
      if (a && k > 0) {
        if (k === S && a.t - (t - bars[S - 1] * bar) < bar / 2) err = Math.max(err, 1e3);
        if (k === S) endErr = Math.abs(t - a.t);
        else err = Math.max(err, Math.abs(t - a.t));
      }
      if (k < S) t += bars[k] * bar;
    }
    return { bars, err: err + 1e-4 * endErr };
  };

  // Scan the tempo window for the best fit, ties to the tempo asked for.
  const [lo, hi] = [req.bpm * (1 - req.nudge), req.bpm * (1 + req.nudge)];
  let best = { bpm: req.bpm, ...barsAt(req.bpm) };
  if (anchors.size > 1) {
    for (let bpm = lo; bpm <= hi + 1e-9; bpm += 0.01) {
      const r = barsAt(bpm);
      // (A tie is a true tie: the end's tie-breaker moves 1e-6 a step, and a
      // looser tie walked the tempo step by step back to the one asked for.)
      const better = r.err < best.err - 1e-9 || (Math.abs(r.err - best.err) <= 1e-9 && Math.abs(bpm - req.bpm) < Math.abs(best.bpm - req.bpm));
      if (better) best = { bpm, ...r };
    }
  }
  // A tempo that is a round number when one fits as well (120, not 119.99).
  const round = Math.round(best.bpm * 10) / 10;
  const r = barsAt(round);
  if (r.err <= best.err + 1e-4) best = { bpm: round, ...r };
  const bar = barSeconds(best.bpm);
  const total = best.bars.reduce((a, b) => a + b, 0) * bar;
  const duration = req.length ?? anchors.get(S)?.t ?? total;
  const targets: FitTarget[] = [];
  let t = 0;
  for (let k = 0; k <= S; k++) {
    const a = anchors.get(k);
    if (a && k > 0) {
      // The end is met exactly: the ending absorbs the difference.
      const got = k === S ? duration : t;
      targets.push({ what: a.what, wanted: +a.t.toFixed(3), got: +got.toFixed(3), error: +(got - a.t).toFixed(3) });
    }
    if (k < S) t += best.bars[k] * bar;
  }
  const step = bar / 16;
  // The last section takes up the slack, but must keep at least half a bar.
  const lastLen = duration - (total - best.bars[S - 1] * bar);
  const ok = targets.every((x) => Math.abs(x.error) <= step / 2 + 1e-6) && lastLen >= bar / 2;
  const nudge = best.bpm / req.bpm - 1;
  const slack = duration - total;
  const note = !targets.length
    ? "No times asked for: the sections play at the tempo asked for."
    : lastLen < bar / 2
      ? `The sections run past the end: the last one would last ${Math.max(0, lastLen).toFixed(2)} s. Give fewer bars or a later end.`
      : ok
      ? `Every time lands on a bar line${Math.abs(nudge) > 0.0005 ? ` at ${+best.bpm.toFixed(2)} BPM (${nudge > 0 ? "+" : ""}${(nudge * 100).toFixed(1)}%)` : ""}${Math.abs(slack) > 1e-3 ? `; the ending ${slack > 0 ? "rings" : "is cut"} ${Math.abs(slack).toFixed(2)} s ${slack > 0 ? "longer" : "shorter"} to end exactly at ${+duration.toFixed(3)} s` : ""}.`
      : `Some times miss by more than a 16th note within ${(req.nudge * 100).toFixed(0)}% of ${req.bpm} BPM: give fewer fixed bars, a wider max_nudge, or another tempo.`;
  return { bpm: best.bpm, bars: best.bars, duration, fit: { bpm: +best.bpm.toFixed(3), requested_bpm: req.bpm, nudge: +nudge.toFixed(4), targets, ok, note } };
}

// ---- harmony ------------------------------------------------------------------------

const MAJOR_THIRD = (mode: Mode) => MODES[mode][2] === 4;

/** The style's progression for the key: one of its own that fits the mode,
 * else the mode's own I-vi-IV-V (or i-VI-III-VII). */
export function pickProgression(spec: StyleSpec, tonic: number, mode: Mode, rng: Rng): Chord[] {
  const lists = MAJOR_THIRD(mode) ? spec.progressions.major : spec.progressions.minor;
  const fit = lists.map((l) => l.map((r) => chordFromRoman(r, tonic, mode))).filter((cs) => cs.every((c) => fitsMode(c, tonic, mode)));
  if (fit.length) return rng.pick(fit);
  const degrees = MAJOR_THIRD(mode) ? [0, 5, 3, 4] : [0, 5, 2, 6];
  return degrees.map((d) => chordFromRoman(diatonicNumeral(d, mode), tonic, mode));
}

// ---- the hook ------------------------------------------------------------------------

/** Pentatonic pitch classes of the key: the scale less its half steps. */
function pentatonic(tonic: number, mode: Mode): number[] {
  const s = MODES[mode];
  const drop = MAJOR_THIRD(mode) ? [3, 6] : [1, 5];
  return s.filter((_, i) => !drop.includes(i)).map((x) => (tonic + x) % 12);
}

/**
 * A four-bar hook over the chords of a drop's first four bars: a two-bar
 * motif (the style's rhythm, a contour that rises then falls) and its
 * answer on the same rhythm and contour over the next two bars, so it
 * sounds as one idea said twice. Long notes and notes on the beat are
 * chord tones; the rest move by scale steps, preferring the pentatonic.
 * The answer ends on a chord tone, held. Of a few candidate contours, the
 * one that sings best is kept: a range of a fifth to an octave, a turn or
 * two, no note struck three times running, no leap over a sixth.
 */
export function makeHook(spec: StyleSpec, chords: Chord[], tonic: number, mode: Mode, rng: Rng): { step: number; len: number; pitch: number }[] {
  const rhythm = rng.pick(spec.hook.rhythms);
  const scale = scaleNotes(tonic, mode, spec.hook.low, spec.hook.high);
  const penta = pentatonic(tonic, mode);
  const soft = scale.filter((n) => penta.includes(n % 12));
  const chordAt = (step: number) => chords[Math.floor(step / 16) % chords.length];
  const tonesOf = (c: Chord) => scale.filter((n) => chordPcs(c).includes(n % 12));
  const stepBy = (from: number, k: number) => {
    const i = scale.indexOf(nearestIn(scale, from));
    return scale[Math.max(0, Math.min(scale.length - 1, i + k))];
  };
  const center = (spec.hook.low + spec.hook.high) / 2;
  const compose = (moves: number[]) => {
    const out: { step: number; len: number; pitch: number }[] = [];
    let first = 0;
    for (const half of [0, 1]) {
      let prev: number | null = null;
      rhythm.forEach(([st, len], i) => {
        const step = half * 32 + st;
        const c = chordAt(step);
        const strong = st % 4 === 0 || len >= 4;
        const last = half === 1 && i === rhythm.length - 1;
        const target = prev === null ? (half === 0 ? center - 2 : first) : stepBy(prev, moves[i]);
        const pool = strong || last ? tonesOf(c) : soft.length ? soft : scale;
        let pitch = nearestIn(pool.length ? pool : scale, target);
        if (prev !== null && Math.abs(pitch - prev) > 9) pitch = nearestIn(pool.length ? pool : scale, prev + Math.sign(pitch - prev) * 4);
        if (prev === null && half === 0) first = pitch;
        out.push({ step, len: last ? Math.max(len, 32 - st) : len, pitch });
        prev = pitch;
      });
    }
    return out;
  };
  const score = (h: { pitch: number }[]) => {
    const ps = h.slice(0, rhythm.length).map((x) => x.pitch);
    const range = Math.max(...ps) - Math.min(...ps);
    let turns = 0, repeats = 0, run = 1;
    for (let i = 1; i < ps.length; i++) {
      if (i > 1 && Math.sign(ps[i] - ps[i - 1]) * Math.sign(ps[i - 1] - ps[i - 2]) < 0) turns++;
      run = ps[i] === ps[i - 1] ? run + 1 : 1;
      if (run >= 3) repeats++;
    }
    return Math.abs(range - 7) + 3 * repeats + (turns >= 1 && turns <= 4 ? 0 : 2);
  };
  let best: { step: number; len: number; pitch: number }[] = [];
  let bestScore = Infinity;
  for (let k = 0; k < 8; k++) {
    const moves = rhythm.map((_, i) => {
      if (i === 0) return 0;
      const rising = i < rhythm.length / 2;
      return rng.pick(rising ? [1, 1, 2, 2, 3, -1, -1, 0] : [-1, -1, -2, -2, -3, 1, 1, 0]);
    });
    const h = compose(moves);
    const sc = score(h);
    if (sc < bestScore) [best, bestScore] = [h, sc];
  }
  return best;
}

// ---- the arrangement ----------------------------------------------------------------

/** A section's level from its energy: a quiet part plays softer, not only thinner. */
const levelOf = (energy: number) => 0.45 + 0.55 * Math.max(0, Math.min(1, energy));

/** The arp's order through four chord tones, one picked per song. */
const ARPS = [[0, 1, 2, 3, 1, 2, 3, 2], [0, 2, 1, 3, 2, 1, 3, 1], [3, 2, 1, 0, 2, 1, 0, 1], [0, 1, 2, 1, 3, 2, 1, 2]];

/** Steps of the corporate guitar's strum (down on the beat, up between). */
const STRUM = [0, 3, 6, 8, 10, 12, 14];

/**
 * The whole plan for a request: sections, tempo, chords, the hook and the
 * events of every part.
 */
export function planMusic(req: MusicRequest): MusicPlan {
  const spec = STYLES[req.style];
  if (!spec) throw new Error(`Unknown style ${req.style}`);
  const bpm0 = req.bpm ?? spec.bpm;
  if (!(bpm0 >= 40 && bpm0 <= 220)) throw new Error("bpm must be between 40 and 220");
  const tonic = req.key ? parseKey(req.key) : parseKey(spec.key);
  const mode = req.mode ?? (req.key && /\bm(in(or)?)?\b|m$/i.test(req.key.trim()) ? "minor" : req.key && /maj/i.test(req.key) ? "major" : spec.mode);
  if (!MODES[mode]) throw new Error(`Unknown mode ${mode}`);
  const ending: Ending = req.ending ?? "ring";
  const fx = req.fx ?? true;
  const seed = req.seed >>> 0;
  // With no times asked for, the tempo may move a little further (8%) to
  // give the form whole phrases.
  const nudge = Math.max(0, Math.min(0.2, req.max_nudge ?? (req.sections?.length ? DEFAULT_NUDGE : 0.08)));

  // Sections and tempo.
  let asked = req.sections?.length ? req.sections : undefined;
  let length = req.length;
  if (!asked) {
    length ??= DEFAULT_LENGTH;
    asked = defaultForm(req.style, barsFor(length, bpm0, nudge), req.ending ?? "ring");
  }
  if (length !== undefined && !(length >= 2 && length <= MAX_SECONDS)) throw new Error(`length must be between 2 and ${MAX_SECONDS} seconds`);
  for (const s of asked) {
    if (s.bars !== undefined && !(Number.isInteger(s.bars) && s.bars >= 1 && s.bars <= 128)) throw new Error(`${s.name}: bars must be a whole number from 1 to 128`);
  }
  const res = resolveSections({ bpm: bpm0, sections: asked, length, nudge });
  const bpm = res.bpm;
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const step = beat / 4;
  let startBar = 0;
  const sections: PlannedSection[] = asked.map((s, i) => {
    const role = roleOf(s.name, s.energy);
    const p = { name: s.name, role, startBar, bars: res.bars[i], start: startBar * bar, end: (startBar + res.bars[i]) * bar, energy: s.energy ?? ROLE_ENERGY[role], seed: s.seed ?? hashSeed(seed, "section", i) };
    startBar += res.bars[i];
    return p;
  });
  const totalBars = startBar;
  const duration = res.duration;
  if (duration > MAX_SECONDS) throw new Error(`The music would last over ${MAX_SECONDS / 60} minutes: shorten it`);

  // Harmony: the progression restarts with each section, so every drop
  // opens on its first chord and the hook lines up.
  const progression = pickProgression(spec, tonic, mode, rngFor(seed, "progression"));
  const chordOfBar: Chord[] = [];
  // Ambient's quiet parts hang on a chord for four bars, as drones do.
  // A lo-fi breakdown vamps on one chord under the melody.
  const chordBarsOf = (s: PlannedSection) => (req.style === "ambient" && s.role !== "drop" ? 4 : req.style === "lofi" && s.role === "breakdown" ? s.bars : spec.chordBars);
  for (const s of sections) {
    for (let b = 0; b < s.bars; b++) chordOfBar.push(progression[Math.floor(b / chordBarsOf(s)) % progression.length]);
  }
  const tonicChord = progression.find((c) => c.root === tonic) ?? chordFromRoman(MAJOR_THIRD(mode) ? "I" : "i", tonic, mode);
  // The final hit is the tonic, the bar before it the progression's last
  // chord (a cadence): ring lands on the outro's first bar, stop on the
  // last bar.
  const last = sections[sections.length - 1];
  const finalBar = ending === "ring" ? (last.role === "outro" ? last.startBar : totalBars - 1) : totalBars - 1;
  for (let b = finalBar; b < totalBars; b++) chordOfBar[b] = tonicChord;
  if (finalBar > 0 && chordOfBar[finalBar - 1].root === tonic) chordOfBar[finalBar - 1] = progression[progression.length - 1].root === tonic ? progression[Math.max(0, progression.length - 2)] : progression[progression.length - 1];
  const chords: MusicPlan["chords"] = [];
  let voicing: number[] | null = null;
  let bassPrev: number | null = null;
  const center = (spec.voicing.low + spec.voicing.high) / 2;
  for (let b = 0; b < totalBars; b++) {
    const c = chordOfBar[b];
    voicing = voiceLead(voicing, c, { voices: spec.voicing.voices, low: spec.voicing.low, high: spec.voicing.high, center });
    bassPrev = bassNote(c, bassPrev, spec.bassRange[0], spec.bassRange[1]);
    chords.push({ bar: b, chord: c, voicing, bass: bassPrev });
  }

  // The hook's chords bar by bar, as a drop plays them (two bars a chord in slow styles).
  const hookChords = [0, 1, 2, 3].map((b) => progression[Math.floor(b / spec.chordBars) % progression.length]);
  const hook = makeHook(spec, hookChords, tonic, mode, rngFor(seed, "hook"));
  const arp = rngFor(seed, "arp").pick(ARPS);

  // Swing: within each swung pair the first step takes `amount` of it.
  const sw = spec.swing;
  const pairSteps = sw.unit === 16 ? 2 : 4;
  const swingAt = (st: number) => {
    const pair = Math.floor(st / pairSteps);
    const p = (st - pair * pairSteps) / pairSteps;
    const q = p < 0.5 ? p * 2 * sw.amount : sw.amount + (p - 0.5) * 2 * (1 - sw.amount);
    return (pair + q) * pairSteps;
  };
  const T = (gbar: number, st: number) => gbar * bar + swingAt(st) * step;

  const events: NoteEvent[] = [];
  const fxParts = new Set<Part>(["riser", "impact", "revcymbal", "downlifter", "braam"]);
  const add = (e: NoteEvent, rng?: Rng) => {
    if (!fx && fxParts.has(e.part)) return;
    if (rng && e.part !== "vinyl") {
      const tight = e.part === "kick" || e.part === "sub" || e.tag === "final" ? 0.3 : 1;
      e.t += rng.gauss() * spec.humanize.time * tight;
      e.vel *= 1 + rng.gauss() * spec.humanize.vel * 0.5;
    }
    // A section owns its downbeat: no hand plays it early, into the part
    // (or the breath) before.
    e.t = Math.max(0, e.t, sections[e.section]?.start ?? 0);
    e.vel = Math.max(0.02, Math.min(1, e.vel));
    events.push(e);
  };

  const drops: number[] = [];
  const gaps: [number, number][] = [];
  const pump: number[] = [];
  const padCutoff: [number, number][] = [];
  const [cLo, cHi] = spec.padCutoff;
  const cutoff = (e: number) => cLo * (cHi / cLo) ** Math.max(0, Math.min(1, e));

  sections.forEach((s, si) => {
    const next = sections[si + 1];
    const prevS = sections[si - 1];
    const parts = new Set(spec.roles[s.role]);
    const lvl = levelOf(s.energy);
    const rng = rngFor(s.seed, "events");
    const full = s.role === "drop" || s.energy >= 0.85;
    const kit = full ? spec.drums.full : spec.drums.light;
    const intoDrop = !!next && next.role === "drop" && next.energy > s.energy + 0.15;
    const breath = intoDrop && spec.breath > 0 ? spec.breath * beat : 0;
    const sEnd = s.end - breath;
    if (s.role === "drop" && (!prevS || prevS.energy < s.energy - 0.15) && si > 0) drops.push(s.start);
    if (breath) gaps.push([sEnd, s.end]);

    // The pad's filter: by energy, sweeping open through builds, closing in outros.
    // Other parts before a drop open only over their last bar.
    const c0 = cutoff(s.role === "build" ? s.energy * 0.6 : s.energy);
    const c1 = s.role === "build" || intoDrop ? cHi : s.role === "outro" ? cLo : c0;
    if (s.role !== "build" && intoDrop) padCutoff.push([s.start, c0], [Math.max(s.start, s.end - bar), c0], [s.end, c1]);
    else padCutoff.push([s.start, c0], [Math.max(s.start, s.end - (s.role === "build" ? 0 : bar * 0.5)), c1]);

    for (let b = 0; b < s.bars; b++) {
      const gb = s.startBar + b;
      if (ending === "ring" ? gb >= finalBar : gb === totalBars - 1) break;
      const ch = chords[gb];
      const lastBar = b === s.bars - 1;
      const changeNext = lastBar && !!next && (next.role !== s.role || next.energy !== s.energy);
      const barEnd = Math.min((gb + 1) * bar, sEnd);
      const hit = (part: Part, st: number, vel: number, extra: Partial<NoteEvent> = {}) => {
        const t = T(gb, st);
        if (t >= sEnd - 1e-6) return;
        add({ part, t, dur: Math.max(0.01, barEnd - t + bar), vel: vel * lvl, bar: gb, step: st, section: si, ...extra }, rng);
      };

      // ---- drums ----
      const fillBar = changeNext && (parts.has("kick") || parts.has("taiko") || parts.has("snare"));
      for (const part of ["kick", "snare", "clap", "rim", "hat", "openhat", "shaker", "taiko", "tom"] as Part[]) {
        if (!parts.has(part)) continue;
        let pat = kit[part] ?? spec.drums.full[part];
        if (!pat) continue;
        // Builds: the groove thins to the kick and hats, the roll carries it.
        if (s.role === "build" && (part === "clap" || part === "snare") && req.style !== "cinematic") continue;
        if (s.role === "build" && part === "hat") pat = b >= s.bars / 2 ? pat.map((_, i) => (i % 2 === 0 ? 0.4 + 0.5 * (b / s.bars) : 0.25)) : pat;
        // A build drives quarter-note kicks, rising.
        if (s.role === "build" && part === "kick") pat = pat.map((_, i) => (i % 4 === 0 ? 0.85 + 0.15 * ((b + i / 16) / s.bars) : 0));
        for (let st = 0; st < 16; st++) {
          let v = pat[st];
          if (!v) continue;
          // Fills: the groove leaves room in the last beats before a change.
          if (fillBar && st >= 12 && (part === "kick" || part === "hat" || part === "openhat") && req.style !== "lofi") continue;
          // A small variation every fourth bar: the hats open, a kick skips.
          if (b % 4 === 3 && part === "hat" && st === 14 && full) {
            hit("openhat", st, 0.6);
            continue;
          }
          if (part === "kick" && req.style === "lofi" && b % 2 === 1 && st === 10) {
            // Every other bar the third kick comes a sixteenth late.
            hit(part, 11, v * 0.9);
            continue;
          }
          if (part === "snare" && req.style === "lofi") {
            // The lazy backbeat: a few milliseconds behind.
            hit(part, st, v, { t: T(gb, st) + 0.012 } as Partial<NoteEvent>);
            continue;
          }
          if (part === "tom") v *= 0.7 + 0.3 * rng.next();
          const pitch = part === "tom" ? [45, 47, 50, 52][st % 4] : part === "taiko" ? (st === 0 || st === 8 ? 36 : 41) : undefined;
          // A build's kick loses its low end, so the drop's lands harder.
          hit(part, st, v, { ...(pitch === undefined ? {} : { pitch }), ...(part === "kick" && s.role === "build" ? { tag: "thin" as const } : {}) });
          if (part === "kick" && spec.sidechain && (s.role === "drop" || s.role === "verse") && Object.keys(spec.sidechain).length) pump.push(T(gb, st));
        }
      }
      if (fillBar && s.role !== "build") {
        // A fill into the next section: snare (or tom) sixteenths rising.
        const part: Part = req.style === "cinematic" ? "tom" : req.style === "lofi" ? "snare" : "roll";
        const from = req.style === "lofi" ? 13 : 8;
        for (let st = from; st < 16; st++) {
          if (req.style === "lofi" && st === 14) continue;
          hit(part, st, 0.35 + 0.55 * ((st - from) / (16 - from)), { tag: "fill", ...(part === "tom" ? { pitch: [52, 50, 47, 45][st % 4] } : {}) });
        }
      }
      if (parts.has("roll") && s.role === "build") {
        // The build's snare roll: quarters, then eighths, sixteenths and
        // thirty-seconds in the last bar, rising.
        const n = s.bars;
        const k = n - b; // bars left
        const per = k <= 1 ? 32 : k <= 2 ? 16 : k <= 3 ? 8 : 4;
        for (let i = 0; i < per; i++) {
          const st = (i * 16) / per;
          const t = gb * bar + st * step;
          if (t >= sEnd - 1e-6) break;
          const x = (b + i / per) / n;
          add({ part: "roll", t, dur: 0.3, vel: (0.25 + 0.7 * x ** 1.4) * lvl, bar: gb, step: Math.floor(st), section: si }, rng);
        }
      }
      if (parts.has("vinyl") && b === 0 && (si === 0 || !spec.roles[sections[si - 1].role].includes("vinyl"))) {
        let endBar = si;
        while (endBar + 1 < sections.length && spec.roles[sections[endBar + 1].role].includes("vinyl")) endBar++;
        add({ part: "vinyl", t: s.start, dur: Math.min(duration, sections[endBar].end) - s.start, vel: 1, bar: gb, step: 0, section: si });
      }

      // ---- bass ----
      if (parts.has("sub")) {
        if (req.style === "launch" || req.style === "ambient" || b % spec.chordBars === 0) {
          const len = (req.style === "ambient" ? spec.chordBars : 1) * bar;
          // Ambient holds the tonic under every chord (a pedal), as drones do.
          const pedal = req.style === "ambient" ? bassNote({ ...ch.chord, root: tonic }, ch.bass, spec.bassRange[0], spec.bassRange[1]) : ch.bass;
          if (b % (req.style === "ambient" ? spec.chordBars : 1) === 0) add({ part: "sub", t: gb * bar, dur: Math.min(len, sEnd - gb * bar) - 0.01, pitch: pedal, vel: 0.9 * lvl, bar: gb, step: 0, section: si });
        } else if (req.style === "cinematic") {
          add({ part: "sub", t: gb * bar, dur: Math.min(bar, sEnd - gb * bar) - 0.01, pitch: ch.bass, vel: 0.85 * lvl, bar: gb, step: 0, section: si });
        }
      }
      if (parts.has("bass")) {
        const kickPat = (spec.drums.full.kick ?? []).map((v) => v > 0);
        let onsets: number[];
        if (req.style === "launch") onsets = [2, 6, 10, 14];
        else if (req.style === "corporate") onsets = s.role === "drop" ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12];
        else onsets = kickPat.flatMap((on, i) => (on ? [i === 10 && b % 2 === 1 ? 11 : i] : [])).concat(b % 2 === 1 ? [14] : []);
        onsets = [...new Set(onsets)].sort((x, y) => x - y);
        onsets.forEach((st, i) => {
          const nextSt = onsets[i + 1] ?? 16;
          let pitch = ch.bass + (req.style === "launch" ? 12 : 0);
          if (req.style === "corporate" && st === 14 && b % 2 === 1) pitch += 12;
          if (req.style === "lofi" && st === 14) {
            // An approach note into the next bar's root.
            const nextRoot = chords[Math.min(totalBars - 1, gb + 1)].bass;
            pitch = nextRoot + (nextRoot > ch.bass ? -1 : 2);
          } else if (req.style === "lofi" && i === 1) pitch = ch.bass + 7 <= spec.bassRange[1] + 7 ? ch.bass + 7 : ch.bass;
          const len = req.style === "launch" ? 1.5 : req.style === "corporate" ? Math.min(nextSt - st, 2) * 0.85 : (nextSt - st) * 0.92;
          const t = T(gb, st);
          if (t < sEnd - 1e-6) add({ part: "bass", t, dur: Math.min(len * step, sEnd - t), pitch, vel: (st % 4 === 0 ? 0.95 : 0.8) * lvl, bar: gb, step: st, section: si }, rng);
        });
      }

      // ---- harmony ----
      const cb = chordBarsOf(s);
      const chordStart = b % cb === 0;
      const chordLen = Math.min(cb * bar, sEnd - gb * bar);
      for (const part of ["pad", "strings", "choir", "brass"] as Part[]) {
        if (!parts.has(part) || !chordStart) continue;
        let notes = ch.voicing;
        if (part === "choir") notes = ch.voicing.slice(-3).map((n) => (n < 60 ? n + 12 : n));
        if (part === "brass") notes = ch.voicing.slice(0, 3).map((n) => n - 12).concat([ch.bass + 12]);
        if (part === "strings" && s.role === "drop") notes = [...ch.voicing, ch.bass + 12];
        for (const n of notes) add({ part, t: gb * bar, dur: chordLen, pitch: n, vel: 0.8 * lvl, bar: gb, step: 0, section: si });
      }
      if (parts.has("keys")) {
        // Rhodes comping: the chord on one, a shorter push on the and of
        // three, sometimes anticipating the next bar.
        const comp: [number, number, number][] = s.role === "drop" ? [[0, 9, 0.85], [10, 5, 0.6]] : [[0, 14, 0.75]];
        if (rng.chance(0.35) && s.role === "drop" && !lastBar) comp.push([14, 2, 0.5]);
        for (const [st, len, v] of comp) {
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) continue;
          const notes = st === 14 ? chords[Math.min(totalBars - 1, gb + 1)].voicing : ch.voicing;
          notes.forEach((n, i) => add({ part: "keys", t: t + i * 0.006, dur: Math.min(len * step, sEnd - t), pitch: n, vel: v * lvl, bar: gb, step: st, section: si }, rng));
        }
      }
      if (parts.has("piano")) {
        if (req.style === "corporate") {
          // The inspiring-corporate eighths: a broken chord, the bass on one.
          const tones = [...ch.voicing].sort((x, y) => x - y);
          const order = [0, 2, 1, 3, 0, 2, 1, 3].map((i) => tones[i % tones.length] + 12);
          for (let k = 0; k < 8; k++) {
            const t = T(gb, k * 2);
            if (t >= sEnd - 1e-6) break;
            add({ part: "piano", t, dur: Math.min(0.45 * beat * 2, sEnd - t), pitch: order[k], vel: (k % 2 ? 0.55 : 0.75) * lvl, bar: gb, step: k * 2, section: si }, rng);
          }
          add({ part: "piano", t: gb * bar, dur: Math.min(bar, sEnd - gb * bar), pitch: ch.bass + 12 * Math.ceil((40 - ch.bass) / 12), vel: 0.6 * lvl, bar: gb, step: 0, section: si }, rng);
        } else if (chordStart) {
          // Felt piano: a slow broken chord, one note a beat.
          const tones = [...ch.voicing].sort((x, y) => x - y);
          [0, 1, 2, 3].forEach((k) => {
            const t = gb * bar + k * beat * cb;
            if (t >= sEnd - 1e-6) return;
            add({ part: "piano", t, dur: Math.min(2 * beat, sEnd - t), pitch: tones[[0, 2, 1, 3][k] % tones.length] + 12, vel: (k ? 0.45 : 0.6) * lvl, bar: gb, step: k * 4, section: si }, rng);
          });
        }
      }
      if (parts.has("pluck") && req.style === "corporate") {
        STRUM.forEach((st, k) => {
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) return;
          const down = k % 2 === 0;
          const notes = down ? ch.voicing : [...ch.voicing].reverse();
          notes.forEach((n, i) => add({ part: "pluck", t: t + i * (down ? 0.009 : 0.006), dur: Math.min(0.5, sEnd - t), pitch: n, vel: (down ? 0.75 : 0.5) * lvl, bar: gb, step: st, section: si }, rng));
        });
      }
      if (parts.has("arp")) {
        const tones = [...ch.voicing.slice(-3), ch.voicing[ch.voicing.length - 3] + 12].map((n) => (n < 64 ? n + 12 : n));
        // Ambient's mallets fall on the beat, slow and spacious.
        const every = req.style === "ambient" ? 4 : 1;
        for (let st = 0; st < 16; st += every) {
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) break;
          const k = (st / every + b * 4) % arp.length;
          const build = s.role === "build" ? 0.4 + 0.6 * ((b + st / 16) / s.bars) : 1;
          add({ part: "arp", t, dur: Math.min(step * every * 0.9, sEnd - t), pitch: tones[arp[k]], vel: (st % 4 === 0 ? 0.8 : 0.6) * build * lvl, bar: gb, step: st, section: si }, rng);
        }
      }
      if (parts.has("ostinato")) {
        // Spiccato strings: sixteenths on the root, fifth and octave,
        // accented on the beat (a 3-3-2 accent reads as a faster tempo).
        const root = ch.bass + 24 >= 48 ? ch.bass + 12 * Math.round((50 - ch.bass) / 12) : ch.bass + 24;
        const fig = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 0, 10, 7].map((x) => (x === 10 && !chordPcs(ch.chord).includes((ch.chord.root + 10) % 12) ? 7 : x));
        for (let st = 0; st < 16; st++) {
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) break;
          const acc = st % 4 === 0 ? 0.9 : st % 2 === 0 ? 0.6 : 0.45;
          add({ part: "ostinato", t, dur: Math.min(step * 0.8, sEnd - t), pitch: root + fig[st], vel: acc * lvl, bar: gb, step: st, section: si }, rng);
        }
      }
      if (parts.has("bell") && req.style === "ambient") {
        // Glassy bells: a few chord tones high up, on eighths, sparse.
        const tones = scaleNotes(tonic, mode, 72, 91).filter((n) => chordPcs(ch.chord).includes(n % 12));
        for (let st = 0; st < 16; st += 2) {
          if (!rng.chance(st === 0 ? 0.7 : 0.22)) continue;
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) break;
          add({ part: "bell", t, dur: Math.min(3 * beat, duration - t), pitch: rng.pick(tones), vel: 0.6 * lvl, bar: gb, step: st, section: si }, rng);
        }
      }
    }

    // ---- the hook: in drops whole, teased (its first two bars) elsewhere ----
    const hookPart: Part | null = parts.has("lead") ? "lead" : null;
    const teasePart: Part | null = s.role === "drop" ? null : parts.has("pluck") && req.style === "launch" ? "pluck" : parts.has("piano") && req.style === "cinematic" ? "piano" : parts.has("bell") && req.style === "corporate" ? "bell" : parts.has("lead") && req.style === "lofi" ? "lead" : null;
    const playHook = (part: Part, fromBar: number, bars: number, vel: number, tag: NoteEvent["tag"], shift = 0) => {
      for (let b0 = 0; b0 < bars; b0 += 4) {
        for (const h of hook) {
          const hb = Math.floor(h.step / 16);
          if (b0 + hb >= bars) continue;
          const gb = fromBar + b0 + hb;
          if (ending === "ring" ? gb >= finalBar : gb >= totalBars - 1) continue;
          const st = h.step % 16;
          const t = T(gb, st);
          if (t >= sEnd - 1e-6) continue;
          let pitch = h.pitch + shift;
          if (tag === "counter") {
            const sc = scaleNotes(tonic, mode, pitch - 5, pitch - 1);
            pitch = sc.length >= 2 ? sc[sc.length - 2] : pitch - 3;
          }
          add({ part, t, dur: Math.min(h.len * step * 0.92, sEnd - t), pitch, vel: (st % 4 === 0 ? 0.9 : 0.75) * vel * lvl, bar: gb, step: st, section: si, tag }, rng);
        }
      }
    };
    if (hookPart && s.role === "drop") {
      playHook("lead", s.startBar, s.bars, 1, "hook");
      if (req.style === "corporate" && parts.has("bell")) playHook("bell", s.startBar, s.bars, 0.8, "hook", 12);
      const laterDrop = sections.slice(0, si).some((x) => x.role === "drop");
      if (laterDrop && (req.style === "launch" || req.style === "cinematic" || req.style === "corporate")) playHook("counter", s.startBar, s.bars, 0.55, "counter");
    } else if (teasePart && s.role !== "build") {
      // The hook on a softer voice, through the whole section, so the
      // part stays one thing from its first bar to its last.
      playHook(teasePart, s.startBar, s.bars, req.style === "lofi" ? 0.8 : 0.7, "teaser");
    }

    // ---- joins: risers into drops, crashes, impacts and braams on them ----
    if (intoDrop) {
      const riseBars = Math.min(s.bars, s.role === "build" ? s.bars : 2, 4);
      const rStart = Math.max(s.start, s.end - riseBars * bar);
      // (Lo-fi has no risers: the beat just comes back in.)
      if (sEnd - rStart > beat && req.style !== "lofi") add({ part: "riser", t: rStart, dur: sEnd - rStart, vel: 0.9, bar: s.startBar + s.bars - riseBars, step: 0, section: si });
      if (req.style !== "lofi" && req.style !== "ambient") {
        const len = Math.min(2 * beat, sEnd - s.start);
        add({ part: "revcymbal", t: sEnd - len, dur: len, vel: 0.8, bar: s.startBar + s.bars - 1, step: 8, section: si });
      }
    }
    if (si > 0 && (s.role === "drop" || s.energy >= prevS.energy + 0.2) && (s.role !== "outro")) {
      const big = s.role === "drop" && prevS.energy < s.energy - 0.15;
      add({ part: "crash", t: s.start, dur: 4 * beat, vel: big ? 1 : 0.7, bar: s.startBar, step: 0, section: si });
      if (big) {
        add({ part: "impact", t: s.start, dur: 3, vel: 1, bar: s.startBar, step: 0, section: si });
        if (req.style === "cinematic") add({ part: "braam", t: s.start, dur: Math.min(3, s.end - s.start), pitch: chords[s.startBar].bass + 12, vel: 1, bar: s.startBar, step: 0, section: si });
      }
    }
    if (s.role === "drop" && s.bars > 8) for (let b = 8; b < s.bars; b += 8) add({ part: "crash", t: (s.startBar + b) * bar, dur: 4 * beat, vel: 0.6, bar: s.startBar + b, step: 0, section: si });
    if (s.role === "breakdown" && prevS?.role === "drop" && (req.style === "launch" || req.style === "cinematic")) add({ part: "downlifter", t: s.start, dur: Math.min(2 * bar, s.end - s.start), vel: 0.8, bar: s.startBar, step: 0, section: si });
  });

  // ---- the ending ----
  const finalHit = finalBar * bar;
  // The beat of silence before the biggest hit, as before a drop.
  if (spec.breath > 0 && finalBar > 0) gaps.push([finalHit - spec.breath * beat, finalHit]);
  const lastS = sections.findIndex((s) => s.startBar <= finalBar && finalBar < s.startBar + s.bars);
  const fin = chords[finalBar];
  const ringFor = duration - finalHit;
  const stopLen = ending === "stop" ? Math.min(ringFor, beat * 1.5) : ringFor;
  const finalParts = new Set<Part>([...spec.roles.drop, ...spec.roles.outro]);
  // (Ambient's last chord is no louder than its quiet parts.)
  const finalLevel = req.style === "ambient" ? 0.55 : 1;
  const fe = (part: Part, dur: number, vel: number, pitch?: number) => add({ part, t: finalHit, dur, pitch, vel: vel * finalLevel, bar: finalBar, step: 0, section: lastS, tag: "final" });
  // Ambient ends on the chord alone, swelling, never a hit.
  const hit = req.style !== "ambient" || ending === "stop";
  if (finalParts.has("kick") && hit) fe("kick", 1, 1);
  if (finalParts.has("taiko")) fe("taiko", 2, 1, 36);
  if (hit) fe("crash", ending === "stop" ? stopLen : Math.min(ringFor, 6), 1);
  if (req.style !== "lofi" && hit) fe("impact", Math.min(ringFor, 4), ending === "stop" ? 0.9 : 0.75);
  if (req.style === "cinematic") fe("braam", Math.min(ringFor, 4), 0.9, fin.bass + 12);
  if (finalParts.has("sub") || finalParts.has("bass")) fe(finalParts.has("sub") ? "sub" : "bass", stopLen, 0.9, fin.bass);
  const harm: Part = (["pad", "strings", "keys", "piano"] as Part[]).find((p) => finalParts.has(p)) ?? "pad";
  for (const n of fin.voicing) fe(harm, stopLen, 0.85, n);
  if (finalParts.has("choir")) for (const n of fin.voicing.slice(-3)) fe("choir", stopLen, 0.8, n < 60 ? n + 12 : n);
  if (finalParts.has("brass")) for (const n of fin.voicing.slice(0, 3)) fe("brass", stopLen, 0.8, n - 12);
  // The hook's home note on the lead, held.
  const home = nearestIn(scaleNotes(tonic, mode, STYLES[req.style].hook.low, STYLES[req.style].hook.high).filter((n) => n % 12 === tonic), hook[hook.length - 1]?.pitch ?? 72);
  if (finalParts.has("lead")) fe("lead", ending === "stop" ? stopLen : Math.min(ringFor, 3 * beat), 0.8, home);
  // Ring: the final hit lands on the outro's first beat and rings; from
  // its second beat the hook's opening echoes softly over a quiet
  // afterglow of the tonic chord, and everything falls away over the last
  // bar (half a bar in a short outro): one part to an editor's ear (and to
  // analyze_music, whose beat tracker needs the echo's onsets to hear the
  // outro at all), as the launch film's outro was.
  const afterglow = ending === "ring" && ringFor >= 1.5 * bar;
  const fadeLen = ringFor > 2.5 * bar ? Math.max(bar, 0.3 * ringFor) : bar / 2;
  if (afterglow) {
    const echoPart: Part = req.style === "launch" ? "pluck" : req.style === "corporate" ? "bell" : req.style === "lofi" ? "keys" : req.style === "ambient" ? "bell" : "piano";
    const from = finalHit + beat;
    for (let k = 0; from + k * 2 * bar < duration - fadeLen; k++) {
      for (const h of hook.filter((x) => x.step < 32)) {
        const t = from + k * 2 * bar + h.step * step;
        if (t < duration - fadeLen / 2) add({ part: echoPart, t, dur: Math.min(h.len * step, duration - t), pitch: h.pitch, vel: 0.45, bar: finalBar + Math.floor((t - finalHit) / bar), step: h.step % 16, section: lastS, tag: "teaser" });
      }
    }
    const t = finalHit + beat;
    for (const n of fin.voicing) add({ part: harm, t, dur: duration - t, pitch: n, vel: 0.25, bar: finalBar, step: 4, section: lastS, tag: "teaser" });
  }
  const fadeOut: [number, number] = ending === "stop" ? [finalHit + stopLen, Math.min(duration, finalHit + stopLen + beat)] : afterglow ? [Math.max(finalHit + beat / 4, duration - fadeLen), duration] : [Math.min(finalHit + beat / 4, duration - 0.05), duration];
  padCutoff.push([finalHit, cutoff(0.8)], [duration, cLo]);

  // ---- breaths: nothing sounds in a gap but what ends at it ----
  for (const e of events) {
    for (const [a, b] of gaps) {
      if (e.t < a && e.t + e.dur > a) e.dur = a - e.t;
      if (e.t >= a && e.t < b) e.dur = 0;
    }
    if (e.t + e.dur > duration) e.dur = Math.max(0, duration - e.t);
  }
  const kept = events.filter((e) => e.dur > 0.005 && e.t < duration).sort((a, b) => a.t - b.t || a.part.localeCompare(b.part));
  padCutoff.sort((a, b) => a[0] - b[0]);

  return {
    style: req.style,
    bpm,
    tonic,
    mode,
    key: keyName(tonic, mode),
    seed,
    ending,
    fx,
    beat,
    bar,
    duration,
    sections,
    chords,
    progression: progression.map((c) => c.name),
    hook,
    events: kept,
    drops,
    finalHit,
    gaps,
    pump: [...new Set(pump)].filter((t) => !gaps.some(([a, b]) => t >= a && t < b)).sort((a, b) => a - b),
    padCutoff,
    fadeOut,
    fit: res.fit,
  };
}

/** Each stem's parts, for the renderer and the answer. */
export const partsOfStem = (stem: Stem): Part[] => (Object.keys(STEM_OF) as Part[]).filter((p) => STEM_OF[p] === stem);
