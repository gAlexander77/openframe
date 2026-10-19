// What a spoken take sounds like, measured: where the speech starts and
// ends, the pauses inside it, how loud its silences are, and its pitch
// (YIN). The natural finish finds the voice's pauses by them, and the
// naturalness research (docs/research/Natural voiceover 2026-10-19.md)
// compared the voice model's reads with natural ones by them, since no
// model can listen.

/** Energy per 10 ms window, in dBFS (RMS); -120 for digital silence. */
export function envelopeDb(pcm: Float32Array, rate: number): Float32Array {
  const n = Math.max(1, Math.round(rate / 100));
  const out = new Float32Array(Math.ceil(pcm.length / n));
  for (let w = 0; w < out.length; w++) {
    let s = 0;
    const end = Math.min(pcm.length, (w + 1) * n);
    for (let i = w * n; i < end; i++) s += pcm[i] * pcm[i];
    const rms = Math.sqrt(s / Math.max(1, end - w * n));
    out[w] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  return out;
}

export interface Activity {
  /** Seconds from the start of the audio to the first speech. */
  first: number;
  /** Seconds to the end of the last speech. */
  last: number;
  /** Silences inside the speech at least `minPause` long, seconds. */
  pauses: { start: number; end: number }[];
  /** The loud part of the speech (its 90th percentile window), dBFS. */
  speechDb: number;
  /** The quietest tenth of the windows, dBFS (-120: digital silence). */
  floorDb: number;
  /** The threshold windows counted as speech above, dBFS. */
  gateDb: number;
}

const pct = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/**
 * Where a take speaks: 10 ms windows louder than 35 dB under its loud part
 * (and over -60 dBFS) are speech; a run of quieter windows of at least
 * `minPause` seconds between the first and last speech is a pause. A stop
 * consonant's closure is 30-100 ms, so 0.12 s keeps those out.
 */
export function speechActivity(pcm: Float32Array, rate: number, minPause = 0.12): Activity | null {
  const env = envelopeDb(pcm, rate);
  if (!env.length) return null;
  const sorted = Float32Array.from(env).sort();
  const speechDb = pct(sorted, 0.9);
  const floorDb = pct(sorted, 0.1);
  const gateDb = Math.max(speechDb - 35, -60);
  let first = -1, last = -1;
  for (let i = 0; i < env.length; i++) {
    if (env[i] <= gateDb) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first < 0) return null;
  const pauses: { start: number; end: number }[] = [];
  let run = -1;
  for (let i = first; i <= last + 1; i++) {
    const quiet = i <= last && env[i] <= gateDb;
    if (quiet && run < 0) run = i;
    else if (!quiet && run >= 0) {
      if ((i - run) / 100 >= minPause - 1e-9) pauses.push({ start: run / 100, end: i / 100 });
      run = -1;
    }
  }
  return { first: first / 100, last: Math.min(pcm.length / rate, (last + 1) / 100), pauses, speechDb, floorDb, gateDb };
}

/**
 * Where a read dips between phrases: runs of 10 ms windows 28 dB or more
 * under its loud part, inside the speech, that are either 0.12 s long or
 * 0.06 s long and 38 dB down. A voice model's pause at a comma, or at the
 * end of a short sentence, is often a dip of 60-100 ms rather than
 * silence; a stop consonant's closure is shorter or shallower.
 */
export function dips(pcm: Float32Array, rate: number): { start: number; end: number; depthDb: number }[] {
  const a = speechActivity(pcm, rate);
  if (!a) return [];
  const env = envelopeDb(pcm, rate);
  const gate = a.speechDb - 28;
  const out: { start: number; end: number; depthDb: number }[] = [];
  const from = Math.round(a.first * 100), to = Math.round(a.last * 100);
  let run = -1, depth = 0;
  for (let i = from; i <= to; i++) {
    const low = i < to && env[i] <= gate;
    if (low) {
      if (run < 0) {
        run = i;
        depth = env[i];
      }
      depth = Math.min(depth, env[i]);
    } else if (run >= 0) {
      const len = (i - run) / 100;
      if (len >= 0.12 - 1e-9 || (len >= 0.06 - 1e-9 && depth <= a.speechDb - 38)) out.push({ start: run / 100, end: i / 100, depthDb: depth });
      run = -1;
    }
  }
  return out;
}

/**
 * The fundamental frequency every 10 ms by YIN (de Cheveigné and Kawahara,
 * 2002): 40 ms windows, 60-400 Hz, threshold 0.15, parabolic
 * interpolation. 0 where the window is unvoiced or too quiet. `aperiodic`,
 * when given, gets each voiced window's YIN aperiodicity (0 a pure
 * periodic wave; buzz and noise in a voice raise it).
 */
export function pitchTrack(pcm: Float32Array, rate: number, gateDb = -45, aperiodic?: number[]): Float32Array {
  const hop = Math.round(rate / 100);
  const size = Math.round(rate * 0.04);
  const minLag = Math.floor(rate / 400), maxLag = Math.ceil(rate / 60);
  const frames = Math.max(0, Math.floor((pcm.length - size - maxLag) / hop) + 1);
  const out = new Float32Array(frames);
  const d = new Float32Array(maxLag + 1);
  for (let f = 0; f < frames; f++) {
    const at = f * hop;
    let e = 0;
    for (let i = 0; i < size; i++) e += pcm[at + i] * pcm[at + i];
    if (10 * Math.log10(e / size + 1e-12) < gateDb) continue;
    for (let lag = 1; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < size; i++) {
        const x = pcm[at + i] - pcm[at + i + lag];
        s += x * x;
      }
      d[lag] = s;
    }
    // Cumulative mean normalized difference.
    let run = 0, lagAt = -1;
    d[0] = 1;
    for (let lag = 1; lag <= maxLag; lag++) {
      run += d[lag];
      d[lag] = run > 0 ? (d[lag] * lag) / run : 1;
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      if (d[lag] < 0.15) {
        while (lag + 1 <= maxLag && d[lag + 1] < d[lag]) lag++;
        lagAt = lag;
        break;
      }
    }
    if (lagAt < 0) continue;
    const a = d[lagAt - 1], b = d[lagAt], c = lagAt + 1 <= maxLag ? d[lagAt + 1] : b;
    const den = a - 2 * b + c;
    const exact = den > 0 ? lagAt + (a - c) / (2 * den) : lagAt;
    out[f] = rate / exact;
    aperiodic?.push(b);
  }
  return out;
}

export interface PitchStats {
  /** Median of the voiced windows, Hz. */
  medianHz: number;
  /** From the 10th to the 90th percentile, semitones: how much the read
   * moves (natural narration about 4-9, a flat read under 3). */
  rangeSt: number;
  /** Fraction of the windows voiced. */
  voiced: number;
}

export function pitchStats(f0: Float32Array): PitchStats | null {
  const all = Array.from(f0).filter((x) => x > 0).sort((a, b) => a - b);
  if (all.length < 10) return null;
  // An octave error (a window locked on a harmonic or a subharmonic) is
  // not part of the read's melody.
  const mid = pct(all, 0.5);
  const v = all.filter((x) => x > mid / 1.8 && x < mid * 1.8);
  return {
    medianHz: Math.round(pct(v, 0.5)),
    rangeSt: +(12 * Math.log2(pct(v, 0.9) / pct(v, 0.1))).toFixed(1),
    voiced: +(all.length / f0.length).toFixed(2),
  };
}
