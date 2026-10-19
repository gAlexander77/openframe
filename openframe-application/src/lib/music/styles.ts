// The score generator's five styles, as data: tempo, key, feel, chord
// progressions, drum patterns, which parts play in which kind of section,
// and the mix. The numbers follow how professional tracks of each kind are
// built (docs/research/Music generation 2026-10-19.md); the arranger
// (arrange.ts) and the renderer (render.ts) read them.

import type { Mode } from "./theory";

export type StyleId = "launch" | "cinematic" | "corporate" | "lofi" | "ambient";

/** What a section does in the piece; any name maps to one (roleOf). */
export type Role = "intro" | "verse" | "build" | "drop" | "breakdown" | "outro";

/** Every sound the arranger writes. Each belongs to one stem. */
export type Part =
  | "kick" | "snare" | "clap" | "rim" | "hat" | "openhat" | "shaker" | "tom" | "taiko" | "crash" | "roll"
  | "riser" | "impact" | "revcymbal" | "downlifter" | "braam" | "vinyl"
  | "sub" | "bass"
  | "pad" | "keys" | "piano" | "pluck" | "arp" | "strings" | "ostinato" | "brass" | "choir"
  | "lead" | "bell" | "counter";

export type Stem = "drums" | "bass" | "harmony" | "lead";
export const STEMS: Stem[] = ["drums", "bass", "harmony", "lead"];

export const STEM_OF: Record<Part, Stem> = {
  kick: "drums", snare: "drums", clap: "drums", rim: "drums", hat: "drums", openhat: "drums", shaker: "drums", tom: "drums", taiko: "drums", crash: "drums", roll: "drums",
  riser: "drums", impact: "drums", revcymbal: "drums", downlifter: "drums", braam: "drums", vinyl: "drums",
  sub: "bass", bass: "bass",
  pad: "harmony", keys: "harmony", piano: "harmony", pluck: "harmony", arp: "harmony", strings: "harmony", ostinato: "harmony", brass: "harmony", choir: "harmony",
  lead: "lead", bell: "lead", counter: "lead",
};

/** A bar of 16 steps; each number is a hit's velocity (0 for none). */
export type Steps = number[];

const s16 = (hits: Record<number, number>): Steps => Array.from({ length: 16 }, (_, i) => hits[i] ?? 0);

export interface DrumKit {
  /** Full groove (drop, chorus). */
  full: Partial<Record<Part, Steps>>;
  /** A lighter groove (verse, the first half of a build). */
  light: Partial<Record<Part, Steps>>;
}

export interface StyleSpec {
  label: string;
  /** One line for the tool's description and the UI. */
  blurb: string;
  bpm: number;
  /** The range the tempo may be set in. */
  bpmRange: [number, number];
  key: string;
  mode: Mode;
  /** The share of a pair of steps the first takes: 0.5 straight, 0.6 a lazy
   * swing (an MPC's 60%). `unit` is the swung step: 16ths or 8ths. */
  swing: { amount: number; unit: 8 | 16 };
  /** Random timing (seconds) and velocity (fraction) per hit: the hands. */
  humanize: { time: number; vel: number };
  /** Progressions in the major-scale numerals of chordFromRoman (b for a
   * lowered degree), for keys with a major third and with a minor one. */
  progressions: { major: string[][]; minor: string[][] };
  /** Bars each chord lasts (two in slow styles). */
  chordBars: 1 | 2;
  /** The upper structure's voices and range (MIDI). */
  voicing: { voices: number; low: number; high: number };
  /** The bass line's range (MIDI). */
  bassRange: [number, number];
  /** The hook's range (MIDI) and rhythm cells: [start, length] in 16ths
   * across two bars (32 steps), one picked per seed. */
  hook: { low: number; high: number; rhythms: [number, number][][] };
  drums: DrumKit;
  /** The parts that play in each kind of section (fills, risers and hits
   * are added at the joins). */
  roles: Record<Role, Part[]>;
  /** Each part's level (linear, before the master) and reverb send. */
  mix: Partial<Record<Part, { gain: number; send?: number; pan?: number }>>;
  reverb: { decay: number; size: number };
  /** Each stem's loudness in the drops, LU against the loudest stem: the
   * mix's balance, measured and set after the stems are rendered. */
  balance: Record<Stem, number>;
  /** dB each stem ducks under the kick in a drop (sidechain pumping). */
  sidechain: Partial<Record<Stem, number>>;
  /** The pad's low-pass in Hz at energy 0 and 1. */
  padCutoff: [number, number];
  /** The master's coloring: a low-pass (Hz), tape wow (cents), saturation. */
  color: { lowpass?: number; wow?: number; drive?: number; crackle?: number };
  /** The master's tilt when generate_music names no brightness (-1..1,
   * render.ts tilt): where the measured balance asked for it. */
  brightness?: number;
  /** Beats of silence before a drop (the breath), 0 for none. */
  breath: number;
}

