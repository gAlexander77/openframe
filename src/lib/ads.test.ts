import { describe, expect, it } from "vitest";
import { addAdElement, behindProblem, putBehindSubject, safeArea } from "./ads";
import { runCommand } from "./commands";
import { createProject } from "./project/defaults";
import type { Clip, ImageClip, Project, TextClip, VideoClip } from "./project/types";
import { fittedSize } from "./render/size";

const branded = (w = 1920, h = 1080): Project => {
  const p: Project = {
    ...createProject({ width: w, height: h }),
    assets: [{ id: "logo", kind: "image", name: "logo.png", src: "logo.png", duration: 0, width: 800, height: 400, hasVideo: true, hasAudio: false }],
  };
  return runCommand(p, "set_brand", { name: "Roast", primary: "#ff3366", accent: "#ffd23f", background: "#14101f", logo: "logo", url: "roast.example", tagline: "Fresh every morning" });
};

const clipsOf = (p: Project, ids: string[]) => ids.map((id) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!);

/** A clip's box on the canvas at rest, in pixels. */
function box(p: Project, c: Clip) {
  if (c.type === "audio" || c.type === "adjustment") throw new Error("no picture");
  const s = fittedSize(p, c);
  const w = s.w * c.transform.scale, h = s.h * (c.transform.scaleY ?? c.transform.scale);
  const cx = p.width / 2 + c.transform.x * p.width, cy = p.height / 2 + c.transform.y * p.height;
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
}

