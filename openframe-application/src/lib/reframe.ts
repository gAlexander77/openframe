// A version keeps each shot's subject in frame (export_versions, ADR-097).
// When a new shape crops a full-frame shot (16:9 filled into 9:16 keeps a
// third of its width), the crop is placed over the shot's subject instead
// of its center, and follows it where it moves: lib/analysis/subject.ts
// scores where a window of the new frame's size holds what stands out in
// the pictures the app looked at (state/subjects.ts), and the shot's
// position is keyed to put that window on the frame. The window stays
// inside what the master showed of the shot at each moment, so a push-in
// or a pan the editor made keeps its framing, and a caller's focus (a
// point of the picture) overrides it per clip. Each version also says
// where its framing cuts the subject, for the check sheet.

import { followPath, subjectBox, windowScores, shareInside, type Rect01, type SaliencyMap } from "./analysis/subject";
import { thin } from "./analysis/track";
import { inSource, onCanvas } from "./follow";
import { ease, paramAt } from "./keyframes";
import { sourceTimeAt } from "./project/ops";
import type { Id, Keyframe, Project, VisualClip } from "./project/types";
import type { Layer } from "./render/plan";
import { fittedSize } from "./render/size";
import { framesToSeconds, secondsToFrames } from "./time";

/** What the app saw of a shot's pictures: saliency maps at source seconds
 * of its media (state/subjects.ts). A still has one. */
export interface ShotLook {
  assetId: Id;
  times: number[];
  maps: SaliencyMap[];
}

/** The looks of a project's shots, by clip id. */
export type Looks = Record<Id, ShotLook>;

/** How a version frames footage it crops: on its subject (default), or at
 * the center as it was (the master's framing grown to cover). */
export type Reframe = "subject" | "center";
export const REFRAMES: Reframe[] = ["subject", "center"];

/** A caller's framing of one clip in a version: the point of its picture
 * (fractions from the top left, as preview_media shows it) to keep at the
 * center of the frame; an axis left out stays on the subject. Several for
 * one clip, each with `at`, make a path (ADR-123): centered on each point
 * at its time, held until the next, moving to it over the FOCUS_GLIDE
 * before it, as add_callout's ring glides. */
export interface Focus {
  clip_id: Id;
  x?: number;
  y?: number;
  /** Timeline seconds of the master. */
  at?: number;
  /** `at` as a frame of the clip (versionProject sets it, before a
   * cut-down moves the clip). */
  rel?: number;
}

/** What a version did with a caller's focus, pushes or overrides, where
 * that was not plainly what was asked or where it carried more (ADR-123):
 * Claude film test 4's focus and pushes changed nothing on its fitted
 * interface shots and the answers said nothing. */
export interface OptionNote {
  option: "focus" | "pushes" | "overrides";
  clip_id?: Id;
  note: string;
}

/** Seconds a focus path takes to move to its next point. */
export const FOCUS_GLIDE = 0.4;

/** A focus path's value on one axis at clip frame r: each point's at its
 * frame, held, eased to the next over `glide` frames before it; points
 * without an axis are left out; undefined when none has it. */
export function focusAt(points: Focus[], axis: "x" | "y", r: number, glide: number): number | undefined {
  const list = points.filter((p) => p[axis] !== undefined).map((p) => ({ f: p.rel ?? 0, v: p[axis]! })).sort((a, b) => a.f - b.f);
  if (!list.length) return undefined;
  if (r <= list[0].f) return list[0].v;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i], from = Math.max(a.f, b.f - glide);
    if (r < from) return a.v;
    if (r < b.f) return a.v + (b.v - a.v) * ease("easeInOut", (r - from) / Math.max(1, b.f - from));
  }
  return list.at(-1)!.v;
}

/** Where a version's framing of a shot cuts its subject. */
export interface SubjectNote {
  clipId: Id;
  /** Version timeline seconds. */
  at: number;
  /** The subject, fractions of the picture. */
  subject: Rect01;
  /** Its share inside the frame. */
  kept: number;
  /** Wider (or taller) than the frame: no placement keeps it whole. */
  wide?: boolean;
  /** Cut by the master's own keyed push, which a held push would show
   * (pushCut). */
  push?: boolean;
}

