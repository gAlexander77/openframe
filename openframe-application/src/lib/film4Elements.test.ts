// Elements, music joins, callout sounds and exports, rebuilt from the
// fourth Claude film test's call log (ADR-125): a 58.5 s vertical how-to
// from 2560x1440 screen recordings, the 120 BPM promo song cut in two by
// hand, captions moved to the top band, an end card at 54 s, rings that
// glide and click, and a re-export that could not replace its first file.
import { describe, expect, it } from "vitest";
import { edgeReport, type AudioEdge } from "./analysis/edges";
import { personFindings } from "./checkFindings";
import { runCommand, type CommandReport } from "./commands";
import { checkProject, type Finding } from "./designCheck";
import { renamedNote, replacedNote } from "./export";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, clipEnd, findClip } from "./project/ops";
import type { Asset, AudioClip, Project, TextClip } from "./project/types";
import { setTextMeasure } from "./render/size";

// About 0.55 em a character, wrapping between words at the style's width
// (titleWrap.test.ts), so a headline made smaller wraps to fewer lines.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080, em = size * 0.55;
  const lines = c.text.split("\n").flatMap((para) => {
    const out: string[] = [];
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * em > c.style.maxWidth * w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    return [...out, line];
  });
  const pad = c.style.background ? (2 * c.style.background.padding * h) / 1080 : 0;
  return { width: Math.max(...lines.map((l) => l.length * em)) + pad, height: size * c.style.lineHeight * lines.length + pad };
});

const fps = { num: 30, den: 1 };
const frame = (s: number) => Math.round(s * 30);
const all = (p: Project) => p.tracks.flatMap((t) => t.clips);
const trackOf = (p: Project, id: string) => p.tracks.find((t) => t.clips.some((c) => c.id === id))!;
const newIds = (before: Project, after: Project) => all(after).filter((c) => !findClip(before, c.id)).map((c) => c.id);

const click: Asset = { id: "a_click", kind: "audio", name: "Click.wav", src: "click.wav", duration: 0.067, hasVideo: false, hasAudio: true, role: "effects", sound: { id: "click" } };

/** The tester's 9:16 project: recordings on the main track, the brand with
 * its icon, captions moved to the top band at the end. */
function howTo(): Project {
  let p: Project = {
    ...createProject({ fps, width: 1080, height: 1920 }),
    assets: [
      { id: "lib", kind: "video", name: "12c-media-library.mp4", src: "lib.mp4", duration: 60, width: 2560, height: 1440, hasVideo: true, hasAudio: false },
      { id: "agent", kind: "video", name: "09-ai-agent.mp4", src: "agent.mp4", duration: 23.17, width: 2560, height: 1440, hasVideo: true, hasAudio: false },
      { id: "icon", kind: "image", name: "openframe-icon.png", src: "icon.png", duration: 0, width: 2048, height: 2048, hasVideo: true, hasAudio: false },
      click,
    ],
  };
  p = runCommand(p, "batch", { commands: [
    { command: "add_media_clip", args: { asset_id: "lib", start: 0, in: 0, duration: 13.9 } },
    { command: "add_media_clip", args: { asset_id: "agent", start: 13.9, in: 6.2, duration: 3.1 } },
    { command: "add_media_clip", args: { asset_id: "lib", start: 17, in: 14, duration: 41.5 } },
  ] });
  p = runCommand(p, "set_brand", { name: "OpenFrame", primary: "#22C7D3", accent: "#FFD23F", background: "#0D1117", text: "#FFFFFF", heading_font: "Inter", body_font: "Inter", logo_icon: "icon", logo: "icon" });
  return runCommand(p, "add_captions", { captions: [{ start: 53.4, end: 56, text: "Your first edit," }, { start: 56, end: 58.5, text: "done." }], y: -0.25 });
}
const mainClip = (p: Project, i: number) => p.tracks.find((t) => t.main)!.clips[i];
const endCard = (p: Project) => runCommand(p, "add_ad_element", { element: "end_card", start: 54, duration: 4.5, headline: "Your first edit in OpenFrame", cta: "Follow for more tips", background: "brand", logo: "icon" });

