// Ad elements, captions and the track stack, rebuilt from the third Claude
// film test's call log (ADR-121): a 16:9 explainer with a voiceover's
// captions at y 0.38, spotlight and callout tracks added by hand, a lower
// third with the brand's icon, a logo reveal and an end card.
import { describe, expect, it } from "vitest";
import { runCommand, type CommandReport } from "./commands";
import { checkProject, seenLetters, seenTexts } from "./designCheck";
import { createProject } from "./project/defaults";
import { findClip } from "./project/ops";
import type { Clip, Project } from "./project/types";

const fps = { num: 30, den: 1 };

function explainer(): Project {
  let p: Project = {
    ...createProject({ fps, width: 1920, height: 1080 }),
    assets: [
      { id: "rec", kind: "video", name: "01b-home-open.mp4", src: "rec.mp4", duration: 70, width: 2560, height: 1440, hasVideo: true, hasAudio: false },
      { id: "icon", kind: "image", name: "openframe-icon.png", src: "icon.png", duration: 0, width: 512, height: 512, hasVideo: true, hasAudio: false },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "rec", start: 0, duration: 70.4 });
  p = runCommand(p, "set_brand", { name: "OpenFrame", primary: "#22C3DA", accent: "#7C5CFF", secondary: "#2BB673", background: "#0F1117", text: "#FFFFFF", heading_font: "Inter", body_font: "Inter", logo: "icon", logo_icon: "icon", tagline: "Edit like you mean it." });
  // The voiceover's captions, three words at a time, at y 0.38.
  const words = ["OpenFrame gives", "you both.", "It's free,", "open source,", "and it runs", "on your own", "computer."];
  p = runCommand(p, "add_captions", { captions: words.map((text, i) => ({ text, start: 5.1 + i * 0.85, end: 5.1 + (i + 1) * 0.85 })), y: 0.38, style: { font: "Inter", size: 54, weight: 700, background: { color: "rgba(15,17,23,0.82)", padding: 16, radius: 14 } } });
  return p;
}

const all = (p: Project) => p.tracks.flatMap((t) => t.clips);
const trackOf = (p: Project, id: string) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
const captionsTrack = (p: Project) => p.tracks.findIndex((t) => t.clips.length > 0 && t.clips.every((c) => c.type === "text" && c.caption));
const newClips = (before: Project, after: Project) => all(after).filter((c) => !findClip(before, c.id));

describe("captions stay the top layer", () => {
  it("keeps a new track, title, shape and spotlight under a voiceover's captions", () => {
    let p = explainer();
    expect(captionsTrack(p)).toBe(0);
    // The tester's add_track Spotlight and Callouts went above the captions.
    p = runCommand(p, "add_track", { kind: "video", name: "Spotlight" });
    p = runCommand(p, "add_track", { kind: "video", name: "Callouts" });
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 5, duration: 3, width: 1, height: 1, color: "#000000", opacity: 0.5 });
    p = runCommand(p, "add_text", { text: "01 CUT & TRIM", start: 6, duration: 2.8, x: -0.33, y: -0.4 });
    expect(captionsTrack(p)).toBe(0);
    expect(p.tracks.slice(1, 3).map((t) => t.name)).toEqual(expect.arrayContaining(["Spotlight", "Callouts"]));
    // A captions row moved down by hand stays where it was put.
    const caps = p.tracks[0].id;
    p = runCommand(p, "move_track", { track_id: caps, below_track_id: p.tracks[2].id });
    p = runCommand(p, "add_track", { kind: "video", name: "Top" });
    expect(p.tracks[0].name).toBe("Top");
  });
});

