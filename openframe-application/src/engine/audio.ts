// Audio scheduling on Web Audio, shared by preview (AudioContext) and export
// (OfflineAudioContext windows). Each sounding clip streams decoded chunks
// from mediabunny's AudioBufferSink into AudioBufferSourceNodes scheduled on
// the sample grid, through a gain (the envelope from lib/audio.ts) and a
// panner. This is the mediabunny media player's algorithm extended to many
// clips (docs/research/Web media engine.md §1.6, §4.1).
//
// Ramps, reverse and pitch-kept speed changes cannot be a node's
// playbackRate: the engine renders those clips itself in short blocks
// (lib/stretch.ts) and schedules each block at rate 1 (ADR-028), as it
// does a tape stop's slowing tail. A clip's sound design (filters, echo,
// reverb) is built by engine/soundFx.ts into the same chain (ADR-060).

import { meterLevels } from "../lib/mixer";
import type { AudioBufferSink } from "mediabunny";
import { busEnvelope, EQ_BANDS, panEnvelope, soundBuses, soundEnvelope, soundingClips, soundPanAt, soundSpan, type BusHop } from "../lib/audio";
import { kWeighting } from "../lib/analysis/loudness";
import { getAsset, sourceOffset } from "../lib/project/ops";
import type { AudioClip, Compressor, Project, Sound, VideoClip } from "../lib/project/types";
import { fxCurve, switchAt, tapeStopMap, type TapeStopMap } from "../lib/soundFx";
import { varispeed, wsola } from "../lib/stretch";
import { framesToSeconds } from "../lib/time";
import { DECODE_PREROLL, mediaFor } from "./media";
import { postFaderFx, preFaderFx } from "./soundFx";