/** The clip-relative frame where `c` shows source second `t`, or null
 * outside it. */
export function relOf(c: VisualClip, t: number, fps: Project["fps"]): number | null {
  if (c.type === "image") return null;
  if (!("in" in c)) return null;
  const at = (rel: number) => sourceTimeAt(c, c.start + rel, fps);
  const first = at(0), last = at(c.duration - 1), step = framesToSeconds(1, fps);
  if (t < Math.min(first, last) - step || t > Math.max(first, last) + step) return null;
  const up = last >= first;
  let lo = 0, hi = c.duration - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid) <= t === up) lo = mid;
    else hi = mid;
  }
  return Math.abs(at(lo) - t) <= Math.abs(at(hi) - t) ? lo : hi;
}

/** What the callouts over a shot point at (lib/versionCallouts.ts,
 * ADR-122): the shot frames where one starts, stops or moves (every frame
 * of a glide, and a moment before each starts, so the frame is there when
 * it draws on), and the union of their targets in the shot's picture at a
 * shot frame, null where none shows. */
export interface ShotTargets {
  frames: number[];
  at(rel: number): Rect01 | null;
}

/** How far past the scale that covers the frame a shot must be zoomed for
 * the master to frame a region of it (frame_region, a keyed or set zoom):
 * a drift slower than a tenth is motion, not a choice of what to show. */
export const REGION_ZOOM = 1.1;

/**
 * Does the master frame a region of a full-frame shot (ADR-122): at rest
 * or at one of its position or scale keys, zoomed REGION_ZOOM past the
 * scale that covers the frame, or moved off its middle by 2% of the
 * picture? Then a version crops around that region; the subject detector
 * is for shots the master shows whole. Claude film test 3's 1:1 version
 * framed the city picture its saliency found inside the region the editor
 * pushed into, and cut out the Letter rise card the push was for.
 */
export function framesRegion(p: Project, c: VisualClip): boolean {
  const S = fittedSize(p, c);
  const frames = new Set([0, ...["transform.x", "transform.y", "transform.scale", "transform.scaleY"].flatMap((k) => (c.keyframes?.[k] ?? []).map((key) => key.f))]);
  for (const rel of frames) {
    if (rel < 0 || rel >= c.duration) continue;
    const l = restLayer(c, rel);
    const zx = (Math.abs(l.scale) * S.w) / p.width, zy = (Math.abs(l.scaleY ?? l.scale) * S.h) / p.height;
    if (Math.min(zx, zy) >= REGION_ZOOM - 1e-6) return true;
    // A fitted shot (bands on one axis, ADR-123) pushed past the frame on
    // the other: frame_region fit's push into a widescreen recording.
    if (Math.min(zx, zy) < 1 && Math.max(zx, zy) >= REGION_ZOOM - 1e-6) return true;
    const r = shownRect(p, c, l);
    if (Math.abs((r.left + r.right) / 2 - 0.5) > 0.02 || Math.abs((r.top + r.bottom) / 2 - 0.5) > 0.02) return true;
  }
  return false;
}

/** Every frame where a clip's position or scale keys move it, within its
 * length. */
function motionFrames(c: VisualClip): number[] {
  const out = new Set<number>();
  for (const path of ["transform.x", "transform.y", "transform.scale", "transform.scaleY"]) {
    const keys = c.keyframes?.[path] ?? [];
    for (let i = 1; i < keys.length; i++) {
      if (keys[i].v === keys[i - 1].v) continue;
      for (let f = Math.max(0, keys[i - 1].f); f <= Math.min(c.duration - 1, keys[i].f); f++) out.add(f);
    }
  }
  return [...out];
}

/** A clip's place on its frame at clip frame `rel`, from its own transform
 * and keys (not the in and out animations), as onCanvas reads a layer. */
