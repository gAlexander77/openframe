// The built-in sound effects as an app action: the effect's WAV is made
// on first use (lib/sfx.ts), saved with the project's media and reused by
// name after that; the clips land on the effects track (ADR-098), the new
// file and the clips in one undoable edit.

import { findClip } from "../lib/project/ops";
import type { Asset, Id, Project } from "../lib/project/types";
import { placeSounds, SFX, type SoundCue } from "../lib/sfx";
import { framesToSeconds } from "../lib/time";
import { encodeWav } from "../lib/wav";
import { audioContext } from "../engine/audio";
import { edit } from "./actions";
import { adoptAndProbe, prepare } from "./media";
import { store } from "./store";

const RATE = 48000;

/** Effect `id`'s file: the project's own when it has one, else made and
 * probed (not yet in the project: `fresh`, for the edit to add). */
async function soundAsset(id: string): Promise<{ asset: Asset; fresh: boolean }> {
  const s = SFX[id];
  if (!s) throw new Error(`No sound effect ${id}; there are ${Object.keys(SFX).join(", ")}`);
  const name = `${s.label}.wav`;
  // Files made before Asset.sound are found by name.
  const own = store.get().project.assets.find((a) => a.kind === "audio" && (a.sound?.id === id || (!a.sound && !a.role && a.name === name)));
  if (own) return { asset: own, fresh: false };
  const [made] = await adoptAndProbe([new File([encodeWav(s.make(RATE), RATE)], name, { type: "audio/wav" })]);
  if (!made) throw new Error(`Couldn't add ${s.label}`);
  return { asset: { ...made, role: "effects", sound: { id } }, fresh: true };
}

/** Add sound effect `id` at timeline frame `frame` (or second `at`; the
 * playhead by default), or ending at second `endAt`, so a riser peaks
 * there; one that would start before 0 loses its head instead. */
export async function addSoundEffect(id: string, opts: { at?: number; frame?: number; endAt?: number } = {}): Promise<{ clipId: Id }> {
  const at = opts.frame !== undefined ? framesToSeconds(opts.frame, store.get().project.fps) : opts.at;
  const { clipIds } = await addSoundEffects([{ name: id, ...(at !== undefined ? { at } : {}), ...(opts.endAt !== undefined ? { endAt: opts.endAt } : {}) }]);
  store.select(clipIds);
  // Added at the playhead (the + button): the playhead moves past it, so
  // repeated adds line up, as a library add does.
  const c = at === undefined && opts.endAt === undefined ? findClip(store.get().project, clipIds[0])?.clip : undefined;
  if (c) store.seek(c.start + c.duration);
  return { clipId: clipIds[0] };
}

/** Several sound effects in one undoable edit (add_sound_effect's list):
 * every file is made first, so a bad name changes nothing. */
export async function addSoundEffects(cues: SoundCue[]): Promise<{ clipIds: Id[] }> {
  const bad = cues.find((c) => !SFX[c.name]);
  if (bad) throw new Error(`No sound effect ${bad.name}; there are ${Object.keys(SFX).join(", ")}`);
  const assets = new Map<string, Asset>();
  const fresh: Asset[] = [];
  for (const name of new Set(cues.map((c) => c.name))) {
    const r = await soundAsset(name);
    assets.set(name, r.asset);
    if (r.fresh) fresh.push(r.asset);
  }
  let clipIds: Id[] = [];
  edit(cues.length === 1 ? `Add ${SFX[cues[0].name].label}` : `Add ${cues.length} sound effects`, (p) => {
    const r = placeSounds({ ...p, assets: [...p.assets, ...fresh] }, cues, assets, store.get().playhead);
    clipIds = r.clipIds;
    return r.project;
  });
  fresh.forEach(prepare);
  return { clipIds };
}

/** Effects' files that a command places itself (add_callout's click,
 * ADR-120): made and probed when the project has none yet. `add` puts the
 * new ones in the project inside the command's own edit, so the file and
 * the clips are one undo step; `done` prepares them once added. */
export async function soundFiles(ids: string[]): Promise<{ add: (p: Project) => Project; done: () => void }> {
  const fresh: Asset[] = [];
  for (const id of ids) {
    const r = await soundAsset(id);
    if (r.fresh) fresh.push(r.asset);
  }
  return { add: (p) => (fresh.length ? { ...p, assets: [...p.assets, ...fresh.filter((x) => !p.assets.some((y) => y.id === x.id))] } : p), done: () => fresh.forEach(prepare) };
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
