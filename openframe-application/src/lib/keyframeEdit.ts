// Editing keyframes as a set: retime, move, change values and easing,
// remove, copy and paste. The keyframe panel, the timeline's diamonds, the
// inspector and the keyframe commands all edit through these, so they agree
// on the rules (no two keys on one frame, keys stay inside the clip). Pure:
// a clip's keyframe map in, a new map out. Frames are clip-relative, as
// stored in Keyframe.f.

import { getPath, interpolate, paramAt, upsertKey } from "./keyframes";
import type { Clip, Ease, Keyframe } from "./project/types";

export type KeyMap = Record<string, Keyframe[]>;

/** One keyframe, addressed the way the document stores it: a parameter
 * path and the (unique on that path) frame it sits on. */
export interface KeyRef {
  path: string;
  f: number;
}

export const sameRef = (a: KeyRef, b: KeyRef) => a.path === b.path && a.f === b.f;

/** Every frame that holds a key on any path, ascending. The timeline draws
 * one diamond per frame. */
export function keyFrames(map: KeyMap | undefined): number[] {
  if (!map) return [];
  return [...new Set(Object.values(map).flatMap((ks) => ks.map((k) => k.f)))].sort((a, b) => a - b);
}

/** The keys on any path at frame `f`: what one timeline diamond stands for. */
export function keysAt(map: KeyMap | undefined, f: number): KeyRef[] {
  if (!map) return [];
  return Object.entries(map).flatMap(([path, ks]) => (ks.some((k) => k.f === f) ? [{ path, f }] : []));
}

/** The refs that still point at a key (a selection can outlive an undo). */
export function liveRefs(map: KeyMap | undefined, refs: KeyRef[]): KeyRef[] {
  if (!map) return [];
  return refs.filter((r) => map[r.path]?.some((k) => k.f === r.f));
}

function byPath(refs: KeyRef[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const r of refs) {
    if (!m.has(r.path)) m.set(r.path, new Set());
    m.get(r.path)!.add(r.f);
  }
  return m;
}

/**
 * Limit a move so the keys stay on the clip's frames, 0..duration-1. A key
 * already outside (a trim can leave one there to keep the curve intact) may
 * come back in but not travel further out. Whole frames only (ADR-004).
 */
export function clampDelta(refs: KeyRef[], delta: number, duration: number): number {
  if (!refs.length) return 0;
  const fs = refs.map((r) => r.f);
  const min = Math.min(...fs);
  const max = Math.max(...fs);
  const lo = Math.min(0, min) - min;
  const hi = Math.max(duration - 1, max) - max;
  return Math.max(lo, Math.min(hi, Math.round(delta)));
}

/**
 * Move a set of keys by `delta` frames, keeping their spacing. A moved key
 * that lands on a key that did not move replaces it, as in Premiere and
 * After Effects: a path never holds two keys on one frame. Returns the new
 * map, where the refs went, and the delta actually applied.
 */
export function moveKeys(map: KeyMap, refs: KeyRef[], delta: number, duration: number): { keys: KeyMap; refs: KeyRef[]; delta: number } {
  const live = liveRefs(map, refs);
  const d = clampDelta(live, delta, duration);
  if (d === 0) return { keys: map, refs: live, delta: 0 };
  const out = { ...map };
  for (const [path, frames] of byPath(live)) {
    const moving = map[path].filter((k) => frames.has(k.f)).map((k) => ({ ...k, f: k.f + d }));
    const landing = new Set(moving.map((k) => k.f));
    const staying = map[path].filter((k) => !frames.has(k.f) && !landing.has(k.f));
    out[path] = [...staying, ...moving].sort((a, b) => a.f - b.f);
  }
  return { keys: out, refs: live.map((r) => ({ path: r.path, f: r.f + d })), delta: d };
}

/** Retime one key to frame `to` (clamped to the clip). */
export function retimeKey(map: KeyMap, ref: KeyRef, to: number, duration: number) {
  return moveKeys(map, [ref], to - ref.f, duration);
}

/** New values for some keys; `fn` gets the key and its path. */
export function setValues(map: KeyMap, refs: KeyRef[], fn: (k: Keyframe, path: string) => number): KeyMap {
  const out = { ...map };
  for (const [path, frames] of byPath(refs)) {
    if (!map[path]) continue;
    out[path] = map[path].map((k) => (frames.has(k.f) ? { ...k, v: fn(k, path) } : k));
  }
  return out;
}

/** Remove keys; paths left with none disappear, and an empty map becomes
 * undefined so the clip carries no `keyframes` field at all. */
