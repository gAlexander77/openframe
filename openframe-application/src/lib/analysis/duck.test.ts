import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { createProject, createTrack } from "../project/defaults";
import { addTrack, findClip, updateClip } from "../project/ops";
import type { Asset, AudioClip, Clip, Project } from "../project/types";
import { retakeLine } from "../voiceLines";
import { duckArgs, duckKeys, duckMark, staleDuckNote, staleDucks, trackDuckKeys, voicesUnder } from "./duck";

const O = { depthDb: 20, attack: 3, release: 12, hold: 15 };
const LOW = 0.1; // -20 dB of 1

const keys = (speech: [number, number][], start = 100, end = 400) => duckKeys(speech, start, end, 1, O).map((k) => [k.f, +k.v.toFixed(6)]);

describe("duckKeys", () => {
  it("dips under one stretch of speech with attack and release", () => {
    expect(keys([[150, 200]])).toEqual([
      [47, 1],
      [50, LOW],
      [100, LOW],
      [112, 1],
    ]);
  });

  it("bridges a short pause and comes back up for a long one", () => {
    // gap 25 <= 3 + 12 + 15: one dip
    expect(keys([[150, 200], [225, 260]])).toHaveLength(4);
    // gap 31 > 30: two dips
    expect(keys([[150, 200], [231, 260]])).toHaveLength(8);
  });

  it("starts ducked when speech starts with the clip, ends ducked when it runs past", () => {
    expect(keys([[90, 150]])).toEqual([
      [0, LOW],
      [50, LOW],
      [62, 1],
    ]);
    expect(keys([[380, 500]])).toEqual([
      [277, 1],
      [280, LOW],
      [299, LOW],
    ]);
  });

  it("ignores speech outside the clip and scales from the clip's volume", () => {
    expect(keys([[0, 50], [450, 500]])).toEqual([]);
    expect(duckKeys([[150, 200]], 100, 400, 0.5, O)[1].v).toBeCloseTo(0.05, 9);
  });

  it("dips each line to its own depth, moving between them in the pause they share", () => {
    const k = (depths: number[]) => duckKeys([[150, 200], [220, 260], [330, 360]], 100, 400, 1, O, depths).map((x) => [x.f, +x.v.toFixed(4)]);
    // The first two share a dip (a 20-frame pause); the level moves from -20 to -26 dB inside it.
    expect(k([20, 26, 10])).toEqual([
      [47, 1],
      [50, 0.1],
      [100, 0.1],
      [120, 0.0501],
      [160, 0.0501],
      [172, 1],
      [227, 1],
      [230, 0.3162],
      [260, 0.3162],
      [272, 1],
    ]);
    // The same depths everywhere: the same keys as one depth.
    expect(duckKeys([[150, 200], [220, 260]], 100, 400, 1, O, [20, 20])).toEqual(duckKeys([[150, 200], [220, 260]], 100, 400, 1, O));
  });

  it("takes the deeper depth where two lines overlap", () => {
    expect(duckKeys([[150, 200], [190, 230]], 100, 400, 1, O, [10, 20]).map((x) => +x.v.toFixed(2))).toEqual([1, 0.1, 0.1, 1]);
  });
});

