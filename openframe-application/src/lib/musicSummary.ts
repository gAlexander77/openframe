// analyze_music's answer in a few lines (ADR-105). A song's full reading
// lists every beat, every hit and each beat's energy: about 2.7 KB for 56
// seconds of music in the Claude film test, more for a longer song, and a
// model cutting to bars needs the tempo, where the grid starts, the bars,
// the parts and the drops. The summary gives those, the beats as an even
// grid with the ones that stray from it named, and counts for the rest;
// detail full answers every list as before.

import type { MappedMusic } from "./analysis/musicMap";

/** A beat further than this from the even grid is named (seconds): more
 * than half a frame at 24 fps, less than a frame at 30. */
export const OFF_GRID = 0.025;
/** Stray beats named at most; past it, how many. */
const MAX_OFF_GRID = 16;

const r3 = (v: number) => +v.toFixed(3) + 0; // + 0: never -0

/** The even grid the beats sit on: the beat's length from the tempo, and
 * the grid's phase as most of the beats have it (one stray first beat does
 * not shift it), with the beats that stray from it. */
export function beatGrid(beats: number[], bpm: number): { first_beat: number; beat_seconds: number; off_grid: number[] } | null {
  if (!beats.length || !(bpm > 0)) return null;
  const P = 60 / bpm;
  const wrap = (x: number) => x - P * Math.round(x / P);
  const residuals = beats.map((t) => wrap(t - beats[0])).sort((a, b) => a - b);
  const origin = beats[0] + residuals[Math.floor(residuals.length / 2)];
  // The grid's beat nearest the first beat heard.
  const first = origin + P * Math.round((beats[0] - origin) / P);
  return { first_beat: r3(first), beat_seconds: +P.toFixed(4), off_grid: beats.filter((t) => Math.abs(wrap(t - origin)) > OFF_GRID) };
}

/** What the summary puts in place of the beats, hits and beat energy. */
export interface MusicSummary {
  grid: { first_beat: number; beat_seconds: number; bar_seconds: number; off_grid?: number[]; off_grid_count?: number } | null;
  counts: { beats: number; bars: number; phrases: number; hits: number };
  detail: string;
}

/** A full analysis (MappedMusic plus what analyze_music adds) as its
 * summary: every field but beats, hits and beat_energy kept, those three
 * as a grid and counts. */
export function musicSummary<T extends MappedMusic & { beats_per_bar?: number }>(full: T): Omit<T, "beats" | "hits" | "beat_energy"> & MusicSummary {
  const { beats, hits, beat_energy: _energy, ...rest } = full;
  const grid = beatGrid(beats, full.bpm);
  const perBar = full.beats_per_bar ?? 4;
  const stray = grid?.off_grid ?? [];
  return {
    ...rest,
    grid: grid
      ? {
          first_beat: grid.first_beat,
          beat_seconds: grid.beat_seconds,
          bar_seconds: +(grid.beat_seconds * perBar).toFixed(4),
          ...(stray.length ? { off_grid: stray.slice(0, MAX_OFF_GRID) } : {}),
          ...(stray.length > MAX_OFF_GRID ? { off_grid_count: stray.length } : {}),
        }
      : null,
    counts: { beats: beats.length, bars: full.downbeats.length, phrases: full.phrases.length, hits: hits.length },
    detail: `summary: beats sit on the grid (first_beat, then every beat_seconds)${stray.length ? " except off_grid" : ""}${stray.length > beats.length / 4 ? "; many stray (a speed curve or a free tempo), so detail full is worth reading" : ""}; detail full lists every beat, hit and beat's energy`,
  };
}
