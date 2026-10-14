// Audio scheduling on Web Audio, shared by preview (AudioContext) and export
// (OfflineAudioContext windows). Each sounding clip streams decoded chunks
// from mediabunny's AudioBufferSink into AudioBufferSourceNodes scheduled on
// the sample grid, through a gain (the envelope from lib/audio.ts) and a
// panner. This is the mediabunny media player's algorithm extended to many
// clips (docs/research/Web media engine.md §1.6, §4.1).

import { gainEnvelope, soundingClips } from "../lib/audio";
import { getAsset } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
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

    const speed = clip.speed;
    const perSec = speed; // source seconds per timeline second
    const srcLo = clip.in + (lo - clipStart) * perSec;
    const srcHi = clip.in + (hi - clipStart) * perSec;

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