export function restLayer(c: VisualClip, rel: number, x?: number, y?: number): Layer {
  const scale = paramAt(c, "transform.scale", rel);
  return {
    x: x ?? paramAt(c, "transform.x", rel),
    y: y ?? paramAt(c, "transform.y", rel),
    scale,
    ...(c.transform.scaleY !== undefined ? { scaleY: paramAt(c, "transform.scaleY", rel) } : {}),
    rotation: paramAt(c, "transform.rotation", rel),
    flipX: c.transform.flipX,
    flipY: c.transform.flipY,
  } as Layer;
}

/** The part of a shot's picture a frame shows with the shot placed so,
 * fractions of the picture, within the picture. */
function shownRect(p: Project, c: VisualClip, l: Layer): Rect01 {
  const a = inSource(p, c, l, 0, 0), b = inSource(p, c, l, p.width, p.height);
  const cl = (v: number) => Math.max(0, Math.min(1, v));
  return { left: cl(Math.min(a.u, b.u)), right: cl(Math.max(a.u, b.u)), top: cl(Math.min(a.v, b.v)), bottom: cl(Math.max(a.v, b.v)) };
}

/** The look for a clip: its own, else one of the same media whose
 * pictures cover its source (a cut-down split it in two). */
export function lookFor(looks: Looks | undefined, c: VisualClip): ShotLook | undefined {
  if (!looks) return undefined;
  if (looks[c.id]) return looks[c.id];
  if (c.type !== "video" && c.type !== "image") return undefined;
  return Object.values(looks).find((l) => l.assetId === c.assetId);
}

/** At most every this many seconds a key of a followed subject. */
const SAMPLE = 0.5;

/**
 * A full-frame shot refit to a version's frame (`after`, its scale already
 * grown to cover), placed so the version's frame holds what matters in it,
 * on the axis the new shape crops, inside what the master showed
 * (`master`, `before`) at each moment (ADR-122):
 * - the caller's focus, on the axes it gives;
 * - else what the callouts over the shot point at (`targets`: a ring, a
 *   spotlight's hole), the frame centered on them at every frame they
 *   show or move, held on the last one between them and already on the
 *   first before it;
 * - else, where the master frames a region of the shot (framesRegion), its
 *   framing kept, centered on that region (as "center");
 * - else the subject its looks see, chosen together over the shot
 *   (followPath).
 * The position is keyed there (kept within the picture) and thinned.
 * "center" keeps `after` as it is. Notes say where the result cuts the
 * subject the looks see where the subject decides or the caller asked for
 * the center, and where the master's own push cuts it, whatever the mode.
 * `focus` is the caller's points for this clip (one, or a path with at);
 * `said` hears what a focus could not do (an axis the frame shows whole, a
 * point held back inside the picture), ADR-123.
 */
