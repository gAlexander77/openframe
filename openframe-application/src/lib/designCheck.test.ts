import { expect, it } from "vitest";
import { runCommand } from "./commands";
import { checkProject, contrastTargets, fadeMoments, seenShots, tailTargets } from "./designCheck";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { Project, TextClip } from "./project/types";

const rules = (p: Project, kind?: Parameters<typeof checkProject>[1]) => checkProject(p, kind).findings.map((f) => f.rule);
const base = () => {
  let p = createProject();
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 6, track_id: p.tracks[0].id });
  return p;
};

it("passes a tidy project, and reports its shape", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "Clean title", start: 1, duration: 3, style: { size: 96, stroke: { color: "#000000", width: 6 } } });
  const r = checkProject(p);
  expect(r.ok).toBe(true);
  expect(r.findings.filter((f) => f.level !== "tip")).toEqual([]);
  expect(r.summary).toMatchObject({ duration: 6, shots: 1, titles: 1 });
});

it("flags text that is off-safe, small, short, many-fonted or under the apps' buttons", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "Edge", start: 0, duration: 3, x: 0.48, style: { stroke: { color: "#000", width: 4 } } });
  p = runCommand(p, "add_text", { text: "tiny", start: 0, duration: 3, style: { size: 24, font: "Georgia" } });
  p = runCommand(p, "add_text", { text: "six words is too many here", start: 3, duration: 1, style: { font: "Impact" } });
  expect(rules(p)).toEqual(expect.arrayContaining(["text_outside_title_safe", "text_too_small", "text_too_short", "too_many_fonts"]));
  let v = createProject({ width: 1080, height: 1920 });
  v = runCommand(v, "add_text", { text: "Shop", start: 0, duration: 3, y: 0.42 });
  expect(rules(v)).toContain("text_under_app_buttons");
});

it("flags captions read faster than 20 characters a second", () => {
  let p = base();
  p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 1, text: "this caption has far too many characters for one second" }] });
  expect(rules(p)).toContain("caption_too_fast");
});

it("judges captions shown a few words at a time over the spoken line they make (ADR-115)", () => {
  // The film test's word-by-word captions: each chunk is up well under
  // 0.83 s, but the line they make reads at 9-11 characters a second.
  const chunks = [
    { start: 3.133, end: 4.267, text: "Day one.", words: [3.133, 3.44] },
    { start: 4.267, end: 4.867, text: "They strap", words: [4.267, 4.54] },
    { start: 4.867, end: 5.467, text: "you to a", words: [4.867, 4.98, 5.1] },
    { start: 5.467, end: 6.333, text: "fire...", words: [5.467] },
    { start: 6.333, end: 7.4, text: "and let go.", words: [6.333, 6.52, 6.9] },
  ];
  let p = base();
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 6, duration: 4, track_id: p.tracks[0].id });
  p = runCommand(p, "add_captions", { captions: chunks });
  expect(rules(p, "social_short")).not.toContain("caption_too_fast");
  // The same chunks crammed into a second and a half read too fast as a line: one finding for the run.
  let fast = base();
  fast = runCommand(fast, "add_captions", { captions: chunks.map((c, i) => ({ text: c.text, start: 1 + i * 0.3, end: 1.3 + i * 0.3 })) });
  const found = checkProject(fast, "social_short").findings.filter((f) => f.rule === "caption_too_fast");
  expect(found).toHaveLength(1);
  expect(found[0].message).toMatch(/^5 captions shown a few words at a time read \d+ characters a second over 1.50 s/);
  // A chunk that flashes by is still named, however the line reads.
  let flash = base();
  flash = runCommand(flash, "add_captions", { captions: [{ start: 1, end: 2, text: "Three." }, { start: 2, end: 2.1, text: "Two." }, { start: 2.1, end: 3, text: "One." }] });
  const flashed = checkProject(flash, "social_short").findings.filter((f) => f.rule === "caption_too_fast");
  expect(flashed).toHaveLength(1);
  expect(flashed[0].message).toMatch(/for 0.10 s/);
  // A full caption on its own is judged as before.
  let one = base();
  one = runCommand(one, "add_captions", { captions: [{ start: 1, end: 1.5, text: "Hi there" }] });
  expect(rules(one)).toContain("caption_too_fast");
});

