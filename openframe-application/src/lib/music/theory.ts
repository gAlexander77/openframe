// Music theory for the score generator (generate_music): keys and modes,
// chords from Roman numerals, voice leading, scale lookups. Pure and
// small, so the arranger (plan.ts) and its tests share one vocabulary.
//
// Pitches are MIDI note numbers (60 = middle C, 69 = A4 = 440 Hz); pitch
// classes are 0..11 from C.

export const PITCH_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const PITCH_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export type Mode = "major" | "minor" | "dorian" | "mixolydian" | "lydian" | "phrygian" | "harmonic_minor";

/** Each mode's scale, semitones above its tonic. */
export const MODES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
};
export const MODE_IDS = Object.keys(MODES) as Mode[];

/** Modes whose third is minor (their keys are spelled from the relative major). */
const MINOR_THIRD = (m: Mode) => MODES[m][2] === 3;

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const pc = (n: number) => ((n % 12) + 12) % 12;

/** A key's tonic as a pitch class: "C", "f#", "Bb", "Eb minor" (the
 * mode word is ignored here). Throws on anything else. */
export function parseKey(key: string): number {
  const m = /^\s*([A-Ga-g])\s*([#♯b♭]?)/.exec(key);
  if (!m) throw new Error(`Unknown key "${key}": use a note name such as C, F#, Bb`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as "C"];
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return pc(base + acc);
}

/** Whether a key reads with flats (F, Bb, Eb... and their relative minors). */
export function usesFlats(tonic: number, mode: Mode): boolean {
  const major = MINOR_THIRD(mode) ? pc(tonic + 3) : tonic;
  return [5, 10, 3, 8, 1, 6].includes(major);
}

export const pitchName = (p: number, flats: boolean) => (flats ? PITCH_FLAT : PITCH_SHARP)[pc(p)];

/** A key's name, e.g. "F# minor". */
export const keyName = (tonic: number, mode: Mode) => `${pitchName(tonic, usesFlats(tonic, mode))} ${mode.replace("_", " ")}`;

/** The scale's pitch classes from the tonic. */
export const scalePcs = (tonic: number, mode: Mode) => MODES[mode].map((s) => pc(tonic + s));

export const inScale = (midi: number, tonic: number, mode: Mode) => scalePcs(tonic, mode).includes(pc(midi));

/** Every scale note in [low, high], ascending. */
export function scaleNotes(tonic: number, mode: Mode, low: number, high: number): number[] {
  const pcs = scalePcs(tonic, mode);
  const out: number[] = [];
  for (let n = low; n <= high; n++) if (pcs.includes(pc(n))) out.push(n);
  return out;
}

export interface Chord {
  /** The numeral as written ("vi7", "bVII", "IVadd9"). */
  roman: string;
  /** Root pitch class. */
  root: number;
  /** Semitones above the root, ascending, the root (0) first. */
  tones: number[];
  /** Its name in the key, e.g. "Am7", "Fmaj7", "Gsus4". */
  name: string;
}

const NUMERALS = ["vii", "iii", "vi", "iv", "ii", "v", "i"];
const DEGREE: Record<string, number> = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };

/**
 * A chord from a Roman numeral in a key: the numeral counts degrees of the
 * tonic's MAJOR scale whatever the mode, and a b or # before it moves the
 * root, as pop and film charts write them (in A minor, i-bVI-bIII-bVII is
 * Am F C G; bVII in C major is Bb). The mode only spells the name. Case
 * gives the triad (upper major, lower minor),
 * then any of: ° or dim, + (augmented), 5 (power chord), sus2, sus4, 6, 7
 * (a minor seventh), maj7, 9 (seventh and ninth), maj9, add9.
 */
export function chordFromRoman(roman: string, tonic: number, mode: Mode): Chord {
  const m = /^([b#]?)([ivIV]+)(.*)$/.exec(roman.trim());
  const numeral = m?.[2].toLowerCase();
  if (!m || !numeral || !(numeral in DEGREE) || !NUMERALS.includes(numeral)) throw new Error(`Unknown chord numeral "${roman}"`);
  const upper = m[2] === m[2].toUpperCase();
  let rest = m[3];
  const root = pc(tonic + MODES.major[DEGREE[numeral]] + (m[1] === "b" ? -1 : m[1] === "#" ? 1 : 0));
  let tones = upper ? [0, 4, 7] : [0, 3, 7];
  let suffix = upper ? "" : "m";
  const take = (s: string) => (rest.startsWith(s) ? ((rest = rest.slice(s.length)), true) : false);
  if (take("°") || take("dim")) [tones, suffix] = [[0, 3, 6], "dim"];
  else if (take("+")) [tones, suffix] = [[0, 4, 8], "aug"];
  while (rest) {
    if (take("maj9")) [tones, suffix] = [[...tones, 11, 14], suffix === "m" ? "m(maj9)" : "maj9"];
    else if (take("maj7")) [tones, suffix] = [[...tones, 11], suffix === "m" ? "m(maj7)" : "maj7"];
    else if (take("add9")) [tones, suffix] = [[...tones, 14], `${suffix}add9`];
    else if (take("sus2")) [tones, suffix] = [[0, 2, ...tones.filter((t) => t !== 3 && t !== 4 && t !== 0)], "sus2"];
    else if (take("sus4")) [tones, suffix] = [[0, 5, ...tones.filter((t) => t !== 3 && t !== 4 && t !== 0)], "sus4"];
    else if (take("9")) [tones, suffix] = [[...tones, 10, 14], `${suffix}9`];
    else if (take("7")) [tones, suffix] = [[...tones, 10], `${suffix}7`];
    else if (take("6")) [tones, suffix] = [[...tones, 9], `${suffix}6`];
    else if (take("5")) [tones, suffix] = [[0, 7], "5"];
    else throw new Error(`Unknown chord numeral "${roman}"`);
  }
  tones = [...new Set(tones)].sort((a, b) => a - b);
  return { roman, root, tones, name: pitchName(root, usesFlats(tonic, mode)) + suffix };
}

/** Pitch classes of a chord. */
export const chordPcs = (c: Chord) => c.tones.map((t) => pc(c.root + t));

/** Whether every tone of the chord is in the key's scale. */
export const fitsMode = (c: Chord, tonic: number, mode: Mode) => chordPcs(c).every((p) => scalePcs(tonic, mode).includes(p));

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/**
 * The diatonic triad on scale degree `degree` (0-based) of the mode, as a
 * numeral chordFromRoman reads (its accidental against the major scale):
 * the fallback when no progression of a style suits the mode asked for.
 */
export function diatonicNumeral(degree: number, mode: Mode): string {
  const s = MODES[mode];
  const at = (k: number) => s[(degree + k) % 7] + 12 * Math.floor((degree + k) / 7);
  const third = at(2) - at(0), fifth = at(4) - at(0);
  const shift = s[degree] - MODES.major[degree];
  const acc = shift < 0 ? "b" : shift > 0 ? "#" : "";
  const n = third === 4 ? ROMAN[degree] : ROMAN[degree].toLowerCase();
  return acc + n + (fifth === 6 ? "°" : fifth === 8 ? "+" : "");
}

/**
 * The ways to give a chord's tones to `n` voices, each with a penalty:
 * every tone once, the fifth dropped first when there are too many (then
 * the root: the bass has it); when there are too few, a tone doubled, the
 * root freely, the fifth or another tone at a small cost.
 */
function toneSets(c: Chord, n: number): { pcs: number[]; cost: number }[] {
  let t = [...c.tones];
  for (const drop of [7, 0, 14]) if (t.length > n && t.includes(drop)) t = t.filter((x) => x !== drop);
  while (t.length > n) t.pop();
  const sets: { tones: number[]; cost: number }[] = [{ tones: t, cost: 0 }];
  while (sets[0].tones.length < n) {
    const next: { tones: number[]; cost: number }[] = [];
    for (const s of sets) for (const d of c.tones) next.push({ tones: [...s.tones, d], cost: s.cost + (d === 0 ? 0 : d === 7 ? 1 : 2) });
    sets.splice(0, sets.length, ...next);
  }
  const seen = new Set<string>();
  return sets
    .map((s) => ({ pcs: s.tones.map((x) => pc(c.root + x)).sort((x, y) => x - y), cost: s.cost }))
    .sort((x, y) => x.cost - y.cost)
    .filter((s) => (seen.has(s.pcs.join()) ? false : (seen.add(s.pcs.join()), true)));
}

export interface VoicingOptions {
  /** Voices in the upper structure (3..5). */
  voices: number;
  /** Lowest and highest MIDI note any voice may take. */
  low: number;
  high: number;
  /** Where the voicing should sit (MIDI), so it does not drift over a song. */
  center?: number;
}

/**
 * Voice-led upper structure for `c`: of every way to place its tones in
 * [low, high] (no two voices on one note, no gap over an octave between
 * neighbors, a span of at most two octaves), the one that moves least
 * from `prev` (each voice to its nearest, summed in semitones), held near
 * `center`. Without `prev`, the most open voicing nearest the center.
 */
export function voiceLead(prev: number[] | null, c: Chord, o: VoicingOptions): number[] {
  const center = o.center ?? (o.low + o.high) / 2;
  let best: number[] = [];
  let bestCost = Infinity;
  for (const set of toneSets(c, o.voices)) {
    const pcs = set.pcs;
    const pick: number[] = [];
    const walk = (i: number) => {
      if (i === pcs.length) {
        const v = [...pick].sort((a, b) => a - b);
        for (let k = 1; k < v.length; k++) if (v[k] === v[k - 1] || v[k] - v[k - 1] > 12) return;
        if (v[v.length - 1] - v[0] > 24) return;
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        // Seconds between voices rub; allowed (add9), but costed.
        let rub = 0;
        for (let k = 1; k < v.length; k++) if (v[k] - v[k - 1] === 1) rub += 3;
        let cost = set.cost + rub + 0.35 * Math.abs(mean - center);
        if (prev && prev.length === v.length) cost += v.reduce((s, x, k) => s + Math.abs(x - prev[k]), 0);
        else cost += 0.5 * Math.abs(v[v.length - 1] - v[0] - 14);
        if (cost < bestCost - 1e-9) [best, bestCost] = [v, cost];
        return;
      }
      for (let n = o.low; n <= o.high; n++) {
        if (pc(n) !== pcs[i]) continue;
        pick.push(n);
        walk(i + 1);
        pick.pop();
      }
    };
    walk(0);
  }
  if (!best.length) throw new Error(`No voicing of ${c.name} in ${o.low}..${o.high}`);
  return best;
}

/** The chord's root as a bass note in [low, high], nearest `prev` (the
 * line moves by the smaller step), else at the bottom of the range. */
export function bassNote(c: Chord, prev: number | null, low: number, high: number): number {
  const cands: number[] = [];
  for (let n = low; n <= high; n++) if (pc(n) === c.root) cands.push(n);
  if (!cands.length) return low + pc(c.root - low);
  const ref = prev ?? low + 4;
  return cands.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
}

/** The scale note in [low, high] nearest `target`, ties up. */
export function nearestIn(notes: number[], target: number): number {
  let best = notes[0];
  for (const n of notes) if (Math.abs(n - target) < Math.abs(best - target) || (Math.abs(n - target) === Math.abs(best - target) && n > best)) best = n;
  return best;
}
