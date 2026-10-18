// Track mattes (ADR-056), After Effects' model: a clip shows only where
// its matte clip's picture is opaque (alpha) or bright (luma), or the
// reverse. The matte is a clip of the same timeline, by default whatever
// is on the video track directly above at each frame, and is not drawn on
// its own: it is the stencil, not a layer. The plan attaches the matte's
// layer to the clip it cuts; the compositor renders both and multiplies.

import type { Clip, Id, MatteMode, Track, TrackMatte, VisualClip } from "./project/types";

export const MATTE_MODES: MatteMode[] = ["alpha", "alphaInverted", "luma", "lumaInverted"];

const isVisual = (c: Clip | undefined): c is VisualClip => !!c && c.type !== "audio" && c.type !== "adjustment";

export const clipAtFrame = (t: Track | undefined, f: number): Clip | undefined => t?.clips.find((c) => c.start <= f && f < c.start + c.duration);

/** The track a track-above matte reads for the track at index `ti`. */
export const trackAbove = (tracks: Track[], ti: number): Track | undefined => (tracks[ti - 1]?.kind === "video" ? tracks[ti - 1] : undefined);

function findIn(tracks: Track[], id: Id): Clip | undefined {
  for (const t of tracks) for (const c of t.clips) if (c.id === id) return c;
  return undefined;
}

/**
 * Where `clip`'s matte comes from at frame `f`: the matte clip; null when
 * the matte has no picture there (an empty matte: nothing of an alpha
 * matte shows, all of an inverted one); undefined when the clip has no
 * matte, or names one that no longer exists.
 */
export function matteClip(tracks: Track[], ti: number, clip: Clip, f: number): VisualClip | null | undefined {
  const m = "trackMatte" in clip ? clip.trackMatte : undefined;
  if (!m) return undefined;
  if (m.clipId !== undefined) {
    const named = findIn(tracks, m.clipId);
    if (!isVisual(named) || named.id === clip.id) return undefined;
    return named.start <= f && f < named.start + named.duration ? named : null;
  }
  const above = clipAtFrame(trackAbove(tracks, ti), f);
  return isVisual(above) ? above : null;
}

/** The clips that are mattes at frame `f`, and so are not drawn: every
 * clip a clip names (at all times, as After Effects turns a matte's video
 * off), and what sits above each showing track-above matte. */
export function mattesAt(tracks: Track[], f: number): Set<Id> {
  const out = new Set<Id>();
  tracks.forEach((t, ti) => {
    if (t.kind !== "video") return;
    for (const c of t.clips) {
      const m = "trackMatte" in c ? c.trackMatte : undefined;
      if (!m) continue;
      if (m.clipId !== undefined) {
        if (m.clipId !== c.id) out.add(m.clipId);
      } else if (!t.hidden && !c.disabled && c.start <= f && f < c.start + c.duration) {
        const above = clipAtFrame(trackAbove(tracks, ti), f);
        if (isVisual(above)) out.add(above.id);
      }
    }
  });
  return out;
}

// ---- loading ------------------------------------------------------------------

/** A track matte from untrusted JSON, or undefined. */
export function cleanTrackMatte(raw: unknown): TrackMatte | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (!MATTE_MODES.includes(r.mode as MatteMode)) return undefined;
  return { ...(typeof r.clipId === "string" && r.clipId ? { clipId: r.clipId } : {}), mode: r.mode as MatteMode };
}

/** One timeline's clips with every named matte that points nowhere (a
 * deleted clip, itself, an audio or adjustment clip) removed. */
export function dropDanglingMattes(tracks: Track[]): Track[] {
  const visual = new Set(tracks.flatMap((t) => t.clips.filter(isVisual).map((c) => c.id)));
  return tracks.map((t) => {
    if (!t.clips.some((c) => "trackMatte" in c && c.trackMatte?.clipId !== undefined && (c.trackMatte.clipId === c.id || !visual.has(c.trackMatte.clipId)))) return t;
    return {
      ...t,
      clips: t.clips.map((c) => {
        if (!("trackMatte" in c) || c.trackMatte?.clipId === undefined || (c.trackMatte.clipId !== c.id && visual.has(c.trackMatte.clipId))) return c;
        const { trackMatte: _, ...rest } = c;
        return rest as Clip;
      }),
    };
  });
}