it("errs on strobes over three a second and on black holes in the main track", () => {
  let p = base();
  const id = p.tracks[0].clips[0].id;
  p = runCommand(p, "add_effect", { clip_id: id, type: "flash", params: { rate: 6 } });
  p = runCommand(p, "add_color_clip", { color: "#000000", start: 8, duration: 2, track_id: p.tracks[0].id });
  const r = checkProject(p);
  expect(r.ok).toBe(false);
  expect(r.findings.filter((f) => f.level === "error").map((f) => f.rule)).toEqual(expect.arrayContaining(["flashes_too_fast", "gap_on_main_track"]));
});

it("asks an ad for an end card and an epic edit for cuts on the beat", () => {
  let p = base();
  expect(rules(p, "ad")).toContain("no_end_card");
  expect(rules(p, "epic_edit")).toContain("no_beat_grid");
  p = runCommand(p, "split", { at: 2.3, clip_ids: [p.tracks[0].clips[0].id] });
  p = runCommand(p, "add_markers", { times: [1, 2, 3], label: "Beat" });
  expect(rules(p, "epic_edit")).toContain("cuts_off_beat");
  p = runCommand(p, "add_markers", { times: [2.3], label: "Beat" });
  expect(rules(p, "epic_edit")).not.toContain("cuts_off_beat");
});

it("lets countdown digits, half-beat cuts and text on its own card pass", () => {
  let p = base();
  p = runCommand(p, "add_text", { text: "3", start: 0, duration: 0.5, style: { size: 200, stroke: { color: "#000", width: 6 } } });
  expect(rules(p)).not.toContain("text_too_short");
  p = runCommand(p, "split", { at: 1.5, clip_ids: [p.tracks.find((t) => t.main)!.clips[0].id] });
  p = runCommand(p, "add_markers", { times: [1, 2], label: "Beat" });
  expect(rules(p, "epic_edit")).not.toContain("cuts_off_beat");
});

it("does not call text on its own solid card a contrast risk", () => {
  let p = createProject();
  p = { ...p, assets: [{ id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 10, hasVideo: true, hasAudio: false, width: 1920, height: 1080 }] };
  p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 4 });
  p = runCommand(p, "add_text", { text: "Over footage", start: 0, duration: 3 });
  expect(rules(p)).toContain("text_contrast_risk");
  let q = runCommand(createProject(), "add_color_clip", { color: "#000", start: 0, duration: 4 });
  q = { ...q, assets: p.assets };
  q = runCommand(q, "add_media_clip", { asset_id: "v", start: 0, duration: 4, track_id: q.tracks.find((t) => t.main)!.id });
  q = runCommand(q, "add_color_clip", { color: "#111", start: 0, duration: 4 });
  q = runCommand(q, "add_text", { text: "On its card", start: 0, duration: 3 });
  expect(rules(q)).not.toContain("text_contrast_risk");
});

it("puts captions above the apps' zone on a tall canvas, and scales the size floor", () => {
  let v = createProject({ width: 1080, height: 1920 });
  v = runCommand(v, "add_captions", { captions: [{ start: 0, end: 2, text: "hello there" }] });
  const cap = v.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!;
  expect("transform" in cap && cap.transform.y).toBe(0.05);
  // Size counts pixels at a 1080-tall frame: on 9:16 a smaller size is as big on a phone.
  v = runCommand(v, "add_text", { text: "Small but fine", start: 0, duration: 3, style: { size: 32 } });
  expect(rules(v)).not.toContain("text_too_small");
});

// ---- measured, not guessed (ADR-068) ------------------------------------------

