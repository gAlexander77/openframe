// check_project hears the joins of audio clips (ADR-119): preview_audio's
// edges (ADR-104, ADR-107) measured where one audio clip meets the next, a
// hole or a click at the cut and a sound cut off while it rings made
// findings, each with the fix that fits the join, and the Check tab's words
// for them.

import { describe, expect, it } from "vitest";
import { personFindings } from "./checkFindings";
import { runCommand } from "./commands";
import { checkProject, joinTargets, type Measured } from "./designCheck";
import type { EdgeReport } from "./analysis/edges";
import { createProject, createTrack } from "./project/defaults";
import { addTrack, updateClip } from "./project/ops";
import type { Asset, AudioClip, Clip, Project } from "./project/types";

const song: Asset = { id: "song", kind: "audio", name: "Liftoff.wav", src: "song.wav", duration: 60, hasVideo: false, hasAudio: true, musicGrid: { bpm: 120, firstDownbeat: 0 } };

/** A song cut in two on its bars (a butt cut), the picture going on. */
function cutSong(): { p: Project; a: string; b: string; track: string } {
  let p: Project = { ...createProject(), assets: [song] };
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 20, track_id: p.tracks[0].id });
  const t = createTrack("audio", "Music");
  p = addTrack(p, t);
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 20, track_id: t.id });
  const id = p.tracks.find((x) => x.id === t.id)!.clips[0].id;
  p = runCommand(p, "cut_music", { clip_id: id, from: 8, to: 16, crossfade: 0 });
  const [a, b] = p.tracks.find((x) => x.id === t.id)!.clips.map((c) => c.id);
  return { p, a, b, track: t.id };
}
const edge = (r: Partial<EdgeReport> & { at: number; clips: string[] }): EdgeReport => ({ kind: "join", step_db: 0, verdict: "clean", ...r });

describe("joinTargets", () => {
  it("lists where one audio clip meets the next, not a split that plays on, nor a muted track", () => {
    const { p, a, b, track } = cutSong();
    expect(joinTargets(p)).toEqual([{ trackId: track, at: 8, clips: [a, b] }]);
    // A split of the piece after plays on in its file: clean by construction.
    const split = runCommand(p, "split", { at: 12, clip_ids: [b] });
    expect(joinTargets(split).map((j) => j.clips)).toEqual([[a, b]]);
    expect(joinTargets({ ...p, tracks: p.tracks.map((t) => (t.id === track ? { ...t, muted: true } : t)) })).toEqual([]);
    expect(joinTargets(updateClip(p, b, (c) => ({ ...c, disabled: true }) as Clip))).toEqual([]);
  });
});

