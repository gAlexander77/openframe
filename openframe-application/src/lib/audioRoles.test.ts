import { expect, it } from "vitest";
import { assetRole, assetsOf, roleTrack, stemsOf, trackRole } from "./audioRoles";
import { placeAsset } from "./drop";
import { clipForAsset, createProject, createTrack } from "./project/defaults";
import { addClip, addTrack } from "./project/ops";
import type { Asset, Project, Track } from "./project/types";
import { runCommand } from "./commands";
import { SFX } from "./sfx";

const audio = (id: string, extra: Partial<Asset> = {}): Asset => ({ id, kind: "audio", name: `${id}.wav`, src: `${id}.wav`, duration: 10, hasVideo: false, hasAudio: true, ...extra });

/** A film's sound: a voiceover with gaps (as the documentary's), a song. */
function film(): { p: Project; voice: Track; song: Track } {
  let p = createProject();
  const speech = audio("line", { speech: { text: "Home.", voice: "af_heart", speed: 0.9 } });
  const song = audio("song", { role: "music" });
  p = { ...p, assets: [speech, song] };
  const voice = createTrack("audio", "Narration"); // a name no rule knows
  const music = createTrack("audio", "Audio");
  p = addTrack(addTrack(p, voice), music);
  p = addClip(p, voice.id, clipForAsset(speech, 0, p.fps));
  p = addClip(p, voice.id, clipForAsset(speech, 600, p.fps));
  p = addClip(p, music.id, clipForAsset(song, 0, p.fps));
  return { p, voice, song: music };
}

it("knows what a file is by where it came from, not by its name", () => {
  expect(assetRole(audio("x", { speech: { text: "Hi.", voice: "af_heart", speed: 1 } }))).toBe("dialog");
  expect(assetRole(audio("x", { role: "ambience", sound: { id: "wind", seed: 1 } }))).toBe("ambience");
  expect(assetRole(audio("x"))).toBeUndefined();
  // Effect files made before Asset.role, by the names the library gave them.
  for (const s of Object.values(SFX)) expect(assetRole({ ...audio("x"), name: `${s.label}.wav` }), s.label).toBe("effects");
  expect(assetRole({ ...audio("x"), name: "Riser take 2.wav" })).toBeUndefined();
});

it("judges a track by its role, then its files, then (old projects) its name, else unset", () => {
  const { p, voice, song } = film();
  const of = assetsOf(p);
  expect(trackRole(p.tracks.find((t) => t.id === voice.id)!, of)).toBe("dialog");
  expect(trackRole(p.tracks.find((t) => t.id === song.id)!, of)).toBe("music");
  expect(trackRole({ ...createTrack("audio", "Music"), role: "effects" }, of)).toBe("effects");
  expect(trackRole(createTrack("audio", "Voiceover"))).toBe("dialog");
  expect(trackRole(createTrack("audio", "SFX"))).toBe("effects");
  expect(trackRole(createTrack("audio", "Room tone"))).toBe("ambience");
  expect(trackRole(createTrack("video", "Voiceover"))).toBeUndefined();
  const stems = stemsOf(p);
  expect(stems.dialog).toEqual([voice.id]);
  expect(stems.music).toEqual([song.id]);
});

it("puts a sound on its stem's track, never in a gap on another stem", () => {
  const { p, voice } = film();
  // The riser of the documentary test went in a gap on the voiceover (here 10-20 s).
  const first = roleTrack(p, "effects", 360, 60);
  expect(first.trackId).not.toBe(voice.id);
  const sfx = first.project.tracks.find((t) => t.id === first.trackId)!;
  expect(sfx).toMatchObject({ name: "SFX", role: "effects", kind: "audio" });
  // Reused while it has room; a second SFX track only for an overlap.
  const placed = addClip(first.project, sfx.id, { ...clipForAsset(audio("rise", { role: "effects" }), 360, p.fps), duration: 60 });
  expect(roleTrack(placed, "effects", 480, 30).trackId).toBe(sfx.id);
  const overlap = roleTrack(placed, "effects", 380, 30);
  expect(overlap.trackId).not.toBe(sfx.id);
  expect(overlap.project.tracks.find((t) => t.id === overlap.trackId)).toMatchObject({ name: "SFX", role: "effects" });
  // A file the user imported goes on music, not on the voice's gap.
  expect(roleTrack(p, undefined, 360, 30).trackId).not.toBe(voice.id);
  // An asked-for track is used (the voice's gap is 10-20 s); taken there, a new one of its role below it.
  expect(roleTrack(p, "effects", 360, 30, voice.id).trackId).toBe(voice.id);
  const below = roleTrack(p, "effects", 0, 30, voice.id);
  expect(below.project.tracks.findIndex((t) => t.id === below.trackId)).toBe(below.project.tracks.findIndex((t) => t.id === voice.id) + 1);
  expect(below.project.tracks.find((t) => t.id === below.trackId)!.role).toBe("dialog");
  expect(() => roleTrack(p, "effects", 0, 30, p.tracks.find((t) => t.kind === "video")!.id)).toThrow(/video track/);
});

it("lands library drops and add_media_clip by what the sound is", () => {
  const { p, voice } = film();
  const song2 = audio("song2");
  const q = { ...p, assets: [...p.assets, song2] };
  // A song in the voice's gap at 12 s lands on music, never the voiceover.
  const dropped = placeAsset(q, song2, 360, undefined, false);
  const where = dropped.project.tracks.find((t) => t.clips.some((c) => c.id === dropped.clipId))!;
  expect(where.id).not.toBe(voice.id);
  const added = runCommand(q, "add_media_clip", { asset_id: song2.id, start: 12 });
  const t = added.tracks.find((x) => x.clips.some((c) => c.type === "audio" && c.assetId === song2.id))!;
  expect(t.id).not.toBe(voice.id);
  // describe_project names each audio track's stem; update_track sets one.
  const r = runCommand(p, "update_track", { track_id: voice.id, role: "ambience" });
  expect(r.tracks.find((x) => x.id === voice.id)!.role).toBe("ambience");
  expect(runCommand(r, "update_track", { track_id: voice.id, role: "auto" }).tracks.find((x) => x.id === voice.id)!.role).toBeUndefined();
  expect(() => runCommand(p, "update_track", { track_id: p.tracks[0].id, role: "music" })).toThrow(/audio tracks/);
  const made = runCommand(p, "add_track", { kind: "audio", name: "Bed", role: "ambience" });
  expect(made.tracks.at(-1)).toMatchObject({ name: "Bed", role: "ambience" });
});

it("keeps uncertain imports out of music stems", () => {
  const p = createProject();
  const r = roleTrack(p, undefined, 0, 30);
  const t = r.project.tracks.find(t => t.id === r.trackId)!;
  expect(t.role).toBeUndefined();
  expect(trackRole(t)).toBeUndefined();
  expect(stemsOf(r.project).music).not.toContain(t.id);
});
