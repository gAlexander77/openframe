// The Check tab says what check_project found in a person's words
// (ADR-111): each finding from the check's own output, grouped as text,
// timing and sound, with the control that fixes it, the clip to select and
// the time to go to. These run the real check, so a change to its wording
// shows here instead of as a wrong number in the panel.

import { describe, expect, it } from "vitest";
import { checkCounts, checkHeadline, groupFindings, notChecked, personFindings } from "./checkFindings";
import { runCommand } from "./commands";
import { checkProject, type Measured } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Asset, CompoundClip, Project } from "./project/types";

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);
const base = () => {
  let p = createProject();
  p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 6, track_id: p.tracks[0].id });
  return p;
};
const person = (p: Project, kind?: Parameters<typeof checkProject>[1], measured?: Measured) => {
  const r = checkProject(p, kind, measured);
  return personFindings(p, r.findings, r.summary.duration);
};
const byRule = (list: ReturnType<typeof person>, rule: string) => list.find((f) => f.rule === rule)!;

describe("personFindings", () => {
  it("names a title by its words, says what is wrong and which control fixes it", () => {
    let p = base();
    p = runCommand(p, "add_text", { text: "Edge", start: 0, duration: 3, x: 0.48, style: { stroke: { color: "#000", width: 4 } } });
    p = runCommand(p, "add_text", { text: "tiny", start: 0, duration: 3, style: { size: 24, font: "Georgia" } });
    p = runCommand(p, "add_text", { text: "six words is too many here", start: 3, duration: 1, style: { font: "Impact" } });
    const list = person(p);
    const edge = clips(p).find((c) => c.type === "text" && c.text === "Edge")!;

    const safe = byRule(list, "text_outside_title_safe");
    expect(safe).toMatchObject({ group: "text", level: "warning", title: "“Edge” runs outside the title-safe area", clipId: edge.id });
    expect(safe.detail).toMatch(/safe area's right edge/);
    expect(safe.action).toMatch(/Safe margins guide/);
    expect(safe.at).toBeGreaterThan(0);
    // Selecting it opens the tab that holds the fix.
    expect(safe.tab).toBe("text");

    const small = byRule(list, "text_too_small");
    expect(small.title).toBe("“tiny” is too small to read on a phone");
    expect(small.detail).toBe("Its letters are 2.2% of the frame's height; a phone shows the frame only a few centimeters wide.");
    expect(small.action).toBe("Raise Size in the Text tab to 49 or more; break the line if it grows too wide.");

    const short = byRule(list, "text_too_short");
    expect(short.title).toBe("“six words is too many here” goes by too fast to read");
    expect(short.detail).toBe("It is on screen 1.0 s; reading it twice takes about 2.4 s.");
    expect(short.action).toMatch(/Drag its end later/);

    const fonts = byRule(list, "too_many_fonts");
    expect(fonts).toMatchObject({ group: "text", title: "3 fonts in one video" });
    expect(fonts.detail).toMatch(/Georgia.*Impact.*Professional work keeps to two\./);
    expect(fonts.clipId).toBeUndefined();
    // No agent's tool names reach a person.
    for (const f of list) expect(`${f.title} ${f.action} ${f.detail ?? ""}`).not.toMatch(/set_text|style\.|set_param|trim_clip|align_clips|_/);
  });

  it("reads the measured contrast and the fixes that measured better on the same pixels", () => {
    let p = base();
    p = runCommand(p, "add_text", { text: "A WAY HOME", start: 1, duration: 3, style: { size: 80, color: "#BBD9DC" } });
    const id = clips(p).find((c) => c.type === "text")!.id;
    const measured: Measured = {
      contrast: {
        [id]: {
          ratio: 1.83,
          backdrop: [0.9, 0.9, 0.85],
          frame: 60,
          fixes: [
            { say: 'style.background {color: "#000000a6", padding: 14, radius: 7}', ratio: 7.2 },
            { say: 'style.stroke {color: "#000000", width: 3}', ratio: 5.1 },
          ],
        },
      },
    };
    const low = byRule(person(p, "any", measured), "text_low_contrast");
    expect(low).toMatchObject({ level: "warning", title: "“A WAY HOME” is hard to read against the picture", at: 2, clipId: id });
    expect(low.detail).toBe("Its contrast with the picture behind it measures 1.8:1; titles read easily from 4.5:1, and under 3:1 they are hard to read.");
    expect(low.action).toBe("Give it a Background box (7.2:1 there) or a Stroke outline (5.1:1 there) in the Text tab, or move it over a calmer part of the picture.");
    // A ratio between 3 and 4.5 is a tip, said more gently.
    const tip = byRule(person(p, "any", { contrast: { [id]: { ratio: 3.6, backdrop: [0.5, 0.5, 0.5], frame: 60 } } }), "text_low_contrast");
    expect(tip).toMatchObject({ level: "tip", title: "“A WAY HOME” could stand out more from the picture" });
    expect(tip.action).toMatch(/^Give it a Background box or a Stroke outline/);
  });

  it("puts black, strobes, the end card and the beat under timing", () => {
    let p = base();
    const id = p.tracks[0].clips[0].id;
    p = runCommand(p, "add_effect", { clip_id: id, type: "flash", params: { rate: 6 } });
    p = runCommand(p, "add_color_clip", { color: "#000000", start: 8, duration: 2, track_id: p.tracks[0].id });
    const list = person(p);
    expect(byRule(list, "flashes_too_fast")).toMatchObject({ group: "timing", level: "error", title: "A strobe flashes too fast", detail: "It flashes 6 times a second. More than 3 can trigger seizures.", clipId: id, at: 0 });
    expect(byRule(list, "gap_on_main_track")).toMatchObject({ group: "timing", level: "error", title: "Black gap on the main track", detail: "2 s of black where nothing plays.", at: 6 });
    expect(byRule(list, "gap_on_main_track").action).toMatch(/Close gap/);

    // An ad with no end card: the jump goes to its last seconds.
    const ad = byRule(person(base(), "ad"), "no_end_card");
    expect(ad).toMatchObject({ group: "timing", title: "No end card", at: 3.5 });
    expect(byRule(person(base(), "epic_edit"), "no_beat_grid").action).toBe("Select the music clip and run Beat markers in AI tools.");
    let beats = base();
    beats = runCommand(beats, "split", { at: 2.3, clip_ids: [beats.tracks[0].clips[0].id] });
    beats = runCommand(beats, "add_markers", { times: [1, 2, 3], label: "Beat" });
    expect(byRule(person(beats, "epic_edit"), "cuts_off_beat")).toMatchObject({ group: "timing", title: "Cuts miss the beat", detail: "1 of 1 cuts miss a beat (or half a beat) by more than a frame. This goes to the first.", at: 2.3 });
  });

  it("names a sound cut off mid-sound by its file, under sound", () => {
    const song: Asset = { id: "song", kind: "audio", name: "Summer song.mp3", src: "song.mp3", duration: 60, hasVideo: false, hasAudio: true };
    let p: Project = { ...createProject(), assets: [song] };
    p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 10, track_id: p.tracks[0].id });
    p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 6 });
    const cut = byRule(person(p), "sound_cut_off");
    expect(cut).toMatchObject({ group: "sound", level: "warning", title: "“Summer song.mp3” is cut off mid-sound", at: 6 });
    expect(cut.action).toMatch(/Fade out in the Audio tab/);
    expect(cut.tab).toBe("audio");
    expect(cut.clipId).toBe(clips(p).find((c) => c.type === "audio")!.id);
    expect(byRule(person(base()), "no_sound")).toMatchObject({ group: "sound", level: "tip" });
  });

  it("selects the compound clip that draws a title and says how to reach inside it", () => {
    let p = createProject();
    p = runCommand(p, "add_color_clip", { color: "#203040", start: 0, duration: 8, track_id: p.tracks[0].id });
    p = runCommand(p, "add_text", { text: "small print", start: 5, duration: 3, style: { size: 30, stroke: { color: "#000", width: 4 } } });
    const inner = clips(p).find((c) => c.type === "text")!.id;
    p = runCommand(p, "create_compound_clip", { clip_ids: [inner], name: "Card" });
    const comp = clips(p).find((c): c is CompoundClip => c.type === "compound")!;
    const small = byRule(person(p), "text_too_small");
    expect(small).toMatchObject({ title: "“small print” is too small to read on a phone", clipId: comp.id, tab: "video" });
    expect(small.action).toMatch(/^Scale the compound clip up by [\d.]+ times \(Video tab, Scale\), or double-click the compound clip and change the title inside it and set its Size to \d+ or more\.$/);
  });

  it("names many small captions together and tells to apply the size to all", () => {
    let p = base();
    p = runCommand(p, "add_captions", { captions: [{ start: 0, end: 2, text: "one two" }, { start: 2, end: 4, text: "three four" }], style: { size: 30 } });
    const small = byRule(person(p), "text_too_small");
    expect(small.title).toBe("2 captions are too small to read on a phone");
    expect(small.action).toMatch(/^Raise Size in the Text tab to \d+ or more, then Apply to all captions\.$/);
  });

  it("keeps a rule it does not know in the check's own words, grouped by its name", () => {
    const [f] = personFindings(base(), [{ rule: "click_at_join", level: "warning", message: "A join clicks at 2 s", fix: "set_fades", at: 2 }]);
    expect(f).toMatchObject({ group: "sound", title: "A join clicks at 2 s", action: "", at: 2 });
  });
});