describe("an ad element's rows are its own (F)", () => {
  it("puts later titles and callouts on rows of their own, not the end card's", () => {
    const p0 = endCard(howTo());
    const cardTracks = p0.tracks.filter((t) => t.name === "End card").map((t) => t.id);
    expect(cardTracks).toHaveLength(4);
    // The tester's step label, hook title and result title, added after it.
    const p1 = runCommand(p0, "batch", { commands: [
      { command: "add_text", args: { text: "THE WORLD\nBELOW", start: 0, duration: 2, y: 0.02, style: { size: 64 } } },
      { command: "add_text", args: { text: "1 · IMPORT", start: 4.9, duration: 12.05, x: -0.04, y: -0.4, style: { size: 38 } } },
      { command: "add_text", args: { text: "CITY LIGHTS", start: 51.633, duration: 2.334, y: 0.02, style: { size: 66 } } },
    ] });
    const titles = newIds(p0, p1);
    const p2 = runCommand(p1, "add_callout", { clip_id: mainClip(p1, 1).id, region: { x: 0.105, y: 0.605, w: 0.14, h: 0.1 }, at: 14.6, duration: 2.3 });
    const callout = newIds(p1, p2);
    expect(callout).toHaveLength(2);
    for (const id of [...titles, ...callout]) expect(cardTracks).not.toContain(trackOf(p2, id).id);
    // The titles share a row of their own, and the end card's rows hold the card alone.
    expect(new Set(titles.map((id) => trackOf(p2, id).id)).size).toBe(1);
    for (const id of cardTracks) expect(p2.tracks.find((t) => t.id === id)!.clips.every((c) => c.name === "End card")).toBe(true);
  });
});

describe("an end card under captions on 9:16 is laid out for the room left (G)", () => {
  const texts = (p: Project, ids: string[]) => ids.map((id) => findClip(p, id)!.clip).filter((c): c is TextClip => c.type === "text");

  it("restacks, its logo giving first, rather than shrinking every part to the floor", () => {
    const p0 = howTo();
    const report: CommandReport = {};
    const p = runCommand(p0, "add_ad_element", { element: "end_card", start: 54, duration: 4.5, headline: "Your first edit in OpenFrame", cta: "Follow for more tips", background: "brand", logo: "icon" }, report);
    const ids = newIds(p0, p);
    const [cta, headline] = texts(p, ids).sort((a, b) => b.transform.y - a.transform.y);
    const logo = ids.map((id) => findClip(p, id)!.clip).find((c) => c.type === "image")!;
    // The tester's call made headline 36, button 31 (the floor), logo
    // 0.15; here, before, headline 41 and logo 0.17 with a tenth of the
    // room left over.
    expect(headline.style.size).toBeGreaterThanOrEqual(44);
    // At the floor at the bottom of its pulse (it dipped under it before).
    expect(cta.style.size).toBeGreaterThanOrEqual(33);
    expect(logo.type === "image" && logo.transform.scale).toBeLessThan(0.15);
    expect(report.notes).toEqual([expect.stringMatching(/below the captions/), expect.stringMatching(/^To fit the room there, its logo was made 50% and its type \d+% of their size: fewer words, or another position, keep it larger\.$/)]);
    // It fits the room: nothing crosses the captions or another part, and
    // the check finds nothing to say about it.
    const found = checkProject(p, "social_short").findings.filter((f) => f.rule === "text_overlaps_text" || f.rule === "text_under_app_buttons" || f.rule === "text_too_small");
    expect(found.filter((f) => ids.includes(f.clip_id ?? ""))).toEqual([]);
  });

  it("finds a headline enlarged by hand that runs into its button", () => {
    const p0 = howTo();
    const p = endCard(p0);
    const headline = texts(p, newIds(p0, p)).find((c) => c.text.startsWith("Your"))!;
    const cta = texts(p, newIds(p0, p)).find((c) => c.text.startsWith("Follow"))!;
    expect(checkProject(p, "social_short").findings.filter((x) => x.rule === "text_overlaps_text")).toEqual([]);
    const q = runCommand(p, "set_text", { clip_id: headline.id, style: { size: 72 } });
    const f = checkProject(q, "social_short").findings.find((x) => x.rule === "text_overlaps_text" && x.clip_ids?.includes(cta.id));
    expect(f?.message).toMatch(/^"Follow for more tips" and "Your first edit in OpenF" are drawn across each other/);
  });

  it("keeps the type larger on an end card with the whole safe area, the logo smaller first", () => {
    let p: Project = { ...createProject({ fps, width: 1080, height: 1920 }), assets: howTo().assets };
    p = runCommand(p, "set_brand", { name: "OpenFrame", logo_icon: "icon", logo: "icon" });
    const q = runCommand(p, "add_ad_element", { element: "end_card", start: 0, headline: "Your first edit in OpenFrame", cta: "Follow for more tips", logo: "icon" });
    const headline = all(q).find((c): c is TextClip => c.type === "text" && c.text.startsWith("Your"))!;
    // 58 before (every part alike); the role's size is 68.
    expect(headline.style.size).toBeGreaterThanOrEqual(63);
  });
});

