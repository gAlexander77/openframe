// The built-in sound effects as an app action: the effect's WAV is made
// on first use (lib/sfx.ts), imported like a dropped file, and reused by
// name after that; the clip lands at the playhead by a library drop's
// rules (an audio track).

import type { Id } from "../lib/project/types";
import { SFX } from "../lib/sfx";
import { secondsToFrames } from "../lib/time";
import { encodeWav } from "../lib/wav";
import { audioContext } from "../engine/audio";
import { addToTimeline, adoptAndImport } from "./media";
import { store } from "./store";

const RATE = 48000;

/** Add sound effect `id` at timeline frame `frame` (or second `at`; the
 * playhead by default). */
export async function addSoundEffect(id: string, opts: { at?: number; frame?: number } = {}): Promise<{ clipId: Id }> {
  const s = SFX[id];
  if (!s) throw new Error(`No sound effect ${id}; there are ${Object.keys(SFX).join(", ")}`);
  const p = store.get().project;
  const frame = opts.frame ?? (opts.at !== undefined ? secondsToFrames(opts.at, p.fps) : store.get().playhead);
  const name = `${s.label}.wav`;
  // ponytail: reused by name; a file of the user's with the same name is
  // taken for it.
  let asset = p.assets.find((a) => a.kind === "audio" && a.name === name);
  if (!asset) [asset] = await adoptAndImport([new File([encodeWav(s.make(RATE), RATE)], name, { type: "audio/wav" })]);
  if (!asset) throw new Error(`Couldn't add ${s.label}`);
  return { clipId: addToTimeline(asset, frame) };
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
