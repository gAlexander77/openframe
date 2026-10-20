// What preview_audio says about the sound it hands an agent (ADR-098): a
// model that cannot take audio still gets the figures a mixer reads off
// its meters, compactly. Loudness as BS.1770 meters it (integrated, the
// loudest 3 s and 400 ms, each second's), the true peak, where it falls
// silent, where its energy sits (below 250 Hz, to 4 kHz, above; the octave
// slope) and how wide it is (the sides' correlation).

import { LoudnessMeter } from "./loudness";
import { loudnessStats } from "./delivery";
import { toDbtp, truePeak } from "./truePeak";
import { balance, stats } from "../music/measure";

export interface AuditionSummary {
  seconds: number;
  integrated_lufs: number | null;
  short_term_max_lufs: number | null;
  momentary_max_lufs: number | null;
  true_peak_dbtp: number | null;
  /** Each whole second's loudness, LUFS (null: silent), from the start. */
  per_second_lufs: (number | null)[];
  /** Stretches under -60 LUFS for half a second or more, in timeline seconds. */
  silent: [number, number][];
  /** Shares of the power below 250 Hz, 250 Hz to 4 kHz and above. */
  spectrum: { low: number; mid: number; high: number; slope_db_per_octave: number };
  /** 1 mono, near 0 wide, below 0 out of phase. */
  correlation: number;
  /** Samples at or past full scale. */
  clipped: number;
  /** Where the sound drops out for a few milliseconds inside sound
   * (timeline seconds; absent when nowhere): a lost packet, a hole. */
  dropouts?: number[];
}

/** A dropout: 3 to 100 ms under -80 dBFS with sound (over -40 dBFS RMS)
 * in the 50 ms either side (a longer silence is a pause, or `silent`). Music and speech never fall that far, that
 * briefly: the film test's MP3 song lost 12-26 ms at every 10 s render
 * window (ADR-104). */
export function dropouts(L: Float32Array, R: Float32Array, rate: number, start = 0, max = 20): number[] {
  const out: number[] = [];
  const floor = 1e-4, side = Math.round(0.05 * rate), least = Math.round(0.003 * rate), most = Math.round(0.1 * rate);
  const level = (a: number, b: number) => {
    a = Math.max(0, a);
    b = Math.min(L.length, b);
    let s = 0;
    for (let i = a; i < b; i++) s += ((L[i] + R[i]) / 2) ** 2;
    return b > a ? Math.sqrt(s / (b - a)) : 0;
  };
  let run = -1;
  for (let i = 0; i <= L.length && out.length < max; i++) {
    const low = i < L.length && Math.abs((L[i] + R[i]) / 2) < floor;
    if (low && run < 0) run = i;
    if (!low && run >= 0) {
      if (i - run >= least && i - run <= most && run >= side && i + side <= L.length && level(run - side, run) > 0.01 && level(i, i + side) > 0.01) out.push(+(start + run / rate).toFixed(3));
      run = -1;
    }
  }
  return out;
}

const lufsOf = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
const r1 = (x: number) => (Number.isFinite(x) ? +x.toFixed(1) : null);

/** The summary of stereo `L`, `R` at `rate`, which starts at timeline second `start`. */
export function auditionSummary(L: Float32Array, R: Float32Array, rate: number, start = 0): AuditionSummary {
  const meter = new LoudnessMeter(rate, 2);
  meter.push([L, R], L.length);
  const st = loudnessStats(meter.steps);
  const steps = meter.steps;
  const perSecond: (number | null)[] = [];
  for (let s = 0; s + 10 <= steps.length; s += 10) {
    const ms = steps.slice(s, s + 10).reduce((a, b) => a + b, 0) / 10;
    perSecond.push(ms > 0 && lufsOf(ms) > -70 ? r1(lufsOf(ms)) : null);
  }
  // Silence: 100 ms steps under -60 LUFS, in runs of five or more.
  const silent: [number, number][] = [];
  let run = -1;
  for (let i = 0; i <= steps.length; i++) {
    const quiet = i < steps.length && !(steps[i] > 0 && lufsOf(steps[i]) > -60);
    if (quiet && run < 0) run = i;
    if (!quiet && run >= 0) {
      if (i - run >= 5) silent.push([+(start + run / 10).toFixed(1), +(start + i / 10).toFixed(1)]);
      run = -1;
    }
  }
  const b = L.length >= 8192 ? balance(L, R, rate) : null;
  const holes = dropouts(L, R, rate, start);
  const s = stats(L, R);
  return {
    seconds: +(L.length / rate).toFixed(3),
    integrated_lufs: r1(st.integrated),
    short_term_max_lufs: r1(st.shortTermMax),
    momentary_max_lufs: r1(st.momentaryMax),
    true_peak_dbtp: r1(toDbtp(truePeak([L, R]))),
    per_second_lufs: perSecond,
    silent,
    spectrum: b ? { low: +b.low.toFixed(3), mid: +b.mid.toFixed(3), high: +b.high.toFixed(3), slope_db_per_octave: b.slope } : { low: 0, mid: 0, high: 0, slope_db_per_octave: 0 },
    correlation: Number.isFinite(s.correlation) ? s.correlation : 0,
    clipped: s.clipped,
    ...(holes.length ? { dropouts: holes } : {}),
  };
}
