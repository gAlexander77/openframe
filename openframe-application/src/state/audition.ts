// preview_audio (ADR-098): a stretch of the mix, or one stem, rendered
// offline through the mixer export uses (engine/mixdown.ts), encoded as a
// short MP3 a model that takes audio can listen to, and measured for one
// that cannot (lib/analysis/audition.ts). Nothing is edited.

import { AudioBufferSource, BufferTarget, Mp3OutputFormat, Output, Quality } from "mediabunny";
import { ensureMp3 } from "../engine/export";
import { hasSound, measureMix, mixPreroll, planesOf, renderMixWindow, WINDOW_SECONDS } from "../engine/mixdown";
import { audioContext, scheduleAudio } from "../engine/audio";
import { findClip } from "../lib/project/ops";
import { decodeMono } from "../engine/analyze";
import { auditionSummary, type AuditionSummary } from "../lib/analysis/audition";
import { audioCrossfade } from "../lib/audio";
import { edgeReport, ownOnset, type AudioEdge, type EdgeReport } from "../lib/analysis/edges";
import { isolateTracks } from "../lib/analysis/balance";
import { applyLimiter } from "../lib/analysis/loudness";
import { stemsOf } from "../lib/audioRoles";
import { EXPORT_SAMPLE_RATE } from "../lib/export";
import { projectDuration, rollBounds } from "../lib/project/ops";
import type { AudioClip, Id, Project, TrackRole } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { currentScreen } from "./project";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

/** The longest stretch one call hears: a 30 s MP3 is about 360 KB. */
export const PREVIEW_MAX_SECONDS = 30;
const BITRATE = 96_000;
const RATE = EXPORT_SAMPLE_RATE;

export type Solo = "mix" | "voice" | "music" | "effects" | "ambience";
const ROLE: Record<Exclude<Solo, "mix">, TrackRole> = { voice: "dialog", music: "music", effects: "effects", ambience: "ambience" };

export interface AuditionRequest {
  start: number;
  end?: number;
  solo?: Solo;
  /** Hear it as export_video with this loudness delivers it. */
  loudness?: number;
  /** Leave the MP3 out: the measurements alone. */
  audio?: boolean;
}

export interface AuditionAnswer {
  mp3?: Uint8Array;
  summary: AuditionSummary & {
    start: number;
    end: number;
    solo: Solo;
    /** The tracks heard, when one stem is. */
    tracks?: string[];
    /** Each stem's own integrated loudness where it sounds, and the
     * picture's: what the video tracks play (their footage's own sound,
     * compound clips' mix), which no stem holds. */
    stems?: Partial<Record<TrackRole | "picture", number | null>>;
    as_exported_at?: number;
    /** Every join of audio clips in the stretch, and any start or end of
     * one that clicks, cuts a sound off or comes in mid-sound (ADR-104). */
    edges?: EdgeReport[];
    note?: string;
  };
}

/** Seconds of a file measured either side of an edge. */
const SIDE = 0.3;
/** Under this (dBFS RMS) a file is silent: a digital breath before a hit. */
const SILENT_DBFS = -60;

/** The audio clips' edges heard in [start, end): joins (a clip ending
 * where the next on its track starts) and lone starts and ends, each with
 * how its file goes on past the cut or came before it. */