describe("ad elements", () => {
  it("builds an end card: a brand-colored card, logo, headline, button and url, grouped, inside the safe area", () => {
    const { project: p, clipIds } = addAdElement(branded(), "end_card", { start: 300, headline: "Fresh roast", cta: "Order now" });
    const cs = clipsOf(p, clipIds);
    expect(cs.map((c) => c.type)).toEqual(["color", "image", "text", "text", "text"]);
    expect(new Set(cs.map((c) => c.group)).size).toBe(1);
    expect(cs.every((c) => c.name === "End card" && c.start + c.duration === 390)).toBe(true);
    expect((cs[0] as Clip & { color: string }).color).toBe("#14101f");
    const texts = cs.filter((c): c is TextClip => c.type === "text");
    expect(texts.map((t) => t.text)).toEqual(["Fresh roast", "Order now", "roast.example"]);
    // The button is the primary color with a readable label; the headline
    // types in by word, after the logo.
    expect(texts[1].style.background!.color).toBe("#ff3366");
    expect(texts[0].animIn).toMatchObject({ type: "wordRise" });
    expect(cs[2].start).toBeGreaterThan(cs[1].start);
    // Stacked top to bottom in order, centered, inside 5% margins.
    const boxes = cs.slice(1).map((c) => box(p, c));
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 1);
    const s = safeArea(p);
    expect(Math.min(...boxes.map((b) => b.top))).toBeGreaterThanOrEqual(s.top * p.height - 1);
    expect(Math.max(...boxes.map((b) => b.bottom))).toBeLessThanOrEqual(p.height * (1 - s.bottom) + 1);
    // The logo is scaled to about 16% of the frame's height.
    const logo = cs[1] as ImageClip;
    expect(box(p, logo).bottom - box(p, logo).top).toBeCloseTo(0.16 * p.height, 0);
  });

  it("puts a button that would match its card in the accent color", () => {
    const { project: p, clipIds } = addAdElement(branded(), "end_card", { start: 0, background: "primary" });
    const button = clipsOf(p, clipIds).find((c): c is TextClip => c.type === "text" && !!c.style.background)!;
    expect(button.style.background!.color).toBe("#ffd23f");
    expect(button.style.color).toBe("#111111");
  });

  it("lays a lower third against the safe area's bottom-left corner, name over title", () => {
    const { project: p, clipIds } = addAdElement(branded(), "lower_third", { start: 30, headline: "Mia Chen", subline: "Head roaster" });
    const [name, title] = clipsOf(p, clipIds) as TextClip[];
    expect([name.style.align, title.style.align]).toEqual(["left", "left"]);
    const a = box(p, name), b = box(p, title);
    expect(a.left).toBeCloseTo(0.05 * p.width, 0);
    expect(b.bottom).toBeCloseTo(0.95 * p.height, 0);
    expect(a.bottom).toBeLessThanOrEqual(b.top + 0.5);
    expect(title.style.background!.color).toBe("#ff3366");
    expect(clipsOf(p, clipIds).every((c) => c.duration + c.start === 30 + 120)).toBe(true);
  });

  it("keeps a 9:16 lower third clear of the apps' captions and buttons", () => {
    const { project: p, clipIds } = addAdElement(branded(1080, 1920), "lower_third", { start: 0, headline: "Mia" });
    const bottom = Math.max(...clipsOf(p, clipIds).map((c) => box(p, c).bottom));
    expect(bottom).toBeCloseTo(0.65 * 1920, 0);
    // Type is scaled for the narrow frame.
    expect((clipsOf(p, clipIds)[0] as TextClip).style.size).toBeLessThan(54);
  });

  it("tilts and pulses an offer badge in the top right", () => {
    const { project: p, clipIds } = addAdElement(branded(), "offer_badge", { start: 0, headline: "-30%", subline: "Today only" });
    const [badge, tag] = clipsOf(p, clipIds) as TextClip[];
    expect(badge.transform.rotation).toBe(-4);
    expect(badge.animLoop?.type).toBe("pulse");
    expect(badge.style.background!.color).toBe("#ffd23f");
    expect(tag.text).toBe("Today only");
    expect(Math.max(box(p, badge).right, box(p, tag).right)).toBeCloseTo(0.95 * p.width, 0);
  });

  it("reveals the logo with a glow flare and a white flash", () => {
    const { project: p, clipIds } = addAdElement(branded(), "logo_reveal", { start: 0, glow: true, flash: true });
    const cs = clipsOf(p, clipIds);
    const logo = cs.find((c): c is ImageClip => c.type === "image")!;
    expect(logo.effects[0].type).toBe("glow");
    expect(Object.keys(logo.keyframes!)[0]).toBe(`effects.${logo.effects[0].id}.amount`);
    const flash = cs.find((c) => c.name === "Flash") as Clip & { blend: string };
    expect(flash.blend).toBe("add");
    expect(flash.duration).toBeLessThanOrEqual(12);
    // The tagline sits under the logo as a line of its own.
    expect(cs.some((c) => c.type === "text" && c.text === "Fresh every morning")).toBe(true);
  });

  it("falls back to a wordmark without a logo, and refuses a missing logo by name", () => {
    let p = runCommand(createProject(), "set_brand", { name: "Roast" });
    p = runCommand(p, "add_ad_element", { element: "logo_reveal", start: 0 });
    expect(p.tracks.flatMap((t) => t.clips).some((c) => c.type === "text" && c.text === "Roast")).toBe(true);
    expect(() => runCommand(p, "add_ad_element", { element: "end_card", start: 0, logo: "light" })).toThrow(/no logo/);
  });

  it("adds a call to action through the command, timed in seconds", () => {
    const p = runCommand(branded(), "add_ad_element", { element: "cta_button", start: 2, duration: 2.5, cta: "Get yours", url: "roast.example" });
    const cs = p.tracks.flatMap((t) => t.clips).filter((c) => c.name === "Call to action").sort((a, b) => a.start - b.start);
    expect(cs.map((c) => (c as TextClip).text)).toEqual(["Get yours", "roast.example"]);
    expect(cs[0].start).toBe(60);
    expect(cs[0].start + cs[0].duration).toBe(135);
  });
});

