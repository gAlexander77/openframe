// What generate_music and plan_music answer: the cue sheet of a plan
// (tempo, every bar and beat, the sections, the drops, where to cut), in
// timeline seconds once the music is placed, and the tools' arguments read
// into a request. Pure, so the answer is tested without rendering.

import { MODE_IDS, type Mode } from "./theory";
import { MAX_SECONDS, planMusic, type Ending, type MusicPlan, type MusicRequest, type SectionRequest } from "./arrange";
import { STYLE_IDS, type Role, type StyleId } from "./styles";

const r3 = (t: number) => Math.round(t * 1000) / 1000;

export type CutKind = "drop" | "section" | "phrase" | "bar";

export interface CueSheet {
  style: StyleId;
  seed: number;
  bpm: number;
  key: string;
  progression: string[];
  /** Seconds a beat and a bar last (4/4). */
  beat: number;
  bar: number;
  /** Timeline seconds the music starts at; every time below includes it. */
  start: number;
  /** Seconds the music lasts. */
  duration: number;
  sections: { name: string; role: Role; start: number; end: number; bars: number; energy: number }[];
  /** Where a drop lands after something quieter. */
  drops: number[];
  /** The last big hit (the end card's moment). */
  final_hit: number;
  /** Beats of silence before drops and the final hit, [from, to). */
  breaths: [number, number][];
  /** Every bar line, then every beat. */
  bars: number[];
  beats: number[];
  /** Where cuts land best, strongest first in kind: a drop, a section's
   * start, a phrase (four bars), a bar line inside a drop or build. */
  cut_points: { at: number; kind: CutKind }[];
  fit: MusicPlan["fit"];
}

/** The plan's cue sheet, every time moved by `start` (timeline seconds). */
export function cueSheet(plan: MusicPlan, start = 0): CueSheet {
  const at = (t: number) => r3(t + start);
  const totalBars = plan.sections.reduce((s, x) => s + x.bars, 0);
  const bars = Array.from({ length: totalBars }, (_, b) => at(b * plan.bar)).filter((t) => t < at(plan.duration));
  const beats = Array.from({ length: totalBars * 4 }, (_, k) => at(k * plan.beat)).filter((t) => t < at(plan.duration));
  const cuts = new Map<number, CutKind>();
  const rank: Record<CutKind, number> = { drop: 0, section: 1, phrase: 2, bar: 3 };
  const put = (t: number, kind: CutKind) => {
    if (t <= 0 || t >= plan.duration) return;
    const k = r3(t);
    const was = cuts.get(k);
    if (!was || rank[kind] < rank[was]) cuts.set(k, kind);
  };
  for (const s of plan.sections) {
    put(s.start, "section");
    for (let b = 4; b < s.bars; b += 4) put(s.start + b * plan.bar, "phrase");
    if (s.role === "drop" || s.role === "build") for (let b = 1; b < s.bars; b++) put(s.start + b * plan.bar, "bar");
  }
  put(plan.finalHit, "section");
  for (const d of plan.drops) put(d, "drop");
  return {
    style: plan.style,
    seed: plan.seed,
    bpm: +plan.bpm.toFixed(3),
    key: plan.key,
    progression: plan.progression,
    beat: r3(plan.beat),
    bar: r3(plan.bar),
    start: r3(start),
    duration: r3(plan.duration),
    sections: plan.sections.map((s) => ({ name: s.name, role: s.role, start: at(s.start), end: at(Math.min(s.end, plan.duration)), bars: s.bars, energy: s.energy })),
    drops: plan.drops.map(at),
    final_hit: at(plan.finalHit),
    breaths: plan.gaps.map(([a, b]) => [at(a), at(b)] as [number, number]),
    bars,
    beats,
    cut_points: [...cuts].sort((a, b) => a[0] - b[0]).map(([t, kind]) => ({ at: r3(t + start), kind })),
    fit: plan.fit,
  };
}

// ---- the tools' arguments ---------------------------------------------------------------

export const ENDINGS: Ending[] = ["ring", "stop"];
export const MUSIC_MARKER_KINDS = ["beats", "bars", "phrases", "sections", "drop"] as const;
export type MusicMarker = (typeof MUSIC_MARKER_KINDS)[number];

export interface MusicOptions {
  request: MusicRequest;
  /** Integrated loudness to master to, LUFS. */
  loudness: number;
  stems: boolean;
  place: "mix" | "stems" | "none";
  /** Timeline seconds to place it at. */
  start: number;
  markers: MusicMarker[];
  name?: string;
}