describe("the panel's summary", () => {
  it("groups by kind with counts, errors first, and says what the counts mean", () => {
    let p = base();
    const main = p.tracks[0].id;
    p = runCommand(p, "add_color_clip", { color: "#000000", start: 8, duration: 2, track_id: main });
    p = runCommand(p, "add_effect", { clip_id: p.tracks[0].clips[1].id, type: "flash", params: { rate: 6 } });
    p = runCommand(p, "add_text", { text: "tiny", start: 4, duration: 2, style: { size: 24 } });
    const r = checkProject(p);
    const groups = groupFindings(personFindings(p, r.findings));
    expect(groups.map((g) => [g.label, g.findings.length])).toEqual([["Text", 1], ["Timing", 2], ["Sound", 1]]);
    // Within a group, by time: the gap at 6 s before the strobe at 8 s.
    expect(groups[1].findings.map((f) => [f.rule, f.at])).toEqual([["gap_on_main_track", 6], ["flashes_too_fast", 8]]);
    expect(checkHeadline(r.summary)).toEqual({ tone: "error", text: "2 errors to fix before you export, and 1 warning" });
    expect(checkHeadline({ errors: 0, warnings: 3, tips: 1 })).toEqual({ tone: "warning", text: "3 warnings to fix before you deliver, and 1 tip" });
    expect(checkHeadline({ errors: 0, warnings: 0, tips: 2 }).text).toBe("Ready to export, with 2 tips to consider");
    expect(checkHeadline({ errors: 0, warnings: 0, tips: 0 }).text).toBe("Ready to export: nothing found");
    expect(checkCounts({ errors: 1, warnings: 0, tips: 2 })).toBe("1 error, 2 tips");
    expect(checkCounts({ errors: 0, warnings: 0, tips: 0 })).toBe("Nothing found");
    expect(notChecked(r)[0]).toMatch(/^Loudness is not part of the check/);
    expect(notChecked(r)).toHaveLength(2);
  });
});
