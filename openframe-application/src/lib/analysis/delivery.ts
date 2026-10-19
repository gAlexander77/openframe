// Delivery: the loudness specs a mix is made for, the loudness report an
// agent reads before delivering (measure_loudness), and the plan export
// follows to meet a target. Integrated loudness is BS.1770's; loudness
// range is EBU Tech 3342's; momentary and short-term maxima are EBU Tech
// 3341's; the peak is the 4x-oversampled true peak (truePeak.ts).

import { gatedLoudness, limiterGains, MAX_LIMITING_DB, normalizeGain, type Normalization } from "./loudness";

export type SpecId = "online" | "ebu_r128" | "atsc_a85";

export interface LoudnessSpec {
  id: SpecId;
  label: string;
  /** Integrated loudness to reach, LUFS (ATSC's LKFS is the same unit). */
  target: number;
  /** LU either side of the target that still passes. */
  tolerance: number;
  /** The highest true peak allowed, dBTP. */
  maxTruePeak: number;
}

/**
 * EBU R128 (2020): -23.0 LUFS, +/-0.5 LU, true peak at most -1 dBTP.
 * ATSC A/85 (2013), the US CALM Act's practice: -24 LKFS, +/-2 dB, at most
 * -2 dBTP (room for the AC-3 encoder). Online is no standard: YouTube,
 * Spotify and TikTok turn louder masters down to about -14 LUFS, and
 * Spotify asks for -1 dBTP; +/-1 LU is our tolerance.
 */
export const LOUDNESS_SPECS: Record<SpecId, LoudnessSpec> = {
  online: { id: "online", label: "Online (YouTube, Spotify, TikTok)", target: -14, tolerance: 1, maxTruePeak: -1 },
  ebu_r128: { id: "ebu_r128", label: "EBU R128 broadcast", target: -23, tolerance: 0.5, maxTruePeak: -1 },
  atsc_a85: { id: "atsc_a85", label: "ATSC A/85 (US TV)", target: -24, tolerance: 2, maxTruePeak: -2 },
};
export const SPEC_IDS = Object.keys(LOUDNESS_SPECS) as SpecId[];

/** The true-peak ceiling for a target no spec claims, dBTP. */
export const DEFAULT_CEILING = -1;

/** The spec a bare LUFS target stands for (-24 is ATSC's), if any. */
export function specForTarget(lufs: number | null | undefined): LoudnessSpec | undefined {
  return SPEC_IDS.map((k) => LOUDNESS_SPECS[k]).find((s) => s.target === lufs);
}

/** The true-peak ceiling export and normalize hold for a target, dBTP. */
export const ceilingFor = (lufs: number | null | undefined) => specForTarget(lufs)?.maxTruePeak ?? DEFAULT_CEILING;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(Math.max(0, meanSquare));

/** Loudness of every `n`-step window, one per 100 ms step (10 Hz, as Tech
 * 3342 asks); a mix shorter than one window is one window. */
function sliding(steps: number[], n: number): number[] {
  if (!steps.length) return [];
  if (steps.length < n) return [toLufs(mean(steps))];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += steps[i];
    if (i >= n) acc -= steps[i - n];
    if (i >= n - 1) out.push(toLufs(acc / n));
  }
  return out;
}

/** Full three-second windows, reported each second; times are window ends. */
export function shortTermSeries(steps: number[]): { end: number; lufs: number }[] {
  if (steps.length < 30) return [];
  return sliding(steps, 30).flatMap((lufs, i) => i % 10 === 0 ? [{ end: (i + 30) / 10, lufs }] : []);
}

/**
 * EBU Tech 3342 loudness range, LU, from short-term (3 s) loudness values:
 * gated at -70 LUFS, then at 20 LU under the power mean of what passed,
 * and the spread between the 10th and 95th percentiles of the rest.
 */
export function loudnessRange(shortTerm: number[]): number {
  const abs = shortTerm.filter((l) => l >= -70);
  if (!abs.length) return 0;
  const gate = 10 * Math.log10(mean(abs.map((l) => 10 ** (l / 10)))) - 20;
  const rel = abs.filter((l) => l >= gate).sort((a, b) => a - b);
  const at = (pct: number) => rel[Math.round(((rel.length - 1) * pct) / 100)];
  return at(95) - at(10);
}

export interface LoudnessStats {
  /** Gated integrated loudness, LUFS; -Infinity for silence. */
  integrated: number;
  /** Loudness range, LU. */
  range: number;
  /** Loudest 3 s, LUFS. */
  shortTermMax: number;
  /** Loudest 400 ms, LUFS. */
  momentaryMax: number;
}

