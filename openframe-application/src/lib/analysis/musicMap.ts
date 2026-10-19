// A music file's structure (beats.ts musicStructure, read once from the
// whole file) placed where a clip of it plays: through its in-point, its
// speed (a curve too) and its place on the timeline (ADR-096). Reading only
// the clip's own stretch lost the bar phase: a 0-32 s clip of a score whose
// second drop comes at 36 s has half the evidence for where bars start, and
// read its downbeats a beat pair late and its drop a bar early.

import { framesForSource, sourceRange, type TimedClip } from "../project/ops";
import { framesToSeconds, type Rational } from "../time";
import type { MusicStructure, SectionLabel, StructureHints } from "./beats";

export interface MappedMusic {
  bpm: number;
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
export function sourceToTimeline(c: TimedClip, fps: Rational): { at: (t: number) => number | null; edge: (t: number) => number; lo: number; hi: number } {
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
  return {
    lo,
    hi,
    at: (t) => {
      const f = Math.round(frameOf(t));
      return f >= 0 && f < c.duration ? toSec(f) : null;
    },
    // A section's edge: held inside the clip.
    edge: (t) => toSec(Math.min(c.duration, Math.max(0, Math.round(frameOf(Math.min(hi, Math.max(lo, t))))))),
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
  return {
    bpm: m.bpm,
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