describe("ad elements", () => {
  it("draws the logo a lower third is given, left of its name and title", () => {
    const p = explainer();
    const q = runCommand(p, "add_ad_element", { element: "lower_third", start: 5.7, duration: 4.6, headline: "OpenFrame", subline: "Free, open-source video editor", logo: "icon" });
    const parts = newClips(p, q);
    const logo = parts.find((c) => c.type === "image")!;
    const texts = parts.filter((c): c is Extract<Clip, { type: "text" }> => c.type === "text");
    expect(logo).toBeDefined();
    expect(texts).toHaveLength(2);
    expect(new Set(parts.map((c) => c.group)).size).toBe(1);
    // Left of both texts' left edges.
    if (logo.type !== "image") throw new Error();
    expect(logo.transform.x).toBeLessThan(Math.min(...texts.map((t) => t.transform.x)));
    // Without logo, none, as before.
    const plain = newClips(p, runCommand(p, "add_ad_element", { element: "lower_third", start: 5.7, headline: "OpenFrame" }));
    expect(plain.some((c) => c.type === "image")).toBe(false);
  });

  it("refuses a logo on an element that draws none", () => {
    const p = explainer();
    expect(() => runCommand(p, "add_ad_element", { element: "offer_badge", start: 1, headline: "-30%", logo: "icon" })).toThrow(/draws no logo/);
    expect(() => runCommand(p, "add_ad_element", { element: "cta_button", start: 1, logo: "auto" })).toThrow(/draws no logo/);
    expect(() => runCommand(p, "add_ad_element", { element: "cta_button", start: 1, logo: "none" })).not.toThrow();
  });

  it("places a lower third clear of the captions showing then, and says so", () => {
    const p = explainer();
    const report: CommandReport = {};
    const q = runCommand(p, "add_ad_element", { element: "lower_third", start: 5.7, duration: 4.6, headline: "OpenFrame", subline: "Free, open-source video editor", logo: "icon" }, report);
    expect(report.notes?.join(" ")).toMatch(/Placed above the captions showing then/);
    const ids = new Set(newClips(p, q).map((c) => c.id));
    const seen = seenTexts(q);
    const capTop = Math.min(...seen.filter((s) => s.c.caption && s.start < 309 && s.start + s.duration > 171).map((s) => seenLetters(q, s)!.box.top));
    for (const c of newClips(p, q)) if (c.type === "text") expect(seenLetters(q, seen.find((s) => s.c.id === c.id)!)!.box.bottom).toBeLessThan(capTop);
    expect(checkProject(q).findings.filter((f) => f.rule === "text_overlaps_text")).toEqual([]);
    // Where the tester's landed (y 0.31 and 0.41): the check names it, with every caption it crosses and the move.
    let r = q;
    for (const c of newClips(p, q)) if (c.type === "text") r = runCommand(r, "set_param", { clip_ids: [c.id], path: "transform.y", value: c.text === "OpenFrame" ? 0.312 : 0.4097 });
    const found = checkProject(r).findings.filter((f) => f.rule === "text_overlaps_text");
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((f) => ids.has(f.clip_id!))).toBe(true);
    expect(found[0].message).toMatch(/is drawn across \d+ captions/);
    expect(found[0].fix).toMatch(/move it up [\d.]+ of the frame's height \(set_param transform\.y -?[\d.]+, and its group's other parts by the same amount\)/);
  });

  it("puts each element on rows of its own, so moving another track never slides between its parts", () => {
    let p = explainer();
    p = runCommand(p, "add_track", { kind: "video", name: "Spotlight" });
    p = runCommand(p, "add_shape", { kind: "rectangle", start: 55.8, duration: 3.2, width: 1, height: 1, color: "#000000", opacity: 0.55, track_id: p.tracks[1].id });
    p = runCommand(p, "add_track", { kind: "video", name: "Titles" });
    p = runCommand(p, "add_text", { text: "04 AI AGENT", start: 41.7, duration: 2.8, x: -0.33, y: -0.4, track_id: p.tracks[1].id });
    // An empty track made for something else is not the element's row.
    p = runCommand(p, "add_track", { kind: "video", name: "Callouts" });
    p = runCommand(p, "move_track", { track_id: p.tracks.find((t) => t.name === "Callouts")!.id, below_track_id: p.tracks.find((t) => t.name === "Spotlight")!.id });
    const before = p;
    p = runCommand(p, "add_ad_element", { element: "logo_reveal", start: 60.2, duration: 3.75, headline: "OpenFrame", subline: "Edit like you mean it.", glow: true, logo: "icon" });
    p = runCommand(p, "add_ad_element", { element: "end_card", start: 63.95, duration: 6.45, headline: "Free. Open source. Yours.", cta: "Download OpenFrame", logo: "icon", background: "brand" });
    for (const name of ["Logo reveal", "End card"]) {
      const parts = newClips(before, p).filter((c) => c.name === name);
      const rows = parts.map((c) => trackOf(p, c.id));
      // One row a part, the rows together, nothing else on them.
      expect(new Set(rows).size).toBe(parts.length);
      expect(Math.max(...rows) - Math.min(...rows)).toBe(parts.length - 1);
      for (const r of rows) expect(p.tracks[r].clips.every((c) => c.name === name)).toBe(true);
    }
    expect(p.tracks.find((t) => t.name === "Callouts")!.clips).toEqual([]);
    // The end card's icon stays above its card whatever other track moves,
    // even to between its rows (the tester's: Spotlight below Titles).
    const card = all(p).find((c) => c.name === "End card" && c.type === "color")!;
    const icon = all(p).find((c) => c.name === "End card" && c.type === "image")!;
    const spot = p.tracks.find((t) => t.name === "Spotlight")!.id;
    const titles = p.tracks.find((t) => t.name === "Titles")!.id;
    for (const [track, below] of [[spot, titles], [titles, p.tracks[trackOf(p, card.id)].id], [spot, p.tracks[trackOf(p, icon.id)].id]]) {
      const moved = runCommand(p, "move_track", { track_id: track, below_track_id: below });
      expect(trackOf(moved, icon.id)).toBeLessThan(trackOf(moved, card.id));
      expect(captionsTrack(moved)).toBe(0);
    }
  });
});