/** The report's loudness figures from a LoudnessMeter's 100 ms steps. */
export function loudnessStats(steps: number[]): LoudnessStats {
  const shortTerm = sliding(steps, 30);
  const momentary = sliding(steps, 4);
  const max = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), -Infinity);
  return { integrated: gatedLoudness(steps), range: loudnessRange(shortTerm), shortTermMax: max(shortTerm), momentaryMax: max(momentary) };
}

export interface SpecCheck {
  spec: SpecId;
  pass: boolean;
  /** Why it fails, one sentence each; empty when it passes. */
  problems: string[];
}

/** Does a mix with this integrated loudness and true peak (dBTP) meet `spec`? */
export function checkSpec(r: { integrated: number; truePeak: number }, spec: LoudnessSpec): SpecCheck {
  const problems: string[] = [];
  if (!Number.isFinite(r.integrated)) problems.push("The mix is silent.");
  else {
    const off = r.integrated - spec.target;
    if (Math.abs(off) > spec.tolerance) problems.push(`Integrated ${r.integrated.toFixed(1)} LUFS is ${Math.abs(off).toFixed(1)} LU ${off > 0 ? "over" : "under"} ${spec.target} (±${spec.tolerance}).`);
  }
  // To the tenth of a dB the report prints: -1.0 meets a -1 ceiling.
  if (Math.round(r.truePeak * 10) / 10 > spec.maxTruePeak) problems.push(`True peak ${r.truePeak.toFixed(1)} dBTP is over ${spec.maxTruePeak} dBTP.`);
  return { spec: spec.id, pass: !problems.length, problems };
}

export interface LoudnessPlan extends Normalization {
  /** The limiter's gain at every LIMIT_BLOCK boundary (limiterGains). */
  gains: Float32Array;
  /** The most the limiter takes off, dB. */
  heldDb: number;
  /** The true-peak ceiling held, dBTP. */
  ceilingDb: number;
}

/**
 * What export does to bring a measured mix to `target` LUFS: a gain, and a
 * limiter on the blocks' true peaks (`blockPeaks`, linear) that holds the
 * raised mix under `ceilingDb` dBTP, taking at most MAX_LIMITING_DB off.
 * Null when the mix is silent, or already at the target under the ceiling.
 */
/** How far under the ceiling the limiter aims, dB. */
const LIMIT_HEADROOM_DB = 0.1;

export function planLoudness(measured: number, truePeak: number, blockPeaks: Float32Array, target: number, ceilingDb: number): LoudnessPlan | null {
  const n = normalizeGain(measured, target, truePeak, { ceilingDb: ceilingDb + MAX_LIMITING_DB });
  const ceiling = 10 ** (ceilingDb / 20);
  if (!Number.isFinite(measured) || (n.gain === 1 && truePeak <= ceiling)) return null;
  // Aim a hair under the ceiling: the limiter works on block peaks, and the
  // file's own 4x true peak can land a few hundredths over (-0.9996 dBTP
  // read as "-1.0 is over -1").
  const gains = limiterGains(blockPeaks, n.gain, ceiling * 10 ** (-LIMIT_HEADROOM_DB / 20));
  const heldDb = -20 * Math.log10(gains.reduce((m, g) => Math.min(m, g), 1));
  return { ...n, gains, heldDb, ceilingDb };
}

/** What the export-complete card says about loudness, and whether it is
 * good news: reaching the target (within 1 LU) is a success to show as one;
 * a mix the peaks or the gain range held short is a warning. */
export interface LoudnessOutcome {
  text: string;
  ok: boolean;
}

/** The outcome of a planLoudness plan, once the mix reached `reached` LUFS. */
export function loudnessOutcome(measured: number, reached: number, target: number, plan: Pick<LoudnessPlan, "limitedBy" | "heldDb" | "ceilingDb">): LoudnessOutcome {
  const ok = Number.isFinite(reached) && Math.abs(reached - target) <= 1;
  const how = plan.limitedBy === "peak" ? `raised as far as ${MAX_LIMITING_DB} dB of limiting allows` : plan.limitedBy === "range" ? "changed as far as it can be" : "normalized";
  const held = plan.heldDb > 0.1 ? ` (a limiter held the peaks under ${plan.ceilingDb} dBTP, at most ${plan.heldDb.toFixed(1)} dB)` : "";
  const short = ok ? "" : `, ${Math.abs(reached - target).toFixed(1)} LU ${reached < target ? "under" : "over"} the ${target} LUFS target`;
  return { text: `Loudness ${measured.toFixed(1)} LUFS, ${how} to ${reached.toFixed(1)} LUFS${held}${short}.`, ok };
}
