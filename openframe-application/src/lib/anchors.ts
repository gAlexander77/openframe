// Overlays pinned to a clip's picture (ADR-120). A title, shape or callout
// anchored to a point (a callout to a region) of a screen recording stays
// on it through the recording's zooms and pans: the anchor is stored on
// the overlay, and its position (a callout ring's size too, a callout
// dim's hole) is written as ordinary values and keyframes from the
// footage's own transform keys. Everything that reads positions (the
// renderer, align, checks, versions) needs nothing new. followAnchors
// writes them again after every edit, as followClips moves a song's
// markers (ADR-101), so a frame_region, a key, a move or a trim of the
// footage carries what is pinned to it.
//
// The keys are exact where the footage moves by keys that share their
// frames and ease (frame_region's always do): a point of the picture moves
// on the canvas by the same ease between the same frames, since its place
// is linear in the picture's position and scale. Elsewhere (a turn, a move
// while the callout glides, keys that do not line up) the stretch is
// sampled every frame and thinned to a quarter pixel.
//
// ponytail: the footage's in and out animations, wiggle, stabilization and
// tilt are not followed (they are rare on screen recordings); a callout's
// box stays upright on a turned picture.

import { thin } from "./analysis/track";
import { inSource, onCanvas, type Placed } from "./follow";
import { ease, getPath, paramAt, setPath } from "./keyframes";
import { isFootage } from "./overlays";
import { anchorShift, layerAt } from "./render/plan";
import { fittedSize, sourceSize } from "./render/size";
import type { Anchor, Clip, Ease, Id, Keyframe, Project, Track, VisualClip } from "./project/types";
import { framesToSeconds } from "./time";

/** The footage's keyed numbers whose keys can be followed exactly. */
const DRIVE = ["transform.x", "transform.y", "transform.scale", "transform.scaleY"];
/** Keyed numbers that bend the path (a turn, an anchor point under a
 * zoom): a stretch where one changes is sampled. */
const BENDS = ["transform.rotation", "transform.anchorX", "transform.anchorY"];

const tidy = (v: number) => Math.round(v * 1e5) / 1e5 || 0;

export const anchorOf = (c: Clip): Anchor | undefined => ("transform" in c ? c.anchor : undefined);

const isRegion = (a: Anchor) => a.keys[0].w !== undefined && a.keys[0].h !== undefined;

/** The paths an anchor writes on its clip: a dim's mask, a ring's place
 * and size, or a point's place. */
export function anchorPaths(c: VisualClip): string[] {
  const a = c.anchor!;
  if (a.mask) return ["mask.x", "mask.y", "mask.width", "mask.height"];
  return isRegion(a) && c.type === "color" && c.shape ? ["transform.x", "transform.y", "shape.width", "shape.height"] : ["transform.x", "transform.y"];
}

/** The anchor's point (and region) at overlay frame r. */
export function anchorAt(a: Anchor, r: number): { x: number; y: number; w?: number; h?: number } {
  const ks = a.keys;
  if (ks.length === 1 || r <= ks[0].f) return ks[0];
  const last = ks[ks.length - 1];
  if (r >= last.f) return last;
  let i = 0;
  while (ks[i + 1].f <= r) i++;
  const k0 = ks[i], k1 = ks[i + 1];
  const t = ease(k0.ease, (r - k0.f) / (k1.f - k0.f));
  const mix = (u: number, v: number) => u + (v - u) * t;
  return { x: mix(k0.x, k1.x), y: mix(k0.y, k1.y), ...(k0.w !== undefined ? { w: mix(k0.w, k1.w ?? k0.w), h: mix(k0.h!, k1.h ?? k0.h!) } : {}) };
}

/** The footage's placement at its own frame r, by its keys alone. */
function placed(p: Project, c: VisualClip, r: number): Placed {
  const scale = paramAt(c, "transform.scale", r);
  const scaleY = c.transform.scaleY !== undefined ? paramAt(c, "transform.scaleY", r) : undefined;
  const rotation = paramAt(c, "transform.rotation", r);
  let x = paramAt(c, "transform.x", r), y = paramAt(c, "transform.y", r);
  const ax = paramAt(c, "transform.anchorX", r), ay = paramAt(c, "transform.anchorY", r);
  if (ax || ay) {
    const s = anchorShift(p, c, { ax, ay, scale, scaleY, rotation });
    x += s.dx;
    y += s.dy;
  }
  return { x, y, scale, ...(scaleY !== undefined ? { scaleY } : {}), rotation, flipX: c.transform.flipX, flipY: c.transform.flipY };
}