export interface Schedule {
  /** Stop every node and every pump. Safe to call twice. */
  stop(): void;
  /** Resolves once every pump has scheduled all it was going to (export
   * waits on this before rendering a window). */
  done: Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Does this clip's sound need the engine's retiming? Only plain forward
 * playback at 1x, or tape-style constant speed, can use playbackRate. */
export const needsRetime = (c: VideoClip | AudioClip) =>
  !!c.speedCurve || !!c.reverse || (c.speed !== 1 && !c.changePitch);

interface Pcm {
  rate: number;
  /** Source second of data[c][0]. */
  start: number;
  data: Float32Array[];
}

/** Decoded source audio covering [a, b] seconds (container time `off` is
 * source 0), as planar channels. Null when nothing decodes there. */
async function decodeRange(sink: AudioBufferSink, a: number, b: number, off: number, stopped: () => boolean): Promise<Pcm | null> {
  const chunks: { buffer: AudioBuffer; t: number }[] = [];
  // Decoded from a little earlier: a cold decoder's first packet can be silence.
  for await (const { buffer, timestamp } of sink.buffers(Math.max(0, a + off - DECODE_PREROLL), b + off)) {
    if (stopped()) break;
    chunks.push({ buffer, t: timestamp - off });
  }
  if (!chunks.length) return null;
  const rate = chunks[0].buffer.sampleRate;
  const start = chunks[0].t;
  const last = chunks[chunks.length - 1];
  const len = Math.round((last.t - start) * rate) + last.buffer.length;
  const channels = Math.max(...chunks.map((c) => c.buffer.numberOfChannels));
  const data = Array.from({ length: channels }, () => new Float32Array(len));
  for (const { buffer, t } of chunks) {
    // Place by timestamp, so a gap between chunks stays a gap.
    const at = Math.round((t - start) * rate);
    for (let c = 0; c < channels; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      data[c].set(src.subarray(0, Math.max(0, Math.min(src.length, len - at))), at);
    }
  }
  return { rate, start, data };
}

/**
 * Schedule the timeline's sound from timeline second `from` to `to`, with
 * timeline time `from` landing at context time `at`. Realtime contexts are
 * throttled to ~1.5 s ahead so long timelines do not open every decoder at
 * once; offline contexts schedule everything immediately.
 */
export function scheduleAudio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  p: Project,
  from: number,
  to: number,
  at: number,
): Schedule {
  const realtime = ctx instanceof AudioContext;
  const master = ctx.createGain();
  master.gain.value = p.masterVolume ?? 1;
  master.connect(dest);
  const buses = new Map<string, GainNode>();
  const taps = new Map<string, [AnalyserNode, AnalyserNode]>();
  const splitters: ChannelSplitterNode[] = [];
  const output = (id: string) => {
    let node = buses.get(id);
    if (!node) {
      node = ctx.createGain();
      node.channelCount = 2;
      node.channelCountMode = "explicit";
      node.connect(master);
      buses.set(id, node);
      if (realtime) {
        // Separate channels: a mono analyser would cancel opposite-phase
        // stereo and under-report hard-panned sound.
        const split = ctx.createChannelSplitter(2);
        const pair: [AnalyserNode, AnalyserNode] = [ctx.createAnalyser(), ctx.createAnalyser()];
        pair.forEach((tap, channel) => { tap.fftSize = 1024; split.connect(tap, channel); });
        node.connect(split);
        splitters.push(split);
        taps.set(id, pair);
        trackMeters.set(id, pair);
      }
    }
    return node;
  };
  let stopped = false;
  const nodes = new Set<AudioScheduledSourceNode>();
  /** Each clip's last node, connected to `dest`. */
  const outs: AudioNode[] = [];
  const sr = ctx.sampleRate;
  const grid = (t: number) => Math.round(t * sr) / sr;
  const toCtx = (timelineSec: number) => at + (timelineSec - from);
  const hasAudio = (id: string) => getAsset(p, id)?.hasAudio ?? false;

  /** Compound clips mixed as a bus (ADR-100): their clips' sound summed,
   * then the compound clip's EQ and compressor, then its volume and fades,
   * by key (soundBuses), each feeding the next bus out or its track. */
  const compoundBuses = new Map<string, AudioNode>();
  const busInput = (hops: BusHop[], track: AudioNode): AudioNode => {
    let next = track;
    for (const hop of [...hops].reverse()) {
      let node = compoundBuses.get(hop.key);
      if (!node) {
        const sum = new GainNode(ctx, { channelCount: 2, channelCountMode: "explicit" });
        let tail: AudioNode = sum;
        const eq = eqChain(ctx, hop.clip.eq);
        if (eq) {
          tail.connect(eq.input);
          tail = eq.output;
        }
        if (hop.clip.compressor) {
          const comp = compressorNodes(ctx, hop.clip.compressor);
          tail.connect(comp.input);
          tail = comp.output;
        }
        const gain = ctx.createGain();
        tail.connect(gain);
        gain.connect(next);
        outs.push(gain);
        const lo = Math.max(from, framesToSeconds(hop.clip.start, p.fps)), hi = Math.min(to, framesToSeconds(hop.clip.start + hop.clip.duration, p.fps));
        gain.gain.setValueAtTime(0, Math.max(0, toCtx(lo) - 0.01));
        const envAt = Math.max(toCtx(lo), realtime ? ctx.currentTime : 0);
        if (toCtx(hi) - envAt > 0.01) {
          const env = busEnvelope(hop, p.fps, lo, hi);
          gain.gain.setValueCurveAtTime(env.subarray(Math.min(Math.floor(((envAt - toCtx(lo)) / (hi - lo)) * env.length), env.length - 2)), envAt, toCtx(hi) - envAt);
        }
        compoundBuses.set(hop.key, (node = sum));
      }
      next = node;
    }
    return next;
  };

  const pumps = soundingClips(p, hasAudio).map(async (sounding) => {
    const { clip } = sounding;
    const clipStart = framesToSeconds(clip.start, p.fps);
    // Under a transition the sound runs into its handles to crossfade;
    // inside a compound clip, only while the compound clip lasts.
    const [spanLo, spanHi] = soundSpan(sounding, p.fps);
    const lo = Math.max(from, spanLo);
    const hi = Math.min(to, spanHi);
    if (hi <= lo) return;
    // Its way out, built now (before any wait) so a bus's envelope starts
    // on time: its track, through the compound clips that are buses.
    const route = soundBuses(sounding);
    const out = busInput(route.buses, output(sounding.via?.at(-1)?.track.id ?? sounding.track.id));
    // Wait until the clip is near before opening its decoder.
    if (realtime) {
      while (!stopped && toCtx(lo) - ctx.currentTime > 2) await sleep(150);
      if (stopped) return;
    }
    const asset = getAsset(p, clip.assetId);
    if (!asset) return;
    const media = await mediaFor(asset);
    if (stopped || !media.audioSink) return;

    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = soundPanAt(sounding, p.fps, lo);
    pan.connect(out);
    outs.push(pan);
    gain.gain.setValueAtTime(0, Math.max(0, toCtx(lo) - 0.01));
    // Keyframed curves ride the clip's span; started late (realtime), the
    // part still ahead.
    const envAt = Math.max(toCtx(lo), realtime ? ctx.currentTime : 0);
    const envDur = toCtx(hi) - envAt;
    const ride = (param: AudioParam, curve: Float32Array) => {
      if (envDur > 0.01) param.setValueCurveAtTime(curve.subarray(Math.min(Math.floor(((envAt - toCtx(lo)) / (hi - lo)) * curve.length), curve.length - 2)), envAt, envDur);
    };
    const curve = (path: string, map?: (v: number) => number) => fxCurve(clip, path, clipStart, p.fps.num / p.fps.den, lo, hi, 100, map);
    // Echo and reverb after the gain, so their tails outlast the clip and
    // its fade (ADR-060).
    // ponytail: playback started after a clip's end misses its tail (the
    // clip is not scheduled); export windows pre-roll (mixdown.ts).
    const post = postFaderFx(ctx, clip, curve, ride);
    if (post) {
      gain.connect(post.input);
      post.output.connect(pan);
    } else gain.connect(pan);
    // EQ, then compressor, then the filters, then the gain (volume, fades,
    // keyframes): sources feed the first band.
    let input: AudioNode = gain;
    const pre = preFaderFx(ctx, clip, curve, ride);
    if (pre) {
      pre.output.connect(input);
      input = pre.input;
    }
    if (clip.compressor) {
      const comp = compressorNodes(ctx, clip.compressor);
      comp.output.connect(input);
      input = comp.input;
    }
    const eq = eqChain(ctx, clip.eq);
    if (eq) {
      eq.output.connect(input);
      input = eq.input;
    }
    // Fill: one channel to both sides, ahead of the EQ. A splitter is
    // always "discrete", so a stereo gain in front upmixes a mono file to
    // both channels first ("speakers"), making a fill from it harmless.
    if (clip.fill) {
      const up = new GainNode(ctx, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" });
      const split = ctx.createChannelSplitter(2);
      const merge = ctx.createChannelMerger(2);
      const ch = clip.fill === "left" ? 0 : 1;
      up.connect(split);
      split.connect(merge, ch, 0);
      split.connect(merge, ch, 1);
      merge.connect(input);
      input = up;
    }
    const env = soundEnvelope(sounding, p.fps, lo, hi, 200, route.through);
    if (envDur > 0.01) {
      // Trim the envelope's head if we start late (realtime only).
      const skip = Math.floor(((envAt - toCtx(lo)) / (hi - lo)) * env.length);
      gain.gain.setValueCurveAtTime(env.subarray(Math.min(skip, env.length - 2)), envAt, envDur);
      // Keyframed pan rides the same span.
      const panCurve = panEnvelope(sounding, p.fps, lo, hi);
      if (panCurve) pan.pan.setValueCurveAtTime(panCurve.subarray(Math.min(Math.floor(((envAt - toCtx(lo)) / (hi - lo)) * panCurve.length), panCurve.length - 2)), envAt, envDur);
    }

    const tape = clip.tapeStop ? tapeStopMap(framesToSeconds(clip.duration, p.fps), clip.tapeStop) : null;
    if (needsRetime(clip)) {
      await retimed(clip, clipStart, lo, hi, media.audioSink, media.audioStart, asset.duration, input, tape);
      return;
    }
    // A tape stop's slowing tail is made by the engine; the rest plays as is.
    const stopAt = tape ? clipStart + tape.start : Infinity;
    const playHi = Math.min(hi, stopAt);
    const speed = clip.speed;
    const perSec = speed; // source seconds per timeline second
    const srcLo = clip.in + (lo - clipStart) * perSec;
    const srcHi = clip.in + (playHi - clipStart) * perSec;

    const off = media.audioStart;
    // Decoded from a little earlier (DECODE_PREROLL): a cold decoder's first
    // packet can be silence, a hole at every window and every mid-file start.
    for await (const { buffer, timestamp } of playHi > lo ? media.audioSink.buffers(Math.max(0, srcLo + off - DECODE_PREROLL), srcHi + off) : []) {
      if (stopped) break;
      const srcT = timestamp - off;
      // Timeline second where this chunk's first sample would play.
      const tl = clipStart + (srcT - clip.in) / speed;
      let when = toCtx(tl);
      let offset = 0;
      if (tl < lo) {
        offset = (lo - tl) * speed;
        when = toCtx(lo);
      }
      if (realtime && when < ctx.currentTime) {
        offset += (ctx.currentTime - when) * speed;
        when = ctx.currentTime;
      }
      if (offset >= buffer.duration) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.playbackRate.value = speed;
      node.connect(input);
      node.start(grid(when), offset);
      node.stop(grid(toCtx(playHi)));
      nodes.add(node);
      node.onended = () => nodes.delete(node);
      if (realtime) {
        while (!stopped && when - ctx.currentTime > 1.5) await sleep(100);
      }
    }
    if (tape && !stopped && hi > Math.max(lo, stopAt)) await retimed(clip, clipStart, Math.max(lo, stopAt), hi, media.audioSink, media.audioStart, asset.duration, input, tape);
  });

  /**
   * Render a retimed clip's sound in blocks and schedule each at rate 1.
   * Output sample n (timeline, at the context rate) plays the source
   * sourceOffset() seconds from `in`, forward or backward, so sound follows
   * exactly the time map the picture uses.
   */
  async function retimed(
    clip: VideoClip | AudioClip,
    clipStart: number,
    lo: number,
    hi: number,
    sink: AudioBufferSink,
    off: number,
    srcDuration: number,
    gain: AudioNode,
    tape: TapeStopMap | null,
  ) {
    const fpsRate = p.fps.num / p.fps.den;
    const dir = clip.reverse ? -1 : 1;
    // A tape stop reads the clip's own time map at a slowing clock.
    const warp = tape ? tape.warp : (u: number) => u;
    const pos = (n: number) => sourceOffset(clip, warp(n / sr - clipStart) * fpsRate, p.fps) * sr;
    // Pitch kept (WSOLA) only where the clip asks and no tape stop runs:
    // a stopping tape's pitch falls with it.
    const tapeLike = clip.changePitch || !needsRetime(clip);
    const retimer = tapeLike ? varispeed(pos) : tape ? switchAt(wsola(pos, sr), varispeed(pos), Math.round((clipStart + tape.start) * sr)) : wsola(pos, sr);
    const nLo = Math.round(lo * sr);
    const nHi = Math.round(hi * sr);
    // ponytail: each block decodes its own source range (overlaps decode
    // twice, ~10%); a rolling PCM cache would save it if profiling cares.
    const block = Math.round((realtime ? 0.5 : 2) * sr);
    const maxSrc = srcDuration > 0 ? srcDuration : Infinity;
    for (let n = nLo; n < nHi && !stopped; n += block) {
      const len = Math.min(block, nHi - n);
      const [yLo, yHi] = retimer.inputSpan(n, n + len);
      // Source seconds those positions read, low to high.
      const a = Math.max(0, dir > 0 ? clip.in + yLo / sr : clip.in - yHi / sr);
      const b = Math.min(maxSrc, dir > 0 ? clip.in + yHi / sr : clip.in - yLo / sr);
      const pcm = b > a ? await decodeRange(sink, a, b, off, () => stopped) : null;
      if (stopped) return;
      const channels = pcm?.data.length ?? 1;
      // The input on the retimer's axis: position i is source in + dir*i/sr.
      const input = Array.from({ length: channels }, () => new Float32Array(Math.max(0, yHi - yLo)));
      if (pcm) {
        for (let i = 0; i < yHi - yLo; i++) {
          const x = (clip.in + (dir * (yLo + i)) / sr - pcm.start) * pcm.rate;
          const k = Math.floor(x);
          if (k < 0 || k + 1 >= pcm.data[0].length) continue;
          const f = x - k;
          for (let c = 0; c < channels; c++) input[c][i] = pcm.data[c][k] + (pcm.data[c][k + 1] - pcm.data[c][k]) * f;
        }
      }
      const out = Array.from({ length: channels }, () => new Float32Array(len));
      retimer.render(input, yLo, n, out);
      if (tape) {
        for (let i = 0; i < len; i++) {
          const g = tape.gain((n + i) / sr - clipStart);
          if (g < 1) for (const ch of out) ch[i] *= g;
        }
      }
      const buffer = ctx.createBuffer(channels, len, sr);
      out.forEach((ch, c) => buffer.copyToChannel(ch, c));
      let when = toCtx(n / sr);
      let offset = 0;
      if (realtime && when < ctx.currentTime) {
        offset = ctx.currentTime - when;
        when = ctx.currentTime;
      }
      if (offset >= len / sr) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(gain);
      node.start(grid(when), offset);
      nodes.add(node);
      node.onended = () => nodes.delete(node);
      if (realtime) {
        while (!stopped && when - ctx.currentTime > 1.5) await sleep(100);
      }
    }
  }

  return {
    stop() {
      stopped = true;
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      nodes.clear();
      // Echo and reverb would ring on after a pause: cut every clip off.
      for (const o of outs) o.disconnect();
      outs.length = 0;
      master.disconnect();
      splitters.forEach(split => split.disconnect());
      for (const [id, node] of buses) {
        node.disconnect();
        if (trackMeters.get(id) === taps.get(id)) trackMeters.delete(id);
      }
    },
    done: Promise.all(pumps).then(() => undefined),
  };
}

// ---- realtime clock -------------------------------------------------------------

let shared: AudioContext | null = null;

/** The app's one AudioContext, created on first use (needs a user gesture
 * to start; play() resumes it). 48 kHz, tuned for playback over latency. */
export function audioContext(): AudioContext {
  if (!shared) {
    shared = new AudioContext({ latencyHint: "playback", sampleRate: 48000 });
  }
  return shared;
}

/**
 * The context time of the sample the listener hears right now: compensates
 * output latency, which on Bluetooth is 100-300 ms and makes lips lead
 * sound if ignored (Web media engine pitfall 9).
 */
export function audibleTime(ctx: AudioContext): number {
  const fallback = ctx.currentTime - (ctx.outputLatency ?? 0) - ctx.baseLatency;
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0 && ts.performanceTime > 0) {
    const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    // Some environments (no audio device, headless) report a performanceTime
    // from another time base; an audible time far from currentTime is that.
    if (Math.abs(t - ctx.currentTime) < 1) return t;
  }
  return fallback;
}

