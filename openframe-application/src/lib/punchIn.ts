// Punch-ins on jump cuts (ADR-148): where two pieces of one shot meet with
// something cut out between them, every other piece is drawn a little
// larger, so the cut reads as a change of shot size instead of a jump. The
// talking-head editor's standard fix, done by hand one set_param a cut
// before this. What was applied is kept on the clip, so punching in again
// first takes it back: it never compounds. Keyed framing (auto_reframe, a
// tracked or pushed-in piece) is scaled key by key, which is the framing a
// vertical short's pieces usually have.

import { clipEnd, sourceTimeAt } from "./project/ops";
import type { Clip, Id, Keyframe, Project, Punch, VideoClip } from "./project/types";

export const PUNCH_SCALE = 1.15;
/** Where a framed face sits: the point kept in place by default. */
export const PUNCH_FOCUS = { x: 0.5, y: 0.4 };

export interface PunchResult {
  project: Project;
  /** Jump cuts found among the clips considered. */
  cuts: number;
  /** Pieces on either side of a jump cut. */
  pieces: number;
  punched: Id[];
}

const SCALE = "transform.scale", SCALE_Y = "transform.scaleY", X = "transform.x", Y = "transform.y";

/** The clip's first scale, keyed or not: what a punch-in left it at. */
const scaleOf = (c: VideoClip) => c.keyframes?.[SCALE]?.[0]?.v ?? c.transform.scale;

/**
 * The clip's framing `k` times larger about the point (fx, fy) of the
 * frame (fractions from its top left), which stays where it is: static
 * values and keys alike, so a reframed or tracked piece keeps its move.
 * 1 / k about the same point takes it back exactly.
 */
function scaled(c: VideoClip, k: number, fx: number, fy: number): VideoClip {
  const t = c.transform, keys = c.keyframes ?? {};
  // Positions are offsets of the picture's center from the frame's: each moves away from the focus.
  const about = (center: number) => (v: number) => center + (v - center) * k;
  const x = about(fx - 0.5), y = about(fy - 0.5), larger = (v: number) => v * k;
  const each = (path: string, fn: (v: number) => number) => (keys[path]?.length ? { [path]: keys[path].map((key: Keyframe) => ({ ...key, v: fn(key.v) })) } : {});
  return {
    ...c,
    transform: { ...t, scale: larger(t.scale), ...(t.scaleY !== undefined ? { scaleY: larger(t.scaleY) } : {}), x: x(t.x), y: y(t.y) },
    ...(c.keyframes ? { keyframes: { ...keys, ...each(SCALE, larger), ...each(SCALE_Y, larger), ...each(X, x), ...each(Y, y) } } : {}),
  };
}
/** The clip as it was framed before its punch-in. A punch-in something
 * has since reframed (its scale is no longer what the punch left) is
 * forgotten: the framing it has now is its own. */
function unpunched(c: VideoClip): VideoClip {
  if (!c.punch) return c;
  const { punch, ...rest } = c;
  return Math.abs(scaleOf(c) - punch.to) > 1e-6 ? (rest as VideoClip) : scaled(rest as VideoClip, 1 / punch.scale, punch.fx, punch.fy);
}

/** Two clips that meet where the file does not go on: a jump cut. */
function jumps(p: Project, a: Clip, b: Clip): boolean {
  if (a.type !== "video" || b.type !== "video" || clipEnd(a) !== b.start || a.assetId !== b.assetId) return false;
  if (a.freeze || b.freeze || a.reverse || b.reverse || a.speedCurve || b.speedCurve) return false;
  const frame = p.fps.den / p.fps.num;
  return Math.abs(sourceTimeAt(a, clipEnd(a), p.fps) - b.in) > frame * Math.max(a.speed, 1);
}

/**
 * Punch in every other piece at the jump cuts among `ids` (default: the
 * main track's clips), by `scale` about `focus` (fractions of the frame
 * from its top left). `off` takes the punch-ins away instead.
 */
export function punchInCuts(p: Project, o: { ids?: Id[]; scale?: number; focus?: { x: number; y: number }; off?: boolean } = {}): PunchResult {
  const scale = o.scale ?? PUNCH_SCALE, focus = o.focus ?? PUNCH_FOCUS;
  const only = o.ids ? new Set(o.ids) : null;
  const next = new Map<Id, VideoClip>();
  const out: PunchResult = { project: p, cuts: 0, pieces: 0, punched: [] };
  for (const t of p.tracks) {
    if (t.kind !== "video" || t.locked || (only ? false : !t.main)) continue;
    // Runs of pieces, each meeting the next at a jump cut.
    let run: VideoClip[] = [];
    const close = () => {
      if (run.length > 1) {
        out.cuts += run.length - 1;
        out.pieces += run.length;
      }
      run.forEach((c, i) => {
        const base = unpunched(c);
        if (o.off || run.length < 2 || i % 2 === 0) return void (base !== c && next.set(c.id, base));
        const big = scaled(base, scale, focus.x, focus.y);
        const punch: Punch = { scale, fx: focus.x, fy: focus.y, to: scaleOf(big) };
        next.set(c.id, { ...big, punch });
        out.punched.push(c.id);
      });
      run = [];
    };
    for (const c of t.clips) {
      if (c.type !== "video" || (only && !only.has(c.id))) {
        close();
        continue;
      }
      if (run.length && !jumps(p, run[run.length - 1], c)) close();
      run.push(c);
    }
    close();
  }
  if (next.size) out.project = { ...p, tracks: p.tracks.map((t) => (t.clips.some((c) => next.has(c.id)) ? { ...t, clips: t.clips.map((c) => next.get(c.id) ?? c) } : t)) };
  return out;
}
