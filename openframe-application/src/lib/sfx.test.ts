import { expect, it } from "vitest";
import { SFX } from "./sfx";
import type { Project } from "./project/types";

it("makes every effect at its length, in range, audible and the same each time", () => {
  for (const [id, s] of Object.entries(SFX)) {
    const [l, r] = s.make(48000);
    expect(l.length, id).toBe(Math.round(s.seconds * 48000));
    expect(r).toEqual(l);
    let peak = 0, energy = 0;
    // One expect for the lot: one per sample made the test take seconds.
    expect(l.every(Number.isFinite), id).toBe(true);
    for (const v of l) {
      peak = Math.max(peak, Math.abs(v));
      energy += v * v;
    }
    expect(peak, id).toBeLessThanOrEqual(0.81);
    expect(Math.sqrt(energy / l.length), id).toBeGreaterThan(0.01);
    expect(s.make(48000)[0]).toEqual(l);
  }
});

it("sweeps a whoosh's band up and back down", () => {
  // Zero crossings per window track the band's center: more in the middle.
  const [x] = SFX.whoosh.make(48000);
  const crossings = (from: number, to: number) => {
    let c = 0;
    for (let i = from + 1; i < to; i++) if (Math.sign(x[i]) !== Math.sign(x[i - 1])) c++;
    return c;
  };
  const w = 4800;
  const edge = crossings(4800, 4800 + w), mid = crossings(19200 - w / 2, 19200 + w / 2);
  // A wide band (Q 2) passes plenty either way; the middle is still well up.
  expect(mid).toBeGreaterThan(edge * 1.4);
});

it("ends a riser and a reverse cymbal at their peak and starts the hits on theirs", () => {
  // end_at puts a sound's end on a time, so a swell must peak at its end.
  const rms = (x: Float32Array, a: number, b: number) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  const tenth = 4800;
  for (const id of ["rise", "reverseCymbal", "swooshUp"]) {
    const [x] = SFX[id].make(48000);
    expect(rms(x, x.length - 2 * tenth, x.length), id).toBeGreaterThan(3 * rms(x, 0, 2 * tenth));
  }
  for (const id of ["impact", "subDrop", "boom"]) {
    const [x] = SFX[id].make(48000);
    expect(rms(x, 0, 2 * tenth), id).toBeGreaterThan(3 * rms(x, x.length - 2 * tenth, x.length));
  }
});

it("places a list of sounds as one edit: at a start, ending at a time, at a volume, overlapping on new tracks", async () => {
  const { placeSounds } = await import("./sfx");
  const { createProject } = await import("./project/defaults");
  const p = createProject();
  const asset = (id: string, seconds: number) => ({ id, kind: "audio" as const, name: `${id}.wav`, src: `${id}.wav`, duration: seconds, hasVideo: false, hasAudio: true, role: "effects" as const });
  const assets = new Map([["whoosh", asset("w", SFX.whoosh.seconds)], ["rise", asset("r", SFX.rise.seconds)]]);
  const { project, clipIds } = placeSounds(p, [{ name: "whoosh", at: 1 }, { name: "whoosh", at: 1.2, volume: 0.5 }, { name: "rise", endAt: 1 }], assets, 0);
  const placed = clipIds.map((id) => project.tracks.flatMap((t) => t.clips.map((c) => ({ c, t }))).find((x) => x.c.id === id)!);
  expect(placed.map(({ c }) => c.start)).toEqual([30, 36, 0]);
  expect(placed.map(({ c }) => ("volume" in c ? c.volume : 0))).toEqual([1, 0.5, 1]);
  // The overlapping whoosh got a track of its own, an SFX track too; the riser lost its head to end at 1 s.
  expect(placed[0].t.id).not.toBe(placed[1].t.id);
  expect(placed.map(({ t }) => [t.name, t.role])).toEqual([["SFX", "effects"], ["SFX", "effects"], ["SFX", "effects"]]);
  expect(placed[2].c.start + placed[2].c.duration).toBe(30);
  expect(() => placeSounds(p, [{ name: "kazoo", at: 0 }], assets, 0)).toThrow(/No sound effect kazoo/);
});

it("never puts a sound in a gap on the voiceover or the music, and honors a track asked for", async () => {
  const { placeSounds } = await import("./sfx");
  const { createProject, createTrack, clipForAsset } = await import("./project/defaults");
  const { addClip, addTrack } = await import("./project/ops");
  const speech = { id: "v", kind: "audio" as const, name: "line.wav", src: "line.wav", duration: 5, hasVideo: false, hasAudio: true, speech: { text: "Home.", voice: "af_heart", speed: 0.9 } };
  const riser = { id: "r", kind: "audio" as const, name: "Riser.wav", src: "Riser.wav", duration: SFX.rise.seconds, hasVideo: false, hasAudio: true, role: "effects" as const };
  let p: Project = { ...createProject(), assets: [speech, riser] };
  const vo = { ...createTrack("audio", "Voiceover"), role: "dialog" as const };
  p = addTrack(p, vo);
  // Lines at 0-5 s and 8.5-13.5 s: a gap where the riser into the 8 s drop goes.
  p = addClip(addClip(p, vo.id, clipForAsset(speech, 0, p.fps)), vo.id, clipForAsset(speech, 255, p.fps));
  const assets = new Map([["rise", riser]]);
  const { project, clipIds } = placeSounds(p, [{ name: "rise", endAt: 8 }], assets, 0);
  const t = project.tracks.find((x) => x.clips.some((c) => c.id === clipIds[0]))!;
  expect(t.id).not.toBe(vo.id);
  expect(t).toMatchObject({ name: "SFX", role: "effects" });
  // The second call reuses the SFX track.
  const again = placeSounds(project, [{ name: "rise", at: 20 }], assets, 0);
  expect(again.project.tracks.filter((x) => x.role === "effects")).toHaveLength(1);
  // track_id puts it where asked.
  const mine = placeSounds(p, [{ name: "rise", endAt: 8, trackId: vo.id }], assets, 0);
  expect(mine.project.tracks.find((x) => x.id === vo.id)!.clips.some((c) => c.id === mine.clipIds[0])).toBe(true);
});
