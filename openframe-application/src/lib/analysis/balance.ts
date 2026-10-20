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
 * Each line's dip depth (dB) for every line to sit at least `min` and at
 * most `max` LU over the music, from each line's margin as measured with
 * `depths` (null: not measurable, kept as it is): a line short of the
 * minimum dips deeper by what it lacks, never under `floor`; a line past
 * the ceiling dips less by what it has too much, down to no dip at all
 * (the music is never raised); a line between keeps its dip. Never over
 * 40. The music's level falls by the dip's depth while a line plays, so a
 * line's margin moves by as much.
 */
export function lineDepths(depths: number[], margins: (number | null)[], min: number | undefined, floor = 0, max?: number): number[] {
  return depths.map((d, i) => {
    const m = margins[i];
    if (m !== null && min !== undefined && m < min) return +Math.min(40, Math.max(floor, d + min + LINE_AIM_OVER - m)).toFixed(1);
    if (m !== null && max !== undefined && m > max) return +Math.min(40, Math.max(0, d - (m - max + LINE_AIM_OVER))).toFixed(1);
    return d;
  });
}

/**
 * Each line's dip for the lines together to sit `target` LU over the music
 * in the speech window (measured at `speech` with `depths`) and each line
 * between `min` and `max` (lineDepths): every line moves by what the
 * speech window is off, then the bounds hold. The ceiling alone (ADR-104)
 * held the line over a quiet intro back, which lifted the lines together
 * 0.9 LU over their target, and duck_under_speech answered met false.
 */
export function aimDepths(depths: number[], margins: (number | null)[], o: { target?: number; speech?: number | null; min?: number; max?: number; floor?: number }): number[] {
  const off = o.target !== undefined && o.speech !== undefined && o.speech !== null && Math.abs(o.target - o.speech) > 0.5 ? o.target - o.speech : 0;
  if (!off) return lineDepths(depths, margins, o.min, o.floor ?? 0, o.max);
  const moved = depths.map((d) => +Math.min(40, Math.max(0, d + off)).toFixed(1));
  return lineDepths(moved, margins.map((m, i) => (m === null ? null : m + moved[i] - depths[i])), o.min, 0, o.max);
}

/**
 * The most a line sits over the music when duck_under_speech is not told
 * (max_line_lu): 15 LU, the top of the 10-15 a promo's voice sits over
 * its music, or 3 over the speech target or the minimum asked when either
 * is higher. One depth for every line (the speech target's) emptied the
 * film test's quiet intro and its outro's last hit: lines 16.7 and 18.7 LU
 * over. A line past it dips less.
 */
export const LINE_CEILING_LU = 15;

/**
 * What is wrong with duck_under_speech's targets, or undefined: each 0-30
 * LU, a ceiling at least 1 LU over the minimum, and not under the speech
 * window's target. Every line at most `max` over the music puts the lines
 * together at most `max` over it, so a target over the ceiling could never
 * be met: it was measured four times over and answered met false.
 */
export function duckTargetsError(target?: number, min?: number, max?: number): string | undefined {
  for (const [name, v] of [["voice_above_music_lu", target], ["min_line_lu", min], ["max_line_lu", max]] as const)
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 30)) return `${name} must be between 0 and 30 LU.`;
  if (max !== undefined && min !== undefined && max < min + 1) return "max_line_lu must be at least 1 LU over min_line_lu.";
  if (max !== undefined && target !== undefined && max < target) return `max_line_lu (${max}) is under voice_above_music_lu (${target}): with every line at most ${max} LU over the music, the lines together cannot sit ${target} over it. Raise max_line_lu or lower the target.`;
  return undefined;
}
export function lineCeiling(target?: number, min?: number): number {
  return Math.max(LINE_CEILING_LU, (target ?? 0) + 3, (min ?? 0) + 3);
}

/** Several windows' loudness as one program: energy averaged by length.
 * Silent windows (-Infinity) add length but no energy; all silent is -Infinity. */
export function combinedLoudness(parts: { lufs: number; seconds: number }[]): number {
  const seconds = parts.reduce((n, p) => n + p.seconds, 0);
  const energy = parts.reduce((n, p) => n + (Number.isFinite(p.lufs) ? p.seconds * 10 ** (p.lufs / 10) : 0), 0);
  return seconds > 0 && energy > 0 ? 10 * Math.log10(energy / seconds) : -Infinity;
}
