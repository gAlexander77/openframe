import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { clipForAsset, createProject, createTextClip, normalizeProject } from "./project/defaults";
import { splitClip } from "./project/ops";
import type { AudioClip, Clip, Project } from "./project/types";
import { cleanFx, echoTail, FILTER_DEFAULTS, fxCurve, fxParamAt, fxTail, mixGains, REVERB_PRESETS, reverbImpulse, switchAt, tapeStopMap } from "./soundFx";
import type { Retimer } from "./stretch";

/** A project with one 10 s audio clip at 0 on an audio track (30 fps). */
function withClip(): { p: Project; id: string } {
  const p: Project = { ...createProject(), assets: [{ id: "a", kind: "audio", name: "music.wav", src: "music.wav", duration: 10, hasVideo: false, hasAudio: true }] };
  const c = clipForAsset(p.assets[0], 0, p.fps) as AudioClip;
  p.tracks = [p.tracks[0], { id: "t_a", kind: "audio", name: "Audio", clips: [c], muted: false, hidden: false, locked: false, volume: 1, pan: 0 } as Project["tracks"][number]];
  return { p, id: c.id };
}
const clipOf = (p: Project) => p.tracks[1].clips[0] as AudioClip;

describe("effect values", () => {
  it("keep every number in range, fill the rest, and refuse what is not an object", () => {
    expect(cleanFx("lowpass", { cutoff: 99999, resonance: -3 })).toEqual({ cutoff: 20000, resonance: 0 });
    expect(cleanFx("echo", { time: 0.2, feedback: 1.5, mix: "lots" })).toEqual({ time: 0.2, feedback: 0.9, mix: 0.3 });
    expect(cleanFx("reverb", {}, REVERB_PRESETS.room)).toEqual(REVERB_PRESETS.room);
    expect(cleanFx("tapeStop", "slow")).toBeUndefined();
    expect(cleanFx("reverb", null)).toBeUndefined();
  });

  it("mix wet and dry at equal power", () => {
    for (const m of [0, 0.3, 0.5, 1]) {
      const [d, w] = mixGains(m);
      expect(d * d + w * w).toBeCloseTo(1, 9);
    }
    expect(mixGains(0)).toEqual([1, 0]);
  });
});

describe("reverb impulse", () => {
  const rate = 48000;
  const hall = REVERB_PRESETS.hall;
  const [l, r] = reverbImpulse(rate, hall);

  it("is the same room every time, of unit energy per channel, silent through the pre-delay", () => {
    const [l2] = reverbImpulse(rate, hall);
    expect(l2).toEqual(l);
    for (const ch of [l, r]) expect(ch.reduce((s, v) => s + v * v, 0)).toBeCloseTo(1, 4);
    const pre = Math.round((0.005 + 0.045 * hall.size) * rate);
    expect(l.subarray(0, pre).every((v) => v === 0)).toBe(true);
    expect(Math.abs(l[pre + 200])).toBeGreaterThan(0);
  });

  it("falls 60 dB in about its decay time (Schroeder's backward integration)", () => {
    // Energy decay curve; RT60 from its -5 to -35 dB slope (T30, doubled).
    const edc = new Float64Array(l.length + 1);
    for (let i = l.length - 1; i >= 0; i--) edc[i] = edc[i + 1] + l[i] * l[i];
    const db = (i: number) => 10 * Math.log10(edc[i] / edc[0]);
    const at = (target: number) => {
      let i = 0;
      while (i < l.length && db(i) > target) i++;
      return i / rate;
    };
    const rt60 = 2 * (at(-35) - at(-5));
    expect(rt60).toBeGreaterThan(hall.decay * 0.8);
    expect(rt60).toBeLessThan(hall.decay * 1.2);
  });

  it("gives the two sides different reflections, for width", () => {
    let lr = 0;
    for (let i = 0; i < l.length; i++) lr += l[i] * r[i];
    expect(Math.abs(lr)).toBeLessThan(0.1);
  });
});