export function reframeShot(master: Project, q: Project, before: VisualClip, after: VisualClip, look: ShotLook | undefined, mode: Reframe = "subject", focus?: Focus[], targets?: ShotTargets, said?: OptionNote[]): { clip: VisualClip; notes: SubjectNote[] } {
  const none = { clip: after, notes: [] as SubjectNote[] };
  const crop = after.crop;
  // What decides the framing where no focus does.
  const aim = mode === "center" ? "center" : targets?.frames.length ? "targets" : framesRegion(master, before) ? "region" : "subject";
  // Turned or cut pictures keep the old framing; so does a shot with
  // neither a look, a focus nor a callout.
  if (Math.abs(after.transform.rotation) > 1e-3 || crop.left + crop.right + crop.top + crop.bottom > 1e-3 || (!look && !focus && aim !== "targets")) {
    if (focus) said?.push({ option: "focus", clip_id: after.id, note: `${after.id} is turned or cropped, so this version keeps its framing and the focus changes nothing` });
    return none;
  }
  const S = fittedSize(q, after);
  const fps = q.fps;
  const glide = secondsToFrames(FOCUS_GLIDE, fps);
  // The frames to place it at: the look's samples inside the clip, else
  // every half second; with its first and last frame.
  const every = Math.max(1, Math.round((SAMPLE * fps.num) / fps.den));
  const still = after.type === "image" || !look || look.times.length === 1;
  const samples: { rel: number; map?: SaliencyMap; looked?: boolean }[] = [];
  if (look && !still) look.times.forEach((t, i) => {
    const rel = relOf(after, t, fps);
    if (rel !== null && !samples.some((s) => s.rel === rel)) samples.push({ rel, map: look.maps[i], looked: true });
  });
  if (!samples.length) for (let rel = 0; rel < after.duration; rel += every) samples.push({ rel, map: look?.maps[0], looked: !!look });
  // Callouts: every frame they start, stop or glide, and every frame the
  // master's push moves, so the frame stays on them and the picture keeps
  // covering it through an eased push (keys every half second, linear
  // between, left a band bare mid-push).
  if (aim === "targets") {
    const have = new Set(samples.map((s) => s.rel));
    for (const rel of [...targets!.frames, ...motionFrames(before)]) if (rel >= 0 && rel < after.duration && !have.has(rel)) (samples.push({ rel }), have.add(rel));
  }
  // A focus path: every frame it moves, each with the nearest look.
  if (focus && focus.some((x) => x.rel !== undefined)) {
    const looked = samples.filter((s) => s.map);
    const near = (rel: number) => looked.reduce<(typeof samples)[number] | undefined>((b, s) => (!b || Math.abs(s.rel - rel) < Math.abs(b.rel - rel) ? s : b), undefined);
    const have = new Set(samples.map((s) => s.rel));
    for (const x of focus) for (let f = Math.max(0, (x.rel ?? 0) - glide); f <= Math.min(after.duration - 1, x.rel ?? 0); f++) if (!have.has(f)) (samples.push({ rel: f, map: near(f)?.map }), have.add(f));
  }
  samples.sort((a, b) => a.rel - b.rel);
  if (samples[0].rel > 0) samples.unshift({ rel: 0, map: samples[0].map, looked: samples[0].looked });
  if (samples.at(-1)!.rel < after.duration - 1) samples.push({ rel: after.duration - 1, map: samples.at(-1)!.map, looked: samples.at(-1)!.looked });

  // Per sample: the frame's size in picture fractions, and the room its
  // center has: inside what the master showed of the shot.
  const placed = samples.map((s) => {
    const l = restLayer(after, s.rel);
    const w = Math.min(1, q.width / (S.w * Math.abs(l.scale))), h = Math.min(1, q.height / (S.h * Math.abs(l.scaleY ?? l.scale)));
    const shown = shownRect(master, before, restLayer(before, s.rel));
    return { ...s, l, w, h, shown };
  });
  const axes = (["x", "y"] as const).filter((a) => placed.some((s) => (a === "x" ? s.w : s.h) < 0.995));
  // A focus on an axis this shape shows whole has nothing to move.
  for (const a of ["x", "y"] as const) {
    if (focus?.some((x) => x[a] !== undefined) && !axes.includes(a)) said?.push({ option: "focus", clip_id: after.id, note: `${after.id} shows its picture's whole ${a === "x" ? "width" : "height"} in this shape, so focus ${a} has nothing to move` });
  }
  if (!axes.length) return none;

  const centers = placed.map((s) => centerOf(q, after, s.l));
  const auto: Record<"x" | "y", number[]> = { x: [], y: [] };
  // What the callouts point at, at each sample: held on the last one
  // between them, and on the first before it shows.
  const aimed: (Rect01 | null)[] = aim === "targets" ? placed.map((s) => targets!.at(s.rel)) : [];
  const first = aimed.find(Boolean) ?? null;
  for (let k = 0, last = first; k < aimed.length; k++) aimed[k] = aimed[k] ?? last, (last = aimed[k]);
  for (const axis of axes) {
    const size = (s: (typeof placed)[number]) => (axis === "x" ? s.w : s.h);
    const lo = (s: (typeof placed)[number]) => (axis === "x" ? s.shown.left : s.shown.top), hi = (s: (typeof placed)[number]) => (axis === "x" ? s.shown.right : s.shown.bottom);
    // Inside what the master showed; a frame wider than that (a 16:9
    // version of a tall master's column) holds all of it instead. Clamping
    // as if it were narrower put the frame's edge on the column's edge and
    // the subject off center (Claude film test 2, ADR-116).
    const fit = (s: (typeof placed)[number], c: number) => {
      const a = lo(s) + size(s) / 2, b = hi(s) - size(s) / 2;
      return a <= b ? Math.max(a, Math.min(b, c)) : Math.max(b, Math.min(a, c));
    };
    if (look && (aim === "subject" || aim === "center")) auto[axis] = followPath(placed.map((s) => windowScores(s.map!, axis, size(s), s.shown)));
    placed.forEach((s, k) => {
      const t = aimed[k];
      const want = focus && focusAt(focus, axis, s.rel, glide);
      const c =
        want !== undefined ? fit(s, want)
        : aim === "subject" && look ? auto[axis][k]
        : aim === "targets" && t ? fit(s, axis === "x" ? (t.left + t.right) / 2 : (t.top + t.bottom) / 2)
        : axis === "x" ? centers[k].u : centers[k].v;
      if (axis === "x") centers[k].u = c;
      else centers[k].v = c;
    });
  }

  // The position that puts each chosen center at the frame's center, kept
  // where the picture still covers the frame.
  const moved = aim === "subject" || aim === "targets" || !!focus;
  let clip = after;
  for (const axis of axes) {
    if (!moved) break;
    const dim = axis === "x" ? q.width : q.height;
    const values = placed.map((s, k) => {
      const at = onCanvas(q, after, { ...s.l, x: 0, y: 0 }, centers[k].u, centers[k].v);
      const room = Math.max(0, ((axis === "x" ? S.w * Math.abs(s.l.scale) : S.h * Math.abs(s.l.scaleY ?? s.l.scale)) - dim) / (2 * dim));
      const v = ((axis === "x" ? q.width / 2 - at.x : q.height / 2 - at.y)) / dim;
      return Math.max(-room, Math.min(room, v));
    });
    const path = `transform.${axis}` as const;
    const flat = Math.max(...values) - Math.min(...values) < 1 / dim;
    const keys = clip.keyframes ? { ...clip.keyframes } : {};
    delete keys[path];
    if (flat) clip = { ...clip, transform: { ...clip.transform, [axis]: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(5) }, keyframes: keys };
    else {
      const keep = thin(values, 1 / dim);
      const list: Keyframe[] = keep.map((i) => ({ f: placed[i].rel, v: +values[i].toFixed(5) }));
      clip = { ...clip, transform: { ...clip.transform, [axis]: list[0].v }, keyframes: { ...keys, [path]: list } };
    }
  }
  // A focus point the frame could not center (the picture's edge, or what
  // the master showed, held it back): said, at its worst moment.
  if (focus && said) {
    for (const axis of axes) {
      let worst: { k: number; want: number; got: number } | undefined;
      placed.forEach((s, k) => {
        const want = focusAt(focus, axis, s.rel, glide);
        if (want === undefined || (axis === "x" ? s.w : s.h) >= 0.995) return;
        const got = centerOf(q, clip, restLayer(clip, s.rel))[axis === "x" ? "u" : "v"];
        if (Math.abs(got - want) > 0.02 && (!worst || Math.abs(got - want) > Math.abs(worst.got - worst.want))) worst = { k, want, got };
      });
      if (worst) {
        const at = +framesToSeconds(after.start + placed[worst.k].rel, fps).toFixed(2);
        said.push({ option: "focus", clip_id: after.id, note: `focus ${axis} ${+worst.want.toFixed(3)} on ${after.id} is held at ${+worst.got.toFixed(3)} at ${at} s: the frame stays on the picture and around what the master showed of it` });
      }
    }
  }

  // Where the frame, as placed, cuts the subject the looks see: where the
  // subject decides, or the caller asked for the center. Where the editor
  // framed a region or pointed at a part, the detector's subject does not
  // second-guess it (a screen recording's most salient part is rarely what
  // the push was for); a subject the master's own push cuts is still named.
  const notes: SubjectNote[] = [];
  const judged = aim === "subject" || aim === "center";
  if (look) {
    const sec = (rel: number) => +framesToSeconds(after.start + rel, fps).toFixed(2);
    placed.forEach((s, k) => {
      if (!s.map || !s.looked) return;
      const win = frameRect(q, clip, s.rel, S);
      if (!judged) {
        const pushed = pushCut(after, s.rel, s.map, s.shown, win);
        if (pushed) notes.push({ clipId: after.id, at: sec(s.rel), subject: round(pushed.subject), kept: +pushed.kept.toFixed(2), push: true });
        return;
      }
      const subject = subjectBox(s.map, s.shown);
      if (!subject) return;
      const kept = shareInside(subject, win);
      const ideal = { ...win };
      for (const axis of axes) {
        const c = auto[axis][k], half = (axis === "x" ? s.w : s.h) / 2;
        if (axis === "x") (ideal.left = c - half), (ideal.right = c + half);
        else (ideal.top = c - half), (ideal.bottom = c + half);
      }
      // Wide: the subject is wider than the frame on a cropped axis, and a
      // figure rather than a band (a horizon's glow is not a subject).
      const sw = subject.right - subject.left, sh = subject.bottom - subject.top;
      const aspect = (sh * S.h) / Math.max(1e-6, sw * S.w);
      const wide = axes.some((a) => (a === "x" ? sw > s.w && aspect >= 0.5 : sh > s.h && 1 / aspect >= 0.5));
      // Cut: this framing loses much of a subject the subject framing keeps.
      const cut = kept < 0.65 && shareInside(subject, ideal) >= 0.9;
      if (cut || wide) notes.push({ clipId: after.id, at: sec(s.rel), subject: round(subject), kept: +kept.toFixed(2), ...(wide ? { wide: true } : {}) });
      else {
        const pushed = pushCut(after, s.rel, s.map, s.shown, win);
        if (pushed) notes.push({ clipId: after.id, at: sec(s.rel), subject: round(pushed.subject), kept: +pushed.kept.toFixed(2), push: true });
      }
    });
  }
  return { clip, notes };
}

