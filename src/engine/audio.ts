// Audio scheduling on Web Audio, shared by preview (AudioContext) and export
// (OfflineAudioContext windows). Each sounding clip streams decoded chunks
// from mediabunny's AudioBufferSink into AudioBufferSourceNodes scheduled on
// the sample grid, through a gain (the envelope from lib/audio.ts) and a
// panner. This is the mediabunny media player's algorithm extended to many
// clips (docs/research/Web media engine.md §1.6, §4.1).
//
// Ramps, reverse and pitch-kept speed changes cannot be a node's
// playbackRate: the engine renders those clips itself in short blocks
// (lib/stretch.ts) and schedules each block at rate 1 (ADR-028).

import type { AudioBufferSink } from "mediabunny";
import { gainEnvelope, soundingClips } from "../lib/audio";
import { getAsset, sourceOffset } from "../lib/project/ops";
import type { AudioClip, Project, VideoClip } from "../lib/project/types";
import { varispeed, wsola } from "../lib/stretch";
import { framesToSeconds } from "../lib/time";
import { mediaFor } from "./media";

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
  for await (const { buffer, timestamp } of sink.buffers(a + off, b + off)) {
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
  let stopped = false;
  const nodes = new Set<AudioScheduledSourceNode>();
  const sr = ctx.sampleRate;
  const grid = (t: number) => Math.round(t * sr) / sr;
  const toCtx = (timelineSec: number) => at + (timelineSec - from);
  const hasAudio = (id: string) => getAsset(p, id)?.hasAudio ?? false;

  const pumps = soundingClips(p, hasAudio).map(async ({ clip, track }) => {
    const clipStart = framesToSeconds(clip.start, p.fps);
    const clipEnd = framesToSeconds(clip.start + clip.duration, p.fps);
    const lo = Math.max(from, clipStart);
    const hi = Math.min(to, clipEnd);
    if (hi <= lo) return;
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
    pan.pan.value = Math.max(-1, Math.min(1, clip.pan));
    gain.connect(pan).connect(dest);
    gain.gain.setValueAtTime(0, Math.max(0, toCtx(lo) - 0.01));
    const env = gainEnvelope(clip, track, p.fps, lo, hi);
    const envAt = Math.max(toCtx(lo), realtime ? ctx.currentTime : 0);
    const envDur = toCtx(hi) - envAt;
    if (envDur > 0.01) {
      // Trim the envelope's head if we start late (realtime only).
      const skip = Math.floor(((envAt - toCtx(lo)) / (hi - lo)) * env.length);
      gain.gain.setValueCurveAtTime(env.subarray(Math.min(skip, env.length - 2)), envAt, envDur);
    }

    if (needsRetime(clip)) {
      await retimed(clip, clipStart, lo, hi, media.audioSink, media.audioStart, asset.duration, gain);
      return;
    }
    const speed = clip.speed;
    const perSec = speed; // source seconds per timeline second
    const srcLo = clip.in + (lo - clipStart) * perSec;
    const srcHi = clip.in + (hi - clipStart) * perSec;

    const off = media.audioStart;
    for await (const { buffer, timestamp } of media.audioSink.buffers(srcLo + off, srcHi + off)) {
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
      node.connect(gain);
      node.start(grid(when), offset);
      node.stop(grid(toCtx(hi)));
      nodes.add(node);
      node.onended = () => nodes.delete(node);
      if (realtime) {
        while (!stopped && when - ctx.currentTime > 1.5) await sleep(100);
      }
    }
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
    gain: GainNode,
  ) {
    const fpsRate = p.fps.num / p.fps.den;
    const dir = clip.reverse ? -1 : 1;
    const pos = (n: number) => sourceOffset(clip, (n / sr - clipStart) * fpsRate, p.fps) * sr;
    const retimer = clip.changePitch ? varispeed(pos) : wsola(pos, sr);
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

const scratch = new Float32Array(1024);

/** Peak level of an analyser's last block, in dBFS (-Infinity for silence). */
export function peakDb(a: AnalyserNode): number {
  a.getFloatTimeDomainData(scratch);
  let peak = 0;
  for (let i = 0; i < scratch.length; i++) peak = Math.max(peak, Math.abs(scratch[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}
