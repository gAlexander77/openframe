// What each audio track's sound is, as a stem: dialog, music, effects or
// ambience (Premiere's and Resolve's dialog/music/effects busses; ADR-098).
// The tools that make a track say what it is (Track.role), the files say
// what they are (Asset.role, a spoken file's speech), and only a project
// from before roles falls back to the names those tools gave their tracks.
// Stems (measure_loudness by_track, preview_audio's solo, review_voiceover's
// music, duck_under_speech's voices) and where a new sound lands both read
// it here, so a riser never lands on the voiceover because it had a gap.

import { createTrack } from "./project/defaults";
import * as ops from "./project/ops";
import type { Asset, Id, Project, Track, TrackRole } from "./project/types";

/** The name a track made for a role gets. */
export const ROLE_TRACK_NAMES: Record<TrackRole, string> = { dialog: "Voiceover", music: "Music", effects: "SFX", ambience: "Ambience" };

/** Sound effect files made before Asset.role existed: "Riser.wav". */
const LEGACY_EFFECT_NAMES = /^(Whoosh|Swish|Pop|Click|Ding|Success|Riser|Impact|Sub drop|Braam|Reverse cymbal|Glitch|Camera shutter|Swoosh up|Boom)\.wav$/;

/** What a file's sound is, from where it came from; undefined for a
 * file the user imported (it could be anything). */
export function assetRole(a: Asset | undefined): TrackRole | undefined {
  if (!a) return undefined;
  if (a.role) return a.role;
  if (a.speech) return "dialog";
  if (a.kind === "audio" && LEGACY_EFFECT_NAMES.test(a.name)) return "effects";
  return undefined;
}

type AssetOf = (id: Id) => Asset | undefined;
const none: AssetOf = () => undefined;

/** A project's assets by id, for trackRole. */
export const assetsOf = (p: Project): AssetOf => {
  const m = new Map(p.assets.map((a) => [a.id, a]));
  return (id) => m.get(id);
};

/**
 * The stem an audio track is: its role when a tool or the user set one;
 * else what most of its clips' sound is (by length); else, for a project
 * from before roles, the names add_voiceover and the sound effect tracks
 * had; else unset when the imported audio is uncertain. Video
 * tracks are not stems: their sound is the picture's own.
 */
export function trackRole(t: Track, assetOf: AssetOf = none): TrackRole | undefined {
  if (t.kind !== "audio") return undefined;
  if (t.role) return t.role;
  const length = new Map<TrackRole, number>();
  for (const c of t.clips) {
    const r = c.type === "audio" ? assetRole(assetOf(c.assetId)) : undefined;
    if (r) length.set(r, (length.get(r) ?? 0) + c.duration);
  }
  if (length.size) return [...length].sort((a, b) => b[1] - a[1])[0][0];
  // Legacy tool names for documents from before explicit roles.
  if (/^voiceover\b/i.test(t.name)) return "dialog";
  if (/sound effects|\bsfx\b/i.test(t.name)) return "effects";
  if (/ambien|room tone/i.test(t.name)) return "ambience";
  if (/^music\b/i.test(t.name)) return "music";
  return undefined;
}

/** The audio tracks of a stem. */
export const tracksOfRole = (p: Project, role: TrackRole): Track[] => {
  const of = assetsOf(p);
  return p.tracks.filter((t) => trackRole(t, of) === role);
};

/**
 * The track a new sound of `role` lands on at frames [start, start +
 * duration): `prefer` when given (an audio track id; when its spot is
 * taken, a new track of its role just below it), else the first unlocked
 * track of that role with room, else a new one named for the role, below
 * the last of its kind. An uncertain import lands on an
 * unclassified audio track until the user assigns it a stem.
 */
export function roleTrack(p: Project, role: TrackRole | undefined, start: number, duration: number, prefer?: Id): { project: Project; trackId: Id } {
  const of = assetsOf(p);
  const want = role;
  if (prefer !== undefined) {
    const t = ops.findTrack(p, prefer);
    if (!t) throw new Error(`No track with id ${prefer}`);
    if (t.kind !== "audio") throw new Error(`Track ${prefer} is a video track; sound goes on an audio track`);
    if (t.locked) throw new Error(`Track ${prefer} is locked`);
    if (ops.rangeFree(t, start, duration)) return { project: p, trackId: t.id };
    const fresh: Track = { ...createTrack("audio", t.name), ...(trackRole(t, of) ? { role: trackRole(t, of) } : {}) };
    const at = p.tracks.findIndex((x) => x.id === t.id) + 1;
    return { project: ops.addTrack(p, fresh, at), trackId: fresh.id };
  }
  const free = p.tracks.find((t) => t.kind === "audio" && !t.locked && trackRole(t, of) === want && ops.rangeFree(t, start, duration));
  if (free) return { project: p, trackId: free.id };
  const fresh: Track = { ...createTrack("audio", role ? ROLE_TRACK_NAMES[role] : "Audio"), ...(role ? { role } : {}) };
  const last = p.tracks.findLastIndex((t) => t.kind === "audio" && trackRole(t, of) === want);
  return { project: ops.addTrack(p, fresh, last >= 0 ? last + 1 : undefined), trackId: fresh.id };
}

/** Stems in one call: each audio track's role, by track id. */
export function stemsOf(p: Project): Record<TrackRole, Id[]> {
  const of = assetsOf(p);
  const out: Record<TrackRole, Id[]> = { dialog: [], music: [], effects: [], ambience: [] };
  for (const t of p.tracks) {
    const r = trackRole(t, of);
    if (r) out[r].push(t.id);
  }
  return out;
}