describe("a frame of black between main-track adds (J)", () => {
  it("starts a clip where the one before ends when its start rounds a frame past it", () => {
    const p0: Project = { ...createProject({ fps, width: 1080, height: 1920 }), assets: howTo().assets };
    const report: CommandReport = {};
    const p = runCommand(p0, "batch", { commands: [
      { command: "add_media_clip", args: { asset_id: "lib", track_id: p0.tracks.find((t) => t.main)!.id, start: 0, duration: 46.45 } },
      { command: "add_media_clip", args: { asset_id: "agent", track_id: p0.tracks.find((t) => t.main)!.id, start: 46.45, in: 5.2, duration: 4.3 } },
      { command: "set_speed", args: { clip_id: "$2", speed: 1.4 } },
      { command: "add_media_clip", args: { asset_id: "agent", track_id: p0.tracks.find((t) => t.main)!.id, start: 49.521, in: 9.5, duration: 0.5 } },
    ] }, report);
    const [, a, b] = newIds(p0, p).map((id) => findClip(p, id)!.clip);
    expect(clipEnd(a)).toBe(frame(49.5));
    expect(b.start).toBe(frame(49.5));
    // Its end stays where asked, its first frame a frame earlier in its file.
    expect(clipEnd(b)).toBe(frame(50.033));
    expect(report.notes?.join(" ")).toMatch(/starts at 49\.5 s, where the clip before it ends: start 49\.521 rounded to 49\.533 s, a frame of black/);
    expect(checkProject(p).findings.filter((f) => f.rule === "gap_on_main_track" && f.at === 49.5)).toEqual([]);
  });

  it("leaves a gap of two frames or more, and other tracks, as asked", () => {
    const p0 = howTo();
    const main = p0.tracks.find((t) => t.main)!.id;
    const p = runCommand(p0, "add_media_clip", { asset_id: "agent", track_id: main, start: 58.6, duration: 1 });
    expect(newIds(p0, p).map((id) => findClip(p, id)!.clip.start)).toEqual([frame(58.6)]);
  });
});

describe("a callout clicks as it lands on each part (K)", () => {
  const glide = { region: { x: 0.009, y: 0.062, w: 0.028, h: 0.052 }, at: 9.1, glide: 0.4 };
  const next = { region: { x: 0.104, y: 0.47, w: 0.092, h: 0.105 }, at: 10.5, glide: 0.5 };
  const clicks = (args: Record<string, unknown>) => {
    const p0 = howTo();
    const p = runCommand(p0, "add_callout", { clip_id: mainClip(p0, 0).id, region: { x: 0.011, y: 0.13, w: 0.06, h: 0.034 }, at: 6.5, duration: 4.8, ...args });
    return newIds(p0, p).map((id) => findClip(p, id)!.clip).filter((c) => c.type === "audio").map((c) => c.start).sort((a, b) => a - b);
  };

  it("clicks where it draws on and where each glide arrives", () => {
    expect(clicks({ sound: true, to: [glide, next] })).toEqual([frame(6.5), frame(9.1), frame(10.5)]);
  });
  it("lets a step say otherwise", () => {
    expect(clicks({ sound: true, to: [glide, { ...next, sound: false }] })).toEqual([frame(6.5), frame(9.1)]);
    expect(clicks({ to: [{ ...glide, sound: true }, next] })).toEqual([frame(9.1)]);
    expect(clicks({ to: [glide, next] })).toEqual([]);
  });
});

