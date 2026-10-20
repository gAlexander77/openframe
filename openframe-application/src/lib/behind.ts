// A title behind its subject (text_behind_subject), checked for what the
// subject leaves of it (ADR-103). The look hides some letters on purpose,
// but a new shape can put the subject over the middle of the title: the
// Northbound test's 9:16 hook read "LEA E / T E / GRO ND" behind the
// rocket, and its check sheet said only that the rocket was too wide.
// The app renders the title alone and the subject's copy alone, each over
// black and over white (state/behind.ts); this file finds the pairs, turns
// those renders into coverage, and says what to do.

import { titleMoments } from "./designCheck";
import { framesToSeconds } from "./time";
import type { Clip, Id, Project, TextClip, Track } from "./project/types";

/** A title with a subject's copy above it while it shows: the copy is
 * what text_behind_subject makes, a video with its background matte on or
 * a cut-out picture named Subject. */
export interface BehindPair {
  title: TextClip;
  subject: Clip;
  /** The title's frames to measure: after its in-animation, its middle,
   * before its out-animation, while the copy plays. */
  frames: number[];
}

const isCopy = (c: Clip) => !c.disabled && ((c.type === "video" && !!c.cutout?.enabled) || (c.type === "image" && c.name === "Subject"));

/** The titles on the project's timeline with a subject's copy above them. */
export function behindPairs(p: Project): BehindPair[] {
  const shown = p.tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.hidden && t.kind === "video");
  const out: BehindPair[] = [];
  const fps = p.fps.num / p.fps.den;
  for (const { t, i } of shown)
    for (const title of t.clips) {
      if (title.type !== "text" || title.disabled || title.caption) continue;
      // tracks[0] is the top: a copy on a track above, playing with it.
      const copies = shown.filter((x) => x.i < i).flatMap(({ t: above }: { t: Track }) => above.clips.filter((c) => isCopy(c) && c.start < title.start + title.duration && title.start < c.start + c.duration));
      for (const subject of copies) {
        const frames = titleMoments(title, fps).filter((f) => f >= subject.start && f < subject.start + subject.duration);
        if (frames.length) out.push({ title, subject, frames });
      }
    }
  return out;
}

/** Coverage from two renders of one layer alone, over black and over
 * white: its alpha at each pixel, 0..1 (RGBA bytes, same size). */
export function alphaOf(black: Uint8ClampedArray, white: Uint8ClampedArray): Float32Array {
  const n = black.length / 4;
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Over white minus over black is what shows through: 1 - alpha.
    const through = (white[i * 4] - black[i * 4] + white[i * 4 + 1] - black[i * 4 + 1] + white[i * 4 + 2] - black[i * 4 + 2]) / (3 * 255);
    a[i] = Math.max(0, Math.min(1, 1 - through));
  }
  return a;
}

/** The share of the title's letters the subject covers: its letters'
 * alpha weighted by the subject's alpha over them. 0 when no letter shows. */
export function hiddenShare(letters: Float32Array, subject: Float32Array): number {
  let all = 0, under = 0;
  for (let i = 0; i < letters.length; i++) {
    all += letters[i];
    under += letters[i] * subject[i];
  }
  return all > 0 ? under / all : 0;
}

/** A title hidden this much or more no longer reads as its words. The look
 * itself covers some: the Northbound master's hook was 18% under the
 * rocket at its worst and read; its 9:16 version (41%) and 4:5 (36%) read
 * "LEA E / T E / GRO ND". */
export const HIDDEN_LIMIT = 0.25;

/** A title's worst moment behind its subject, as measured. */
export interface Hidden {
  titleId: Id;
  subjectId: Id;
  frame: number;
  share: number;
}

/**
 * A version whose subject hides a title past the limit shows the title in
 * front instead: the subject's copy is turned off in that version, the
 * effect given up where the words would not read (the Northbound tester
 * turned it off by hand on 9:16 and 4:5). Not where the version's
 * overrides place the title or the copy by hand (`byHand`): that is the
 * agent's call, and is only reported.
 */
export function titlesInFront(q: Project, hidden: Hidden[], byHand: Set<Id> = new Set()): { project: Project; off: Id[] } {
  const off = [...new Set(hidden.filter((h) => h.share >= HIDDEN_LIMIT && !byHand.has(h.titleId) && !byHand.has(h.subjectId)).map((h) => h.subjectId))];
  if (!off.length) return { project: q, off };
  return { project: { ...q, tracks: q.tracks.map((t) => (t.clips.some((c) => off.includes(c.id)) ? { ...t, clips: t.clips.map((c) => (off.includes(c.id) ? ({ ...c, disabled: true } as Clip) : c)) } : t)) }, off };
}

/** What an agent reads about a title its subject hides (a version, or
 * check_project): how much, when, and how to fix it. `master`: the share
 * in the master, for a version. Undefined under the limit. */
export function hiddenNote(p: Project, h: Hidden, text: string, master?: number): { message: string; fix: string } | undefined {
  if (h.share < HIDDEN_LIMIT) return undefined;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const at = +framesToSeconds(h.frame, p.fps).toFixed(2);
  return {
    message: `"${text.replace(/\s+/g, " ").slice(0, 24)}" is ${pct(h.share)} hidden behind the subject (${h.subjectId}) at ${at} s${master !== undefined ? `, against ${pct(master)} in the master` : ""}: past ${pct(HIDDEN_LIMIT)} its words no longer read`,
    fix: `move the title where the subject is not (set_param transform.y, or an export_versions override {clip_id: "${h.titleId}", y}), make it larger, or show it in front: set_clip_enabled ${h.subjectId} false (an override {clip_id: "${h.subjectId}", hidden: true} in a version)`,
  };
}