// ---- master bus and meters ----------------------------------------------------

export interface MasterBus {
  input: GainNode;
  left: AnalyserNode;
  right: AnalyserNode;
}

let bus: MasterBus | null = null;

/** Playback's master bus: everything scheduled for preview goes through it,
 * so the meters show exactly what reaches the speakers. */
export function masterBus(): MasterBus {
  if (bus) return bus;
  const ctx = audioContext();
  const input = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const mk = () => Object.assign(ctx.createAnalyser(), { fftSize: 1024, smoothingTimeConstant: 0 });
  const left = mk();
  const right = mk();
  input.connect(ctx.destination);
  input.connect(split);
  split.connect(left, 0);
  split.connect(right, 1);
  bus = { input, left, right };
  return bus;
}

/** Hear the program or not (a voiceover take mutes it); the meters keep
 * reading either way. */
export function setMonitor(on: boolean) {
  const { input } = masterBus();
  const ctx = audioContext();
  try {
    if (on) input.connect(ctx.destination);
    else input.disconnect(ctx.destination);
  } catch {
    /* already in that state */
  }
}

const scratch = new Float32Array(1024);

/** Peak level of an analyser's last block, in dBFS (-Infinity for silence). */
let loudnessTap: Promise<AudioWorkletNode> | null = null;

