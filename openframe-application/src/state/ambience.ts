// Ambience beds as an app action (add_ambience, the Audio tab's cards;
// ADR-098): the bed's file is synthesized in a worker (lib/ambience.ts),
// saved with the project's media and laid on the ambience track, the file
// and the clips one undoable edit. A file of the same bed and seed that
// is long enough is reused.

import { renderBedFile, renderBedPcm } from "../engine/ambience";
import { audioContext, masterBus } from "../engine/audio";
import { AMBIENCE, AMBIENCE_IDS, BED_MAX_SECONDS, bedFileName, placeBed } from "../lib/ambience";
import { projectDuration } from "../lib/project/ops";
import type { Asset, Id } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { edit } from "./actions";
import { adoptAndProbe, prepare } from "./media";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

const RATE = 48000;

export interface AmbienceRequest {
  name: string;
  /** Timeline seconds; default the playhead. */
  start?: number;
  /** Timeline seconds it ends; or `length` seconds; default the end of the
   * timeline (30 s past the start when that is sooner than 2 s away). */
  end?: number;
  length?: number;
  fadeIn?: number;
  fadeOut?: number;
  volume?: number;
  seed?: number;
  trackId?: Id;
}

export interface AmbienceAnswer {
  clip_ids: Id[];
  asset_id: Id;
  track_id: Id;
  start: number;
  end: number;
  /** The file's own length; a longer bed repeats it end to end. */
  file_seconds: number;
  reused: boolean;
}

const r3 = (x: number) => +x.toFixed(3);

/** Add bed `name` over a stretch of the timeline. */
export async function addAmbience(req: AmbienceRequest): Promise<AmbienceAnswer> {
  const signal = projectWork.capture();
  const bed = AMBIENCE[req.name];
  if (!bed) throw new Error(`No ambience ${req.name}; there are ${AMBIENCE_IDS.join(", ")}`);
  const p = store.get().project;
  const seed = Math.max(1, Math.round(req.seed ?? 1));
  const start = Math.max(0, req.start ?? framesToSeconds(store.get().playhead, p.fps));
  const timelineEnd = framesToSeconds(projectDuration(p), p.fps);
  const end = req.end ?? (req.length !== undefined ? start + req.length : timelineEnd - start >= 2 ? timelineEnd : start + 30);
  if (!(end - start >= 0.5)) throw new Error(`The bed must last at least half a second: it would run ${start} s to ${end} s.`);
  // The file: whole frames long (repeats cut on its loop point), at most
  // BED_MAX_SECONDS; a long enough one of this bed and seed is reused.
  const need = Math.min(end - start, BED_MAX_SECONDS);
  const tiles = end - start > BED_MAX_SECONDS + 1e-6;
  const fps = p.fps.num / p.fps.den;
  const whole = (a: Asset) => Math.abs(a.duration * fps - Math.round(a.duration * fps)) < 0.01;
  let asset = p.assets.find((a) => a.kind === "audio" && a.sound?.id === req.name && (a.sound.seed ?? 1) === seed && a.duration >= need - 1e-3 && (!tiles || whole(a)));
  let fresh: Asset | undefined;
  if (!asset) {
    const frames = tiles ? Math.floor(BED_MAX_SECONDS * fps) : Math.ceil(need * fps - 1e-6);
    const seconds = framesToSeconds(frames, p.fps);
    const tid = toast(`Making ${bed.label}`, "progress");
    try {
      const { wav } = await renderBedFile(req.name, seconds, seed, RATE, (x) => updateToast(tid, { progress: x }), signal);
      signal.throwIfAborted();
      const [made] = await adoptAndProbe([new File([wav], bedFileName(req.name, seconds, seed), { type: "audio/wav" })]);
      if (!made) throw new Error(`Couldn't add ${bed.label}`);
      asset = fresh = { ...made, role: "ambience", sound: { id: req.name, seed } };
    } finally {
      dismiss(tid);
    }
  }
  signal.throwIfAborted();
  let placed!: ReturnType<typeof placeBed>;
  const file = asset;
  edit(`Add ${bed.label}`, (q) => {
    placed = placeBed(fresh ? { ...q, assets: [...q.assets, fresh] } : q, file, { start, end, fadeIn: req.fadeIn, fadeOut: req.fadeOut, volume: req.volume, trackId: req.trackId });
    return placed.project;
  });
  if (fresh) prepare(fresh);
  return { clip_ids: placed.clipIds, asset_id: file.id, track_id: placed.trackId, start: r3(start), end: r3(end), file_seconds: r3(file.duration), reused: !fresh };
}

let playing: AudioBufferSourceNode | null = null;

/** Hear eight seconds of a bed on the app's own output (the Audio tab). */
export async function auditionAmbience(name: string): Promise<void> {
  const { left, right } = await renderBedPcm(name, 8, 1, RATE);
  try {
    playing?.stop();
  } catch {
    /* already stopped */
  }
  const ctx = audioContext();
  const buf = ctx.createBuffer(2, left.length, RATE);
  buf.copyToChannel(left, 0);
  buf.copyToChannel(right, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Faded at both ends: the preview is a cut from a longer bed.
  const g = ctx.createGain();
  const t = ctx.currentTime + 0.05;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 0.5);
  g.gain.setValueAtTime(1, t + 7);
  g.gain.linearRampToValueAtTime(0, t + 8);
  src.connect(g).connect(masterBus().input);
  await ctx.resume();
  src.start(t);
  playing = src;
}
