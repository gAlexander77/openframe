import { describe, expect, it } from "vitest";
import { runCommand } from "../commands";
import { createProject, createTrack } from "../project/defaults";
import { addTrack, findClip, updateClip } from "../project/ops";
import type { Asset, AudioClip, Clip, Project } from "../project/types";
import { retakeLine } from "../voiceLines";
import { duckArgs, duckKeys, duckMark, duckPlan, duckWrote, mergeKeys, staleDuckNote, staleDucks, trackDuckKeys, voicesUnder, writtenKeys } from "./duck";

// A pause under 31 frames stays down (the old hold: 3 + 12 + 15 frames, and one).
const O = { depthDb: 20, attack: 3, release: 12, gap: 31 };
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
    // a pause of 25 < 31: one dip
    expect(keys([[150, 200], [225, 260]])).toHaveLength(4);
    // 31: two dips
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

describe("where the music comes up between lines (film test 2, ADR-114)", () => {
  // The tester's opening at 30 fps: a first line 0.13 s into the song,
  // pauses of 0.3, 1.0 and 0.7 s, and the song's drop at 8 s (frame 240)
  // in the 1.0 s pause. Pauses under 1.1 s (33 frames) stay down.
  const T = { depthDb: 20, attack: 3, release: 12, gap: 33 };
  const lines: [number, number][] = [[4, 79], [88, 220], [250, 349], [370, 415]];
  const k = (ks: { f: number; g: number }[]) => ks.map((x) => [x.f, +x.g.toFixed(6)]);

  it("holds short pauses down and says which, with no blip before the first line", () => {
    const plan = duckPlan(lines, 0, 1440, T);
    // It was [1, 1] at frame 1 and dipped by frame 4: 0.1 s at full level.
    expect(k(plan.keys)).toEqual([[0, LOW], [415, LOW], [427, 1]]);
    expect(plan.held).toEqual([[79, 88], [220, 250], [349, 370]]);
    expect(plan.dips).toBe(1);
  });

  it("comes up on a moment asked for (a drop), however short its pause, and down after it", () => {
    const plan = duckPlan(lines, 0, 1440, { ...T, open: [240] });
    expect(k(plan.keys)).toEqual([[0, LOW], [220, LOW], [232, 1], [247, 1], [250, LOW], [415, LOW], [427, 1]]);
    expect(plan.held).toEqual([[79, 88], [349, 370]]);
    expect(plan.open).toEqual([{ at: 240, up: [232, 247] }]);
    expect(plan.dips).toBe(2);
    // A drop right after a line comes up a frame later; never into a line.
    const close = duckPlan([[100, 200], [206, 300]], 0, 600, { ...T, open: [201] });
    expect(close.open).toEqual([{ at: 201, up: [201, 203] }]);
    expect(k(close.keys).filter(([f]) => f >= 200 && f <= 206)).toEqual([[200, LOW], [201, 1], [203, 1], [206, LOW]]);
  });

  it("keeps a moment inside a line down, and says so", () => {
    const plan = duckPlan(lines, 0, 1440, { ...T, open: [300, 2000] });
    expect(plan.open).toEqual([{ at: 300, line: [250, 349] }, { at: 2000 }]);
    expect(k(plan.keys)).toEqual([[0, LOW], [415, LOW], [427, 1]]);
  });

  it("lets a shorter gap open, part of the way up when the ramps meet", () => {
    expect(duckPlan(lines, 0, 1440, { ...T, gap: 25 }).held).toEqual([[79, 88], [349, 370]]);
    // A pause of 8 frames, under the attack and release together (15):
    // the music comes half way up, where the ramps meet.
    expect(k(duckPlan([[100, 150], [158, 200]], 0, 400, { ...T, gap: 5 }).keys).slice(2, 5)).toEqual([[150, LOW], [156, 0.55], [158, LOW]]);
  });

  it("plans a song cut in two as one bed: no full-level blip at the cut between two lines", () => {
    // Line ends 15.6 s, the next starts 16.3 s, the song cut at 16 s: the
    // second piece started at its volume and dipped 0.3 s later.
    const ks = trackDuckKeys([[400, 468], [489, 560]], [{ id: "a", start: 0, end: 480, base: 1 }, { id: "b", start: 480, end: 1440, base: 1 }], T).keys;
    expect(ks.get("a")!.map((x) => [x.f, +x.v.toFixed(6)])).toEqual([[397, 1], [400, LOW], [479, LOW]]);
    expect(ks.get("b")!.map((x) => [x.f, +x.v.toFixed(6)])).toEqual([[0, LOW], [80, LOW], [92, 1]]);
  });
});

