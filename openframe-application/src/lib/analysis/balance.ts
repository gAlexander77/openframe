import type { Project, Track } from "../project/types";

/** Isolate stems without changing the document or bypassing mute/solo. */
export function isolateTracks(p: Project, ids: string[]): Project {
  const solo = p.tracks.some(t => t.solo);
  return { ...p, tracks: p.tracks.map(t => ({ ...t, solo: false, muted: t.muted || (solo && !t.solo) || !ids.includes(t.id) })) };
}

/** Track names are the current role convention, not a speech classifier. */
export const isDialog = (t: Track) => /^voiceover(?:\b|$)/i.test(t.name);
export const isMusic = (t: Track) => t.kind === "audio" && !isDialog(t) && !/sound effects|sfx/i.test(t.name);

export function loudnessDifference(dialog: number, music: number): number | null {
  return Number.isFinite(dialog) && Number.isFinite(music) ? dialog - music : null;
}

/** Absolute attenuation required from the unducked bed; never boost it. */
export function duckDepth(dialog: number, music: number, target: number): number {
  const difference = loudnessDifference(dialog, music);
  if (difference === null || !Number.isFinite(target)) throw new Error("Cannot target voice balance: voice or music is silent in the measurement window.");
  return Math.max(0, Math.min(40, target - difference));
}
