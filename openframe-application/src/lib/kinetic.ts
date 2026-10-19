// Kinetic typography: a title's in, out or loop animation played by each
// letter, word or line on its own, staggered across the animation, the way
// After Effects' text animators and range selectors do and CapCut's
// per-character text animations look. Any catalog animation can run per
// unit (Animation.unit); the presets here (typewriter, word pop...) are
// ones that only make sense on text. The render plan says which animation
// is playing and how far (kineticAt); the text rasterizer asks this module
// what each unit looks like at that moment (unitStates), so preview and
// export draw the same letters.

import type { AnimationDef, AnimState } from "./catalog";
import { ease } from "./keyframes";
import type { Animation, TextClip } from "./project/types";

export type KineticUnit = "letter" | "word" | "line";
export const KINETIC_UNITS: KineticUnit[] = ["letter", "word", "line"];
export type KineticOrder = "forward" | "backward" | "center" | "random";
export const KINETIC_ORDERS: KineticOrder[] = ["forward", "backward", "center", "random"];

/** What a text-only preset adds to an animation. */
export interface TextAnimation {
  unit?: KineticUnit;
  /** 0..1: 0 moves every unit together, 1 one after another. */
  stagger?: number;
  order?: KineticOrder;
  /** The order units leave in, when the out animation differs. */
  outOrder?: KineticOrder;
  /** Units snap on and off instead of easing (a typewriter). */
  step?: boolean;
  /** A caret after the last letter shown while it types. */
  caret?: boolean;
  /** Not per unit: a marker box behind each line, or an underline under
   * it, drawn across the words in style.accent. */
  sweep?: "marker" | "underline";
}

/** The presets that animate a title's letters, words or lines (catalog
 * entries; their `from` is in the catalog's units, canvas fractions). */
export const KINETIC_ANIMATIONS: Record<string, AnimationDef> = {
  typewriter: { label: "Typewriter", from: { opacity: 0 }, text: { unit: "letter", stagger: 1, step: true, caret: true, outOrder: "backward" } },
  letterRise: { label: "Letter rise", from: { y: 0.05, opacity: 0 }, text: { unit: "letter", stagger: 0.25 } },
  letterFade: { label: "Letter fade", from: { opacity: 0 }, text: { unit: "letter", stagger: 0.15 } },
  wordPop: { label: "Word pop", from: { scale: 0.2, opacity: 0 }, overshoot: true, text: { unit: "word", stagger: 0.6 } },
  wordRise: { label: "Word rise", from: { y: 0.06, opacity: 0 }, text: { unit: "word", stagger: 0.5 } },
  wordSlide: { label: "Word slide", from: { x: 0.03, opacity: 0 }, text: { unit: "word", stagger: 0.5 } },
  lineRise: { label: "Line rise", from: { y: 0.06, opacity: 0 }, text: { unit: "line", stagger: 0.6 } },
  highlightSweep: { label: "Highlight", text: { sweep: "marker" } },
  underlineWipe: { label: "Underline", text: { sweep: "underline" } },
};

/** The stagger an animation run per unit gets when neither it nor its
 * preset says. */
export const DEFAULT_STAGGER = 0.5;

/** What a unit moves by: the catalog's travel (canvas fractions) as ems of
 * the type, so a per-letter rise is as far for a caption as for a
 * headline relative to its size. At the default 96 px a unit travels as
 * far as the whole title would on a 1920 x 1080 canvas. */
const EM_X = 1920 / 96;
const EM_Y = 1080 / 96;

/** One unit's look at a moment: offsets in ems of the font size, degrees,
 * extra blur in pixels at 1080p. */
export interface UnitState {
  opacity: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  blur: number;
}

export const SETTLED: UnitState = { opacity: 1, x: 0, y: 0, scale: 1, rotation: 0, blur: 0 };

/** Which animation plays per unit at a frame, and how far through it. */
export interface KineticSlot {
  type: string;
  /** 0..1 through the in or out animation; loops: the clip's frame. */
  t: number;
  unit?: KineticUnit;
  stagger: number;
  order: KineticOrder;
  /** Loops: frames per cycle. */
  period?: number;
}