/** An overlay's own picture at rest, canvas fractions: what its mask's
 * fractions measure. */
function box(p: Project, c: VisualClip) {
  const s = sourceSize(p, c);
  const t = c.transform;
  return { x: t.x, y: t.y, w: (s.w * Math.abs(t.scale)) / p.width || 1, h: (s.h * Math.abs(t.scaleY ?? t.scale)) / p.height || 1 };
}

const padPx = (p: Project, a: Anchor) => ((a.pad ?? 0) * p.height) / 1080;

/** The values the anchor writes on `o` at its frame r, footage `f` under it. */
function valuesAt(p: Project, f: VisualClip, o: VisualClip, r: number): number[] {
  const a = o.anchor!;
  const k = anchorAt(a, r);
  const pl = placed(p, f, r + o.start - f.start);
  const pt = onCanvas(p, f, pl, k.x, k.y);
  const X = pt.x / p.width - 0.5, Y = pt.y / p.height - 0.5;
  const paths = anchorPaths(o);
  if (paths.length === 2) return [X, Y];
  const { w, h } = fittedSize(p, f);
  const pad = padPx(p, a);
  const W = (k.w! * w * Math.abs(pl.scale) + 2 * pad) / p.width;
  const H = (k.h! * h * Math.abs(pl.scaleY ?? pl.scale) + 2 * pad) / p.height;
  if (a.mask) {
    const b = box(p, o);
    return [(X - b.x) / b.w, (Y - b.y) / b.h, W / b.w, H / b.h];
  }
  return [X, Y, W / Math.abs(o.transform.scale || 1), H / Math.abs(o.transform.scaleY ?? (o.transform.scale || 1))];
}

const sameEase = (a: Ease, b: Ease) => JSON.stringify(a) === JSON.stringify(b);

/** The keys of a list on each side of the stretch [s0, s1]: the last at or
 * before s0 and the first at or after s1. */
function around<K extends { f: number }>(keys: K[], s0: number, s1: number): [K | undefined, K | undefined] {
  let kp: K | undefined, kn: K | undefined;
  for (const k of keys) {
    if (k.f <= s0) kp = k;
    if (k.f >= s1 && kn === undefined) kn = k;
  }
  return [kp, kn];
}

/** How the stretch between two neighbouring marks is written: held, one
 * eased key (exact), or sampled. `off` puts the footage's frames in the
 * overlay's. */
function stretch(f: VisualClip, off: number, a: Anchor, s0: number, s1: number): { still: true } | { ease: Ease } | { sample: true } {
  let moves: Ease | undefined;
  for (const path of [...DRIVE, ...BENDS]) {
    const ks = f.keyframes?.[path];
    if (!ks || ks.length < 2) continue;
    const [kp, kn] = around(ks.map((k) => ({ ...k, f: k.f + off })), s0, s1);
    if (!kp || !kn || kp.v === kn.v) continue;
    if (BENDS.includes(path) || kp.f !== s0 || kn.f !== s1) return { sample: true };
    const e = kp.ease ?? "linear";
    if (moves === undefined) moves = e;
    else if (!sameEase(moves, e)) return { sample: true };
  }
  const [ap, an] = around(a.keys, s0, s1);
  const glides = !!ap && !!an && (ap.x !== an.x || ap.y !== an.y || ap.w !== an.w || ap.h !== an.h);
  if (glides) return moves === undefined && ap!.f === s0 && an!.f === s1 ? { ease: ap!.ease ?? "linear" } : { sample: true };
  return moves === undefined ? { still: true } : { ease: moves };
}

/** Keys that change nothing go: inside a still stretch, and at either end
 * where the value holds anyway. */
function simplify(ks: Keyframe[]): Keyframe[] {
  const out = ks.filter((k, i) => i === 0 || i === ks.length - 1 || !(ks[i - 1].v === k.v && k.v === ks[i + 1].v));
  while (out.length > 1 && out[out.length - 1].v === out[out.length - 2].v) out.pop();
  while (out.length > 1 && out[0].v === out[1].v) out.shift();
  return out;
}

/** The keys (overlay frames) the anchor of `o` writes on each of its
 * paths, footage `f` under it. */