/** Feed `onStep` the master bus's K-weighted mean square every 100 ms (the
 * LUFS meter). One tap, connected once and kept: two biquads a sample. */
export function tapLoudness(onStep: (meanSquare: number) => void): Promise<() => void> {
  const ctx = audioContext();
  loudnessTap ??= ctx.audioWorklet.addModule("/loudness-tap.js").then(() => {
    const node = new AudioWorkletNode(ctx, "loudness-tap", { numberOfOutputs: 1, channelCount: 2, channelCountMode: "explicit", processorOptions: { filters: kWeighting(ctx.sampleRate) } });
    // A silent path to the output keeps the tap pulled by the graph.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    masterBus().input.connect(node).connect(sink).connect(ctx.destination);
    return node;
  });
  loudnessTap.catch(() => (loudnessTap = null));
  return loudnessTap.then((node) => {
    const on = (e: MessageEvent<number>) => onStep(e.data);
    node.port.addEventListener("message", on);
    node.port.start();
    return () => node.port.removeEventListener("message", on);
  });
}

export function peakDb(a: AnalyserNode): number {
  a.getFloatTimeDomainData(scratch);
  let peak = 0;
  for (let i = 0; i < scratch.length; i++) peak = Math.max(peak, Math.abs(scratch[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** The equalizer's bands in a row, low first, the same in preview and
 * export; null when every band is flat. */
function eqChain(ctx: BaseAudioContext, eq: Sound["eq"]): { input: AudioNode; output: AudioNode } | null {
  const bands = EQ_BANDS.filter((b) => eq?.[b.key]).map((b) => new BiquadFilterNode(ctx, { type: b.type, frequency: b.frequency, ...("q" in b ? { Q: b.q } : {}), gain: Math.max(-12, Math.min(12, eq![b.key]!)) }));
  if (!bands.length) return null;
  bands.slice(1).forEach((f, i) => bands[i].connect(f));
  return { input: bands[0], output: bands[bands.length - 1] };
}

/**
 * A clip's compressor as nodes: the platform's DynamicsCompressorNode and a
 * makeup gain. Playback, export and loudness measurement all build it here,
 * so what is measured is what plays.
 * ponytail: the node's built-in 6 ms lookahead delays a compressed clip's
 * sound by 6 ms, a fifth of a frame; compensate if sync ever needs better.
 */
export function compressorNodes(ctx: BaseAudioContext, c: Compressor): { input: AudioNode; output: AudioNode } {
  const comp = new DynamicsCompressorNode(ctx, { threshold: c.threshold, ratio: c.ratio, knee: c.knee, attack: c.attack, release: c.release });
  const makeup = new GainNode(ctx, { gain: 10 ** (c.makeup / 20) });
  comp.connect(makeup);
  return { input: comp, output: makeup };
}

const trackMeters = new Map<string, [AnalyserNode, AnalyserNode]>();
export function trackMeter(id: string) { return trackMeters.get(id); }
export function readMeter(node?: AnalyserNode | [AnalyserNode, AnalyserNode]) {
  const nodes = node ? Array.isArray(node) ? node : [node] : [];
  const samples = new Float32Array(nodes.reduce((sum, n) => sum + n.fftSize, 0));
  let offset = 0;
  for (const n of nodes) { n.getFloatTimeDomainData(samples.subarray(offset, offset + n.fftSize)); offset += n.fftSize; }
  return meterLevels(samples);
}