/** The launch film's case: white titles over image clips (glow sprites) on
 * a near-black ground, music that fades out in its own audio, and the cuts
 * on an overlay track above a one-clip background. */
function designed(): Project {
  let p = createProject();
  p = {
    ...p,
    assets: [
      { id: "glow", kind: "image", name: "glow.png", src: "glow.png", duration: 0, hasVideo: true, hasAudio: false, width: 1400, height: 1400 },
      { id: "ui", kind: "video", name: "ui.mp4", src: "ui.mp4", duration: 30, hasVideo: true, hasAudio: false, width: 1920, height: 1080 },
      { id: "song", kind: "audio", name: "song.wav", src: "song.wav", duration: 12, hasVideo: false, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_color_clip", { color: "#05060a", start: 0, duration: 10, track_id: p.tracks[0].id });
  p = runCommand(p, "add_media_clip", { asset_id: "glow", start: 0, duration: 10 });
  p = runCommand(p, "add_track", { kind: "video", name: "Windows" });
  const windows = p.tracks.find((t) => t.name === "Windows")!.id;
  for (const s of [1, 3, 5, 7]) p = runCommand(p, "add_media_clip", { asset_id: "ui", start: s, duration: 1.5, in: s, track_id: windows });
  p = runCommand(p, "add_text", { text: "Pro editing.", start: 0, duration: 3, style: { size: 150 } });
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 10 });
  return p;
}
const textId = (p: Project) => p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id;
const songId = (p: Project) => p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!.id;

it("asks to measure every title at a few moments of its life, shadowed and boxed ones too, and the music that ends with the video", () => {
  let p = designed();
  p = runCommand(p, "add_text", { text: "A WAY HOME", start: 2, duration: 8, y: 0.41, style: { size: 40, color: "#BBD9DC", shadow: { color: "#000000cc", blur: 16, x: 0, y: 0 } } });
  const shadowed = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "A WAY HOME")!.id;
  p = runCommand(p, "set_animation", { clip_id: shadowed, slot: "in", type: "fade", duration: 0.5 });
  const { targets, skipped } = contrastTargets(p);
  expect(skipped).toBe(0);
  const plain = targets.find((t) => t.clipId !== shadowed)!, soft = targets.find((t) => t.clipId === shadowed)!;
  expect(targets.map((t) => t.clipId)).toEqual([plain.clipId, shadowed]);
  expect(plain.look.fills).toEqual([[1, 1, 1, 1]]);
  expect(plain.look.around).toEqual([]);
  // A 3 s title without animations: its first frame, middle and last.
  expect(plain.samples.map((s) => s.frame)).toEqual([0, 45, 89]);
  expect(plain.samples[0].box.right - plain.samples[0].box.left).toBeGreaterThan(100);
  // Over six seconds: quarters too, from where its fade-in has played.
  expect(soft.clipId).toBe(shadowed);
  expect(soft.samples.map((s) => s.frame)).toEqual([75, 131, 187, 243, 299]);
  expect(soft.look.around.map((a) => a.what)).toEqual(["shadow"]);
  expect(soft.fixes.map((f) => f.say)).toEqual([expect.stringMatching(/^style.background/), expect.stringMatching(/^style.stroke/)]);
  expect(tailTargets(p)).toEqual([{ clipId: songId(p), assetId: "song", from: 6, to: 10 }]);
  const faded = runCommand(p, "set_fades", { clip_ids: [songId(p)], fade_out: 1.5 });
  expect(tailTargets(faded)).toEqual([]);
});

