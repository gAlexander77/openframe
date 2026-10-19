import { describe, expect, it } from "vitest";
import { checkSpec, ceilingFor, LOUDNESS_SPECS, loudnessOutcome, loudnessRange, loudnessStats, planLoudness, specForTarget } from "./delivery";
import { applyLimiter, LIMIT_BLOCK, LoudnessMeter } from "./loudness";
import { toDbtp, truePeak, TruePeakMeter } from "./truePeak";

const RATE = 48000;

/** Stereo 1 kHz tone segments, [seconds, dBFS peak per channel] each (the
 * EBU test signals); null level is silence. */
function tones(segments: [number, number | null][]): Float32Array[] {
  const n = Math.round(segments.reduce((s, [d]) => s + d, 0) * RATE);
  const x = new Float32Array(n);
  let at = 0;
  for (const [d, db] of segments) {
    const len = Math.round(d * RATE);
    if (db !== null) for (let i = 0; i < len; i++) x[at + i] = 10 ** (db / 20) * Math.sin((2 * Math.PI * 1000 * (at + i)) / RATE);
    at += len;
  }
  return [x, x.slice()];
}

function stats(planes: Float32Array[]) {
  const m = new LoudnessMeter(RATE, planes.length);
  m.push(planes, planes[0].length);
  return loudnessStats(m.steps);
}

describe("loudness range (EBU Tech 3342)", () => {
  // Tech 3342's minimum-requirement signals 1-4: 20 s tones; LRA +/-1 LU.
  const cases: [string, number[], number][] = [
    ["1: -20 then -30 dBFS", [-20, -30], 10],
    ["2: -20 then -15 dBFS", [-20, -15], 5],
    ["3: -40 then -20 dBFS", [-40, -20], 20],
    ["4: -50, -35, -20, -35, -50 dBFS", [-50, -35, -20, -35, -50], 15],
  ];
  for (const [name, levels, want] of cases) {
    it(`reads signal ${name} as ${want} LU`, () => {
      const lra = stats(tones(levels.map((l) => [20, l]))).range;
      expect(Math.abs(lra - want)).toBeLessThanOrEqual(1);
    });
  }

  it("is zero for a steady tone and for silence", () => {
    expect(stats(tones([[10, -23]])).range).toBeCloseTo(0, 1);
    expect(loudnessRange([])).toBe(0);
    expect(loudnessRange([-90, -80])).toBe(0);
  });
});

describe("loudness report", () => {
  it("reads a -23 dBFS stereo tone as -23 LUFS integrated, short-term and momentary", () => {
    const s = stats(tones([[20, -23]]));
    expect(s.integrated).toBeCloseTo(-23, 1);
    expect(s.shortTermMax).toBeCloseTo(-23, 1);
    expect(s.momentaryMax).toBeCloseTo(-23, 1);
  });

  it("finds each segment's short-term maximum (Tech 3341 signal 10, file-based)", () => {
    // i * 0.15 s of silence, 3 s at -23 dBFS, 1 s of silence.
    const segs: [number, number | null][] = [];
    for (let i = 0; i < 20; i++) segs.push([i * 0.15, null], [3, -23], [1, null]);
    expect(Math.abs(stats(tones(segs)).shortTermMax + 23)).toBeLessThanOrEqual(0.1);
  });

  it("reads the loudest moment: a 1 s burst 10 dB over a quiet bed", () => {
    const s = stats(tones([[9, -33], [1, -23], [9, -33]]));
    expect(s.momentaryMax).toBeCloseTo(-23, 1);
    expect(s.shortTermMax).toBeLessThan(-26);
    expect(s.integrated).toBeLessThan(-31);
  });
});

describe("specs", () => {
  it("names the broadcast specs by their targets, with their ceilings", () => {
    expect(specForTarget(-24)?.id).toBe("atsc_a85");
    expect(specForTarget(-23)?.id).toBe("ebu_r128");
    expect(specForTarget(-14)?.id).toBe("online");
    expect(specForTarget(-16)).toBeUndefined();
    expect([ceilingFor(-24), ceilingFor(-23), ceilingFor(-16), ceilingFor(null)]).toEqual([-2, -1, -1, -1]);
  });

  it("passes inside the tolerance and under the ceiling, and says why it fails", () => {
    const r128 = LOUDNESS_SPECS.ebu_r128;
    expect(checkSpec({ integrated: -23.4, truePeak: -1.2 }, r128).pass).toBe(true);
    const loud = checkSpec({ integrated: -16, truePeak: -0.3 }, r128);
    expect(loud.pass).toBe(false);
    expect(loud.problems).toEqual(["Integrated -16.0 LUFS is 7.0 LU over -23 (±0.5).", "True peak -0.3 dBTP is over -1 dBTP."]);
    expect(checkSpec({ integrated: -25.5, truePeak: -2.5 }, LOUDNESS_SPECS.atsc_a85).pass).toBe(true);
    expect(checkSpec({ integrated: -Infinity, truePeak: -Infinity }, LOUDNESS_SPECS.online).problems).toEqual(["The mix is silent."]);
  });
});

