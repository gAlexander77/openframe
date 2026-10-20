// A music file's structure (beats.ts musicStructure, read once from the
// whole file) placed where a clip of it plays: through its in-point, its
// speed (a curve too) and its place on the timeline (ADR-096). Reading only
// the clip's own stretch lost the bar phase: a 0-32 s clip of a score whose
// second drop comes at 36 s has half the evidence for where bars start, and
// read its downbeats a beat pair late and its drop a bar early.

import { framesForSource, sourceRange, type TimedClip } from "../project/ops";
import type { MusicGrid } from "../project/types";
import { framesToSeconds, nearestFrame, type Rational } from "../time";
import { BARS_PER_PHRASE, BEATS_PER_BAR, type MusicStructure, type SectionLabel, type StructureHints } from "./beats";

export interface MappedMusic {
  /** Beats a minute as the clip plays it (the file's tempo times its speed). */
  bpm: number;
  /** The file's own tempo, when the clip plays it at another speed. */
  file_bpm?: number;
  /** Timeline seconds, inside the clip. */
  beats: number[];
  downbeats: number[];
  phrases: number[];
  hits: number[];
  beat_energy: number[];
  sections: { start: number; end: number; label: SectionLabel; energy: number }[];
  drop: number | null;
  drops: number[];
}

/**
 * Source seconds of `c` to timeline seconds, rounded to its frame (null
 * outside the stretch the clip plays). Through the clip's own source-time
 * map, so a speed curve or a reversed clip maps too.
 */
export function sourceToTimeline(c: TimedClip, fps: Rational): { at: (t: number) => number | null; frame: (t: number) => number | null; edge: (t: number) => number; lo: number; hi: number } {
  const [lo, hi] = sourceRange(c, fps);
  // The clip frame where its source reaches t (a speed curve's frames are
  // only defined inside the clip, so t is held to its stretch first).
  const frameOf = (t: number) => {
    const u = Math.min(hi, Math.max(lo, t));
    const f = c.reverse ? framesForSource(c, c.in - u, fps) : framesForSource(c, u - c.in, fps);
    // Past the stretch, the constant-speed slope carries on (a beat half a
    // frame before the in-point still lands on the clip's first frame).
    const sps = (hi - lo) / Math.max(1, c.duration);
    return f + (c.reverse ? -1 : 1) * (t - u) / (sps || 1);
  };
  const toSec = (f: number) => +framesToSeconds(c.start + f, fps).toFixed(3);
  // Rounded as secondsToFrames rounds, a tie to the earlier frame: a beat
  // at 3.75 s at 30 fps is frame 112, for its marker and for a command
  // given 3.75 alike (ADR-102, ADR-106).
  return {
    lo,
    hi,
    at: (t) => {
      const f = nearestFrame(frameOf(t));
      return f >= 0 && f < c.duration ? toSec(f) : null;
    },
    // The timeline frame instead (markers that follow the clip).
    frame: (t) => {
      const f = nearestFrame(frameOf(t));
      return f >= 0 && f < c.duration ? c.start + f : null;
    },
    // A section's edge: held inside the clip.
    edge: (t) => toSec(Math.min(c.duration, Math.max(0, nearestFrame(frameOf(Math.min(hi, Math.max(lo, t))))))),
  };
}

/** The structure where `c` plays it, timeline seconds; what falls outside
 * the clip is left out, and sections are cut at its edges. `from` is the
 * source second the analyzed audio starts at (0 for the whole file). */
export function mapMusic(m: MusicStructure, c: TimedClip, fps: Rational, from = 0): MappedMusic {
  const map = sourceToTimeline(c, fps);
  const at = (t: number) => map.at(t + from);
  const all = (ts: number[]) => ts.map(at).filter((t): t is number => t !== null).sort((a, b) => a - b);
  const kept = m.beats.map((t, i) => [at(t), m.energy[i]] as const).filter((x): x is readonly [number, number] => x[0] !== null).sort((a, b) => a[0] - b[0]);
  const sections = m.sections
    .map((s) => {
      const [a, b] = [map.edge(s.start + from), map.edge(s.end + from)];
      return { ...s, start: Math.min(a, b), end: Math.max(a, b) };
    })
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const drops = m.drops.map((t, i) => [at(t), m.rises[i] ?? 0] as const).filter((x): x is readonly [number, number] => x[0] !== null);
  // The biggest drop the clip plays (the song's own may be outside it).
  const biggest = drops.reduce<readonly [number, number] | null>((b, d) => (!b || d[1] > b[1] ? d : b), null);
  const own = m.drop === null ? null : at(m.drop);
  // The tempo heard: a clip at 1.25x plays a 128 BPM song at 160.
  const speed = c.speedCurve || c.freeze ? 1 : c.speed;
  return {
    bpm: +(m.bpm * speed).toFixed(1),
    ...(speed !== 1 || c.speedCurve ? { file_bpm: m.bpm } : {}),
    beats: kept.map(([t]) => t),
    downbeats: all(m.downbeats),
    phrases: all(m.phrases),
    hits: all(m.hits),
    beat_energy: kept.map(([, e]) => e),
    sections,
    drop: own ?? biggest?.[0] ?? null,
    drops: drops.map(([t]) => t).sort((a, b) => a - b),
  };
}

const LABELS: SectionLabel[] = ["intro", "verse", "build", "drop", "breakdown", "outro"];