export function anchoredKeys(p: Project, f: VisualClip, o: VisualClip): { paths: string[]; keys: Keyframe[][] } {
  const a = o.anchor!;
  const paths = anchorPaths(o);
  const end = Math.max(0, o.duration - 1);
  const off = f.start - o.start;
  // Every frame where the footage's keys or the glides turn, and the
  // overlay's ends where none falls: a stretch of the footage's move that
  // the overlay starts or ends inside keeps its own frames (keys before the
  // overlay's start or after its end), so it stays one eased key.
  const marks = new Set<number>();
  for (const path of [...DRIVE, ...BENDS]) for (const k of f.keyframes?.[path] ?? []) marks.add(k.f + off);
  a.keys.forEach((k, i) => {
    const n = a.keys[i + 1];
    if (n && (n.x !== k.x || n.y !== k.y || n.w !== k.w || n.h !== k.h)) marks.add(k.f).add(n.f);
  });
  if (![...marks].some((m) => m <= 0)) marks.add(0);
  if (![...marks].some((m) => m >= end)) marks.add(end);
  const bs = [...marks].sort((x, y) => x - y);
  const first = bs.findLastIndex((m) => m <= 0), last = bs.findIndex((m) => m >= end);
  const at = (r: number) => valuesAt(p, f, o, r);
  const keys: Keyframe[][] = paths.map(() => []);
  const tol = paths.map((path) => (/\.(x|width)$/.test(path) ? 0.25 / p.width : 0.25 / p.height));
  const push = (i: number, fr: number, v: number, e?: Ease) => keys[i].push({ f: fr, v: tidy(v), ...(e && e !== "linear" ? { ease: e } : {}) });
  let tail = true;
  for (let s = first; s < last; s++) {
    const s0 = bs[s], s1 = bs[s + 1];
    const how = stretch(f, off, a, s0, s1);
    if ("sample" in how) {
      // Sampled only where the overlay is: its own first and last frames.
      const lo = Math.max(s0, 0), hi = Math.min(s1, end);
      const frames = Array.from({ length: hi - lo + 1 }, (_, j) => lo + j);
      const vals = frames.map(at);
      paths.forEach((_, i) => {
        const col = vals.map((v) => v[i]);
        for (const j of thin(col, tol[i])) if (frames[j] !== s1) push(i, frames[j], col[j]);
      });
      tail = hi === s1;
    } else {
      const v = at(s0);
      paths.forEach((_, i) => push(i, s0, v[i], "ease" in how ? how.ease : undefined));
      tail = true;
    }
  }
  if (tail) {
    const v = at(bs[last]);
    paths.forEach((_, i) => push(i, bs[last], v[i]));
  }
  return { paths, keys: keys.map(simplify) };
}

/** What a clip holds on the anchor's paths, to tell a hand's change. */
const written = (c: VisualClip, paths: string[]) => JSON.stringify(paths.map((path) => [getPath(c, path) ?? null, c.keyframes?.[path] ?? null]));

function write(c: VisualClip, paths: string[], keys: Keyframe[][]): VisualClip {
  let out = c;
  const kf = { ...c.keyframes };
  paths.forEach((path, i) => {
    const ks = keys[i];
    out = setPath(out, path, ks[0].v);
    if (ks.length > 1 && ks.some((k) => k.v !== ks[0].v)) kf[path] = ks;
    else delete kf[path];
  });
  const { keyframes: _, ...rest } = out;
  return (Object.keys(kf).length ? { ...rest, keyframes: kf } : rest) as VisualClip;
}

/** The overlay frame its hand edit changed most: where to re-read it. */
function mostChanged(p: Project, was: VisualClip, now: VisualClip, paths: string[]): number | undefined {
  let best: number | undefined, most = 1e-9;
  for (let r = 0; r < now.duration; r++) {
    const d = paths.reduce((s, path) => s + Math.abs(paramAt(now, path, r) - paramAt(was, path, r)) * (/\.(x|width)$/.test(path) ? p.width : p.height), 0);
    if (d > most) [best, most] = [r, d];
  }
  return best;
}

/** The anchor that puts `o` where it now is at frame r, its glides moved
 * (and a region's size scaled) by as much. */