it("trusts the measured contrast over the guess: white on the dark film passes, white on a bright shot is named with its ratio, time and fix", () => {
  const p = designed();
  expect(rules(p)).toContain("text_contrast_risk");
  const id = textId(p);
  const dark = checkProject(p, "any", { contrast: { [id]: { ratio: 17.8, backdrop: [0.03, 0.04, 0.08], frame: 45 } }, moments: 3 });
  expect(dark.findings.map((f) => f.rule)).not.toContain("text_contrast_risk");
  expect(dark.findings.map((f) => f.rule)).not.toContain("text_low_contrast");
  expect(dark.contrast).toMatchObject({ lowest: [{ clip_id: id, ratio: 17.8, at: 1.5 }] });
  expect(dark.not_checked).not.toMatch(/Contrast/);
  const bright = checkProject(p, "any", { contrast: { [id]: { ratio: 1.3, backdrop: [0.86, 0.9, 0.94], frame: 60, fixes: [{ say: 'style.background {color: "#000000a6"}', ratio: 7.9 }, { say: 'style.stroke {color: "#000000", width: 8}', ratio: 12.4 }] } } });
  const f = bright.findings.find((x) => x.rule === "text_low_contrast")!;
  expect(f.level).toBe("warning");
  expect(f.at).toBe(2);
  expect(f.message).toMatch(/measures 1.3:1 against the picture behind it at 2 s \(backdrop #dbe6f0\)/);
  // The fixes as measured on the same pixels, the best first.
  expect(f.fix).toMatch(/^set_text style.stroke .* \(measures 12.4:1 there\), or style.background .* \(measures 7.9:1 there\)/);
  const middling = checkProject(p, "any", { contrast: { [id]: { ratio: 3.6, backdrop: [0.5, 0.5, 0.5], frame: 45 } } });
  expect(middling.findings.find((x) => x.rule === "text_low_contrast")!.level).toBe("tip");
});

it("measures a fading title at its fades' middles, and names one that loses a part before the rest (ADR-118)", () => {
  let p = designed();
  const id = textId(p);
  p = runCommand(p, "set_animation", { clip_id: id, slot: "in", type: "pop", duration: 0.5 });
  p = runCommand(p, "set_animation", { clip_id: id, slot: "out", type: "fade", duration: 0.2 });
  // 0-3 s at 30 fps: the pop's middle (frame 7) and the fade's (89 - 3).
  expect(fadeMoments(findClip(p, id)!.clip as TextClip)).toEqual([7, 86]);
  const t = contrastTargets(p).targets.find((x) => x.clipId === id)!;
  expect(t.fades!.map((f) => f.frame)).toEqual([7, 86]);
  expect(t.fades![1].box.right - t.fades![1].box.left).toBeGreaterThan(100);
  // A slide does not fade; a title's own word-by-word animation is drawn by its letters; a fade of a frame is a cut.
  for (const type of ["slideLeft", "wordPop"]) {
    const d = designed();
    const q = runCommand(d, "set_animation", { clip_id: textId(d), slot: "out", type, duration: 0.5 });
    expect(fadeMoments(findClip(q, textId(d))!.clip as TextClip), type).toEqual([]);
  }
  const c = findClip(p, id)!.clip as TextClip;
  expect(fadeMoments({ ...c, animIn: undefined, animOut: { ...c.animOut!, duration: 1 } })).toEqual([]);
  const fades = { [id]: { frame: 86, opacity: 0.25, faint: 1.26, body: 1.63, backdrop: [1, 1, 1] as [number, number, number], fixes: ['style.background {color: "#000000a6"}'] } };
  const f = checkProject(p, "any", { contrast: { [id]: { ratio: 5.2, backdrop: [0.45, 0.55, 0.68], frame: 45 } }, fades }).findings.find((x) => x.rule === "title_fades_unevenly")!;
  expect(f).toMatchObject({ level: "tip", clip_id: id, at: 2.87 });
  expect(f.message).toMatch(/fades unevenly at 2.87 s: at 25% of its opacity the part of it over #ffffff is gone \(1.26:1\) while the rest is still seen \(1.63:1\)/);
  expect(f.fix).toMatch(/^set_text style.background .* \(it then fades as one there\), or end it with a cut or a slide/);
  // A title already hard to read at rest is named for that alone.
  const low = checkProject(p, "any", { contrast: { [id]: { ratio: 2.1, backdrop: [1, 1, 1], frame: 45 } }, fades });
  expect(low.findings.map((x) => x.rule)).not.toContain("title_fades_unevenly");
});

it("says why contrast was not measured, and names what ok means", () => {
  const p = designed();
  const guessed = checkProject(p, "any", { contrastNote: "not measured, the picture could not be rendered here (no WebGL)" });
  expect(guessed.not_checked).toMatch(/Contrast: not measured, the picture could not be rendered here \(no WebGL\); look with preview_frames/);
  expect(checkProject(p).not_checked).toMatch(/Contrast: not measured on the picture/);
  // No titles, nothing to say about contrast.
  expect(checkProject(base()).not_checked).not.toMatch(/Contrast/);
  // ok: true beside a warning is said in words.
  const r = checkProject(runCommand(p, "add_text", { text: "fine print", start: 4, duration: 3, style: { size: 30, stroke: { color: "#000", width: 3 } } }));
  expect(r.ok).toBe(true);
  expect(r.summary.warnings).toBeGreaterThan(0);
  expect(r.verdict).toMatch(/^ok means no errors; \d+ warnings? still to fix before delivering/);
  let gap = base();
  gap = runCommand(gap, "add_color_clip", { color: "#000", start: 8, duration: 1, track_id: gap.tracks[0].id });
  expect(checkProject(gap).verdict).toMatch(/^Not ok: 1 error to fix before export/);
});

it("lets music that fades out in its own audio end, judged by its last second, and names the level of one that stops dead", () => {
  const p = designed();
  expect(rules(p)).toContain("music_ends_abruptly");
  const fades = checkProject(p, "any", { tails: { [songId(p)]: { endDb: -48, bodyDb: -14 } } });
  expect(fades.findings.map((f) => f.rule)).not.toContain("music_ends_abruptly");
  // A one-second fade in the audio that the clip ends a little early.
  const early = checkProject(p, "any", { tails: { [songId(p)]: { endDb: -27, bodyDb: -14, lastSecond: [-15, -18, -22, -26] } } });
  expect(early.findings.map((f) => f.rule)).not.toContain("music_ends_abruptly");
  const dead = checkProject(p, "any", { tails: { [songId(p)]: { endDb: -15, bodyDb: -14, lastSecond: [-14, -15, -14, -15] } } });
  expect(dead.findings.find((f) => f.rule === "music_ends_abruptly")!.message).toMatch(/its last second runs -14, -15, -14, -15 dBFS by quarters and ends at -15, against -14 dBFS before/);
  // Volume keys that fade it count as a fade.
  let k = runCommand(p, "add_keyframe", { clip_id: songId(p), path: "volume", at: 8, value: 1 });
  k = runCommand(k, "add_keyframe", { clip_id: songId(k), path: "volume", at: 9.96, value: 0 });
  expect(rules(k)).not.toContain("music_ends_abruptly");
});

it("finds a sound cut off before the end with no fade: a song trimmed mid-phrase, a line cut mid-word", () => {
  // A 20 s video; music 0-12 s of a 30 s song, a voice line cut 2.5 s
  // into its 6.4 s, neither faded: the check found neither (it only
  // looked at long clips that end with the video).
  let p = createProject();
  p = {
    ...p,
    assets: [
      { id: "song", kind: "audio", name: "song.mp3", src: "song.mp3", duration: 30, hasVideo: false, hasAudio: true },
      { id: "line", kind: "audio", name: "line.wav", src: "line.wav", duration: 6.4, hasVideo: false, hasAudio: true },
      { id: "hit", kind: "audio", name: "hit.wav", src: "hit.wav", duration: 1.2, hasVideo: false, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 20, track_id: p.tracks[0].id });
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 12 });
  p = runCommand(p, "add_track", { kind: "audio", name: "Voiceover", role: "dialog" });
  p = runCommand(p, "add_media_clip", { asset_id: "line", start: 14, duration: 2.5, track_id: p.tracks.find((t) => t.role === "dialog")!.id });
  p = runCommand(p, "add_media_clip", { asset_id: "hit", start: 4 });
  const clip = (asset: string) => p.tracks.flatMap((t) => t.clips).find((c) => "assetId" in c && c.assetId === asset)!.id;
  const [song, line] = [clip("song"), clip("line")];
  // The hit plays its whole file: it ends as it was made, not cut off.
  expect(tailTargets(p)).toEqual([
    { clipId: song, assetId: "song", from: 8, to: 12 },
    { clipId: line, assetId: "line", from: 0, to: 2.5 },
  ]);
  const holds = { endDb: -15, bodyDb: -14, lastSecond: [-14, -15, -14, -15] };
  const cut = checkProject(p, "any", { tails: { [song]: holds, [line]: holds } }).findings.filter((f) => f.rule === "sound_cut_off");
  expect(cut.map((f) => [f.clip_id, f.at, f.level])).toEqual([[song, 12, "warning"], [line, 16.5, "warning"]]);
  expect(cut[1].message).toMatch(/cut off at 16.5 s while still sounding, with no fade, and the video goes on: its last second runs -14, -15, -14, -15 dBFS/);
  // A line cut in a pause, or a song whose own audio falls away, is fine.
  const ends = checkProject(p, "any", { tails: { [song]: { endDb: -55, bodyDb: -14 }, [line]: { endDb: -60, bodyDb: -20 } } });
  expect(ends.findings.map((f) => f.rule)).not.toContain("sound_cut_off");
  // Unmeasured, only the long clip is suspect.
  expect(checkProject(p).findings.filter((f) => f.rule === "sound_cut_off").map((f) => f.clip_id)).toEqual([song]);
  // A fade, or the song carrying on in the next clip of its track, ends it.
  const faded = runCommand(p, "set_fades", { clip_ids: [song, line], fade_out: 0.3 });
  expect(tailTargets(faded)).toEqual([]);
  const track = p.tracks.find((t) => t.clips.some((c) => c.id === song))!.id;
  const carried = runCommand(p, "add_media_clip", { asset_id: "song", start: 12, in: 12, duration: 8, track_id: track });
  expect(tailTargets(carried).map((t) => t.clipId)).not.toContain(song);
});

it("counts the shots on the busiest picture track, not the one-clip background", () => {
  const r = checkProject(designed());
  expect(r.summary).toMatchObject({ shots: 4, shots_on: "Windows", average_shot: 1.5 });
});

it("counts the cuts the viewer sees across tracks: A and B rolls, cutaways over an interview", () => {
  const assets = [{ id: "v", kind: "video" as const, name: "v.mp4", src: "v.mp4", duration: 60, hasVideo: true, hasAudio: false, width: 1920, height: 1080 }];
  // An interview on the main track, b-roll cut in above it twice.
  let p: Project = { ...createProject(), assets };
  const main = p.tracks.find((t) => t.main)!.id;
  p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 12, track_id: main });
  p = runCommand(p, "add_track", { kind: "video", name: "B-roll" });
  const broll = p.tracks.find((t) => t.name === "B-roll")!.id;
  for (const s of [3, 8]) p = runCommand(p, "add_media_clip", { asset_id: "v", start: s, duration: 2, in: 30 + s, track_id: broll });
  const r = checkProject(p);
  expect(r.summary).toMatchObject({ shots: 5, shots_on: "the picture, across tracks", average_shot: 2.4 });
  expect(seenShots(p).map((s) => s.start / 30)).toEqual([0, 3, 5, 8, 10]);
  // On the beat check, those cuts count: 3, 5, 8 and 10 on the grid, 5 off.
  p = runCommand(p, "add_markers", { times: [3, 8, 10], label: "Beat" });
  const off = checkProject(p, "epic_edit").findings.find((f) => f.rule === "cuts_off_beat")!;
  expect(off.message).toMatch(/^1 of 4 cuts on the picture \(across tracks\) miss a beat/);
  expect(off.at).toBe(5);
});

