import { assetsOf, trackRole } from "../audioRoles";
import type { Project, Track } from "../project/types";
import { gatedLoudness } from "./loudness";

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

// ---- the three windows a voice-over-music balance is measured in (ADR-096) ----
// "11 LU over the music" meant three things in three answers: over the
// whole stretch (music swelling between lines counts), over the stretches
// where the voice speaks, and line by line. Each answer now names its window.

export const BALANCE_WINDOWS = {
  program: "the whole stretch measured, the music between lines included",
  speech: "only while the voice speaks: every line from its first word to its last, taken together",
  line: "each line alone, from its first word to its last",
} as const;

/** Seconds a LoudnessMeter step covers. */
const STEP = 0.1;

const stepRange = (steps: number[], t0: number, a: number, b: number): [number, number] => [Math.max(0, Math.round((a - t0) / STEP)), Math.min(steps.length, Math.round((b - t0) / STEP))];

/** Gated loudness (BS.1770) of the windows [a, b) (seconds), from a mix's
 * 100 ms steps that start at `t0` (MixMeasurement.steps); -Infinity for
 * silence. One render serves every window inside it. */
export function windowLoudness(steps: number[], t0: number, windows: [number, number][]): number {
  const picked: number[] = [];
  for (const [a, b] of windows) {
    const [i, j] = stepRange(steps, t0, a, b);
    for (let k = i; k < j; k++) picked.push(steps[k]);
  }
  return gatedLoudness(picked);
}

/** Where a voice sounds inside [a, b): from its first 100 ms within
 * `rangeDb` of its loudest to its last (a line's lead-in silence and its
 * tail out), or null when it is silent there. */
export function activeSpan(steps: number[], t0: number, a: number, b: number, rangeDb = 40): [number, number] | null {
  const [i, j] = stepRange(steps, t0, a, b);
  let top = 0;
  for (let k = i; k < j; k++) top = Math.max(top, steps[k]);
  // -70 LUFS, BS.1770's absolute gate, as a mean square.
  if (!(top > 10 ** ((-70 + 0.691) / 10))) return null;
  const floor = top * 10 ** (-rangeDb / 10);
  let first = i, last = j - 1;
  while (first < last && steps[first] <= floor) first++;
  while (last > first && steps[last] <= floor) last--;
  return [+(t0 + first * STEP).toFixed(3), +(t0 + (last + 1) * STEP).toFixed(3)];
}

export interface LineBalance {
  start: number;
  end: number;
  voice_lufs: number | null;
  music_lufs: number | null;
  voice_above_music_lu: number | null;
}

const r1 = (x: number) => (Number.isFinite(x) ? +x.toFixed(1) : null);

/** Each line's voice, music and margin, from the two stems' steps. */
export function lineBalances(voiceSteps: number[], bedSteps: number[], t0: number, lines: [number, number][]): LineBalance[] {
  return lines.map(([a, b]) => {
    const v = windowLoudness(voiceSteps, t0, [[a, b]]), m = windowLoudness(bedSteps, t0, [[a, b]]);
    const d = loudnessDifference(v, m);
    return { start: +a.toFixed(3), end: +b.toFixed(3), voice_lufs: r1(v), music_lufs: r1(m), voice_above_music_lu: d === null ? null : r1(d) };
  });
}

/** The lines' margins in a few numbers: the lowest, the median, the
 * highest, and where the lowest is. */
export function marginSummary(lines: LineBalance[]): { lines: number; min_lu: number; median_lu: number; max_lu: number; lowest: { start: number; end: number } } | null {
  const known = lines.filter((l) => l.voice_above_music_lu !== null).sort((x, y) => x.voice_above_music_lu! - y.voice_above_music_lu!);
  if (!known.length) return null;
  const at = (q: number) => known[Math.min(known.length - 1, Math.floor(q * known.length))].voice_above_music_lu!;
  return { lines: known.length, min_lu: known[0].voice_above_music_lu!, median_lu: at(0.5), max_lu: known.at(-1)!.voice_above_music_lu!, lowest: { start: known[0].start, end: known[0].end } };
}

/** How far a line is aimed over the minimum, LU: measurement and the
 * dip's ramps move a line a few tenths. */
export const LINE_AIM_OVER = 0.3;

/**
 * Each line's dip depth (dB) for every line to sit at least `min` LU over
 * the music, from each line's margin as measured with `depths` (null: not
 * measurable, kept as it is): a line short of it dips deeper by what it
 * lacks, a line over it keeps its dip; never under `floor` nor over 40.
 * The music's level falls by the dip's depth while a line plays, so a
 * line's margin grows by as much.
 */
export function lineDepths(depths: number[], margins: (number | null)[], min: number, floor = 0): number[] {
  return depths.map((d, i) => {
    const m = margins[i];
    const want = m === null || m >= min ? d : d + min + LINE_AIM_OVER - m;
    return +Math.min(40, Math.max(floor, want)).toFixed(1);
  });
}

/** Several windows' loudness as one program: energy averaged by length.
 * Silent windows (-Infinity) add length but no energy; all silent is -Infinity. */
export function combinedLoudness(parts: { lufs: number; seconds: number }[]): number {
  const seconds = parts.reduce((n, p) => n + p.seconds, 0);
  const energy = parts.reduce((n, p) => n + (Number.isFinite(p.lufs) ? p.seconds * 10 ** (p.lufs / 10) : 0), 0);
  return seconds > 0 && energy > 0 ? 10 * Math.log10(energy / seconds) : -Infinity;
}