/** analyze_music's hints from the tool's arguments (source seconds), checked. */
export function readMusicHints(a: { bpm?: unknown; first_downbeat?: unknown; cues?: unknown }): StructureHints {
  const out: StructureHints = {};
  if (a.bpm !== undefined) {
    const bpm = Number(a.bpm);
    if (!(bpm >= 40 && bpm <= 240)) throw new Error("bpm must be between 40 and 240");
    out.bpm = bpm;
  }
  if (a.first_downbeat !== undefined) {
    const t = Number(a.first_downbeat);
    if (!(t >= 0)) throw new Error("first_downbeat is a bar's first beat in the music's own seconds, 0 or more");
    out.firstDownbeat = t;
  }
  if (a.cues !== undefined) {
    if (!Array.isArray(a.cues)) throw new Error('cues is a list of parts: [{"at": 0, "label": "intro"}, {"at": 8, "label": "drop"}]');
    out.cues = a.cues.map((c, i) => {
      const at = Number((c as { at?: unknown })?.at), label = (c as { label?: unknown })?.label;
      if (!(at >= 0)) throw new Error(`cues[${i}].at must be the music's own seconds, 0 or more`);
      if (!LABELS.includes(label as SectionLabel)) throw new Error(`cues[${i}].label must be one of ${LABELS.join(", ")}`);
      return { at, label: label as SectionLabel };
    });
  }
  return out;
}

/** What to tell the caller about how sure the reading is. */
export function confidenceNote(c: MusicStructure["confidence"], hints: StructureHints): string | undefined {
  const notes: string[] = [];
  if (c.bars < 0.4 && hints.firstDownbeat === undefined) notes.push("the bar lines are a guess (no beat stands out as the first of a bar): give first_downbeat, a bar's first beat in the music's own seconds");
  if (c.tempo < 0.5 && hints.bpm === undefined) notes.push("few beats land on a clear attack, so the tempo is uncertain: give bpm if it is known");
  if (c.sections < 0.6 && !hints.cues) notes.push("the section boundaries are faint: give cues (the parts' start times) if they are known");
  return notes.length ? `${notes.join("; ")}.` : undefined;
}

/** A song's grid as given (set_music_grid), in its file's seconds: every
 * beat from the first downbeat both ways, bars every four beats, phrases
 * every four bars (starting where most parts start, else on the first
 * bar), the parts from their times and the drops (a drop after another
 * part). What analysis reads with the same hints, nothing guessed. */
export function gridStructure(g: MusicGrid, duration: number): { bpm: number; beats: number[]; downbeats: number[]; phrases: number[]; sections: { start: number; end: number; label: SectionLabel }[]; drops: number[]; drop: number | null } {
  const step = 60 / g.bpm;
  const first = g.firstDownbeat - Math.floor(g.firstDownbeat / step + 1e-9) * step;
  const r4 = (t: number) => Math.round(t * 1e4) / 1e4;
  const beats: number[] = [];
  for (let k = 0; first + k * step < duration; k++) beats.push(r4(first + k * step));
  const nearest = (t: number) => beats.reduce((b, x, i) => (Math.abs(x - t) < Math.abs(beats[b] - t) ? i : b), 0);
  const phase = beats.length ? nearest(g.firstDownbeat) % BEATS_PER_BAR : 0;
  const bars = beats.map((_, i) => i).filter((i) => i % BEATS_PER_BAR === phase);
  const cues = (g.sections ?? []).filter((x) => x.at > 0.05 && x.at < duration - 0.05).sort((a, b) => a.at - b.at);
  // Phrases start where most parts start (on a bar line), else on the first bar.
  const mod = (x: number, n: number) => ((x % n) + n) % n;
  const votes = [0, 0, 0, 0];
  for (const x of cues) votes[mod(Math.round((nearest(x.at) - phase) / BEATS_PER_BAR), BARS_PER_PHRASE)]++;
  const pp = votes.indexOf(Math.max(...votes));
  const phrases = bars.filter((i) => mod((i - phase) / BEATS_PER_BAR - pp, BARS_PER_PHRASE) === 0).map((i) => beats[i]);
  const sections: { start: number; end: number; label: SectionLabel }[] = [];
  if (g.sections?.length) {
    const head = g.sections.find((x) => x.at <= 0.05)?.label ?? "intro";
    const starts = [{ at: 0, label: head }, ...cues];
    starts.forEach((x, k) => sections.push({ start: r4(x.at), end: r4(k + 1 < starts.length ? starts[k + 1].at : duration), label: x.label }));
  }
  const drops = sections.filter((x, k) => k > 0 && x.label === "drop" && sections[k - 1].label !== "drop").map((x) => x.start);
  return { bpm: g.bpm, beats, downbeats: bars.map((i) => beats[i]), phrases, sections, drops, drop: drops[0] ?? null };
}

/** set_music_grid's arguments (the file's seconds), checked, as stored. */
export function readMusicGrid(a: { bpm?: unknown; first_downbeat?: unknown; sections?: unknown }): MusicGrid {
  const h = readMusicHints({ bpm: a.bpm, first_downbeat: a.first_downbeat, cues: a.sections });
  if (h.bpm === undefined || h.firstDownbeat === undefined) throw new Error("a grid needs bpm and first_downbeat (a bar's first beat, in the music file's own seconds)");
  const sections = (h.cues ?? []).slice().sort((x, y) => x.at - y.at);
  return { bpm: h.bpm, firstDownbeat: h.firstDownbeat, ...(sections.length ? { sections } : {}) };
}

/** analyze_music's hints: a stored grid, the call's own hints winning. */
export function gridHints(g: MusicGrid | undefined, given: StructureHints): StructureHints {
  if (!g) return given;
  return { bpm: g.bpm, firstDownbeat: g.firstDownbeat, ...(g.sections?.length ? { cues: g.sections } : {}), ...given };
}