export function removeKeys(map: KeyMap | undefined, refs: KeyRef[]): KeyMap | undefined {
  if (!map) return undefined;
  const out: KeyMap = {};
  const drop = byPath(refs);
  for (const [path, ks] of Object.entries(map)) {
    const gone = drop.get(path);
    const kept = gone ? ks.filter((k) => !gone.has(k.f)) : ks;
    if (kept.length) out[path] = kept;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Set the curve leaving each key. Linear is the default and is stored as
 * no `ease` field, keeping project files small. */
export function setEase(map: KeyMap, refs: KeyRef[], e: Ease): KeyMap {
  const out = { ...map };
  for (const [path, frames] of byPath(refs)) {
    if (!map[path]) continue;
    out[path] = map[path].map((k) => {
      if (!frames.has(k.f)) return k;
      const { ease: _old, ...rest } = k;
      return e === "linear" ? rest : { ...rest, ease: Array.isArray(e) ? ([...e] as Ease) : e };
    });
  }
  return out;
}

// ---- section keyframe -----------------------------------------------------------

/** CapCut's section diamond: when every path already has a key at `f`,
 * remove them all; otherwise key the missing ones at their current values. */
export function toggleKeysAt(clip: Clip, paths: string[], f: number): Clip {
  const map = clip.keyframes ?? {};
  const all = paths.every((p) => map[p]?.some((k) => k.f === f));
  if (all) return { ...clip, keyframes: removeKeys(map, paths.map((path) => ({ path, f }))) } as Clip;
  const out = { ...map };
  for (const p of paths) {
    if (out[p]?.some((k) => k.f === f)) continue;
    out[p] = upsertKey(out[p], { f, v: paramAt(clip, p, f) });
  }
  return { ...clip, keyframes: out } as Clip;
}

// ---- copy and paste -------------------------------------------------------------

/** Copied keys, frames relative to the earliest one so a paste lands them
 * at the playhead with their spacing (Premiere's "relative to playhead"). */
export interface KeyClipboard {
  keys: KeyMap;
}

export function copyKeys(map: KeyMap | undefined, refs: KeyRef[]): KeyClipboard | null {
  const live = liveRefs(map, refs);
  if (!map || !live.length) return null;
  const origin = Math.min(...live.map((r) => r.f));
  const keys: KeyMap = {};
  for (const [path, frames] of byPath(live)) {
    keys[path] = map[path].filter((k) => frames.has(k.f)).map((k) => ({ ...k, f: k.f - origin }));
  }
  return { keys };
}

/**
 * Paste copied keys so the earliest lands on frame `at`. Keys that would
 * fall outside the clip are dropped, as are paths the target clip has no
 * such parameter for (an effect it lacks, a transform on an audio clip).
 * Pasted keys replace keys already on their frames.
 */
export function pasteKeys(clip: Clip, board: KeyClipboard, at: number): { keys: KeyMap | undefined; refs: KeyRef[] } {
  let keys = clip.keyframes;
  const refs: KeyRef[] = [];
  for (const [path, ks] of Object.entries(board.keys)) {
    if (getPath(clip, path) === undefined) continue;
    for (const k of ks) {
      const f = k.f + at;
      if (f < 0 || f > clip.duration - 1) continue;
      keys = { ...keys, [path]: upsertKey(keys?.[path], { ...k, f }) };
      refs.push({ path, f });
    }
  }
  return { keys, refs };
}

// ---- bezier handles ---------------------------------------------------------------

export type Bezier = [number, number, number, number];

/** Linear as a bezier, with handles a third of the way along so they can
 * be grabbed (at 0,0 and 1,1 they would sit under the keys). */
export const LINEAR_BEZIER: Bezier = [1 / 3, 1 / 3, 2 / 3, 2 / 3];

const NAMED: Record<string, Bezier> = {
  linear: LINEAR_BEZIER,
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/** The bezier a curve is drawn with, or null for hold (a step has none). */
export function asBezier(e: Ease | undefined): Bezier | null {
  if (Array.isArray(e)) return [...e] as Bezier;
  // Hold steps; spring, elastic and bounce are no bezier (ADR-062).
  const named = NAMED[e ?? "linear"];
  return named ? ([...named] as Bezier) : null;
}

export interface Point {
  f: number;
  v: number;
}

/** The segment a→b's two control points in (frame, value) space: `out`
 * leaves a, `in` arrives at b. Null for a hold. */
export function handlePoints(a: Keyframe, b: Keyframe): { out: Point; in: Point } | null {
  const bz = asBezier(a.ease);
  if (!bz) return null;
  const T = b.f - a.f;
  const V = b.v - a.v;
  return {
    out: { f: a.f + bz[0] * T, v: a.v + bz[1] * V },
    in: { f: a.f + bz[2] * T, v: a.v + bz[3] * V },
  };
}

/** How far a handle may pull the curve past its keys, in multiples of the
 * segment's rise. Enough for any overshoot preset; beyond it the curve
 * leaves the graph and the value range. */
const Y_LIMIT = 3;

/**
 * The segment's new bezier after dragging one handle to `to`. Time is
 * clamped inside the segment (x in 0..1) so the curve can never run
 * backward; value is free within a sane overshoot. On a flat segment
 * (a.v === b.v) a handle's height has no meaning and is kept.
 */
export function dragHandle(a: Keyframe, b: Keyframe, which: "out" | "in", to: Point): Bezier {
  const bz = asBezier(a.ease) ?? [...LINEAR_BEZIER];
  const T = b.f - a.f;
  const V = b.v - a.v;
  const x = T > 0 ? Math.max(0, Math.min(1, (to.f - a.f) / T)) : 0;
  const y = V !== 0 ? Math.max(-Y_LIMIT, Math.min(1 + Y_LIMIT, (to.v - a.v) / V)) : null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const i = which === "out" ? 0 : 2;
  bz[i] = r(x);
  if (y !== null) bz[i + 1] = r(y);
  return bz;
}

// ---- presets ------------------------------------------------------------------------

export interface EasePreset {
  id: string;
  label: string;
  ease: Ease;
  /** What it looks like, for the menu's hint. */
  hint: string;
}

/**
 * The easing menu. The first five are the document's named eases; the
 * next four are CapCut-style curves stored as beziers, so any player that
 * reads CSS cubic-bezier reproduces them exactly; the last three are named
 * eases with overshoot no bezier can draw.
 */
export const EASE_PRESETS: EasePreset[] = [
  { id: "linear", label: "Linear", ease: "linear", hint: "Constant speed" },
  { id: "hold", label: "Hold", ease: "hold", hint: "Jumps at the next keyframe" },
  { id: "easeIn", label: "Ease in", ease: "easeIn", hint: "Starts slow" },
  { id: "easeOut", label: "Ease out", ease: "easeOut", hint: "Ends slow" },
  { id: "easeInOut", label: "Ease in-out", ease: "easeInOut", hint: "Slow at both ends" },
  { id: "smooth", label: "Smooth", ease: [0.65, 0, 0.35, 1], hint: "Gentle start and stop" },
  { id: "fastIn", label: "Fast in", ease: [0.16, 1, 0.3, 1], hint: "Arrives fast, glides to rest" },
  { id: "overshoot", label: "Overshoot", ease: [0.34, 1.56, 0.64, 1], hint: "Passes the value once, no bounce" },
  { id: "anticipate", label: "Anticipate", ease: [0.36, 0, 0.66, -0.56], hint: "Pulls back, then goes" },
  // Named eases a bezier cannot draw (ADR-062): no handles in the graph.
  { id: "spring", label: "Spring", ease: "spring", hint: "Overshoots, rings, settles" },
  { id: "elastic", label: "Elastic", ease: "elastic", hint: "Snaps past and wobbles in" },
  { id: "bounce", label: "Bounce", ease: "bounce", hint: "Lands and bounces" },
];

export const EASE_IDS = EASE_PRESETS.map((p) => p.id);

const sameEase = (a: Ease, b: Ease) =>
  Array.isArray(a) && Array.isArray(b) ? a.every((n, i) => Math.abs(n - b[i]) < 1e-6) : a === b;

/** The preset a key's ease matches, or null for a hand-drawn curve. */
export function presetOf(e: Ease | undefined): EasePreset | null {
  return EASE_PRESETS.find((p) => sameEase(p.ease, e ?? "linear")) ?? null;
}

export function easeById(id: string): Ease | undefined {
  return EASE_PRESETS.find((p) => p.id === id)?.ease;
}

// ---- drawing ------------------------------------------------------------------------

/** Lowest and highest value a track reaches from its first key to its last,
 * overshoot included, after `show` maps it to display units. Sampled: a
 * graph's value axis only needs to be close. */
export function curveRange(keys: Keyframe[], show: (v: number) => number = (v) => v): { min: number; max: number } {
  if (!keys.length) return { min: 0, max: 0 };
  let min = Infinity;
  let max = -Infinity;
  const take = (v: number) => {
    const s = show(v);
    if (!Number.isFinite(s)) return;
    min = Math.min(min, s);
    max = Math.max(max, s);
  };
  for (let i = 0; i < keys.length; i++) {
    take(keys[i].v);
    const b = keys[i + 1];
    if (!b) break;
    for (let j = 1; j < 24; j++) take(interpolate(keys, keys[i].f + ((b.f - keys[i].f) * j) / 24));
  }
  return min <= max ? { min, max } : { min: 0, max: 0 };
}