function regrip(p: Project, f: VisualClip, o: VisualClip, r: number): Anchor {
  const a = o.anchor!;
  const paths = anchorPaths(o);
  const v = paths.map((path) => paramAt(o, path, r));
  let X = v[0], Y = v[1], W = v[2], H = v[3];
  if (a.mask) {
    const b = box(p, o);
    [X, Y, W, H] = [b.x + v[0] * b.w, b.y + v[1] * b.h, v[2] * b.w, v[3] * b.h];
  } else if (paths.length > 2) [W, H] = [v[2] * Math.abs(o.transform.scale || 1), v[3] * Math.abs(o.transform.scaleY ?? (o.transform.scale || 1))];
  const pl = placed(p, f, r + o.start - f.start);
  const q = inSource(p, f, pl, (X + 0.5) * p.width, (Y + 0.5) * p.height);
  const old = anchorAt(a, r);
  let kw = 1, kh = 1;
  if (paths.length > 2 && old.w && old.h) {
    const { w, h } = fittedSize(p, f);
    const pad = padPx(p, a);
    kw = Math.max(1e-4, (W * p.width - 2 * pad) / (w * Math.abs(pl.scale))) / old.w;
    kh = Math.max(1e-4, (H * p.height - 2 * pad) / (h * Math.abs(pl.scaleY ?? pl.scale))) / old.h;
  }
  const dx = q.u - old.x, dy = q.v - old.y;
  return { ...a, keys: a.keys.map((k) => ({ ...k, x: tidy(k.x + dx), y: tidy(k.y + dy), ...(k.w !== undefined ? { w: tidy(k.w * kw), h: tidy(k.h! * kh) } : {}) })) };
}

/** Same point, region, glides and room (a callout's ring and its dim's
 * hole share one, `mask` aside). */
const sameAnchor = (a: Anchor, b: Anchor, anyMask = false) =>
  a.clipId === b.clipId && (a.pad ?? 0) === (b.pad ?? 0) && (anyMask || !!a.mask === !!b.mask) && JSON.stringify(a.keys) === JSON.stringify(b.keys);

const sec = (p: Project, frames: number) => +framesToSeconds(frames, p.fps).toFixed(3);

/** One timeline's anchored clips written from their footage; null when
 * nothing changed. `old` is the same timeline before the edit (absent:
 * no hand edits to look for). */
function followTimeline(p: Project, tracks: Track[], old: Track[] | undefined, notes?: string[]): Track[] | null {
  const all = tracks.flatMap((t) => t.clips);
  if (!all.some((c) => anchorOf(c))) return null;
  const byId = new Map(all.map((c) => [c.id, c]));
  const was = new Map((old ?? []).flatMap((t) => t.clips).map((c) => [c.id, c]));
  const next = new Map<Id, Clip>();
  const get = (id: Id) => next.get(id) ?? byId.get(id)!;
  const footage = (a: Anchor, self: Id) => {
    const f = byId.get(a.clipId);
    return f && f.id !== self && "transform" in f && !f.anchor ? f : undefined;
  };
  // A pinned clip moved or resized by hand (a drag, set_param, a key) is
  // pinned again where it now is: its anchor moves by as much, so it keeps
  // following, and its callout's other part goes with it.
  for (const c of all) {
    const a = anchorOf(c), c0 = was.get(c.id) as VisualClip | undefined, a0 = c0 && anchorOf(c0);
    if (!a || !a0 || !sameAnchor(a0, a) || c0!.start !== c.start || c0!.duration !== c.duration) continue;
    const v = c as VisualClip, paths = anchorPaths(v);
    const f = footage(a, c.id);
    if (!f || written(c0!, paths) === written(v, paths)) continue;
    const r = mostChanged(p, c0!, v, paths);
    if (r === undefined) continue;
    const moved = regrip(p, f, v, r);
    next.set(c.id, { ...v, anchor: moved });
    const k = anchorAt(moved, r);
    notes?.push(`${c.id} was moved by hand, so it is pinned there now: it follows ${f.id}'s picture at x ${+k.x.toFixed(3)}, y ${+k.y.toFixed(3)} of its source.`);
    if (!c.group) continue;
    for (const m of all) {
      const am = anchorOf(m), m0 = was.get(m.id) as VisualClip | undefined;
      if (m === c || m.group !== c.group || !am || !sameAnchor(am, a0, true) || !m0 || !anchorOf(m0) || written(m0, anchorPaths(m0)) !== written(m as VisualClip, anchorPaths(m as VisualClip))) continue;
      next.set(m.id, { ...m, anchor: { ...am, keys: moved.keys } } as Clip);
    }
  }
  for (const c of all) {
    const cur = get(c.id) as VisualClip, a = anchorOf(cur);
    if (!a) continue;
    const f = footage(a, c.id);
    if (!f || (a.mask && !cur.mask)) {
      const { anchor: _, ...rest } = cur;
      next.set(c.id, rest as Clip);
      notes?.push(`${c.id} no longer follows ${a.clipId}: ${!f ? "that clip is not on its timeline any more" : "its mask is gone"}, so it stays where it was.`);
      continue;
    }
    const { paths, keys } = anchoredKeys(p, f as VisualClip, cur);
    const out = write(cur, paths, keys);
    if (written(out, paths) !== written(cur, paths)) next.set(c.id, out);
  }
  if (!next.size) return null;
  return tracks.map((t) => (t.clips.some((c) => next.has(c.id)) ? { ...t, clips: t.clips.map((c) => next.get(c.id) ?? c) } : t));
}

