import { describe, expect, it } from "vitest";
import { bassNote, chordFromRoman, chordPcs, diatonicNumeral, fitsMode, keyName, MODES, parseKey, scaleNotes, voiceLead, type Chord } from "./theory";

const C = 0, A = 9;

describe("keys and scales", () => {
  it("reads note names with sharps, flats and a mode word", () => {
    expect(parseKey("C")).toBe(0);
    expect(parseKey("f#")).toBe(6);
    expect(parseKey("Bb")).toBe(10);
    expect(parseKey("Eb minor")).toBe(3);
    expect(() => parseKey("H")).toThrow(/Unknown key/);
  });

  it("spells keys with flats where they have them", () => {
    expect(keyName(parseKey("F"), "major")).toBe("F major");
    expect(keyName(parseKey("D"), "minor")).toBe("D minor");
    expect(keyName(parseKey("Eb"), "major")).toBe("Eb major");
    expect(keyName(parseKey("F#"), "minor")).toBe("F# minor");
  });

  it("lists a mode's notes in a range", () => {
    expect(scaleNotes(A, "minor", 57, 69)).toEqual([57, 59, 60, 62, 64, 65, 67, 69]);
    expect(scaleNotes(C, "lydian", 60, 67)).toEqual([60, 62, 64, 66, 67]);
  });
});

describe("chords from numerals", () => {
  const name = (r: string, tonic = C, mode: "major" | "minor" = "major") => chordFromRoman(r, tonic, mode).name;

  it("builds triads and sevenths on the major scale's degrees", () => {
    expect(name("I")).toBe("C");
    expect(name("vi7")).toBe("Am7");
    expect(name("IVmaj7")).toBe("Fmaj7");
    expect(name("V7")).toBe("G7");
    expect(name("ii9")).toBe("Dm9");
    expect(name("Vsus4")).toBe("Gsus4");
    expect(name("Iadd9")).toBe("Cadd9");
    expect(name("vii°")).toBe("Bdim");
    expect(chordFromRoman("V7", C, "major").tones).toEqual([0, 4, 7, 10]);
    expect(chordFromRoman("Vsus4", C, "major").tones).toEqual([0, 5, 7]);
  });

  it("reads a minor key's chords as charts write them: i-bVI-bIII-bVII", () => {
    expect(["i", "bVI", "bIII", "bVII"].map((r) => name(r, A, "minor"))).toEqual(["Am", "F", "C", "G"]);
    expect(name("iadd9", A, "minor")).toBe("Amadd9");
    expect(chordPcs(chordFromRoman("bVImaj7", A, "minor")).sort((x, y) => x - y)).toEqual([0, 4, 5, 9]);
    expect(() => chordFromRoman("X", C, "major")).toThrow(/Unknown chord/);
  });

  it("knows which chords a mode holds", () => {
    expect(fitsMode(chordFromRoman("bVII", C, "major"), C, "major")).toBe(false);
    expect(fitsMode(chordFromRoman("bVII", C, "mixolydian"), C, "mixolydian")).toBe(true);
    expect(fitsMode(chordFromRoman("V", A, "minor"), A, "minor")).toBe(false);
    expect(fitsMode(chordFromRoman("V", A, "harmonic_minor"), A, "harmonic_minor")).toBe(true);
  });

  it("names each mode's diatonic triads", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => diatonicNumeral(d, "minor"))).toEqual(["i", "ii°", "bIII", "iv", "v", "bVI", "bVII"]);
    expect([0, 3, 4].map((d) => diatonicNumeral(d, "dorian"))).toEqual(["i", "IV", "v"]);
    expect(diatonicNumeral(4, "harmonic_minor")).toBe("V");
    for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
      for (let d = 0; d < 7; d++) expect(fitsMode(chordFromRoman(diatonicNumeral(d, mode), 2, mode), 2, mode)).toBe(true);
    }
  });
});

describe("voice leading", () => {
  const prog = ["I", "V", "vi", "IV", "I"].map((r) => chordFromRoman(r, C, "major"));
  const lead = (chords: Chord[], voices: number) => {
    let v: number[] | null = null;
    return chords.map((c) => (v = voiceLead(v, c, { voices, low: 52, high: 76 })));
  };

  it("voices every tone of each chord inside the range", () => {
    for (const v of lead(prog, 4)) {
      expect(v.every((n) => n >= 52 && n <= 76)).toBe(true);
      expect(new Set(v).size).toBe(v.length);
    }
    lead(prog, 4).forEach((v, i) => expect(new Set(v.map((n) => n % 12))).toEqual(new Set(chordPcs(prog[i]))));
  });

  it("moves each voice by a step or a common tone, never jumping", () => {
    const vs = lead(prog, 4);
    for (let i = 1; i < vs.length; i++) {
      const moves = vs[i].map((n, k) => Math.abs(n - vs[i - 1][k]));
      expect(Math.max(...moves)).toBeLessThanOrEqual(4);
      expect(moves.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(7);
    }
  });

  it("keeps a common tone where a chord shares one (C to Am keeps C and E)", () => {
    const [c, , am] = lead(prog, 3);
    expect(am.filter((n) => c.includes(n)).length).toBeGreaterThanOrEqual(2);
  });

  it("drops the fifth when there are more tones than voices", () => {
    const v = voiceLead(null, chordFromRoman("ii9", C, "major"), { voices: 4, low: 50, high: 77 });
    expect(new Set(v.map((n) => n % 12))).toEqual(new Set([2, 5, 0, 4]));
  });

  it("puts the bass on the root, the nearer octave", () => {
    const g = chordFromRoman("V", C, "major");
    expect(bassNote(g, null, 28, 43) % 12).toBe(7);
    expect(bassNote(g, 40, 28, 43)).toBe(43);
    expect(bassNote(g, 33, 28, 43)).toBe(31);
  });
});