describe("loudness plan (export's true-peak limiter)", () => {
  /** Speech-like: noise bursts with high-frequency transients, crest far
   * above the loudness, as a voice has. */
  function peaky(seconds = 6): Float32Array[] {
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const n = seconds * RATE;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.08 * (0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (RATE * 0.25))) * rnd();
    // Bursts at a quarter of the rate, 45 degrees off the samples: their
    // peaks fall between samples, 3 dB over what the samples show.
    for (let i = 4500; i + 40 < n; i += 9000) for (let k = 0; k < 40; k++) x[i + k] += 0.6 * Math.sin((Math.PI / 2) * k + Math.PI / 4);
    return [x, x.slice()];
  }

  for (const ceilingDb of [-1, -2]) {
    it(`holds the true peak under ${ceilingDb} dBTP after raising the mix`, () => {
      const planes = peaky();
      const meter = new LoudnessMeter(RATE, 2);
      meter.push(planes, planes[0].length);
      const blocks = new Float32Array(Math.ceil(planes[0].length / LIMIT_BLOCK) + 1);
      const tp = new TruePeakMeter(2);
      tp.push(planes, planes[0].length, blocks);
      tp.flush(blocks);
      // Over the sample peak: inter-sample peaks are there to catch.
      const samplePeak = planes[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(tp.peak).toBeGreaterThan(samplePeak * 1.1);
      const plan = planLoudness(meter.integrated(), tp.peak, blocks, -14, ceilingDb)!;
      expect(plan.gain).toBeGreaterThan(1);
      expect(plan.heldDb).toBeGreaterThan(1);
      applyLimiter(planes, 0, plan.gain, plan.gains);
      expect(toDbtp(truePeak(planes))).toBeLessThanOrEqual(ceilingDb + 0.05);
    });
  }

  it("does nothing to a mix already at the target under the ceiling, or to silence", () => {
    const blocks = new Float32Array(10);
    expect(planLoudness(-23, 0.5, blocks, -23, -1)).toBeNull();
    expect(planLoudness(-Infinity, 0, blocks, -23, -1)).toBeNull();
    // At the target but over the ceiling: limited without a gain.
    blocks[3] = 1;
    const over = planLoudness(-23, 1, blocks, -23, -1)!;
    expect(over.gain).toBe(1);
    expect(over.gains[3]).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
  });
});

it("passes a true peak that rounds to the ceiling, as the report prints it", () => {
  const online = LOUDNESS_SPECS.online;
  expect(checkSpec({ integrated: -14, truePeak: -0.9996 }, online).pass).toBe(true);
  expect(checkSpec({ integrated: -14, truePeak: -0.94 }, online).pass).toBe(false);
});

describe("loudness outcome (the export-complete card)", () => {
  it("calls a mix normalized to its target good news", () => {
    const o = loudnessOutcome(-11.8, -14.2, -14, { limitedBy: null, heldDb: 0, ceilingDb: -1 });
    expect(o).toEqual({ ok: true, text: "Loudness -11.8 LUFS, normalized to -14.2 LUFS." });
    expect(loudnessOutcome(-20, -14.1, -14, { limitedBy: null, heldDb: 2.4, ceilingDb: -1 }).ok).toBe(true);
  });
  it("warns when the peaks or the gain range held the mix short", () => {
    const o = loudnessOutcome(-30, -18.6, -14, { limitedBy: "peak", heldDb: 6, ceilingDb: -1 });
    expect(o.ok).toBe(false);
    expect(o.text).toMatch(/raised as far as 6 dB of limiting allows to -18\.6 LUFS .*4\.6 LU under the -14 LUFS target\.$/);
    expect(loudnessOutcome(-80, -68, -14, { limitedBy: "range", heldDb: 0, ceilingDb: -1 }).ok).toBe(false);
  });
});