export interface KineticFrame {
  in?: KineticSlot;
  out?: KineticSlot;
  loop?: KineticSlot;
}

/** The unit an animation runs per, if it does: its own setting, else its
 * preset's. A sweep has none (it is drawn per line, not moved). */
export function unitOf(a: Animation | undefined, defs: Record<string, AnimationDef>): KineticUnit | undefined {
  if (!a) return undefined;
  const def = defs[a.type];
  if (!def || def.text?.sweep) return undefined;
  return a.unit ?? def.text?.unit;
}

/** Whether a text clip's animation in this slot plays per unit or as a
 * sweep, so the whole-layer animation must leave it alone. */
export function isKinetic(a: Animation | undefined, defs: Record<string, AnimationDef>): boolean {
  if (!a) return false;
  const def = defs[a.type];
  return !!def && (!!def.text?.sweep || !!unitOf(a, defs));
}

/** What the rasterizer needs to animate a text clip's units at clip frame
 * r: the in, out and loop animations that play per unit (or sweep) and are
 * running then. Undefined when none is, so a settled title rasterizes (and
 * caches) as a still. */
export function kineticAt(clip: TextClip, r: number, defs: Record<string, AnimationDef>): KineticFrame | undefined {
  const out: KineticFrame = {};
  const slot = (a: Animation, t: number, outSlot = false): KineticSlot => {
    const def = defs[a.type];
    const order = a.order ?? (outSlot ? def?.text?.outOrder : undefined) ?? def?.text?.order ?? "forward";
    const unit = unitOf(a, defs);
    return { type: a.type, t, ...(unit ? { unit } : {}), stagger: a.stagger ?? def?.text?.stagger ?? DEFAULT_STAGGER, order };
  };
  // A marker or underline swept in stays drawn, and one that sweeps out is
  // there until it goes: at rest a sweep is part of the look (t at its end).
  const ai = clip.animIn;
  if (ai && isKinetic(ai, defs)) {
    if (r < ai.duration) out.in = slot(ai, r / ai.duration);
    else if (defs[ai.type].text?.sweep) out.in = slot(ai, 1);
  }
  const ao = clip.animOut;
  if (ao && isKinetic(ao, defs)) {
    const from = clip.duration - ao.duration;
    if (r >= from) out.out = slot(ao, (r - from) / ao.duration, true);
    else if (defs[ao.type].text?.sweep) out.out = slot(ao, 0, true);
  }
  const al = clip.animLoop;
  if (al && unitOf(al, defs) && defs[al.type]?.loop) out.loop = { ...slot(al, r), period: Math.max(1, al.duration) };
  return out.in || out.out || out.loop ? out : undefined;
}

/** A key for the raster cache: the same frame of the same animation
 * draws the same pixels. */
export function kineticKey(k: KineticFrame): string {
  const s = (x?: KineticSlot) => (x ? `${x.type}/${x.unit ?? "-"}/${x.order}/${x.stagger}/${+x.t.toFixed(4)}${x.period ? `/${x.period}` : ""}` : "");
  return `${s(k.in)}|${s(k.out)}|${s(k.loop)}`;
}

// ---- units ------------------------------------------------------------------------

/** One drawn piece of a title: a run of a line's characters. `letter`,
 * `word` and `line` number it among all units of that kind in the text, so
 * an in animation by words and an out by letters both find their order. */
export interface Atom {
  line: number;
  /** UTF-16 offsets into that line. */
  start: number;
  end: number;
  letter: number;
  word: number;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** A line's letters (grapheme clusters, so an emoji or an accented letter
 * stays whole), without the spaces. */
function letters(line: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  if (segmenter) {
    for (const s of segmenter.segment(line)) if (/\S/.test(s.segment)) out.push({ start: s.index, end: s.index + s.segment.length });
    return out;
  }
  for (let i = 0; i < line.length; i++) if (/\S/.test(line[i])) out.push({ start: i, end: i + 1 });
  return out;
}