const anyAnchor = (tracks: Track[]) => tracks.some((t) => t.clips.some((c) => anchorOf(c)));

/**
 * After an edit: every pinned clip's values written from its footage as it
 * now is, on the project's timeline and inside each compound. A pinned
 * clip whose written values the edit itself changed (with its anchor, start
 * and length the same) was moved by hand and is pinned again where it now
 * is; one whose footage left its timeline is unpinned. `notes` collects
 * what an agent should hear.
 */
export function followAnchors(before: Project | undefined, after: Project, notes?: string[]): Project {
  if (!anyAnchor(after.tracks) && !after.compounds?.some((k) => anyAnchor(k.tracks))) return after;
  let p = after;
  const root = followTimeline(p, p.tracks, before?.tracks, notes);
  if (root) p = { ...p, tracks: root };
  if (p.compounds?.length) {
    const compounds = p.compounds.map((k) => {
      const t = followTimeline(p, k.tracks, before?.compounds?.find((b) => b.id === k.id)?.tracks, notes);
      return t ? { ...k, tracks: t } : k;
    });
    if (compounds.some((k, i) => k !== p.compounds![i])) p = { ...p, compounds };
  }
  return p;
}

/** Every pinned clip written from its footage, hand edits not looked for:
 * for code that moves footage outside the edit path (a version's
 * reframing) and wants what is pinned to follow. */
export const reanchor = (p: Project) => followAnchors(undefined, p);

/** Why `targetId` cannot pin `clipId`, or null. */
export function anchorProblem(p: Project, clipId: Id, targetId: Id): string | null {
  const t = p.tracks.flatMap((x) => x.clips).find((c) => c.id === targetId);
  if (!t) return `no clip with id ${targetId} on this timeline to pin to (an anchor's clip is on the same timeline)`;
  if (t.id === clipId) return "a clip cannot be pinned to itself";
  if (!("transform" in t)) return `${t.type} clips have no picture to pin to`;
  if (t.anchor) return `${t.id} is itself pinned to ${t.anchor.clipId}: pin to that clip instead`;
  return null;
}

/** An anchor for describe_project, in the terms the tools take: a point,
 * or a region by its top-left corner; glides at timeline seconds. */
export function anchorSummary(p: Project, c: Clip) {
  const a = anchorOf(c);
  if (!a) return {};
  const r = (v: number) => +v.toFixed(4);
  const where = (k: { x: number; y: number; w?: number; h?: number }) => (k.w !== undefined ? { region: { x: r(k.x - k.w / 2), y: r(k.y - k.h! / 2), w: r(k.w), h: r(k.h!) } } : { x: r(k.x), y: r(k.y) });
  return {
    anchor: {
      clip_id: a.clipId,
      ...where(a.keys[0]),
      ...(a.keys.length > 1 ? { keys: a.keys.map((k) => ({ at: sec(p, c.start + k.f), ...where(k) })) } : {}),
      ...(a.mask ? { mask: true } : {}),
    },
  };
}

/** The footage a layer over frame f would pin to: a video or picture
 * playing then on another track, the main track's first, else the
 * topmost. What a person's Pin to footage and Callout use. */
export function footageUnder(p: Project, f: number, except?: Id): VisualClip | undefined {
  return p.tracks
    .filter((t) => t.kind === "video" && !t.hidden && !t.clips.some((c) => c.id === except))
    .sort((a, b) => Number(!!b.main) - Number(!!a.main))
    .flatMap((t) => t.clips)
    .find((c): c is VisualClip => f >= c.start && f < c.start + c.duration && !c.disabled && isFootage(p, c) && !anchorOf(c));
}

/** The point of footage `f`'s source picture drawn at canvas fractions
 * (x, y) from the center at timeline frame `frame`, and a canvas size
 * (fractions) in the source's fractions there. */
export function underPoint(p: Project, f: VisualClip, frame: number, x: number, y: number, w = 0, h = 0) {
  const l = layerAt(p, f, frame) ?? placed(p, f, frame - f.start);
  const q = inSource(p, f, l, (x + 0.5) * p.width, (y + 0.5) * p.height);
  const fit = fittedSize(p, f);
  return { x: q.u, y: q.v, w: (w * p.width) / (fit.w * Math.abs(l.scale)), h: (h * p.height) / (fit.h * Math.abs(l.scaleY ?? l.scale)) };
}
