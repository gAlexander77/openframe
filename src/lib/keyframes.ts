// Parameter paths and keyframe interpolation. Any numeric property of a clip
// can be animated by path ("transform.x", "opacity", "adjust.exposure",
// "effects.<effectId>.<param>"), so the inspector's keyframe diamond, the
// renderer and automation all address parameters the same way.

import type { Clip, Ease, Keyframe } from "./project/types";

/** Read a numeric value by path. Array segments match an element's `id`,
 * and an effect's params are reached through it: effects.<id>.<param>. */
export function getPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur)) {
      const el = cur.find((e) => (e as { id?: string }).id === seg) as
        | { params?: unknown }
        | undefined;
      cur = el && "params" in el ? el.params : el;
    } else if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else return undefined;
  }
  return typeof cur === "number" ? cur : undefined;
}

/** Immutable set by path; returns a new object sharing untouched branches. */
export function setPath<T>(obj: T, path: string, value: number): T {
  const [seg, ...rest] = path.split(".");
  if (Array.isArray(obj)) {
    return obj.map((el) => {
      if ((el as { id?: string }).id !== seg) return el;
      const e = el as { params?: Record<string, number> };
      return rest.length && e.params
        ? { ...el, params: setPath(e.params, rest.join("."), value) }
        : el;
    }) as T;
  }
  const o = (obj ?? {}) as Record<string, unknown>;
  return {
    ...o,
    [seg]: rest.length ? setPath(o[seg], rest.join("."), value) : value,
  } as T;
}

// Cubic bezier easing, solved for x by Newton's method then bisection — the
// same approach browsers use for CSS cubic-bezier().
function bezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) return sy(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  while (hi - lo > 1e-6) {
    if (sx(t) < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sy(t);
}

const CURVES: Record<Exclude<Ease, unknown[]>, (x: number) => number> = {
  linear: (x) => x,
  hold: () => 0,
  easeIn: (x) => bezier(0.42, 0, 1, 1, x),
  easeOut: (x) => bezier(0, 0, 0.58, 1, x),
  easeInOut: (x) => bezier(0.42, 0, 0.58, 1, x),
};

export function ease(kind: Ease | undefined, x: number): number {
  if (Array.isArray(kind)) return bezier(kind[0], kind[1], kind[2], kind[3], x);
  return CURVES[kind ?? "linear"](x);
}

/** Value of a keyframed track at frame `f` (relative to the clip start).
 * Before the first key and after the last, the value holds. */
export function interpolate(keys: Keyframe[], f: number): number {
  if (keys.length === 0) return 0;
  if (f <= keys[0].f) return keys[0].v;
  const last = keys[keys.length - 1];
  if (f >= last.f) return last.v;
  let i = 0;
  while (keys[i + 1].f <= f) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const x = (f - a.f) / (b.f - a.f);
  return a.v + (b.v - a.v) * ease(a.ease, x);
}

/** The value a parameter has at frame `f` of the clip, keyframes first. */
export function paramAt(clip: Clip, path: string, f: number): number {
  const keys = clip.keyframes?.[path];
  if (keys && keys.length) return interpolate(keys, f);
  return getPath(clip, path) ?? 0;
}

/** Insert or replace the keyframe at `f`, keeping the list sorted. */
export function upsertKey(keys: Keyframe[] = [], key: Keyframe): Keyframe[] {
  const out = keys.filter((k) => k.f !== key.f);
  out.push(key);
  return out.sort((a, b) => a.f - b.f);
}
