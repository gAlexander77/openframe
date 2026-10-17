// Record voiceover, CapCut's microphone button: a 3-second countdown, then
// the timeline plays from the playhead while the microphone records; Stop
// places the take on an audio track where it was heard. Samples come
// through an AudioWorklet on the playback clock, so placement is exact to
// the sample (src/lib/voiceover.ts), and the take is saved as 16-bit WAV.

import { useSyncExternalStore } from "react";
import { audioContext, audibleTime, setMonitor } from "../engine/audio";
import { player } from "../engine/player";
import { runCommand } from "../lib/commands";
import { framesToSeconds } from "../lib/time";
import { placeTake } from "../lib/voiceover";
import { encodeWav } from "../lib/wav";
import { adoptAndImport } from "./media";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { toast } from "./toast";

export type VoiceoverPhase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "countdown"; n: number }
  | { kind: "recording"; since: number }
  | { kind: "saving" };

let phase: VoiceoverPhase = { kind: "idle" };
const listeners = new Set<() => void>();
const setPhase = (p: VoiceoverPhase) => {
  phase = p;
  listeners.forEach((l) => l());
};
// Read through a call: the phase changes across awaits, which narrowing
// cannot see.
const now = () => phase;
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useVoiceover = () => useSyncExternalStore(subscribe, () => phase);

interface Take {
  stream: MediaStream;
  source?: MediaStreamAudioSourceNode;
  tap?: AudioWorkletNode;
  sink?: GainNode;
  chunks: Float32Array[][];
  first: number | null;
  startSec: number;
  clock: { t0: number; ctxAt: number } | null;
  muted: boolean;
  level: number;
}
let take: Take | null = null;
let tapLoaded: Promise<void> | null = null;

/** The latest input peak, 0..1, for the panel's meter. */
export const inputLevel = () => take?.level ?? 0;

export async function microphones(): Promise<MediaDeviceInfo[]> {
  const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  return all.filter((d) => d.kind === "audioinput");
}

/** Release the microphone and the program mute, keeping nothing. */
function teardown() {
  if (!take) return;
  take.source?.disconnect();
  if (take.tap) take.tap.port.onmessage = null;
  take.tap?.disconnect();
  take.sink?.disconnect();
  take.stream.getTracks().forEach((t) => t.stop());
  if (take.muted) setMonitor(true);
  take = null;
}

export function cancelVoiceover() {
  if (phase.kind === "idle" || phase.kind === "saving") return;
  if (phase.kind === "recording") player.pause();
  teardown();
  // A start still waiting for the microphone sees the idle phase and stops.
  setPhase({ kind: "idle" });
}

export async function startVoiceover(opts: { deviceId?: string; mute: boolean }) {
  if (phase.kind !== "idle") return;
  const session = projectWork.signal();
  if (session.aborted) return;
  setPhase({ kind: "starting" });
  const ctx = audioContext();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.deviceId ? { deviceId: { exact: opts.deviceId } } : {}),
        // Raw voice: no gain riding or noise gate. Echo cancellation only
        // while the program is audible, where it keeps speakers out.
        echoCancellation: !opts.mute,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (e) {
    if (now().kind === "starting") setPhase({ kind: "idle" });
    toast(`The microphone is not available: ${(e as Error).message || e}`, "error");
    return;
  }
  if (session.aborted || now().kind !== "starting") {
    stream.getTracks().forEach((t) => t.stop());
    if (now().kind === "starting") setPhase({ kind: "idle" });
    return;
  }
  const mine: Take = { stream, chunks: [], first: null, startSec: 0, clock: null, muted: opts.mute, level: 0 };
  take = mine;
  const cancelOnClose = () => cancelVoiceover();
  session.addEventListener("abort", cancelOnClose, { once: true });
  player.pause();
  for (let n = 3; n > 0; n--) {
    setPhase({ kind: "countdown", n });
    await new Promise((r) => setTimeout(r, 1000));
    if (take !== mine) return; // canceled during the countdown
  }
  try {
    await ctx.resume();
    tapLoaded ??= ctx.audioWorklet.addModule("/voiceover-tap.js");
    await tapLoaded;
  } catch (e) {
    tapLoaded = null;
    teardown();
    setPhase({ kind: "idle" });
    toast(`Recording could not start: ${(e as Error).message || e}`, "error");
    return;
  }
  if (take !== mine) return;
  const t = mine;
  t.source = ctx.createMediaStreamSource(stream);
  t.tap = new AudioWorkletNode(ctx, "voiceover-tap", { numberOfOutputs: 1 });
  // A silent path to the output keeps the tap pulled by the graph.
  t.sink = ctx.createGain();
  t.sink.gain.value = 0;
  t.tap.port.onmessage = (e: MessageEvent<{ t: number; data: Float32Array[] }>) => {
    t.first ??= e.data.t;
    t.chunks.push(e.data.data);
    let peak = 0;
    for (const s of e.data.data[0] ?? []) peak = Math.max(peak, Math.abs(s));
    t.level = Math.max(peak, t.level * 0.9);
  };
  t.source.connect(t.tap).connect(t.sink).connect(ctx.destination);
  if (opts.mute) setMonitor(false);
  t.startSec = framesToSeconds(store.get().playhead, store.get().project.fps);
  await player.play(1, { once: true });
  t.clock = player.clock();
  setPhase({ kind: "recording", since: performance.now() });
}

export async function stopVoiceover() {
  if (phase.kind !== "recording" || !take) return;
  const t = take;
  const ctx = audioContext();
  const latency = Math.max(0, ctx.currentTime - audibleTime(ctx));
  player.pause();
  teardown();
  setPhase({ kind: "saving" });
  try {
    const session = projectWork.signal();
    const first = t.first;
    const channels = t.chunks[0]?.length ?? 0;
    if (first === null || !channels) throw new Error("No sound reached the recorder.");
    const p = store.get().project;
    // Without playback (an empty timeline) the take starts at the playhead.
    const clock = t.clock ?? { t0: t.startSec, ctxAt: first };
    const { start, skip } = placeTake({ first, ...clock, outputLatency: t.clock ? latency : 0, from: t.startSec }, p.fps, ctx.sampleRate);
    const data = Array.from({ length: channels }, (_, c) => {
      const all = new Float32Array(t.chunks.reduce((n, b) => n + (b[c]?.length ?? 0), 0));
      let at = 0;
      for (const b of t.chunks) if (b[c]) all.set(b[c], at), (at += b[c].length);
      return all.subarray(skip);
    });
    if (!data[0].length) throw new Error("The take was too short to keep.");
    const n = p.assets.filter((a) => /^Voiceover \d+\.wav$/.test(a.name)).length + 1;
    const file = new File([encodeWav(data, ctx.sampleRate)], `Voiceover ${n}.wav`, { type: "audio/wav" });
    const [asset] = await adoptAndImport([file]);
    if (!asset || session.aborted) return;
    store.edit("Record voiceover", (q) => runCommand(q, "add_media_clip", { asset_id: asset.id, start: framesToSeconds(start, q.fps) }));
  } catch (e) {
    toast(`The voiceover was not saved: ${(e as Error).message || e}`, "error");
  } finally {
    setPhase({ kind: "idle" });
  }
}