describe("check_project names a callout that leaves the frame (L)", () => {
  /** The tester's step 1 ring on a landed clip, the shot panning on under it. */
  function panned(): { p: Project; ring: string; dim: string } {
    let p = howTo();
    const shot = mainClip(p, 1).id;
    p = runCommand(p, "frame_region", { clip_id: shot, mode: "fit", moves: [{ region: { x: 0, y: 0.28, w: 0.38, h: 0.52 }, at: 13.9 }, { region: { x: 0, y: 0.28, w: 0.38, h: 0.52 }, at: 15.3 }, { region: { x: 0.22, y: 0.28, w: 0.38, h: 0.52 }, at: 16.9 }] });
    const p0 = p;
    p = runCommand(p, "add_callout", { clip_id: shot, region: { x: 0.105, y: 0.605, w: 0.14, h: 0.1 }, at: 14.6, duration: 2.3, dim: 0.45 });
    const [ring, dim] = newIds(p0, p).sort((a, b) => (findClip(p, a)!.clip.name === "Callout" ? -1 : 1) - (findClip(p, b)!.clip.name === "Callout" ? -1 : 1));
    return { p, ring, dim };
  }

  it("finds the ring and its dim riding the pan off the left edge, and when it starts to leave", () => {
    const { p, ring, dim } = panned();
    const f = checkProject(p, "social_short").findings.filter((x) => x.rule === "callout_off_frame");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ level: "warning", clip_id: ring, clip_ids: [ring, dim] });
    expect(f[0].message).toMatch(/^a ring \(.+\) runs off the frame: \d+% of it is outside at [\d.]+ s, leaving from [\d.]+ s$/);
    const leaves = Number(/leaving from ([\d.]+) s/.exec(f[0].message)![1]);
    // The pan starts at 15.3 s and the ring's edge reaches the frame's
    // about half way (the tester trimmed it to 15.9 s).
    expect(leaves).toBeGreaterThan(15.8);
    expect(leaves).toBeLessThan(16.3);
    expect(f[0].fix).toBe(`trim_clip the end of ${ring} and ${dim} to ${leaves} s, or frame_region the shot so what it points at stays in the frame`);
    // The Check tab says it in the app's words.
    const words = personFindings(p, [f[0] as Finding])[0];
    expect(words).toMatchObject({ group: "timing", title: "“Callout” runs off the frame" });
    expect(words.action).toContain(`Trim the callout's end to ${leaves} s`);
    // Trimmed as the fix says, it is clean.
    let q = runCommand(p, "trim_clip", { clip_id: ring, edge: "end", to: leaves });
    q = runCommand(q, "trim_clip", { clip_id: dim, edge: "end", to: leaves });
    expect(checkProject(q, "social_short").findings.filter((x) => x.rule === "callout_off_frame")).toEqual([]);
  });

  it("leaves a callout that stays on its part alone", () => {
    const p0 = howTo();
    const p = runCommand(p0, "add_callout", { clip_id: mainClip(p0, 0).id, region: { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }, at: 2, duration: 2 });
    expect(checkProject(p).findings.filter((x) => x.rule === "callout_off_frame")).toEqual([]);
  });
});