describe("keys made by hand outlive a duck (film test 2, ADR-114)", () => {
  const fps = { num: 30, den: 1 };
  // The duck's keys (clip frames): down under two lines, up in the pause.
  const duck = [{ f: 0, v: 0.2 }, { f: 100, v: 0.2 }, { f: 112, v: 1 }, { f: 190, v: 1 }, { f: 200, v: 0.2 }, { f: 300, v: 0.2 }];
  const lines: [number, number][] = [[0, 100], [200, 300]];
  const music = { in: 10, speed: 1, duck: { keys: 0, written: writtenKeys({ in: 10, speed: 1 }, duck, fps) } };

  it("knows the keys it wrote through a trim, and a key changed by hand as the hand's", () => {
    const wrote = duckWrote(music, fps);
    expect(wrote({ f: 112, v: 1 })).toBe(true);
    expect(wrote({ f: 190, v: 0.75 })).toBe(false);
    expect(wrote({ f: 150, v: 0.75 })).toBe(false);
    // Trimmed 15 frames at the head: the keys shift with the in-point.
    expect(duckWrote({ ...music, in: 10.5 }, fps)({ f: 97, v: 1 })).toBe(true);
    // Never ducked: every key is the hand's; ducked before its keys were kept: none is.
    expect(duckWrote({ in: 0, speed: 1 }, fps)({ f: 0, v: 1 })).toBe(false);
    expect(duckWrote({ in: 0, speed: 1, duck: { keys: 0 } }, fps)({ f: 0, v: 1 })).toBe(true);
  });

  it("keeps the hand's keys in a pause in place of its own, held at the lines, and replaces those under a line", () => {
    // The tester capped the lift in the pause at 0.75 and lifted the music
    // under the second line; then ducked again.
    const current = [...duck.filter((x) => x.f !== 190), { f: 150, v: 0.75 }, { f: 190, v: 0.75 }, { f: 250, v: 0.5 }].sort((a, b) => a.f - b.f);
    const m = mergeKeys(current, duckWrote(music, fps), duck, lines);
    expect(m.keys.map((x) => [x.f, x.v])).toEqual([[0, 0.2], [100, 0.2], [150, 0.75], [190, 0.75], [200, 0.2], [300, 0.2]]);
    expect(m.kept.map((x) => x.f)).toEqual([150, 190]);
    expect(m.replaced.map((x) => x.f)).toEqual([250]);
    // Untouched, it is all the duck's: ducked again, the same keys.
    expect(mergeKeys(duck, duckWrote(music, fps), duck, lines).keys).toEqual(duck);
  });

  it("holds the duck's level at a line's edge when a held pause gets a key by hand, so it never ramps under the voice", () => {
    // Held down from 100 to 140 with no key between; a hand key at 120.
    const flat = [{ f: 0, v: 0.2 }, { f: 240, v: 0.2 }];
    const m = mergeKeys([{ f: 120, v: 0.55 }], () => false, flat, [[0, 100], [140, 240]]);
    expect(m.keys.map((x) => [x.f, x.v])).toEqual([[0, 0.2], [100, 0.2], [120, 0.55], [140, 0.2], [240, 0.2]]);
  });

  it("moves a key made by hand on a line's last frame a frame into the pause (a lift for the hit after the line)", () => {
    // The tester set the duck's key at a line's end to 0.55 for the hit after it.
    const flat = [{ f: 0, v: 0.2 }, { f: 240, v: 0.2 }];
    const m = mergeKeys([{ f: 100, v: 0.55 }, { f: 90, v: 0.2 }], () => false, flat, [[0, 100], [140, 240]]);
    expect(m.keys.map((x) => [x.f, x.v])).toEqual([[0, 0.2], [100, 0.2], [101, 0.55], [140, 0.2], [240, 0.2]]);
    expect(m.replaced.map((x) => x.f)).toEqual([90]);
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
    const ks = trackDuckKeys([[400, 440], [600, 650]], [{ id: "a", start: 0, end: 420, base: 1 }, { id: "b", start: 420, end: 1200, base: 1 }], O).keys;
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