describe("the voices under the music", () => {
  // An interview kept in a compound clip (a template): duck_under_speech
  // answered "No other clip with sound plays under it", ducking nothing.
  const talk: Asset = { id: "talk", kind: "video", name: "talk.mp4", src: "talk.mp4", duration: 12, width: 1920, height: 1080, hasVideo: true, hasAudio: true };
  const song: Asset = { id: "song", kind: "audio", name: "song.wav", src: "song.wav", duration: 40, hasVideo: false, hasAudio: true };
  function fixture(): { p: Project; music: AudioClip; interview: string } {
    let p: Project = { ...createProject(), assets: [talk, song] };
    const m = createTrack("audio", "Music");
    p = addTrack(p, m);
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, track_id: m.id });
    p = runCommand(p, "add_media_clip", { asset_id: "talk", start: 2, duration: 6, in: 3 });
    const interview = p.tracks[0].clips[0].id;
    return { p, music: p.tracks.find((t) => t.id === m.id)!.clips[0] as AudioClip, interview };
  }
  const has = () => true;
  it("finds a clip with sound under it, and not the music itself", () => {
    const { p, music, interview } = fixture();
    expect(voicesUnder(p, [music], has).map((v) => [v.clip.id, v.top, v.span])).toEqual([[interview, interview, [60, 240]]]);
  });
  it("finds one inside a compound clip, as it plays there, kept by its compound clip", () => {
    const { p, music, interview } = fixture();
    const q = runCommand(p, "create_compound_clip", { clip_ids: [interview] });
    const k = q.tracks[0].clips[0];
    expect(k.type).toBe("compound");
    const [v] = voicesUnder(q, [music], has);
    expect(v.clip.id).toBe(interview);
    expect(v.top).toBe(k.id);
    expect([v.clip.start, v.clip.in, v.span]).toEqual([60, 3, [60, 240]]);
    // Muted, it is no voice; the music soloed to listen to it, it still is.
    expect(voicesUnder(runCommand(q, "update_track", { track_id: q.tracks[0].id, muted: true }), [music], has)).toEqual([]);
    const soloed = runCommand(q, "update_track", { track_id: q.tracks.find((t) => t.clips.includes(music))!.id, solo: true });
    expect(voicesUnder(soloed, [music], has)).toHaveLength(1);
  });
});

describe("a music track ducked as one bed (film test 3.14)", () => {
  it("gives each piece its own keys, a line across the cut dipping on both sides", () => {
    // A song cut at frame 420 (14 s), a line from 400 to 440 across it.
    const ks = trackDuckKeys([[400, 440], [600, 650]], [{ id: "a", start: 0, end: 420, base: 1 }, { id: "b", start: 420, end: 1200, base: 1 }], O);
    expect([...ks.keys()]).toEqual(["a", "b"]);
    expect(ks.get("a")!.map((k) => [k.f, +k.v.toFixed(6)])).toEqual([[397, 1], [400, LOW], [419, LOW]]);
    expect(ks.get("b")!.map((k) => [k.f, +k.v.toFixed(6)])).toEqual([[0, LOW], [20, LOW], [32, 1], [177, 1], [180, LOW], [230, LOW], [242, 1]]);
  });
});