const round = (r: Rect01): Rect01 => ({ left: +r.left.toFixed(3), top: +r.top.toFixed(3), right: +r.right.toFixed(3), bottom: +r.bottom.toFixed(3) });

/**
 * A subject the master's own keyed push crops, in a version whose frame
 * shows more of the shot than the master did (a 16:9 version of a tall
 * short's push-in: the same zoom crops the picture's top and bottom, the
 * rocket's nose with it, which reads as a close-up on 9:16 and as a
 * mistake on 16:9). ADR-116 judged a subject only inside what the master
 * showed, so this was never named (ADR-118). The subject is found in the
 * whole picture, must be the master's (half of it or more in what the
 * master showed), and is taken with the thin part that runs on from it
 * on the axis the master's crop still decides (withSpine: the strongest
 * blob of the launch was its flame, the nose a faint streak above it).
 * Named when this frame leaves out 2% of the picture or more of it that
 * way, a twentieth of it, where the shot at its widest (pushes "hold")
 * would leave out at most half that.
 */
export function pushCut(c: VisualClip, rel: number, map: SaliencyMap, shown: Rect01, win: Rect01): { subject: Rect01; kept: number } | null {
  const keys = c.keyframes?.["transform.scale"];
  if (!keys?.length) return null;
  // Where this frame shows more of the shot than the master did on one
  // axis, the master's crop on the other is judged.
  const wider = { x: win.right - win.left > shown.right - shown.left + 0.01, y: win.bottom - win.top > shown.bottom - shown.top + 0.01 };
  if (wider.x === wider.y) return null;
  const axis = wider.x ? "y" : "x";
  const core = subjectBox(map);
  if (!core || shareInside(core, shown) < 0.5) return null;
  const subject = withSpine(map, core, axis);
  const [lo, hi] = axis === "y" ? (["top", "bottom"] as const) : (["left", "right"] as const);
  // What a window leaves out of the subject that way, a share of the
  // picture, counted from 2% of it and a twentieth of the subject.
  const out = (w: Rect01) => {
    const off = Math.max(0, w[lo] - subject[lo]) + Math.max(0, subject[hi] - w[hi]);
    return off >= 0.02 && off >= 0.05 * (subject[hi] - subject[lo]) ? off : 0;
  };
  const now = out(win);
  if (!now) return null;
  // The window at the shot's widest, about the same center, kept inside the picture.
  const k = Math.abs(paramAt(c, "transform.scale", rel)) / Math.min(...keys.map((x) => Math.abs(x.v)));
  const grow = (lo: number, hi: number): [number, number] => {
    const half = Math.min(0.5, ((hi - lo) * k) / 2), mid = Math.max(half, Math.min(1 - half, (lo + hi) / 2));
    return [mid - half, mid + half];
  };
  const [left, right] = grow(win.left, win.right), [top, bottom] = grow(win.top, win.bottom);
  return out({ left, right, top, bottom }) <= now / 2 ? { subject, kept: shareInside(subject, win) } : null;
}