describe("check_project's joins", () => {
  it("makes a hole, a click and a sound cut off at a join findings, with a crossfade as the fix", () => {
    const { p, a, b } = cutSong();
    const at = joinTargets(p)[0].at;
    const measured = (r: Partial<EdgeReport>): Measured => ({ joins: [edge({ at, clips: [a, b], ...r })] });
    const find = (m: Measured) => checkProject(p, "any", m).findings.filter((f) => /join/.test(f.rule));
    expect(find(measured({ dip_db: -16.8 }))).toEqual([{ rule: "click_at_join", level: "warning", clip_id: a, clip_ids: [a, b], at: 8, message: `A 16.8 dB hole for a few milliseconds where ${a} meets ${b} at 8 s (dip_db), heard as a tick`, fix: `set_crossfade clip_id ${a} seconds 0.03` }]);
    expect(find(measured({ dip_db: -48 }))[0].message).toMatch(/^Silence for a few milliseconds .* heard as a dropout$/);
    expect(find(measured({ click_db: 8.1 }))[0].message).toMatch(/A click where .*: a sample step 8.1 dB steeper/);
    const tail = find(measured({ tail_cut_db: 9.2 }));
    expect(tail).toMatchObject([{ rule: "sound_cut_at_join", clip_id: a, fix: `set_crossfade clip_id ${a} seconds 0.25` }]);
    // What edges call clean is no finding: a small dip, a click under 6 dB.
    expect(find(measured({ dip_db: -1.8, click_db: 3.3, tail_cut_db: 2 }))).toEqual([]);
    expect(find({})).toEqual([]);
  });

  it("names what to change first where no crossfade fits", () => {
    const { p, a, b } = cutSong();
    const at = joinTargets(p)[0].at;
    const m: Measured = { joins: [edge({ at, clips: [a, b], dip_db: -17 })] };
    // The piece after starts at its file's start: nothing to rise before the cut.
    const fromZero = updateClip(p, b, (c) => ({ ...c, in: 0 }) as Clip);
    expect(checkProject(fromZero, "any", m).findings.find((f) => f.rule === "click_at_join")!.fix).toMatch(/^trim_clip the start of .* later .*then set_crossfade/);
    const fast = updateClip(p, b, (c) => ({ ...c, speed: 1.5 }) as Clip);
    expect(checkProject(fast, "any", m).findings.find((f) => f.rule === "click_at_join")!.fix).toMatch(/^set_fades fade_out 0.03 on .* and fade_in 0.03/);
  });

  it("says when not every join was measured", () => {
    const { p } = cutSong();
    expect(checkProject(p, "any", { joinsNote: "the first 24 of 30 joins of audio clips were measured" }).not_checked).toMatch(/Joins: the first 24 of 30 .*preview_audio's edges measure the rest\./);
  });
});

describe("the Check tab's words for a join", () => {
  const person = (p: Project, m: Measured) => {
    const r = checkProject(p, "any", m);
    return personFindings(p, r.findings, r.summary.duration).filter((f) => /join/.test(f.rule));
  };

  it("names the song's two pieces and the clip menu's crossfade, under Sound", () => {
    const { p, a, b } = cutSong();
    const at = joinTargets(p)[0].at;
    const [tick] = person(p, { joins: [edge({ at, clips: [a, b], dip_db: -16.8 })] });
    expect(tick).toMatchObject({ group: "sound", level: "warning", title: "A tick where the two pieces of “Liftoff.wav” meet", detail: "For a few milliseconds at the cut the sound drops 16.8 dB.", clipId: a, tab: "audio", at: 8 });
    expect(tick.action).toBe("Add a crossfade from the clip menu: right-click “Liftoff.wav” and choose Crossfade into next clip.");
    const [click] = person(p, { joins: [edge({ at, clips: [a, b], click_db: 8.1 })] });
    expect(click.title).toBe("A click where the two pieces of “Liftoff.wav” meet");
    const [cut] = person(p, { joins: [edge({ at, clips: [a, b], tail_cut_db: 9.2 })] });
    expect(cut).toMatchObject({ title: "“Liftoff.wav” is cut off where “Liftoff.wav” starts", detail: "It still rings 9.2 dB over what plays after the cut, and stops dead." });
    expect(cut.action).toMatch(/lengthen it to about 0.25 s in the Audio tab/);
    // No agent's tool names reach a person.
    for (const f of [tick, click, cut]) expect(`${f.title} ${f.action} ${f.detail ?? ""}`).not.toMatch(/set_crossfade|set_fades|trim_clip|dip_db|_/);
  });

  it("names two songs, and what to change where no crossfade fits", () => {
    const { p, a, b } = cutSong();
    const other: Asset = { ...song, id: "other", name: "Night drive.wav" };
    const q = updateClip({ ...p, assets: [...p.assets, other] }, b, (c) => ({ ...c, assetId: "other", in: 0 }) as AudioClip);
    const at = joinTargets(q)[0].at;
    const [f] = person(q, { joins: [edge({ at, clips: [a, b], dip_db: -48 })] });
    expect(f.title).toBe("A dropout where “Liftoff.wav” meets “Night drive.wav”");
    expect(f.action).toMatch(/^Trim the start of “Night drive.wav” a little later so its sound can rise before the cut, then add a crossfade from the clip menu/);
  });
});