/**
 * Split laid-out lines into the pieces to draw: letters when any animation
 * moves letters, else words, else whole lines. Every atom knows which
 * letter, word and line it is, counted across the whole text.
 */
export function layoutAtoms(lines: string[], fine: KineticUnit): { atoms: Atom[]; letters: number; words: number; lines: number } {
  const atoms: Atom[] = [];
  let letter = 0, word = 0;
  lines.forEach((text, line) => {
    const words = [...text.matchAll(/\S+/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
    if (fine === "line") {
      if (words.length) atoms.push({ line, start: words[0].start, end: words[words.length - 1].end, letter, word });
      letter += letters(text).length;
      word += words.length;
      return;
    }
    if (fine === "word") {
      for (const w of words) {
        atoms.push({ line, start: w.start, end: w.end, letter, word: word++ });
        letter += letters(text.slice(w.start, w.end)).length;
      }
      return;
    }
    let wi = 0;
    for (const l of letters(text)) {
      while (wi < words.length && words[wi].end <= l.start) wi++;
      atoms.push({ line, start: l.start, end: l.end, letter: letter++, word: word + wi });
    }
    word += words.length;
  });
  return { atoms, letters: letter, words: word, lines: lines.length };
}

/** The finest unit any running slot moves, which is what gets drawn. */
export function finestUnit(k: KineticFrame): KineticUnit | undefined {
  const units = [k.in?.unit, k.out?.unit, k.loop?.unit];
  return units.includes("letter") ? "letter" : units.includes("word") ? "word" : units.includes("line") ? "line" : undefined;
}

/** A deterministic shuffle (mulberry32 seeded by n), so a random order is
 * the same in the preview, the export and every rerender. */
function shuffled(n: number): number[] {
  let seed = (n * 2654435761) >>> 0;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** When unit i of n moves, as a rank from 0 (first) to the returned max:
 * center starts in the middle and spreads out in pairs. */
export function rankOf(i: number, n: number, order: KineticOrder): number {
  if (order === "backward") return n - 1 - i;
  if (order === "center") return Math.abs(i - (n - 1) / 2);
  if (order === "random") return shuffled(n).indexOf(i);
  return i;
}

const maxRank = (n: number, order: KineticOrder) => (order === "center" ? (n - 1) / 2 : n - 1);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * How far one unit is through a staggered animation at overall progress t
 * (0..1). Each unit takes the same time; with stagger s they start s of
 * that time apart, so s = 0 moves all together and s = 1 one after
 * another, and the last unit lands exactly when the animation ends.
 */
export function unitProgress(t: number, rank: number, max: number, stagger: number): number {
  const s = clamp01(stagger);
  return clamp01(t * (1 + max * s) - rank * s);
}

/** Overshooting ease for pop (as the whole-layer pop). */
const easeOutBack = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A catalog state (canvas fractions) as a unit's, part way (v: 0 at the
 * state, 1 settled). */
function mix(from: Partial<AnimState>, v: number): UnitState {
  return {
    opacity: lerp(from.opacity ?? 1, 1, v),
    x: lerp((from.x ?? 0) * EM_X, 0, v),
    y: lerp((from.y ?? 0) * EM_Y, 0, v),
    scale: lerp(from.scale ?? 1, 1, v),
    rotation: lerp(from.rotation ?? 0, 0, v),
    blur: lerp(from.blur ?? 0, 0, v),
  };
}

function combine(a: UnitState, b: UnitState): UnitState {
  return { opacity: a.opacity * b.opacity, x: a.x + b.x, y: a.y + b.y, scale: a.scale * b.scale, rotation: a.rotation + b.rotation, blur: a.blur + b.blur };
}

type Counts = { letters: number; words: number; lines: number };

const indexIn = (a: Atom, unit: KineticUnit) => (unit === "letter" ? a.letter : unit === "word" ? a.word : a.line);
const countOf = (c: Counts, unit: KineticUnit) => (unit === "letter" ? c.letters : unit === "word" ? c.words : c.lines);

/** Every atom's look at this frame: the in, out and loop animations that
 * play per unit, each finding the atom's place among its own units. */
export function unitStates(atoms: Atom[], counts: Counts, k: KineticFrame, defs: Record<string, AnimationDef>): UnitState[] {
  return atoms.map((a) => {
    let s = SETTLED;
    for (const which of ["in", "out"] as const) {
      const slot = k[which];
      const def = slot && defs[slot.type];
      if (!slot?.unit || !def) continue;
      const n = Math.max(1, countOf(counts, slot.unit));
      const p = unitProgress(slot.t, rankOf(indexIn(a, slot.unit), n, slot.order), maxRank(n, slot.order), slot.stagger);
      const step = !!def.text?.step;
      const v = which === "in"
        ? step ? (p > 0 ? 1 : 0) : def.overshoot ? easeOutBack(p) : ease("easeOut", p)
        : step ? (p > 0 ? 0 : 1) : 1 - ease("easeIn", p);
      s = combine(s, mix(def.from ?? {}, v));
    }
    const loop = k.loop;
    const ldef = loop && defs[loop.type];
    if (loop?.unit && ldef?.loop && loop.period) {
      // Each unit runs the cycle a little later than the one before: a wave.
      const n = Math.max(1, countOf(counts, loop.unit));
      const lag = (rankOf(indexIn(a, loop.unit), n, loop.order) / Math.max(1, n)) * loop.stagger;
      const phase = (((loop.t / loop.period - lag) % 1) + 1) % 1;
      s = combine(s, mix(ldef.loop(phase), 0));
    }
    return s;
  });
}

/** Typewriter: how many letters show (the caret goes after the last), or
 * undefined when no caret is drawn now. */
export function caretAfter(k: KineticFrame, letterCount: number, defs: Record<string, AnimationDef>): number | undefined {
  const slot = k.in;
  if (!slot || !defs[slot.type]?.text?.caret || slot.unit !== "letter") return undefined;
  if (slot.t <= 0 || slot.t >= 1) return undefined;
  return Math.min(letterCount, Math.ceil(slot.t * letterCount));
}

/** How much of the marker and of the underline is drawn, 0..1, at this
 * frame (in: growing, out: shrinking; a title can have a marker in and an
 * underline out), or undefined when it has neither. */
export function sweepAt(k: KineticFrame, defs: Record<string, AnimationDef>): { marker?: number; underline?: number } | undefined {
  let res: { marker?: number; underline?: number } | undefined;
  for (const which of ["in", "out"] as const) {
    const slot = k[which];
    const kind = slot && defs[slot.type]?.text?.sweep;
    if (!slot || !kind) continue;
    const v = which === "in" ? ease("easeInOut", slot.t) : 1 - ease("easeInOut", slot.t);
    res = { ...res, [kind]: Math.min(res?.[kind] ?? 1, v) };
  }
  return res;
}

/** A sweep across several lines: each line's share of `amount`, in
 * proportion to its width, first line first. */
export function lineSweeps(widths: number[], amount: number): number[] {
  const total = widths.reduce((s, w) => s + w, 0);
  if (total <= 0) return widths.map(() => 0);
  let at = amount * total;
  return widths.map((w) => {
    const f = w > 0 ? clamp01(at / w) : 0;
    at -= w;
    return f;
  });
}

/** Extra room around a raster whose units move (ems of the font size), so
 * a rising or popping letter is never cut off at the raster's edge. */
export const KINETIC_PAD = 0.9;

/** Room a marker or underline needs past the letters (ems), kept on the
 * title's still raster too, since a finished sweep stays drawn. */
export const SWEEP_PAD = 0.25;

/** Whether a title has a sweep in either slot. */
export const hasSweep = (clip: TextClip, defs: Record<string, AnimationDef>) => [clip.animIn, clip.animOut].some((a) => !!a && !!defs[a.type]?.text?.sweep);

/** Whether anything moves in this frame (so each frame draws anew): a unit
 * animation, or a sweep part way. A finished sweep is a still. */
export function isMoving(k: KineticFrame): boolean {
  return [k.in, k.out, k.loop].some((s) => !!s && (!!s.unit || (s.t > 0 && s.t < 1)));
}
