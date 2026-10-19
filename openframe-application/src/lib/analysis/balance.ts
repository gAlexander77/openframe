import { assetsOf, trackRole } from "../audioRoles";
import type { Project, Track } from "../project/types";

/** Isolate stems without changing the document or bypassing mute/solo. */
export function isolateTracks(p: Project, ids: string[]): Project {
  const solo = p.tracks.some(t => t.solo);
  return { ...p, tracks: p.tracks.map(t => ({ ...t, solo: false, muted: t.muted || (solo && !t.solo) || !ids.includes(t.id) })) };
}

/** Stems by role (lib/audioRoles.ts: the track's, else its files'), not
 * by track name; `p` lets a track without a role be judged by its files. */
export const isDialog = (t: Track, p?: Project) => trackRole(t, p && assetsOf(p)) === "dialog";
export const isMusic = (t: Track, p?: Project) => trackRole(t, p && assetsOf(p)) === "music";

export function loudnessDifference(dialog: number, music: number): number | null {
  return Number.isFinite(dialog) && Number.isFinite(music) ? dialog - music : null;
}

/** Absolute attenuation required from the unducked bed; never boost it. */
export function duckDepth(dialog: number, music: number, target: number): number {
  const difference = loudnessDifference(dialog, music);
  if (difference === null || !Number.isFinite(target)) throw new Error("Cannot target voice balance: voice or music is silent in the measurement window.");
  return Math.max(0, Math.min(40, target - difference));
}

/** Speech spans, sorted and joined across gaps shorter than `bridge` (the
 * ducked bed holds through those, so they belong to the line). */
export function speechWindows(spans: [number, number][], bridge: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a - last[1] < bridge) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Several windows' loudness as one programme: energy averaged by length.
 * Silent windows (-Infinity) add length but no energy; all silent is -Infinity. */
export function combinedLoudness(parts: { lufs: number; seconds: number }[]): number {
  const seconds = parts.reduce((n, p) => n + p.seconds, 0);
  const energy = parts.reduce((n, p) => n + (Number.isFinite(p.lufs) ? p.seconds * 10 ** (p.lufs / 10) : 0), 0);
  return seconds > 0 && energy > 0 ? 10 * Math.log10(energy / seconds) : -Infinity;
}
