// The built-in sound effects as an app action: the effect's WAV is made
// on first use (lib/sfx.ts), imported like a dropped file, and reused by
// name after that; the clip lands at the playhead by a library drop's
// rules (an audio track).

import type { Asset, Id } from "../lib/project/types";
import { placeSounds, SFX, type SoundCue } from "../lib/sfx";
import { secondsToFrames } from "../lib/time";
import { encodeWav } from "../lib/wav";
import { audioContext } from "../engine/audio";
import { edit } from "./actions";
import { addToTimeline, adoptAndImport } from "./media";
import { store } from "./store";

const RATE = 48000;

/** Effect `id`'s file in the project, made and imported on first use. */
async function soundAsset(id: string): Promise<Asset> {
  const s = SFX[id];
  if (!s) throw new Error(`No sound effect ${id}; there are ${Object.keys(SFX).join(", ")}`);
  const name = `${s.label}.wav`;
  // ponytail: reused by name; a file of the user's with the same name is
  // taken for it.
  let asset = store.get().project.assets.find((a) => a.kind === "audio" && a.name === name);
  if (!asset) [asset] = await adoptAndImport([new File([encodeWav(s.make(RATE), RATE)], name, { type: "audio/wav" })]);
  if (!asset) throw new Error(`Couldn't add ${s.label}`);
  return asset;
}

/** Add sound effect `id` at timeline frame `frame` (or second `at`; the
 * playhead by default), or ending at second `endAt`, so a riser peaks
 * there; one that would start before 0 loses its head instead. */
export async function addSoundEffect(id: string, opts: { at?: number; frame?: number; endAt?: number } = {}): Promise<{ clipId: Id }> {
  const s = SFX[id];
  if (!s) throw new Error(`No sound effect ${id}; there are ${Object.keys(SFX).join(", ")}`);
  const asset = await soundAsset(id);
  const p = store.get().project;
  const head = opts.endAt !== undefined ? Math.max(0, s.seconds - opts.endAt) : 0;
  const frame = opts.frame ?? (opts.endAt !== undefined ? secondsToFrames(Math.max(0, opts.endAt - s.seconds), p.fps) : opts.at !== undefined ? secondsToFrames(opts.at, p.fps) : store.get().playhead);
  return { clipId: addToTimeline(asset, frame, undefined, head > 0 ? { in: Math.min(head, asset.duration - 0.05), out: asset.duration } : undefined) };
}

/** Several sound effects in one undoable edit (add_sound_effect's list):
 * every file is made first, so a bad name changes nothing. */
export async function addSoundEffects(cues: SoundCue[]): Promise<{ clipIds: Id[] }> {
  const bad = cues.find((c) => !SFX[c.name]);
  if (bad) throw new Error(`No sound effect ${bad.name}; there are ${Object.keys(SFX).join(", ")}`);
  const assets = new Map<string, Asset>();
  for (const name of new Set(cues.map((c) => c.name))) assets.set(name, await soundAsset(name));
  let clipIds: Id[] = [];
  edit(cues.length === 1 ? `Add ${SFX[cues[0].name].label}` : `Add ${cues.length} sound effects`, (p) => {
    const r = placeSounds(p, cues, assets, store.get().playhead);
    clipIds = r.clipIds;
    return r.project;
  });
  return { clipIds };
}

/** Hear an effect before adding it, on the app's own audio output. */
export function auditionSoundEffect(id: string) {
  const s = SFX[id];
  if (!s) return;
  const ctx = audioContext();
  const [l, r] = s.make(ctx.sampleRate);
  const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
  buf.copyToChannel(new Float32Array(l), 0);
  buf.copyToChannel(new Float32Array(r), 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  void ctx.resume().then(() => src.start());
}