describe("a join into a file's silence (I)", () => {
  const RATE = 48000, AT = 1, N = AT * RATE;
  // The music on both sides; the incoming file silent for 0.25 s before
  // its in-point (the promo's breath before its drop, 7.75-8.0 s).
  const tone = (t: number, f: number) => 0.3 * Math.sin(2 * Math.PI * f * t) + 0.1 * Math.sin(2 * Math.PI * 4 * f * t);
  const mix = (fade: number) => {
    const x = new Float32Array(2 * RATE);
    for (let i = 0; i < x.length; i++) {
      const t = (i - N) / RATE;
      const ga = t < -fade ? 1 : t < 0 ? Math.cos(((t + fade) / fade) * (Math.PI / 2)) : 0;
      const gb = t < -fade ? 0 : t < 0 ? Math.sin(((t + fade) / fade) * (Math.PI / 2)) : 1;
      const b = t < -0.25 ? tone(i / RATE, 70) : t < 0 ? 0 : tone(i / RATE, 70);
      x[i] = tone(i / RATE, 55) * ga + b * gb;
    }
    return x;
  };
  const edge = (o: Partial<AudioEdge>): AudioEdge => ({ at: AT, kind: "join", clips: ["c_m1", "c_m2"], faded: 0.03, ...o });
  const heard = (x: Float32Array, e: AudioEdge) => edgeReport(x, x, RATE, 0, [e])[0];

  it("says the incoming file is silent before its in-point and moves the join, never the crossfade it has", () => {
    const r = heard(mix(0.03), edge({ silentBefore: { seconds: 0.25, in: 8 }, rollTo: 3 }));
    expect(r.dip_db).toBeLessThanOrEqual(-10);
    expect(r.silent_before).toBe(0.25);
    expect(r.verdict).toMatch(/c_m2's file is silent for 0\.25 s just before its in-point \(7\.75-8 s of the file\), so the crossfade fades into that silence and a longer one deepens the hole: move the join where both files sound, e\.g\. a bar later \(roll_edit to 3 s\)/);
    expect(r.fix).toEqual({ tool: "roll_edit", args: { clip_id: "c_m1", to: 3 } });
    // A longer crossfade, as the tester tried: the same diagnosis.
    expect(heard(mix(0.1), edge({ faded: 0.1, silentBefore: { seconds: 0.25, in: 8 }, rollTo: 3 })).fix?.tool).toBe("roll_edit");
    // With no bar to move to, the verdict says where, and no fix is guessed.
    const bare = heard(mix(0.03), edge({ silentBefore: { seconds: 0.25, in: 8 } }));
    expect(bare.fix).toBeUndefined();
    expect(bare.verdict).toMatch(/roll_edit it to a bar line where the incoming file sounds/);
  });

  it("never suggests a crossfade the join already has", () => {
    // A hole under a crossfade with no silence before: the fix is not set_crossfade 0.03 again.
    const x = mix(0.03);
    for (let i = N - 96; i < N + 96; i++) x[i] = 0;
    const r = heard(x, edge({}));
    expect(r.fix).toBeUndefined();
    expect(r.verdict).toMatch(/the 0\.03 s crossfade is already set: move the join \(roll_edit\)/);
    // A butt cut still gets its crossfade.
    expect(heard(x, edge({ faded: 0 })).fix).toEqual({ tool: "set_crossfade", args: { clip_id: "c_m1", seconds: 0.03 } });
  });

  it("check_project's click_at_join says so too, in the app's words", () => {
    let p: Project = { ...createProject({ fps }), assets: [{ id: "song", kind: "audio", name: "promo.wav", src: "promo.wav", duration: 56, hasVideo: false, hasAudio: true }] };
    const t = createTrack("audio", "Music");
    p = addTrack(p, t);
    p = runCommand(p, "batch", { commands: [
      { command: "add_media_clip", args: { asset_id: "song", track_id: t.id, start: 0, in: 6, duration: 10 } },
      { command: "add_media_clip", args: { asset_id: "song", track_id: t.id, start: 10, in: 8, duration: 48 } },
    ] });
    const [m1, m2] = p.tracks.find((x) => x.id === t.id)!.clips.map((c) => c.id);
    p = runCommand(p, "set_crossfade", { clip_id: m1, seconds: 0.03 });
    const join = { ...heard(mix(0.03), edge({ clips: [m1, m2], silentBefore: { seconds: 0.25, in: 8 }, rollTo: 12 })), at: 10 };
    const f = checkProject(p, "any", { joins: [join] }).findings.find((x) => x.rule === "click_at_join")!;
    expect(f.message).toMatch(/file is silent for 0\.25 s just before its in-point/);
    expect(f.fix).toBe(`roll_edit clip_id ${m1} to 12 (a bar later), where both files sound`);
    const words = personFindings(p, [f])[0];
    expect(words.detail).toMatch(/silent for 0\.25 s just before where it starts/);
    expect(words.action).toMatch(/Roll tool/);
    // Without a measured silence, a crossfade already set is not asked for again.
    const plain = { ...heard(mix(0.03), edge({ clips: [m1, m2] })), at: 10, dip_db: -13 };
    expect(checkProject(p, "any", { joins: [plain] }).findings.find((x) => x.rule === "click_at_join")!.fix).toMatch(/^roll_edit the join .+ a 0\.03 s crossfade is already set/);
  });
});

describe("cut_music repeats bars (I)", () => {
  const song = (bpm: number): Asset => ({ id: "song", kind: "audio", name: "promo.wav", src: "promo.wav", duration: 56, hasVideo: false, hasAudio: true, musicGrid: { bpm, firstDownbeat: 0 } });
  function withSong(bpm = 120) {
    let p: Project = { ...createProject({ fps }), assets: [song(bpm), click] };
    const t = createTrack("audio", "Music");
    p = addTrack(p, t);
    p = runCommand(p, "add_media_clip", { asset_id: "song", track_id: t.id, start: 0, in: 6, duration: 48 });
    // Something later on the song's track, which moves with it.
    p = runCommand(p, "add_media_clip", { asset_id: "a_click", track_id: t.id, start: 50 });
    const [id, after] = p.tracks.find((x) => x.id === t.id)!.clips.map((c) => c.id);
    return { p, id, after, track: t.id };
  }
  const pieces = (p: Project, track: string) => (p.tracks.find((t) => t.id === track)!.clips as AudioClip[]).filter((c) => c.assetId === "song").map((c) => [+c.in.toFixed(4), c.start, clipEnd(c), c.crossfade ?? 0]);

  it("plays four bars twice: the tester's two clips in one call, the song 8 s longer", () => {
    const { p, id, after, track } = withSong();
    const report: CommandReport = {};
    const q = runCommand(p, "cut_music", { clip_id: id, from: 8, to: 16, repeat: 1 }, report);
    expect(pieces(q, track)).toEqual([[6, 0, 300, 0.03], [8, 300, 1680, 0]]);
    expect(findClip(q, after)!.clip.start).toBe(frame(58));
    expect(report.notes).toEqual(["Repeated 8-16 s of the song's file once, 4 bars at 120 BPM: the song plays 8 s longer, and clips after it on its track moved as much; the pieces meet at 10 s on the timeline with a 0.03 s crossfade. preview_audio's edges measure the joins."]);
    // Twice more: three pieces, each jump back whole bars.
    expect(pieces(runCommand(p, "cut_music", { clip_id: id, from: 8, to: 16, repeat: 2 }), track)).toEqual([[6, 0, 300, 0.03], [8, 300, 540, 0.03], [8, 540, 1920, 0]]);
  });

  it("keeps the beat when the bars do not fall on frames", () => {
    // 125 BPM: a bar is 1.92 s, 57.6 frames.
    const { p, id, track } = withSong(125);
    const q = runCommand(p, "cut_music", { clip_id: id, from: 7.7, to: 15.3, repeat: 1 });
    const [a, b] = (q.tracks.find((t) => t.id === track)!.clips as AudioClip[]).filter((c) => c.assetId === "song");
    // a stops on the frame at or before 15.36; b starts as far before 7.68.
    const stop = a.in + a.duration / 30;
    expect(stop).toBeLessThanOrEqual(15.36);
    expect(15.36 - stop).toBeLessThan(1 / 30);
    expect(b.in + (15.36 - stop)).toBeCloseTo(7.68, 5);
    expect(b.start).toBe(clipEnd(a));
  });

  it("refuses what it cannot repeat", () => {
    const { p, id } = withSong();
    expect(() => runCommand(p, "cut_music", { clip_id: id, from: 8, to: 16, repeat: 0 })).toThrow(/repeat/);
    expect(() => runCommand(p, "cut_music", { clip_id: id, from: 8, to: 16, repeat: 1.5 })).toThrow(/whole number/);
    const bare: Project = { ...p, assets: p.assets.map((a) => (a.id === "song" ? { ...a, musicGrid: undefined } : a)) };
    expect(() => runCommand(bare, "cut_music", { clip_id: id, from: 8, to: 16, repeat: 1 })).toThrow(/no grid to repeat on/);
  });
});

describe("an export that replaces its own earlier file (O)", () => {
  it("says what it replaced, or the numbered name it took", () => {
    expect(replacedNote("D:\\Deliveries\\your-first-edit-16x9.mp4")).toBe("your-first-edit-16x9.mp4 replaced the file of that name in that folder, as asked (replace).");
    expect(renamedNote("film.mp4", "D:/Deliveries/film (2).mp4")).toMatch(/nothing was replaced/);
  });
});