describe("text behind the subject", () => {
  const cut = { enabled: true, src: "matte.mp4", from: 0, to: 5, model: "m" };
  const setup = () => {
    let p: Project = { ...createProject(), assets: [{ id: "v", kind: "video", name: "person.mp4", src: "person.mp4", duration: 5, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true }] };
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0 });
    p = runCommand(p, "add_text", { text: "BOLD", start: 0, duration: 3, style: { size: 300 } });
    const all = p.tracks.flatMap((t) => t.clips);
    return { p, video: all.find((c) => c.type === "video")!.id, title: all.find((c) => c.type === "text")!.id };
  };

  it("lays a silent, cut-out copy of the video above the title, grouped with the original", () => {
    const { p, video, title } = setup();
    const { project: q, subjectId } = putBehindSubject(p, video, [title], cut);
    const order = q.tracks.map((t) => t.clips.map((c) => c.id)).flat();
    expect(order.indexOf(subjectId)).toBeLessThan(order.indexOf(title));
    expect(order.indexOf(title)).toBeLessThan(order.indexOf(video));
    const subject = q.tracks.flatMap((t) => t.clips).find((c) => c.id === subjectId)! as VideoClip;
    const original = q.tracks.flatMap((t) => t.clips).find((c) => c.id === video)! as VideoClip;
    expect(subject).toMatchObject({ muted: true, cutout: cut, start: original.start, duration: original.duration, assetId: "v", name: "Subject" });
    expect(original.cutout).toBeUndefined();
    expect(subject.group).toBeDefined();
    expect(subject.group).toBe(original.group);
  });

  it("lifts a title from below the video, and drops the copy's canvas fill", () => {
    let { p, video, title } = setup();
    // Move the video above the title, with a blurred canvas fill.
    p = runCommand(p, "add_track", { kind: "video", name: "Top" });
    const top = p.tracks[0].id;
    p = runCommand(p, "move_clip", { clip_id: video, track_id: top, start: 0 });
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === video ? ({ ...c, canvas: { type: "blur", amount: 30 } } as Clip) : c)) })) };
    const { project: q, subjectId } = putBehindSubject(p, video, [title], cut);
    const index = (id: string) => q.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
    expect(index(subjectId)).toBeLessThan(index(title));
    expect(index(title)).toBeLessThan(index(video));
    expect((q.tracks.flatMap((t) => t.clips).find((c) => c.id === subjectId) as VideoClip).canvas).toBeUndefined();
  });

  it("refuses what it cannot do, saying why", () => {
    const { p, video, title } = setup();
    expect(behindProblem(p, title, [video])).toMatch(/must be in a video clip/);
    expect(behindProblem(p, video, [])).toMatch(/name the title/);
    const late = runCommand(p, "add_text", { text: "Later", start: 8, duration: 1 });
    const id = late.tracks.flatMap((t) => t.clips).find((c) => c.type === "text" && c.text === "Later")!.id;
    expect(behindProblem(late, video, [id])).toMatch(/does not play while the video does/);
    expect(behindProblem(p, video, [title])).toBeNull();
  });
});

describe("the subject copy and transitions", () => {
  it("fades the copy across the half of each transition inside the clip", () => {
    let p: Project = { ...createProject(), assets: [{ id: "v", kind: "video", name: "person.mp4", src: "person.mp4", duration: 5, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true }] };
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 0, duration: 2 });
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 2, duration: 2 });
    p = runCommand(p, "add_media_clip", { asset_id: "v", start: 4, duration: 1 });
    const [a, b] = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "video").sort((x, y) => x.start - y.start);
    p = runCommand(p, "set_transition", { clip_id: a.id, type: "dissolve", duration: 0.5 });
    p = runCommand(p, "set_transition", { clip_id: b.id, type: "dissolve", duration: 1 });
    p = runCommand(p, "add_text", { text: "HI", start: 2, duration: 2 });
    const title = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id;
    const { project: q, subjectId } = putBehindSubject(p, b.id, [title], { enabled: true, src: "m.mp4", from: 0, to: 5, model: "m" });
    const copy = q.tracks.flatMap((t) => t.clips).find((c) => c.id === subjectId) as VideoClip;
    expect(copy.animIn).toEqual({ type: "fade", duration: 8 });
    expect(copy.animOut).toEqual({ type: "fade", duration: 15 });
    expect(copy.transitionOut).toBeUndefined();
  });
});

describe("set_audio_fade", () => {
  it("fades sound in seconds, no longer than the clip, and refuses silent clips", () => {
    let p: Project = { ...createProject(), assets: [{ id: "m", kind: "audio", name: "music.mp3", src: "music.mp3", duration: 30, hasVideo: false, hasAudio: true }] };
    p = runCommand(p, "add_media_clip", { asset_id: "m", start: 0, duration: 2 });
    p = runCommand(p, "add_text", { text: "Hi", start: 0, duration: 1 });
    const music = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "audio")!.id;
    const text = p.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!.id;
    p = runCommand(p, "set_audio_fade", { clip_ids: [music], fade_in: 0.5, fade_out: 5 });
    expect(p.tracks.flatMap((t) => t.clips).find((c) => c.id === music)).toMatchObject({ fadeIn: 15, fadeOut: 60 });
    expect(() => runCommand(p, "set_audio_fade", { clip_ids: [text], fade_in: 1 })).toThrow(/no sound/);
    expect(() => runCommand(p, "set_audio_fade", { clip_ids: [music] })).toThrow(/fade_in, fade_out/);
  });
});