describe("a duck a voice line's change leaves behind (film test 3.9)", () => {
  const speech = (id: string, seconds: number): Asset => ({ id, kind: "audio", name: `${id}.wav`, src: `${id}.wav`, duration: seconds, hasVideo: false, hasAudio: true, speech: { text: "Find your north.", voice: "af_heart", speed: 1 } });
  const song: Asset = { id: "song", kind: "audio", name: "song.wav", src: "song.wav", duration: 56, hasVideo: false, hasAudio: true };
  /** A song cut in two (0-14 s, 14-40 s) and a line at 32.5-34.3 s, the
   * second piece (or the whole track) ducked under it. */
  function fixture(track = false): { p: Project; music: string[]; line: string } {
    let p: Project = { ...createProject(), assets: [song, speech("v1", 1.8)] };
    const m = createTrack("audio", "Music"), vo = createTrack("audio", "Voiceover");
    p = addTrack(addTrack(p, m), vo);
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, track_id: m.id });
    p = runCommand(p, "cut_ranges", { clip_id: p.tracks.find((t) => t.id === m.id)!.clips[0].id, ranges: [{ start: 14, end: 30 }] });
    p = runCommand(p, "add_media_clip", { asset_id: "v1", start: 32.5, track_id: vo.id });
    const music = p.tracks.find((t) => t.id === m.id)!.clips.map((c) => c.id);
    const line = p.tracks.find((t) => t.id === vo.id)!.clips[0].id;
    // What duck_under_speech leaves: volume keys, and how it was asked.
    for (const id of track ? music : [music[1]]) {
      p = runCommand(p, "add_keyframe", { clip_id: id, path: "volume", at: 32.4, value: 1 });
      p = runCommand(p, "add_keyframe", { clip_id: id, path: "volume", at: 32.5, value: 0.18 });
      p = updateClip(p, id, (c) => ({ ...c, duck: { voiceAboveMusicLu: 12, minLineLu: 10, ...(track ? { track: true } : {}), ...duckMark(c as AudioClip) } }) as Clip);
    }
    return { p, music, line };
  }
  const retake = (p: Project, line: string, seconds: number) => retakeLine(p, { clipId: line, asset: speech("v2", seconds), frames: Math.round(seconds * 30) }).project;

  it("finds the music ducked under a line that a retake made longer", () => {
    const { p, music, line } = fixture();
    expect(staleDucks(p, p)).toEqual([]);
    const after = retake(p, line, 2.067);
    const stale = staleDucks(p, after);
    expect(stale).toEqual([{ clipIds: [music[1]], trackId: expect.any(String), record: expect.objectContaining({ voiceAboveMusicLu: 12, minLineLu: 10 }), lineIds: [line], edited: [], moved: [] }]);
    expect(duckArgs(stale[0])).toEqual({ clip_id: music[1], voice_above_music_lu: 12, min_line_lu: 10 });
    expect(staleDuckNote(stale[0])).toMatch(/still dips for the voice as it was before this edit .* duck_under_speech \{"clip_id"/);
  });

  it("dips a whole track again as one, and leaves keys edited by hand alone, saying so", () => {
    const { p, music, line } = fixture(true);
    const after = retake(p, line, 2.067);
    const [d] = staleDucks(p, after);
    expect(d.clipIds).toEqual(music);
    expect(duckArgs(d)).toEqual({ track_id: d.trackId, voice_above_music_lu: 12, min_line_lu: 10 });
    const edited = runCommand(after, "add_keyframe", { clip_id: music[1], path: "volume", at: 34.7, value: 0.42 });
    const [e] = staleDucks(p, edited);
    expect(e.edited).toEqual([music[1]]);
    expect(staleDuckNote(e)).toMatch(/edited since .* not dipped again/);
  });

  it("finds music whose dips moved with it away from the voice: bars cut out of a ducked song", () => {
    // cut_music after duck_under_speech: the piece after the cut plays
    // earlier, its dips with it, and the music rose under every later line
    // with nothing said (the voice had not changed).
    const { p, music } = fixture(true);
    const after = runCommand(p, "cut_music", { clip_id: music[1], from: 34, to: 38, snap: "none" });
    const [d] = staleDucks(p, after);
    expect(d.lineIds).toEqual([]);
    expect(d.moved).toHaveLength(1);
    expect(d.edited).toEqual([]);
    expect(staleDuckNote(d)).toMatch(/moved, its dips with it.* duck_under_speech \{"track_id"/);
    // A later edit that leaves it where it is says nothing more.
    expect(staleDucks(after, runCommand(after, "set_param", { clip_ids: [music[0]], path: "pan", value: 0.1 }))).toEqual([]);
  });

  it("keeps ducked music that was split or trimmed at its head as the duck's: its dips did not move", () => {
    const { p, music, line } = fixture(true);
    const split = runCommand(p, "split", { clip_ids: [music[1]], at: 20 });
    expect(staleDucks(p, split)).toEqual([]);
    const trimmed = runCommand(split, "trim_clip", { clip_id: music[1], edge: "start", to: 16 });
    expect(staleDucks(split, trimmed)).toEqual([]);
    // A retake then dips them again: none reads as edited by hand.
    const [d] = staleDucks(trimmed, retake(trimmed, line, 2.067));
    expect(d.edited).toEqual([]);
  });

  it("judges a moved line by where it was and where it is; a line that kept its place is no change", () => {
    const { p, line } = fixture();
    // Moved out from under the ducked piece: the dip is still where it was.
    expect(staleDucks(p, runCommand(p, "move_clip", { clip_id: line, start: 3 }))).toHaveLength(1);
    expect(staleDucks(p, runCommand(p, "set_param", { clip_ids: [line], path: "volume", value: 0.9 }))).toEqual([]);
    expect(findClip(p, line)).toBeTruthy();
  });
});
