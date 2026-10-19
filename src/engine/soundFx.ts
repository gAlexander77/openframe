// A clip's sound design as Web Audio nodes (lib/soundFx.ts, ADR-060),
// built in one place for playback, export and loudness measurement, so
// what is measured is what plays. The filters go before the clip's
// volume, as a channel strip's inserts do; echo and reverb after it, so
// their tails ring on past the clip's end and its fade.

import { mixGains, reverbImpulse, type FilterKind } from "../lib/soundFx";
import type { AudioClip, AudioFilter, Echo, Reverb, VideoClip } from "../lib/project/types";

/** Nodes in a row: sound goes into `input` and comes out of `output`. */
export interface FxChain {
  input: AudioNode;
  output: AudioNode;
}

/** A parameter's keyframes over the clip's span, mapped into the param's
 * units (lib fxCurve), or null when it has none. */
export type FxCurve = (path: string, map?: (v: number) => number) => Float32Array | null;
/** Play a curve on a param over the clip's span (the scheduler knows when). */
export type Ride = (param: AudioParam, curve: Float32Array) => void;

/** Two biquads, 24 dB per octave: the first Butterworth, the second
 * carrying the resonance (Web Audio's low/high-pass Q is the peak in dB;
 * -3.01 dB is Butterworth's 0.707). */
function filterNodes(ctx: BaseAudioContext, kind: FilterKind, f: AudioFilter, curve: FxCurve, ride: Ride): FxChain {
  const top = ctx.sampleRate * 0.475;
  const hz = (v: number) => Math.max(10, Math.min(top, v));
  const [a, b] = [-3.0103, f.resonance - 3.0103].map((Q) => new BiquadFilterNode(ctx, { type: kind, frequency: hz(f.cutoff), Q }));
  a.connect(b);
  const sweep = curve(`${kind}.cutoff`, hz);
  if (sweep) {
    ride(a.frequency, sweep);
    ride(b.frequency, sweep);
  }
  return { input: a, output: b };
}

/** An effect between a dry and a wet gain at equal power, the mix
 * keyframeable at `path`. */
function wetDry(ctx: BaseAudioContext, effect: FxChain, mix: number, path: string, curve: FxCurve, ride: Ride): FxChain {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const [d, w] = mixGains(mix);
  const dry = new GainNode(ctx, { gain: d });
  const wet = new GainNode(ctx, { gain: w });
  input.connect(dry).connect(output);
  input.connect(effect.input);
  effect.output.connect(wet).connect(output);
  const dryCurve = curve(path, (m) => mixGains(m)[0]);
  const wetCurve = curve(path, (m) => mixGains(m)[1]);
  if (dryCurve && wetCurve) {
    ride(dry.gain, dryCurve);
    ride(wet.gain, wetCurve);
  }
  return { input, output };
}

function echoNodes(ctx: BaseAudioContext, e: Echo, curve: FxCurve, ride: Ride): FxChain {
  const delay = new DelayNode(ctx, { delayTime: e.time, maxDelayTime: 2 });
  const feedback = new GainNode(ctx, { gain: e.feedback });
  delay.connect(feedback).connect(delay);
  return wetDry(ctx, { input: delay, output: delay }, e.mix, "echo.mix", curve, ride);
}

/** Impulse responses by room, so a long export's windows (each its own
 * context) make the same room once. */
const rooms = new Map<string, Float32Array[]>();

function reverbNodes(ctx: BaseAudioContext, r: Reverb, curve: FxCurve, ride: Ride): FxChain {
  const key = `${ctx.sampleRate}|${r.size}|${r.decay}`;
  let ir = rooms.get(key);
  if (!ir) {
    ir = reverbImpulse(ctx.sampleRate, r);
    rooms.set(key, ir);
    if (rooms.size > 8) rooms.delete(rooms.keys().next().value!);
  }
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: ir[0].length, sampleRate: ctx.sampleRate });
  ir.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  // Our own scaling (unit energy), not the browser's normalization.
  const conv = new ConvolverNode(ctx, { buffer, disableNormalization: true });
  return wetDry(ctx, { input: conv, output: conv }, r.mix, "reverb.mix", curve, ride);
}

const chain = (parts: FxChain[]): FxChain | null => {
  if (!parts.length) return null;
  for (let i = 1; i < parts.length; i++) parts[i - 1].output.connect(parts[i].input);
  return { input: parts[0].input, output: parts[parts.length - 1].output };
};

/** The inserts before the clip's volume: high-pass, then low-pass. */
export function preFaderFx(ctx: BaseAudioContext, c: VideoClip | AudioClip, curve: FxCurve, ride: Ride): FxChain | null {
  return chain([
    ...(c.highpass ? [filterNodes(ctx, "highpass", c.highpass, curve, ride)] : []),
    ...(c.lowpass ? [filterNodes(ctx, "lowpass", c.lowpass, curve, ride)] : []),
  ]);
}

/** The time effects after the clip's volume: echo, then reverb (the
 * repeats sound in the room). */
export function postFaderFx(ctx: BaseAudioContext, c: VideoClip | AudioClip, curve: FxCurve, ride: Ride): FxChain | null {
  return chain([...(c.echo ? [echoNodes(ctx, c.echo, curve, ride)] : []), ...(c.reverb ? [reverbNodes(ctx, c.reverb, curve, ride)] : [])]);
}
