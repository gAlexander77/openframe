import { expect, it } from "vitest";
import { sharedChains, soundingClips, soundBuses } from "./audio";
import { COMPRESSOR_PRESETS } from "./compressor";
import { createCompound } from "./project/compound";
import { clipForAsset, createColorClip, createProject, createTrack } from "./project/defaults";
import { splitAt } from "./project/ops";
import type { AudioClip, Project } from "./project/types";

/** A 20 s song on an audio track, its sound settings `o`. */
function song(o: Partial<AudioClip> = {}): Project {
  const p = createProject();
  p.assets = [{ id: "a", name: "song.wav", src: "song.wav", kind: "audio", duration: 20, hasAudio: true, hasVideo: false }];
  const t = createTrack("audio", "Music");
  t.clips = [{ ...(clipForAsset(p.assets[0], 0, p.fps) as AudioClip), ...o }];
  return { ...p, tracks: [...p.tracks, t] };
}
const chains = (p: Project) => {
  const all = soundingClips(p, () => true);
  const runs = sharedChains(all);
  return all.map((s) => runs.get(s) ?? null);
};

it("runs a split's halves through one EQ and compressor (ADR-117)", () => {
  // Each half had its own: the second's compressor started with no gain
  // reduction, and the render came within 15-21 dB of the whole clip's
  // sound for 12-14 ms after the cut.
  const p = splitAt(splitAt(song({ compressor: COMPRESSOR_PRESETS.strong }), 90), 240);
  const first = p.tracks.flatMap((t) => t.clips)[0].id;
  expect(chains(p)).toEqual([{ key: first, next: true }, { key: first, next: true }, { key: first, next: false }]);
  // An EQ alone is carried too: its filters do not start again.
  expect(chains(splitAt(song({ eq: { low: 6 } }), 90)).map((r) => r?.next)).toEqual([true, false]);
});

it("keeps two chains where the halves differ or do not go on", () => {
  // Nothing to carry.
  expect(chains(splitAt(song(), 90))).toEqual([null, null]);
  // Different compressors (or EQs) are two compressors.
  const p = splitAt(song({ compressor: COMPRESSOR_PRESETS.voice }), 90);
  const t = p.tracks.find((x) => x.kind === "audio")!;
  t.clips[1] = { ...t.clips[1], compressor: { ...COMPRESSOR_PRESETS.voice, threshold: -30 } } as AudioClip;
  expect(chains(p)).toEqual([null, null]);
  // A cut that skips part of the file is a splice, not a split.
  const q = splitAt(song({ compressor: COMPRESSOR_PRESETS.voice }), 90);
  const u = q.tracks.find((x) => x.kind === "audio")!;
  u.clips[1] = { ...u.clips[1], in: (u.clips[1] as AudioClip).in + 1 } as AudioClip;
  expect(chains(q)).toEqual([null, null]);
});

it("carries a split inside a compound clip, as the mixer hears it", () => {
  let p = splitAt(song({ compressor: COMPRESSOR_PRESETS.voice }), 90);
  p.tracks.find(t => t.kind === "video")!.clips = [createColorClip("#000000", 0, 600)];
  const ids = p.tracks.flatMap((t) => t.clips).map((c) => c.id);
  const first = p.tracks.flatMap(t => t.clips).find(c => c.type === "audio")!.id;
  p = createCompound(p, ids, "Scene").project;
  expect(p.compounds).toHaveLength(1);
  const r = chains(p);
  expect(r).toHaveLength(2);
  expect(r[0]).toEqual({ key: first, next: true });
  expect(r[1]).toEqual({ key: first, next: false });
});

it("keeps a split compressed compound on one bus, with no new inner clip edge", () => {
  let p = song();
  p.tracks.find(t => t.kind === "video")!.clips = [createColorClip("#000000", 0, 600)];
  p = createCompound(p, p.tracks.flatMap(t => t.clips).map(c => c.id), "Scene").project;
  const c = p.tracks.flatMap(t => t.clips).find(c => c.type === "compound")!;
  Object.assign(c, { compressor: COMPRESSOR_PRESETS.strong, eq: { low: 6 } });
  const whole = soundingClips(p, () => true);
  const split = soundingClips(splitAt(p, 90), () => true);
  expect(split).toHaveLength(1);
  expect(split[0].clip).toEqual(whole[0].clip);
  expect(split[0].via?.map(v => v.clip)).toEqual(whole[0].via?.map(v => v.clip));
  expect(split.map(s => soundBuses(s).buses.map(b => ({ key: b.key, clip: b.clip })))).toEqual(whole.map(s => soundBuses(s).buses.map(b => ({ key: b.key, clip: b.clip }))));
  const apart = splitAt(p, 90);
  const second = apart.tracks.flatMap(t => t.clips).filter(c => c.type === "compound")[1];
  Object.assign(second, { compressor: COMPRESSOR_PRESETS.voice });
  expect(soundingClips(apart, () => true)).toHaveLength(2);
});
