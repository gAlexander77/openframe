// After Effects' wiggle(freq, amp) for transform values (ADR-060): seeded,
// smooth noise added to a clip's x, y, rotation or scale, for organic
// camera shake and handheld drift. Pure and deterministic: the same seed
// draws the same path on every machine, in preview and export, and at
// sub-frame times (motion blur samples between frames).

import { paramAt } from "./keyframes";
import type { Clip, Wiggle, WiggleTarget } from "./project/types";

export const WIGGLE_TARGETS: WiggleTarget[] = ["x", "y", "rotation", "scale"];

/** An integer lattice point and a seed to -1..1 (a 32-bit integer hash). */
function lattice(i: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((seed | 0) + 0x165667b1, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** 1D gradient noise (Perlin's, quintic fade), about -1..1, smooth in
 * value and slope. */
function perlin(x: number, seed: number): number {
  const i = Math.floor(x), t = x - i;
  const fade = t * t * t * (t * (t * 6 - 15) + 10);
  return 2 * ((1 - fade) * lattice(i, seed) * t + fade * lattice(i + 1, seed) * (t - 1));
}

/** Two octaves (After Effects' wiggle with octaves 2, amp_mult 0.5); the
 * second at a non-integer multiple so the lattices never line up and the
 * shake has no beat. Scaled so the amplitude is a ceiling that is reached:
 * the raw sum rarely passed 0.75 (99.9th percentile; RMS 0.21), so a
 * 40 px wiggle only wandered 25 px. -1..1. */
export function noise(x: number, seed: number): number {
  const v = ((perlin(x, seed) + 0.5 * perlin(x * 2.17 + 31.7, seed ^ 0x5bd1e995)) / 1.5) * 1.3;
  return Math.max(-1, Math.min(1, v));
}

/** x and y with one seed must not move together (a diagonal shake). */
const SALT: Record<WiggleTarget, number> = { x: 0, y: 7919, rotation: 15887, scale: 23819 };

/** The offset a clip's wiggle adds to `target` at clip frame `r`
 * (fractional allowed), in the value's own units. */
export function wiggleAt(clip: Clip, target: WiggleTarget, r: number, fps: number): number {
  const w = ("wiggle" in clip ? clip.wiggle : undefined)?.[target];
  if (!w) return 0;
  const keyed = (k: "amplitude" | "strength") => !!clip.keyframes?.[`wiggle.${target}.${k}`]?.length;
  const amp = keyed("amplitude") ? paramAt(clip, `wiggle.${target}.amplitude`, r) : w.amplitude;
  const strength = keyed("strength") ? paramAt(clip, `wiggle.${target}.strength`, r) : (w.strength ?? 1);
  if (!amp || !strength) return 0;
  return amp * strength * noise((r / fps) * w.frequency, w.seed + SALT[target]);
}

// ---- loading ------------------------------------------------------------------

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A clip's wiggles from untrusted JSON; undefined when none survive. */
export function cleanWiggle(raw: unknown): Partial<Record<WiggleTarget, Wiggle>> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Partial<Record<WiggleTarget, Wiggle>> = {};
  for (const t of WIGGLE_TARGETS) {
    const w = (raw as Record<string, unknown>)[t] as Record<string, unknown> | undefined;
    if (!w || !fin(w.frequency) || !fin(w.amplitude)) continue;
    out[t] = {
      frequency: Math.max(0.01, Math.min(60, w.frequency)),
      amplitude: w.amplitude,
      seed: fin(w.seed) ? Math.round(w.seed) : 1,
      ...(fin(w.strength) && w.strength !== 1 ? { strength: Math.max(0, w.strength) } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}