describe("keyframed sound design", () => {
  const clip = { keyframes: { "lowpass.cutoff": [{ f: 0, v: 300 }, { f: 150, v: 20000 }], "reverb.mix": [{ f: 0, v: 0 }, { f: 30, v: 1 }] } } as unknown as Clip;

  it("sweeps a cutoff on a log scale: half way in time is half way in octaves", () => {
    const curve = fxCurve(clip, "lowpass.cutoff", 0, 30, 0, 5, 100)!;
    expect(curve[0]).toBeCloseTo(300, 0);
    expect(curve[250]).toBeCloseTo(Math.sqrt(300 * 20000), -1);
    expect(curve[curve.length - 1]).toBeGreaterThan(19900);
    expect(fxParamAt(clip, "lowpass.cutoff", 75)).toBeCloseTo(Math.sqrt(300 * 20000), 3);
  });

  it("moves a mix in a straight line, mapped into a gain", () => {
    const wet = fxCurve(clip, "reverb.mix", 0, 30, 0, 1, 100, (m) => mixGains(m)[1])!;
    expect(wet[50]).toBeCloseTo(Math.sin(Math.PI / 4), 2);
    expect(fxCurve(clip, "echo.mix", 0, 30, 0, 1)).toBeNull();
  });
});

describe("tape stop", () => {
  const map = tapeStopMap(10, { duration: 2 });

  it("plays as is until the stop, then slows linearly to a standstill", () => {
    expect(map.start).toBe(8);
    expect(map.warp(5)).toBe(5);
    expect(map.rate(9)).toBeCloseTo(0.5);
    expect(map.rate(10)).toBe(0);
    // The source read moves half the stop's length while stopping.
    expect(map.warp(10)).toBeCloseTo(9);
    // Continuous, and slowing: each step reads less source than the last.
    let last = map.warp(8);
    let step = Infinity;
    for (let u = 8.1; u <= 10; u += 0.1) {
      const d = map.warp(u) - last;
      expect(d).toBeLessThan(step + 1e-9);
      step = d;
      last = map.warp(u);
    }
  });

  it("holds full level to half speed, then fades with the speed", () => {
    expect(map.gain(8.5)).toBe(1);
    expect(map.gain(9.5)).toBeCloseTo(0.5);
    expect(map.gain(10)).toBe(0);
  });

  it("never runs longer than the clip", () => {
    const short = tapeStopMap(0.5, { duration: 2 });
    expect([short.start, short.length]).toEqual([0, 0.5]);
  });

  it("switches retimers at the stop: pitch kept before, tape after", () => {
    const fill = (v: number): Retimer => ({ inputSpan: () => [0, 1], render: (_i, _s, _n, out) => out.forEach((o) => o.fill(v)) });
    const both = switchAt(fill(1), fill(2), 100);
    const out = [new Float32Array(40)];
    both.render([new Float32Array(1)], 0, 80, out);
    expect([...out[0].subarray(0, 20)].every((v) => v === 1)).toBe(true);
    expect([...out[0].subarray(20)].every((v) => v === 2)).toBe(true);
  });
});

describe("tails", () => {
  it("ring as long as the echo's repeats and the reverb's decay, in series", () => {
    expect(echoTail({ time: 0.5, feedback: 0.5, mix: 0.3 })).toBeCloseTo(0.5 * 10);
    expect(fxTail({})).toBe(0);
    expect(fxTail({ reverb: REVERB_PRESETS.hall, echo: { time: 0.5, feedback: 0, mix: 0.3 } })).toBeCloseTo(0.5 + 0.005 + 0.045 * 0.6 + 2.5);
  });
});