it("flags text too small for the frame by its share of the height, stricter for social", () => {
  // Codex's subtitle: size 40 on 1080p was the old floor, and did not read on a phone.
  let p = base();
  p = runCommand(p, "add_text", { text: "A WAY HOME", start: 0, duration: 4, y: 0.3, style: { size: 40, stroke: { color: "#000", width: 3 } } });
  const f = checkProject(p).findings.find((x) => x.rule === "text_too_small")!;
  expect(f.message).toMatch(/is 3.7% of the frame's height \(size 40\); on a 1920x1080 frame, letters under 4.5% of its height \(size 49/);
  expect(f.fix).toMatch(/^set_text style.size 49 or more/);
  const ok = runCommand(base(), "add_text", { text: "A WAY HOME", start: 0, duration: 4, y: 0.3, style: { size: 50, stroke: { color: "#000", width: 3 } } });
  expect(rules(ok)).not.toContain("text_too_small");
  // A short for the apps holds a 16:9 frame to 5% of its height.
  expect(rules(ok, "social_short")).toContain("text_too_small");
  // On 9:16 the floor is 5% of the 1080 width: size 31, 2.8% of the height.
  let v = createProject({ width: 1080, height: 1920 });
  v = runCommand(v, "add_text", { text: "Small", start: 0, duration: 3, style: { size: 26 } });
  expect(checkProject(v).findings.find((x) => x.rule === "text_too_small")!.message).toMatch(/2.4% of the frame's height .* social frame, letters under 2.8% of its height \(size 31/);
  v = runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: "Big enough", start: 0, duration: 3, style: { size: 32 } });
  expect(rules(v)).not.toContain("text_too_small");
});