/**
 * A subject's box grown along a thin part that runs on from it, up and
 * down (axis y) or to the sides (x): row by row (column by column), while
 * the strongest salience across the box is a tenth of the map's peak or
 * more and twice its row's median (a rocket's nose against the sky above
 * its flame, not the smoke spread across the frame below it).
 */
export function withSpine(map: SaliencyMap, b: Rect01, axis: "x" | "y"): Rect01 {
  const { w, h, v } = map;
  let peak = 0;
  for (const x of v) peak = Math.max(peak, x);
  const x0 = Math.floor(b.left * w), x1 = Math.ceil(b.right * w), y0 = Math.floor(b.top * h), y1 = Math.ceil(b.bottom * h);
  // Along rows (vertical growth) or columns (horizontal).
  const line = (vertical: boolean, i: number) => {
    const n = vertical ? w : h;
    const at = (j: number) => (vertical ? v[i * w + j] : v[j * w + i]);
    const all = Array.from({ length: n }, (_, j) => at(j)).sort((a, c) => a - c);
    const [lo, hi] = vertical ? [x0, x1] : [y0, y1];
    let best = 0;
    for (let j = lo; j < hi; j++) best = Math.max(best, at(j));
    return best >= 0.1 * peak && best >= 2 * all[n >> 1];
  };
  const reach = (vertical: boolean, from: number, step: number, end: number) => {
    let i = from;
    while (i + step >= 0 && i + step < end && line(vertical, i + step)) i += step;
    return i;
  };
  return axis === "y"
    ? { ...b, top: Math.min(b.top, reach(true, y0, -1, h) / h), bottom: Math.max(b.bottom, (reach(true, y1 - 1, 1, h) + 1) / h) }
    : { ...b, left: Math.min(b.left, reach(false, x0, -1, w) / w), right: Math.max(b.right, (reach(false, x1 - 1, 1, w) + 1) / w) };
}

/** The picture point at the frame's center with the shot placed by `l`. */
function centerOf(q: Project, c: VisualClip, l: Layer): { u: number; v: number } {
  return inSource(q, c, l, q.width / 2, q.height / 2);
}

/** The part of the picture the version's frame shows at clip frame `rel`. */
function frameRect(q: Project, c: VisualClip, rel: number, S: { w: number; h: number }): Rect01 {
  const l = restLayer(c, rel);
  const half = { w: q.width / (2 * S.w * Math.abs(l.scale)), h: q.height / (2 * S.h * Math.abs(l.scaleY ?? l.scale)) };
  const m = centerOf(q, c, l);
  return { left: m.u - half.w, right: m.u + half.w, top: m.v - half.h, bottom: m.v + half.h };
}