// ---- the styles ------------------------------------------------------------------

export const STYLES: Record<StyleId, StyleSpec> = {
  // Future-bass / electro-pop launch: four on the floor, a supersaw pad that
  // pumps, a sub and an offbeat mid bass, a 16th arp and a bright hook.
  launch: {
    label: "Product launch",
    // A 68 s score in the film's form measured 71% of its power below
    // 250 Hz and 1.3% above 4 kHz untilted, darker than the hand-made
    // track it imitates (63%, 2.7%); 0.4 lands at 65% and 2.5%.
    brightness: 0.4,
    blurb: "modern electronic, driving: four on the floor, pumping supersaw pad, sub bass, arp and a bright hook",
    bpm: 120,
    bpmRange: [100, 140],
    key: "A",
    mode: "minor",
    swing: { amount: 0.52, unit: 16 },
    humanize: { time: 0.002, vel: 0.06 },
    progressions: {
      minor: [["iadd9", "bVImaj7", "bIIIadd9", "bVII"], ["i", "bVII", "bVI", "bVII"], ["bVImaj7", "bVII", "iadd9", "i"], ["i", "iv7", "bVImaj7", "bVII"]],
      major: [["vi", "IVmaj7", "Iadd9", "V"], ["Iadd9", "V", "vi7", "IVmaj7"], ["IVmaj7", "Iadd9", "V", "vi"]],
    },
    chordBars: 1,
    voicing: { voices: 5, low: 50, high: 79 },
    bassRange: [28, 43],
    hook: {
      low: 64,
      high: 86,
      rhythms: [
        // 3-3-2 dotted eighths, the modern pop hook rhythm
        [[0, 3], [3, 3], [6, 2], [8, 2], [10, 2], [12, 4], [16, 3], [19, 3], [22, 2], [24, 4], [28, 2], [30, 2]],
        [[0, 2], [2, 2], [4, 3], [7, 3], [10, 2], [12, 4], [16, 2], [18, 2], [20, 3], [23, 3], [26, 6]],
        [[0, 4], [4, 2], [6, 2], [8, 3], [11, 3], [14, 2], [16, 4], [20, 2], [22, 2], [24, 8]],
      ],
    },
    drums: {
      full: {
        kick: s16({ 0: 1, 4: 1, 8: 1, 12: 1 }),
        clap: s16({ 4: 1, 12: 1 }),
        hat: s16({ 0: 0.6, 1: 0.35, 3: 0.5, 4: 0.6, 5: 0.35, 7: 0.5, 8: 0.6, 9: 0.35, 11: 0.5, 12: 0.6, 13: 0.35, 15: 0.5 }),
        openhat: s16({ 2: 0.8, 6: 0.8, 10: 0.8, 14: 0.8 }),
      },
      light: {
        kick: s16({ 0: 1, 4: 1, 8: 1, 12: 1 }),
        hat: s16({ 2: 0.6, 6: 0.6, 10: 0.6, 14: 0.6 }),
      },
    },
    roles: {
      intro: ["pad", "pluck", "hat"],
      verse: ["kick", "hat", "clap", "sub", "pad", "arp", "pluck"],
      build: ["kick", "hat", "pad", "arp", "roll", "riser"],
      drop: ["kick", "clap", "hat", "openhat", "sub", "bass", "pad", "arp", "lead"],
      breakdown: ["pad", "pluck", "riser"],
      outro: ["pad", "pluck"],
    },
    mix: {
      kick: { gain: 0.9 }, clap: { gain: 0.55, send: 0.25 }, hat: { gain: 0.1, pan: -0.2 }, openhat: { gain: 0.12, pan: 0.15 }, roll: { gain: 0.32, send: 0.3 },
      crash: { gain: 0.22, send: 0.3 }, riser: { gain: 0.24, send: 0.3 }, impact: { gain: 0.6, send: 0.35 }, revcymbal: { gain: 0.2, send: 0.2 }, downlifter: { gain: 0.18, send: 0.4 },
      sub: { gain: 0.42 }, bass: { gain: 0.24 },
      pad: { gain: 0.085, send: 0.25 }, arp: { gain: 0.1, send: 0.3 }, pluck: { gain: 0.22, send: 0.45 },
      lead: { gain: 0.17, send: 0.3 },
    },
    reverb: { decay: 2.2, size: 0.6 },
    balance: { drums: 0, bass: -5, harmony: -5, lead: -3 },
    sidechain: { harmony: 6, bass: 6, lead: 1.5 },
    padCutoff: [700, 9000],
    color: {},
    breath: 0.5,
  },

  // Hybrid trailer: legato strings and horns, a 16th string ostinato,
  // taiko and toms, braams and hits on the climax, long halls.
  cinematic: {
    label: "Cinematic",
    blurb: "big and swelling: string ostinato, legato strings and horns, choir, taiko and big hits, long hall reverb",
    bpm: 90,
    bpmRange: [70, 120],
    key: "D",
    mode: "minor",
    swing: { amount: 0.5, unit: 16 },
    humanize: { time: 0.004, vel: 0.08 },
    progressions: {
      minor: [["i", "bVI", "bIII", "bVII"], ["i", "bVI", "iv", "bVII"], ["bVI", "bVII", "i", "i"], ["i", "bVII", "bVI", "bVII"]],
      major: [["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["I", "iii", "vi", "IV"]],
    },
    chordBars: 1,
    voicing: { voices: 4, low: 50, high: 74 },
    bassRange: [26, 41],
    hook: {
      low: 62,
      high: 81,
      rhythms: [
        [[0, 6], [6, 2], [8, 8], [16, 4], [20, 4], [24, 8]],
        [[0, 8], [8, 4], [12, 4], [16, 12], [28, 4]],
        [[0, 4], [4, 4], [8, 4], [12, 4], [16, 16]],
      ],
    },
    drums: {
      full: {
        taiko: s16({ 0: 1, 4: 0.7, 8: 0.95, 12: 0.7, 14: 0.45 }),
        tom: s16({ 0: 0.5, 1: 0.18, 2: 0.32, 3: 0.18, 4: 0.5, 5: 0.18, 6: 0.32, 7: 0.18, 8: 0.5, 9: 0.18, 10: 0.32, 11: 0.18, 12: 0.55, 13: 0.22, 14: 0.4, 15: 0.3 }),
        snare: s16({ 8: 1 }),
      },
      light: {
        taiko: s16({ 0: 0.9, 4: 0.5, 8: 0.7, 12: 0.5 }),
        tom: s16({ 0: 0.4, 4: 0.3, 6: 0.22, 8: 0.4, 12: 0.3, 14: 0.25 }),
      },
    },
    roles: {
      intro: ["strings", "piano", "choir"],
      verse: ["strings", "ostinato", "taiko", "sub", "piano"],
      // The build is the ostinato and a rising roll over the strings; the
      // choir, horns, toms and the full kit wait for the climax.
      build: ["strings", "ostinato", "taiko", "riser", "roll"],
      drop: ["strings", "ostinato", "brass", "choir", "taiko", "tom", "snare", "sub", "lead"],
      breakdown: ["strings", "piano", "choir"],
      outro: ["strings", "piano", "choir"],
    },
    mix: {
      taiko: { gain: 0.7, send: 0.35 }, tom: { gain: 0.3, send: 0.35, pan: 0.2 }, snare: { gain: 0.42, send: 0.45 }, roll: { gain: 0.3, send: 0.45 },
      crash: { gain: 0.2, send: 0.4 }, riser: { gain: 0.22, send: 0.4 }, impact: { gain: 0.7, send: 0.5 }, revcymbal: { gain: 0.2, send: 0.3 }, braam: { gain: 0.32, send: 0.45 }, downlifter: { gain: 0.16, send: 0.5 },
      sub: { gain: 0.3 },
      strings: { gain: 0.1, send: 0.45 }, ostinato: { gain: 0.11, send: 0.35 }, brass: { gain: 0.11, send: 0.45 }, choir: { gain: 0.055, send: 0.55 }, piano: { gain: 0.2, send: 0.5 },
      lead: { gain: 0.12, send: 0.45 },
    },
    reverb: { decay: 3.6, size: 0.85 },
    balance: { drums: 0, bass: -7, harmony: -0.5, lead: -3 },
    sidechain: {},
    padCutoff: [900, 7000],
    color: {},
    breath: 1,
  },

  // "Inspiring corporate": piano eighths, a plucked strum, glockenspiel
  // hook, claps and shaker, four on the floor in the chorus.
  corporate: {
    label: "Upbeat corporate",
    blurb: "bright and positive: piano eighths, plucked guitar strums, glockenspiel hook, claps, shaker and an eighth-note bass",
    bpm: 116,
    bpmRange: [95, 135],
    key: "C",
    mode: "major",
    swing: { amount: 0.5, unit: 16 },
    humanize: { time: 0.003, vel: 0.07 },
    progressions: {
      major: [["I", "V", "vi", "IV"], ["IVadd9", "I", "V", "vi"], ["I", "vi", "IV", "V"], ["vi", "IV", "Iadd9", "Vsus4"]],
      minor: [["i", "bVI", "bIII", "bVII"], ["bVI", "bVII", "i", "i"]],
    },
    chordBars: 1,
    voicing: { voices: 4, low: 52, high: 76 },
    bassRange: [33, 47],
    hook: {
      low: 69,
      high: 91,
      rhythms: [
        [[0, 2], [2, 2], [4, 2], [6, 4], [10, 2], [12, 4], [16, 2], [18, 2], [20, 2], [22, 4], [26, 6]],
        [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4], [16, 3], [19, 3], [22, 2], [24, 8]],
        [[2, 2], [4, 2], [6, 2], [8, 6], [14, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
      ],
    },
    drums: {
      full: {
        kick: s16({ 0: 1, 4: 0.9, 8: 1, 12: 0.9 }),
        clap: s16({ 4: 1, 12: 1 }),
        shaker: s16({ 0: 0.5, 1: 0.3, 2: 0.7, 3: 0.35, 4: 0.5, 5: 0.3, 6: 0.7, 7: 0.35, 8: 0.5, 9: 0.3, 10: 0.7, 11: 0.35, 12: 0.5, 13: 0.3, 14: 0.7, 15: 0.35 }),
        hat: s16({ 2: 0.6, 6: 0.6, 10: 0.6, 14: 0.6 }),
      },
      light: {
        kick: s16({ 0: 1, 8: 0.9 }),
        clap: s16({ 4: 0.8, 12: 0.8 }),
        shaker: s16({ 0: 0.4, 2: 0.6, 4: 0.4, 6: 0.6, 8: 0.4, 10: 0.6, 12: 0.4, 14: 0.6 }),
      },
    },
    roles: {
      intro: ["piano", "pluck", "bell"],
      verse: ["kick", "shaker", "bass", "piano", "pluck"],
      build: ["kick", "piano", "strings", "roll", "riser"],
      drop: ["kick", "clap", "shaker", "hat", "bass", "piano", "pluck", "strings", "lead", "bell"],
      breakdown: ["piano", "strings", "bell"],
      outro: ["piano", "pluck", "strings"],
    },
    mix: {
      kick: { gain: 0.75 }, clap: { gain: 0.5, send: 0.25 }, shaker: { gain: 0.12, pan: 0.35 }, hat: { gain: 0.13, pan: -0.25 }, roll: { gain: 0.28, send: 0.3 },
      crash: { gain: 0.18, send: 0.25 }, riser: { gain: 0.16, send: 0.3 }, impact: { gain: 0.35, send: 0.3 }, revcymbal: { gain: 0.16, send: 0.2 },
      bass: { gain: 0.3 },
      piano: { gain: 0.24, send: 0.25 }, pluck: { gain: 0.2, send: 0.2 }, strings: { gain: 0.065, send: 0.35 },
      lead: { gain: 0.11, send: 0.3 }, counter: { gain: 0.08, send: 0.3 }, bell: { gain: 0.05, send: 0.35 },
    },
    reverb: { decay: 1.8, size: 0.5 },
    balance: { drums: 0, bass: -5, harmony: -1.5, lead: -4.5 },
    sidechain: { harmony: 2.5, bass: 3 },
    padCutoff: [1500, 8000],
    color: {},
    breath: 0,
  },

  // Lo-fi hip hop: a lazy swung boom-bap, Rhodes sevenths and ninths, a
  // round bass on the kick, a sparse melody, vinyl and tape.
  lofi: {
    label: "Lo-fi chill",
    blurb: "laid back: swung boom-bap drums, Rhodes sevenths and ninths, round bass, sparse melody, vinyl crackle and tape wow",
    bpm: 80,
    bpmRange: [65, 95],
    key: "F",
    mode: "major",
    swing: { amount: 0.6, unit: 8 },
    humanize: { time: 0.008, vel: 0.12 },
    progressions: {
      major: [["IVmaj7", "V7", "iii7", "vi7"], ["ii9", "V9", "Imaj9", "vi7"], ["Imaj7", "vi9", "ii7", "V7"], ["IVmaj9", "iii7", "ii9", "Imaj7"]],
      minor: [["i9", "bVImaj7", "bIIImaj7", "bVII7"], ["i7", "iv7", "bVII7", "bIIImaj7"], ["iv9", "i7", "bVImaj7", "bVII7"]],
    },
    chordBars: 1,
    voicing: { voices: 4, low: 53, high: 77 },
    bassRange: [33, 48],
    hook: {
      low: 67,
      high: 84,
      rhythms: [
        [[2, 2], [4, 4], [10, 2], [12, 4], [18, 2], [20, 2], [22, 6], [30, 2]],
        [[0, 3], [3, 3], [8, 6], [16, 2], [18, 4], [24, 8]],
        [[4, 2], [6, 2], [8, 4], [14, 2], [16, 6], [26, 6]],
      ],
    },
    drums: {
      full: {
        kick: s16({ 0: 1, 7: 0.55, 10: 0.85 }),
        snare: s16({ 4: 1, 12: 1, 15: 0.2 }),
        hat: s16({ 0: 0.7, 2: 0.45, 4: 0.65, 6: 0.45, 8: 0.7, 10: 0.45, 12: 0.65, 14: 0.5 }),
        rim: s16({ 9: 0.25 }),
      },
      light: {
        kick: s16({ 0: 0.9, 10: 0.7 }),
        snare: s16({ 4: 0.8, 12: 0.8 }),
        hat: s16({ 0: 0.6, 2: 0.4, 4: 0.6, 6: 0.4, 8: 0.6, 10: 0.4, 12: 0.6, 14: 0.4 }),
      },
    },
    roles: {
      intro: ["keys", "vinyl"],
      verse: ["kick", "snare", "hat", "bass", "keys", "vinyl"],
      build: ["kick", "snare", "hat", "bass", "keys", "vinyl"],
      drop: ["kick", "snare", "hat", "rim", "bass", "keys", "lead", "vinyl"],
      breakdown: ["hat", "rim", "keys", "lead", "vinyl"],
      outro: ["keys", "vinyl"],
    },
    mix: {
      kick: { gain: 0.8 }, snare: { gain: 0.5, send: 0.2 }, hat: { gain: 0.13, pan: 0.2 }, rim: { gain: 0.18, pan: -0.3, send: 0.2 }, crash: { gain: 0.08, send: 0.2 }, vinyl: { gain: 0.05 },
      riser: { gain: 0.08, send: 0.3 }, impact: { gain: 0.15, send: 0.3 },
      bass: { gain: 0.42 },
      keys: { gain: 0.3, send: 0.3 },
      lead: { gain: 0.14, send: 0.35 },
    },
    reverb: { decay: 1.6, size: 0.45 },
    balance: { drums: 0, bass: -3, harmony: -1, lead: -6 },
    sidechain: { harmony: 2.5, bass: 0 },
    padCutoff: [1200, 4500],
    color: { lowpass: 11000, wow: 9, drive: 0.35, crackle: 1 },
    breath: 0,
  },

  // Ambient: slow evolving pads, glassy bells, a sub drone, a soft pulse
  // in the fullest parts, everything in a long hall.
  ambient: {
    label: "Ambient",
    blurb: "calm and spacious: evolving pads, glassy bells, a sub drone and a soft pulse, long hall reverb",
    // Above 85 BPM a beat tracker that leans to 120 hears the quarter, not
    // the eighth (at 80 analyze_music read 160): 92, a slow pulse all the same.
    bpm: 92,
    bpmRange: [55, 110],
    key: "E",
    mode: "major",
    swing: { amount: 0.5, unit: 16 },
    humanize: { time: 0.003, vel: 0.1 },
    progressions: {
      major: [["Iadd9", "IVadd9", "vi7", "IVmaj7"], ["Imaj7", "IVmaj7", "Iadd9", "Vsus4"], ["vi7", "IVmaj7", "Iadd9", "Vsus4"]],
      minor: [["iadd9", "bVImaj7", "bIIIadd9", "bVIIsus2"], ["i7", "iv7", "bVImaj7", "bVII"]],
    },
    chordBars: 2,
    voicing: { voices: 5, low: 50, high: 81 },
    bassRange: [28, 43],
    hook: {
      low: 71,
      high: 91,
      rhythms: [
        [[0, 6], [6, 2], [8, 8], [20, 4], [24, 8]],
        [[0, 4], [6, 6], [16, 4], [22, 10]],
        [[0, 8], [8, 4], [12, 4], [16, 16]],
      ],
    },
    drums: {
      full: {
        kick: s16({ 0: 0.9, 4: 0.45, 8: 0.7, 12: 0.45 }),
        shaker: s16({ 4: 0.35, 12: 0.35 }),
      },
      light: {
        kick: s16({ 0: 0.7, 8: 0.5 }),
      },
    },
    roles: {
      // The pad blooms in after an intro of glass and mallets: a change an
      // ear (and analyze_music) hears as a new part.
      intro: ["bell", "arp"],
      verse: ["pad", "bell", "arp"],
      build: ["pad", "bell", "sub", "arp", "riser"],
      drop: ["pad", "bell", "sub", "arp", "kick", "shaker", "lead", "choir"],
      breakdown: ["pad", "choir", "bell"],
      outro: ["pad", "bell"],
    },
    mix: {
      kick: { gain: 0.5, send: 0.15 }, shaker: { gain: 0.07, pan: 0.3, send: 0.4 }, riser: { gain: 0.1, send: 0.6 }, impact: { gain: 0.2, send: 0.6 }, crash: { gain: 0.06, send: 0.6 },
      sub: { gain: 0.24 },
      pad: { gain: 0.1, send: 0.55 }, choir: { gain: 0.05, send: 0.7 }, arp: { gain: 0.07, send: 0.6 },
      bell: { gain: 0.1, send: 0.65 }, lead: { gain: 0.1, send: 0.6 },
    },
    reverb: { decay: 5, size: 0.95 },
    balance: { drums: -8, bass: -6, harmony: 0, lead: -4 },
    sidechain: {},
    padCutoff: [800, 5000],
    color: {},
    breath: 0,
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

/** Section roles by name: drop, chorus, climax and hook are drops; bridge
 * and break are breakdowns; pre-chorus and riser are builds. */
const ROLE_NAMES: [RegExp, Role][] = [
  [/^(intro|opening|start|open)/, "intro"],
  [/^(outro|ending|end|coda|close|finale?$)/, "outro"],
  [/^(build|pre|riser|rise|lift|swell|ramp)/, "build"],
  [/^(drop|chorus|climax|hook|peak|main|hit|refrain)/, "drop"],
  [/^(breakdown|break|bridge|interlude|calm|rest|quiet)/, "breakdown"],
  [/^(verse|a$|b$|part|groove|body|section)/, "verse"],
];

/** A section's role from its name, else from its energy. */
export function roleOf(name: string, energy?: number): Role {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, "");
  for (const [re, role] of ROLE_NAMES) if (re.test(n)) return role;
  if (energy === undefined) return "verse";
  return energy >= 0.8 ? "drop" : energy <= 0.35 ? "breakdown" : "verse";
}

/** The energy a section has unless one is given. */
export const ROLE_ENERGY: Record<Role, number> = { intro: 0.3, verse: 0.5, build: 0.65, drop: 1, breakdown: 0.35, outro: 0.3 };