it("names small captions once, with how many", () => {
  let p = base();
  p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 2, text: "first words" }, { start: 2, end: 4, text: "second words" }] });
  const ids = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").map((c) => c.id);
  p = runCommand(p, "set_text", { clip_ids: ids, style: { size: 36 } });
  const small = checkProject(p).findings.filter((x) => x.rule === "text_too_small");
  expect(small).toHaveLength(1);
  expect(small[0].message).toMatch(/^2 captions are 3.3% of the frame's height/);
});

it("counts a cut only where it shows: not under a full-frame card above it (ADR-102)", () => {
  // The Claude film: a black breath on a track above, over a filler shot
  // whose cut at 3.833 s (off the beat) nobody sees.
  let p = createProject();
  p = { ...p, assets: [{ id: "v", kind: "video", name: "v.mp4", src: "v.mp4", duration: 12, hasVideo: true, hasAudio: false, width: 1920, height: 1080 }] };
  for (const [start, duration, at] of [[0, 2, 0], [2, 1.833, 4], [3.833, 4.167, 8]]) p = runCommand(p, "add_media_clip", { asset_id: "v", start, duration, in: at });
  p = runCommand(p, "add_markers", { times: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], label: "Beat" });
  expect(rules(p, "epic_edit")).toContain("cuts_off_beat");
  const black = runCommand(p, "add_color_clip", { color: "#000000", start: 3.767, duration: 0.233 });
  expect(rules(black, "epic_edit")).not.toContain("cuts_off_beat");
  expect(checkProject(black, "epic_edit").summary.shots).toBe(2);
  // A card that does not hide the frame (half its size) leaves the cut in sight.
  const id = black.tracks[0].clips[0].id;
  expect(rules(runCommand(black, "set_param", { clip_ids: [id], path: "transform.scale", value: 0.5 }), "epic_edit")).toContain("cuts_off_beat");
  expect(rules(runCommand(black, "set_param", { clip_ids: [id], path: "opacity", value: 0.5 }), "epic_edit")).toContain("cuts_off_beat");
});