describe("sound design commands", () => {
  it("set_audio_filter adds a filter, sweeps it with keyframes, fixes it again and removes it", () => {
    const { p, id } = withClip();
    const swept = runCommand(p, "set_audio_filter", { clip_ids: [id], type: "lowpass", cutoff: 400, sweep: { to: 20000, start: 4.5, end: 5 } });
    expect(clipOf(swept).lowpass).toEqual({ cutoff: 400, resonance: 0 });
    expect(clipOf(swept).keyframes?.["lowpass.cutoff"]).toEqual([{ f: 135, v: 400 }, { f: 150, v: 20000 }]);
    const fixed = runCommand(swept, "set_audio_filter", { clip_ids: [id], type: "lowpass", cutoff: 800 });
    expect(clipOf(fixed).lowpass?.cutoff).toBe(800);
    expect(clipOf(fixed).keyframes).toBeUndefined();
    const resonant = runCommand(swept, "set_audio_filter", { clip_ids: [id], type: "lowpass", resonance: 9 });
    expect(clipOf(resonant).keyframes?.["lowpass.cutoff"]).toHaveLength(2);
    const off = runCommand(swept, "set_audio_filter", { clip_ids: [id], type: "lowpass", off: true });
    expect(clipOf(off).lowpass).toBeUndefined();
    expect(clipOf(off).keyframes).toBeUndefined();
    expect(clipOf(runCommand(p, "set_audio_filter", { clip_ids: [id], type: "highpass" })).highpass).toEqual(FILTER_DEFAULTS.highpass);
    expect(() => runCommand(p, "set_audio_filter", { clip_ids: [id], type: "lowpass", sweep: { to: 900, start: 5, end: 5 } })).toThrow(/after sweep.start/);
  });

  it("set_reverb, set_echo and set_tape_stop set, adjust and remove their effect, and describe_project shows them", () => {
    const { p, id } = withClip();
    let q = runCommand(p, "set_reverb", { clip_ids: [id], preset: "cathedral", mix: 0.25 });
    expect(clipOf(q).reverb).toEqual({ ...REVERB_PRESETS.cathedral, mix: 0.25 });
    q = runCommand(q, "set_reverb", { clip_ids: [id], decay: 3 });
    expect(clipOf(q).reverb).toEqual({ ...REVERB_PRESETS.cathedral, mix: 0.25, decay: 3 });
    q = runCommand(q, "set_echo", { clip_ids: [id], time: 0.25 });
    expect(clipOf(q).echo).toEqual({ time: 0.25, feedback: 0.4, mix: 0.3 });
    q = runCommand(q, "set_tape_stop", { clip_ids: [id], duration: 1.5 });
    expect(clipOf(q).tapeStop).toEqual({ duration: 1.5 });
    expect(describeProject(q).tracks[1].clips[0]).toMatchObject({ reverb: { decay: 3 }, echo: { time: 0.25 }, tape_stop: { duration: 1.5 } });
    for (const [name, key] of [["set_reverb", "reverb"], ["set_echo", "echo"], ["set_tape_stop", "tapeStop"]] as const) {
      expect(clipOf(runCommand(q, name, { clip_ids: [id], off: true }))[key]).toBeUndefined();
    }
  });

  it("refuses clips without sound of their own", () => {
    const p = createProject();
    const title = createTextClip("Hi", 0, 30);
    p.tracks[0].clips = [title];
    expect(() => runCommand(p, "set_reverb", { clip_ids: [title.id] })).toThrow(/video or audio clip/);
  });

  it("keeps a tape stop on the part of a split clip that has the end", () => {
    const { p, id } = withClip();
    const q = splitClip(runCommand(p, "set_tape_stop", { clip_ids: [id] }), id, 150);
    const [left, right] = q.tracks[1].clips as AudioClip[];
    expect(left.tapeStop).toBeUndefined();
    expect(right.tapeStop).toEqual({ duration: 1 });
  });

  it("survives loading, clamped; nonsense is dropped, not refused", () => {
    const { p, id } = withClip();
    const q = runCommand(runCommand(p, "set_reverb", { clip_ids: [id] }), "set_echo", { clip_ids: [id] });
    const raw = JSON.parse(JSON.stringify(q));
    raw.tracks[1].clips[0].echo.feedback = 4;
    raw.tracks[1].clips[0].lowpass = "muffled";
    const loaded = clipOf(normalizeProject(raw));
    expect(loaded.reverb).toEqual(REVERB_PRESETS.hall);
    expect(loaded.echo?.feedback).toBe(0.9);
    expect(loaded.lowpass).toBeUndefined();
  });
});