async function edgesOf(p: Project, heard: Project, start: number, end: number, signal: AbortSignal): Promise<AudioEdge[]> {
  const sec = (f: number) => framesToSeconds(f, p.fps);
  const out: AudioEdge[] = [];
  const level = async (c: AudioClip, a: number, b: number) => {
    const asset = p.assets.find((x) => x.id === c.assetId);
    if (!asset?.hasAudio || a < 0 || b > asset.duration) return undefined;
    const pcm = await decodeMono(asset, a, b, 16000, undefined, signal);
    let s = 0;
    for (const x of pcm) s += x * x;
    return pcm.length ? 10 * Math.log10(s / pcm.length + 1e-20) : undefined;
  };
  const plain = (c: AudioClip) => c.speed === 1 && !c.speedCurve && !c.reverse && !c.freeze;
  const diff = (x?: number, y?: number) => (x === undefined || y === undefined ? undefined : Math.max(-60, Math.min(60, x - y)));
  // The incoming file's own attack at its in-point, at the render's rate:
  // a cut on a downbeat plays the kick's first step, which is no click.
  const onset = async (c: AudioClip) => {
    const asset = p.assets.find((x) => x.id === c.assetId);
    if (!asset?.hasAudio || !plain(c) || c.in + 0.064 > asset.duration) return {};
    const from = Math.max(0, c.in - 0.004);
    const x = await decodeMono(asset, from, c.in + 0.064, RATE, undefined, signal);
    return { onset: ownOnset(x, RATE, Math.round((c.in - from) * RATE)) };
  };
  // How long the incoming file is digital silence right before its
  // in-point (a breath before a drop): a crossfade into it fades into that
  // silence, and a longer one deepens the hole (ADR-125). Seconds, from
  // the in-point back, when 20 ms or more.
  const silentBefore = async (c: AudioClip) => {
    const asset = p.assets.find((x) => x.id === c.assetId);
    if (!asset?.hasAudio || !plain(c) || c.in < 0.02) return undefined;
    const rate = 16000, win = rate / 200;
    const x = await decodeMono(asset, Math.max(0, c.in - 1), c.in, rate, undefined, signal);
    let n = 0;
    for (let e = x.length; e - win >= 0; e -= win) {
      let s = 0;
      for (let i = e - win; i < e; i++) s += x[i] * x[i];
      if (10 * Math.log10(s / win + 1e-20) > SILENT_DBFS) break;
      n += win;
    }
    return n / rate >= 0.02 ? +(n / rate).toFixed(3) : undefined;
  };
  // Where the join could move instead (roll_edit), a bar later or earlier
  // (the song's grid, or Bar markers on either clip), keeping both clips a
  // frame long and in their files, with the incoming file sounding before
  // its new in-point.
  const rollTo = async (a: AudioClip, b: AudioClip): Promise<number | undefined> => {
    const at = sec(b.start);
    const grid = p.assets.find((x) => x.id === b.assetId)?.musicGrid;
    const bars = grid
      ? [at + 240 / grid.bpm, at - 240 / grid.bpm]
      : p.markers.filter((m) => m.label === "Bar" && (m.follows?.clip === a.id || m.follows?.clip === b.id) && m.frame !== b.start).map((m) => sec(m.frame)).sort((x, y) => Math.abs(x - at) - Math.abs(y - at) || y - x).slice(0, 2);
    const bounds = rollBounds(p, a.id, b.id);
    const asset = p.assets.find((x) => x.id === b.assetId);
    if (!bounds || !asset) return undefined;
    for (const to of bars) {
      const fr = Math.round(to * p.fps.num / p.fps.den);
      if (fr < bounds.lo || fr > bounds.hi) continue;
      const inB = b.in + (to - at);
      if (inB < 0.05) continue;
      const pre = await decodeMono(asset, inB - 0.05, inB, 16000, undefined, signal);
      let s = 0;
      for (const v of pre) s += v * v;
      if (pre.length && 10 * Math.log10(s / pre.length + 1e-20) > SILENT_DBFS) return +to.toFixed(3);
    }
    return undefined;
  };
  for (const t of heard.tracks) {
    if (t.kind !== "audio" || t.muted) continue;
    const clips = t.clips.filter((c): c is AudioClip => c.type === "audio" && !c.disabled && !c.muted).sort((a, b) => a.start - b.start);
    for (const [i, c] of clips.entries()) {
      const prev = clips[i - 1]?.start + clips[i - 1]?.duration === c.start ? clips[i - 1] : undefined;
      const next = clips[i + 1]?.start === c.start + c.duration ? clips[i + 1] : undefined;
      const at0 = sec(c.start), at1 = sec(c.start + c.duration);
      const out1 = c.in + sec(c.duration);
      if (!prev && at0 > start + 0.16 && at0 < end - 0.16)
        out.push({ at: +at0.toFixed(3), kind: "start", clips: [c.id], faded: sec(c.fadeIn), ...(plain(c) && c.in >= SIDE ? { cameIn: diff(await level(c, c.in - SIDE, c.in), await level(c, c.in, c.in + SIDE)) } : {}), ...(await onset(c)) });
      if (at1 > start + 0.16 && at1 < end - 0.16) {
        const goesOn = plain(c) ? diff(await level(c, out1, out1 + SIDE), await level(c, out1 - SIDE, out1)) : undefined;
        // The next clip's own step at its in-point: the music's, not the cut's.
        const cameIn = next && plain(next) && next.in >= SIDE ? diff(await level(next, next.in - SIDE, next.in), await level(next, next.in, next.in + SIDE)) : undefined;
        const silent = next ? await silentBefore(next) : undefined;
        const roll = next && silent !== undefined ? await rollTo(c, next) : undefined;
        out.push({ at: +at1.toFixed(3), kind: next ? "join" : "end", clips: next ? [c.id, next.id] : [c.id], faded: next ? audioCrossfade(c, next, p.fps) : sec(c.fadeOut), ...(goesOn !== undefined ? { goesOn } : {}), ...(cameIn !== undefined ? { cameIn } : {}), ...(next ? await onset(next) : {}), ...(next && silent !== undefined ? { silentBefore: { seconds: silent, in: next.in }, ...(roll !== undefined ? { rollTo: roll } : {}) } : {}) });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** [start, end) of `p` rendered as export renders it, stereo at 48 kHz. */
async function render(p: Project, start: number, end: number, signal: AbortSignal): Promise<[Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]> {
  const total = Math.round((end - start) * RATE);
  const L = new Float32Array(total), R = new Float32Array(total);
  if (!hasSound(p)) return [L, R];
  const preroll = mixPreroll(p);
  for (let at = 0; at < total; at += WINDOW_SECONDS * RATE) {
    signal.throwIfAborted();
    const len = Math.min(WINDOW_SECONDS * RATE, total - at);
    const b = await renderMixWindow(p, start + at / RATE, len, RATE, 2, preroll);
    const [l, r] = planesOf(b);
    L.set(l, at);
    R.set(r ?? l, at);
  }
  return [L, R];
}

/** Stereo planes as an MP3 file, LAME in WebAssembly where the platform has no encoder. */
async function mp3(L: Float32Array<ArrayBuffer>, R: Float32Array<ArrayBuffer>): Promise<Uint8Array> {
  await ensureMp3(BITRATE);
  const target = new BufferTarget();
  const out = new Output({ format: new Mp3OutputFormat(), target });
  const src = new AudioBufferSource({ codec: "mp3", quality: new Quality({ bitrate: BITRATE }) });
  out.addAudioTrack(src);
  await out.start();
  for (let at = 0; at < L.length; at += RATE) {
    const n = Math.min(RATE, L.length - at);
    const piece = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: RATE });
    piece.copyToChannel(L.subarray(at, at + n), 0);
    piece.copyToChannel(R.subarray(at, at + n), 1);
    await src.add(piece);
  }
  src.close();
  await out.finalize();
  return new Uint8Array(target.buffer!);
}

const r3 = (x: number) => +x.toFixed(3);

/** Seconds heard before and after a join when check_project measures it:
 * the 1.3 s before a cut tell a ring-out, the 0.3 s either side its level. */
const JOIN_BEFORE = 1.4, JOIN_AFTER = 0.4;

/**
 * One join of two audio clips judged as preview_audio's edges judge it,
 * heard on its own track alone (check_project, ADR-119): a voice or a hit
 * on another track neither hides a click nor makes one. `at` is the join's
 * timeline second; undefined when it plays in silence or cannot be heard.
 */
export async function joinEdge(p: Project, trackId: Id, at: number, signal: AbortSignal): Promise<EdgeReport | undefined> {
  const heard = isolateTracks(p, [trackId]);
  const start = Math.max(0, at - JOIN_BEFORE), end = at + JOIN_AFTER;
  const [L, R] = await render(heard, start, end, signal);
  const edges = (await edgesOf(p, heard, start, end, signal)).filter((e) => e.kind === "join" && Math.abs(e.at - at) < 0.002);
  return edgeReport(L, R, RATE, start, edges)[0];
}

/** preview_audio: hear (and measure) [start, end) of the mix or one stem. */
export async function previewAudio(req: AuditionRequest): Promise<AuditionAnswer> {
  if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
  const p = store.document();
  const duration = framesToSeconds(projectDuration(p), p.fps);
  const start = Math.max(0, req.start);
  if (!(start < duration)) throw new Error(`Nothing to hear: the timeline ends at ${r3(duration)} s.`);
  const asked = req.end ?? start + 10;
  if (!(asked > start)) throw new Error("end must be after start");
  const end = Math.min(asked, duration, start + PREVIEW_MAX_SECONDS);
  const notes: string[] = [];
  if (asked > duration + 1e-6 && duration <= start + PREVIEW_MAX_SECONDS) notes.push(`The timeline ends at ${r3(duration)} s.`);
  else if (asked > start + PREVIEW_MAX_SECONDS + 1e-6) notes.push(`At most ${PREVIEW_MAX_SECONDS} s a call: this is ${r3(start)}-${r3(end)} s; call again from ${r3(end)}.`);
  const solo = req.solo ?? "mix";
  const stems = stemsOf(p);
  const ids = solo === "mix" ? p.tracks.map((t) => t.id) : stems[ROLE[solo]];
  if (!ids.length) throw new Error(`No ${ROLE[solo as Exclude<Solo, "mix">]} tracks to hear. describe_project names each audio track's role; update_track role sets one.`);
  const heard = solo === "mix" ? p : isolateTracks(p, ids);
  const signal = projectWork.signal();
  const tid = toast("Rendering the sound", "progress");
  try {
    const [L, R] = await render(heard, start, end, signal);
    let asExported: number | undefined;
    if (req.loudness !== undefined) {
      // What export does to the whole mix (a gain, a limiter on its peaks),
      // applied to this stretch where it sits in it.
      const m = await measureMix(p, 0, duration, { loudness: req.loudness, signal, onProgress: (x) => updateToast(tid, { progress: x * 0.8 }) });
      if (m.plan) applyLimiter([L, R], Math.round(start * RATE), m.plan.gain, m.plan.gains);
      asExported = req.loudness;
    }
    const summary: AuditionAnswer["summary"] = { start: r3(start), end: r3(end), solo, ...(solo === "mix" ? {} : { tracks: ids }), ...auditionSummary(L, R, RATE, start) };
    if (solo === "mix") {
      // Each stem's loudness here, as mixed (before any export loudness).
      summary.stems = {};
      for (const role of ["dialog", "music", "effects", "ambience"] as TrackRole[]) {
        if (!stems[role].length) continue;
        const [l, r] = await render(isolateTracks(p, stems[role]), start, end, signal);
        summary.stems[role] = auditionSummary(l, r, RATE, start).integrated_lufs;
      }
      // What the video tracks play (an interview's voice, a scene's own
      // sound, a compound clip's mix) is in the mix but in no stem:
      // without it the stems did not account for the mix.
      const picture = isolateTracks(p, p.tracks.filter((t) => t.kind === "video").map((t) => t.id));
      if (hasSound(picture)) {
        const [l, r] = await render(picture, start, end, signal);
        summary.stems.picture = auditionSummary(l, r, RATE, start).integrated_lufs;
      }
    }
    if (asExported !== undefined) summary.as_exported_at = asExported;
    // Each join, and any edge that is not clean, measured on what is heard.
    const edges = edgeReport(L, R, RATE, start, await edgesOf(p, heard, start, end, signal)).filter((e) => e.kind === "join" || e.verdict !== "clean");
    if (edges.length) summary.edges = edges;
    if (summary.clipped) notes.push("The mix passes full scale here, so a file of it clips: turn tracks or clips down, or export with a loudness target.");
    if (notes.length) summary.note = notes.join(" ");
    return { ...(req.audio === false ? {} : { mp3: await mp3(L, R) }), summary };
  } finally {
    dismiss(tid);
  }
}


let voiceAudition: (() => void) | null = null;
let voiceTimer: ReturnType<typeof setTimeout> | undefined;
/** Hear a selected clip's first three seconds, in isolation through the
 * live mixer. A new chip replaces the previous audition immediately. */
export async function auditionClip(id: Id): Promise<void> {
  voiceAudition?.();
  clearTimeout(voiceTimer);
  const p = store.get().project;
  const c = findClip(p, id)?.clip;
  if (!c) return;
  const ctx = audioContext();
  await ctx.resume();
  if (store.get().project !== p) return;
  const heard = { ...p, tracks: p.tracks.map((t) => ({ ...t, muted: false, solo: false, clips: t.clips.filter((x) => x.id === id) })) };
  const start = framesToSeconds(c.start, p.fps);
  const length = Math.min(3, framesToSeconds(c.duration, p.fps));
  const schedule = scheduleAudio(ctx, ctx.destination, heard, start, start + length, ctx.currentTime + 0.1);
  const signal = projectWork.signal();
  let unsubscribe = () => {};
  const stop = () => {
    unsubscribe();
    schedule.stop();
    if (voiceAudition === stop) voiceAudition = null;
    signal.removeEventListener("abort", stop);
  };
  unsubscribe = store.subscribe(() => { if (store.get().project !== p) stop(); });
  voiceAudition = stop;
  signal.addEventListener("abort", stop, { once: true });
  voiceTimer = setTimeout(stop, (length + 0.15) * 1000);
  await schedule.done;
}