const num = (v: unknown, what: string, lo: number, hi: number): number | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`${what} must be a number from ${lo} to ${hi}`);
  return v;
};

/** generate_music's and plan_music's arguments (snake_case, from an
 * agent or the UI) as options, every value checked; `seed` defaults to a
 * new random one, which the answer reports. */
export function readMusicArgs(a: Record<string, unknown>, randomSeed: () => number = () => Math.floor(Math.random() * 1e6)): MusicOptions {
  const style = (a.style ?? "launch") as StyleId;
  if (!STYLE_IDS.includes(style)) throw new Error(`style must be one of ${STYLE_IDS.join(", ")}`);
  const mode = a.mode as Mode | undefined;
  if (mode !== undefined && !MODE_IDS.includes(mode)) throw new Error(`mode must be one of ${MODE_IDS.join(", ")}`);
  const ending = (a.ending ?? "ring") as Ending;
  if (!ENDINGS.includes(ending)) throw new Error(`ending must be ring or stop`);
  if (a.key !== undefined && typeof a.key !== "string") throw new Error("key must be a note name such as A, F# or Bb (Am for A minor)");
  const sections = a.sections as SectionRequest[] | undefined;
  if (sections !== undefined) {
    if (!Array.isArray(sections) || !sections.length) throw new Error("sections must be a list of {name, bars | seconds | at | end_at, energy}");
    sections.forEach((s, i) => {
      if (!s || typeof s.name !== "string" || !s.name.trim()) throw new Error(`section ${i + 1} needs a name (intro, verse, build, drop, breakdown, outro, ...)`);
      num(s.bars, `${s.name}: bars`, 1, 128);
      num(s.seconds, `${s.name}: seconds`, 0.5, MAX_SECONDS);
      num(s.at, `${s.name}: at`, 0, MAX_SECONDS);
      num(s.end_at, `${s.name}: end_at`, 0.5, MAX_SECONDS);
      num(s.energy, `${s.name}: energy`, 0, 1);
      num(s.seed, `${s.name}: seed`, 0, 4294967295);
    });
  }
  const markers = (a.markers ?? []) as MusicMarker[];
  if (!Array.isArray(markers) || markers.some((m) => !MUSIC_MARKER_KINDS.includes(m))) throw new Error(`markers takes ${MUSIC_MARKER_KINDS.join(", ")}`);
  const place = (a.place ?? "mix") as MusicOptions["place"];
  if (!["mix", "stems", "none"].includes(place)) throw new Error("place must be mix, stems or none");
  const seed = num(a.seed, "seed", 0, 4294967295);
  return {
    request: {
      style,
      bpm: num(a.bpm, "bpm", 40, 220),
      key: a.key as string | undefined,
      mode,
      length: num(a.length, "length", 2, MAX_SECONDS),
      sections,
      seed: seed === undefined ? randomSeed() : Math.floor(seed),
      ending,
      fx: a.fx === undefined ? undefined : !!a.fx,
      max_nudge: num(a.max_nudge, "max_nudge", 0, 0.2),
      brightness: num(a.brightness, "brightness", -1, 1),
    },
    loudness: num(a.loudness, "loudness", -30, -8) ?? -14,
    stems: !!a.stems || place === "stems",
    place,
    start: num(a.start, "start", 0, 36000) ?? 0,
    markers,
    name: typeof a.name === "string" && a.name.trim() ? a.name.trim() : undefined,
  };
}

/** The file name a score is imported under. */
export function musicName(plan: MusicPlan, label: string, name?: string): string {
  return `${name ?? `${label} ${Math.round(plan.bpm)} BPM ${plan.key} (seed ${plan.seed})`}`.replace(/[\\/:*?"<>|]/g, "-");
}

/** plan_music: the cue sheet a generate_music call with these arguments
 * would answer, without rendering (the seed decides the chords and the
 * hook, not the timing), with the chord of every bar. */
export function planMusicAnswer(args: Record<string, unknown>, randomSeed?: () => number) {
  const o = readMusicArgs(args, randomSeed);
  const plan = planMusic(o.request);
  return { ...cueSheet(plan, o.start), chords: plan.chords.map((c) => c.chord.name), note: `${plan.fit.note} Pass seed ${plan.seed} to generate_music for this exact piece.` };
}
