import { describe, expect, it } from "vitest";
import { addAdElement, safeArea } from "./ads";
import { runCommand } from "./commands";
import { paramAt } from "./keyframes";
import { createProject } from "./project/defaults";
import { projectDuration } from "./project/ops";
import type { AudioClip, Clip, Project, TextClip, VideoClip } from "./project/types";
import { fittedSize, setTextMeasure } from "./render/size";

// A measure close to the engine's: about 0.55 em a character, wrapping at
// the style's width; the default stand-in is always as wide as it may be.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080;
  const widest = Math.max(...c.text.split("\n").map((l) => l.length)) * size * 0.55;
  const lines = c.text.split("\n").length * Math.max(1, Math.ceil(widest / (c.style.maxWidth * w)));
  return { width: Math.min(widest, c.style.maxWidth * w) + 4, height: size * c.style.lineHeight * lines + 4 };
});
import { cutDown, endCardStart, expandVersions, reshape, textless, versionName, versionProject } from "./versions";

/** A 15 s 16:9 master: a wide shot pushing in, a title low on the left,
 * a logo-sized picture, music, and a 3 s end card. */
function master(): Project {
  let p: Project = {
    ...createProject({ name: "Roast" }),
    assets: [
      { id: "shot", kind: "video", name: "shot.mp4", src: "shot.mp4", duration: 20, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false },
      { id: "logo", kind: "image", name: "logo.png", src: "logo.png", duration: 0, width: 400, height: 400, hasVideo: true, hasAudio: false },
      { id: "music", kind: "audio", name: "music.mp3", src: "music.mp3", duration: 30, hasVideo: false, hasAudio: true },
    ],
  };
  p = runCommand(p, "add_media_clip", { asset_id: "shot", start: 0, duration: 12 });
  const shot = p.tracks.flatMap((t) => t.clips)[0].id;
  p = runCommand(p, "frame_region", { clip_id: shot, region: { x: 0, y: 0, w: 1, h: 1 }, to_region: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 } });
  p = runCommand(p, "add_text", { text: "Small batch", start: 1, duration: 4, x: -0.3, y: 0.35, style: { size: 80 } });
  p = runCommand(p, "add_media_clip", { asset_id: "logo", start: 0, duration: 12, track_id: undefined });
  p = runCommand(p, "add_media_clip", { asset_id: "music", start: 0, duration: 15 });
  p = addAdElement(p, "end_card", { start: 360, headline: "Order now" }).project;
  return p;
}

const clips = (p: Project) => p.tracks.flatMap((t) => t.clips);
const byType = <T extends Clip["type"]>(p: Project, type: T) => clips(p).filter((c) => c.type === type) as Extract<Clip, { type: T }>[];

describe("versions", () => {
  it("names versions by what they are", () => {
    expect(versionName("Roast", { ratio: "9:16", duration: 6, textless: true })).toBe("Roast 9x16 6s textless");
    expect(versionName("Roast", { ratio: "original" })).toBe("Roast");
    expect(versionName("Roast", { ratio: "1:1", name: "Square" })).toBe("Square");
  });

  it("finds the end card", () => {
    expect(endCardStart(master())).toBe(360);
    expect(endCardStart(createProject())).toBeUndefined();
  });

  it("refits a wide master to 9:16: footage fills, the push-in keeps its framing, titles stay in the safe area", () => {
    const p = master();
    const q = reshape(p, "9:16", "fill");
    expect([q.width, q.height]).toEqual([1080, 1920]);
    const shot = byType(q, "video")[0];
    const before = byType(p, "video")[0];
    // Covering 1080 x 1920 with a 16:9 picture takes 1920/1080 / (1080/1920) times the fit scale.
    const k = (1920 / 1080) / (1080 / 1920);
    expect(shot.transform.scale).toBeCloseTo(before.transform.scale * k, 3);
    expect(shot.keyframes!["transform.scale"].map((x) => x.v)).toEqual(before.keyframes!["transform.scale"].map((x) => +(x.v * k).toFixed(5)));
    // Every frame of the push-in still covers the frame.
    for (const f of [0, 100, 200, 359]) {
      const s = paramAt(shot, "transform.scale", f), x = paramAt(shot, "transform.x", f);
      const w = 1920 * (1080 / 1920) * s;
      expect(Math.abs(x) * 1080).toBeLessThanOrEqual((w - 1080) / 2 + 0.5);
    }
    // The title keeps its pixel size against the short side and lands
    // inside 9:16's safe area: clear of the bottom 35% and the left 11%.
    const title = byType(q, "text").find((t) => t.text === "Small batch")!;
    expect(title.style.size).toBeCloseTo(80 * (1080 / 1920), 1);
    const size = fittedSize(q, title);
    const bottom = q.height / 2 + title.transform.y * q.height + size.h / 2;
    const left = q.width / 2 + title.transform.x * q.width - size.w / 2;
    expect(bottom).toBeLessThanOrEqual(0.65 * 1920 + 0.5);
    expect(left).toBeGreaterThanOrEqual(0.11 * 1080 - 0.5);
    // The logo picture keeps its pixels against the short side.
    const logo = byType(q, "image")[0], logo0 = byType(p, "image")[0];
    expect(fittedSize(q, logo).w * logo.transform.scale).toBeCloseTo(fittedSize(p, logo0).w * logo0.transform.scale, 1);
  });

  it("shrinks a refit headline to fit the narrow frame's safe area, but no more than to three quarters", () => {
    let p = runCommand(createProject(), "add_text", { text: "Small batch.\nBig flavor.", start: 0, duration: 2, style: { size: 120 } });
    p = runCommand(p, "add_text", { text: "A very long headline that has no business being on one line", start: 0, duration: 2, style: { size: 120 } });
    const [short, long] = byType(reshape(p, "9:16", "fill"), "text").sort((x, y) => x.text.length - y.text.length);
    const room = (1 - 0.11 - 0.19) * 1080;
    expect(short.style.size).toBeLessThan(120 * (1080 / 1920));
    expect(fittedSize({ ...p, width: 1080, height: 1920 }, { ...short, style: { ...short.style, maxWidth: 1 } }).w).toBeLessThanOrEqual(room + 1);
    expect(long.style.size).toBeCloseTo(120 * (1080 / 1920) * 0.75, 1);
  });

  it("fits the footage over a blurred copy when asked", () => {
    const q = reshape(master(), "1:1", "blur");
    const shot = byType(q, "video")[0];
    expect(shot.canvas).toEqual({ type: "blur", amount: 40 });
    expect(shot.transform.scale).toBeCloseTo(byType(master(), "video")[0].transform.scale, 5);
  });

  it("keeps an end card's group together, centered", () => {
    const q = reshape(master(), "4:5", "fill");
    const card = clips(q).filter((c) => c.name === "End card" && c.type !== "color") as TextClip[];
    const xs = card.map((c) => c.transform.x);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(0.02);
    const bg = clips(q).find((c) => c.name === "End card" && c.type === "color")!;
    expect((bg as Clip & { crop: object }).crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("cuts down to 6 s keeping the opening and the end card, the music fading at the end", () => {
    const p = master();
    const q = cutDown(p, 180, 90);
    expect(projectDuration(q)).toBe(180);
    const card = clips(q).filter((c) => c.name === "End card");
    expect(Math.min(...card.map((c) => c.start))).toBe(90);
    expect(byType(q, "video")[0]).toMatchObject({ start: 0, duration: 90 });
    const music = byType(q, "audio")[0] as AudioClip;
    expect(music.start + music.duration).toBe(180);
    expect(music.fadeOut).toBe(30);
    // Tracks keep their locks.
    expect(q.tracks.every((t, i) => t.locked === p.tracks[i].locked)).toBe(true);
    expect(cutDown(p, 9999, 90)).toBe(p);
  });

  it("makes a textless master: titles off, the card's solid and the footage on", () => {
    const q = textless(master());
    expect(byType(q, "text").every((t) => t.disabled)).toBe(true);
    expect(byType(q, "video").every((v) => !v.disabled)).toBe(true);
    expect(clips(q).find((c) => c.type === "color")!.disabled).toBeUndefined();
  });

  it("combines them, finding the end card by itself, and never touches the master", () => {
    const p = master();
    const snapshot = JSON.stringify(p);
    const v = versionProject(p, { ratio: "9:16", duration: 6, textless: true });
    expect(v.name).toBe("Roast 9x16 6s textless");
    expect([v.width, v.height, projectDuration(v)]).toEqual([1080, 1920, 180]);
    expect(byType(v, "text").every((t) => t.disabled)).toBe(true);
    expect(JSON.stringify(p)).toBe(snapshot);
    const shot = byType(v, "video")[0] as VideoClip;
    expect(shot.duration).toBe(90);
  });
});

describe("asking for versions", () => {
  it("crosses ratios with durations, the full length meaning the master", () => {
    expect(expandVersions({ ratios: ["9:16", "1:1"], durations: [15, 6] }, 15)).toEqual([{ ratio: "9:16" }, { ratio: "9:16", duration: 6 }, { ratio: "1:1" }, { ratio: "1:1", duration: 6 }]);
    expect(expandVersions({ durations: [30, 15, 6] }, 15)).toEqual([{ ratio: "original" }, { ratio: "original", duration: 6 }]);
    expect(expandVersions({ versions: [{ ratio: "4:5" }], textless: true, fit: "blur" }, 15)).toEqual([{ ratio: "4:5", fit: "blur" }, { ratio: "4:5", textless: true, fit: "blur" }]);
  });

  it("refuses nothing, too many and twins", () => {
    expect(() => expandVersions({}, 15)).toThrow(/which versions/);
    expect(() => expandVersions({ ratios: ["9:16", "1:1", "4:5", "16:9"], durations: [1, 2, 3, 4] }, 15)).toThrow(/more than 12/);
    expect(() => expandVersions({ versions: [{ ratio: "1:1" }, { ratio: "1:1" }] }, 15)).toThrow(/same/);
  });
});

describe("a 9:16 ad in other shapes", () => {
  /** A 12 s 9:16 master: a wide photo letterboxed on the center line, an
   * offer badge with a tag in the top right, and an end card (logo,
   * headline, button, url). */
  function vertical(): Project {
    let p: Project = {
      ...createProject({ name: "Ember", width: 1080, height: 1920 }),
      assets: [
        { id: "photo", kind: "image", name: "photo.jpg", src: "photo.jpg", duration: 0, width: 1920, height: 1080, hasVideo: true, hasAudio: false },
        { id: "logo", kind: "image", name: "logo.png", src: "logo.png", duration: 0, width: 900, height: 300, hasVideo: true, hasAudio: false },
      ],
    };
    p = runCommand(p, "set_brand", { name: "Ember", primary: "#ff5a5f", accent: "#ffd23f", background: "#1b1b2f", logo: "logo", url: "emberroast.example" });
    p = runCommand(p, "add_media_clip", { asset_id: "photo", start: 0, duration: 12 });
    p = addAdElement(p, "offer_badge", { start: 150, headline: "-30%", subline: "Today only" }).project;
    return addAdElement(p, "end_card", { start: 270, duration: 90, headline: "Fresh roast,\nevery morning", cta: "Order now" }).project;
  }

  /** A layer's box at rest, turned by its rotation. */
  function boxOn(p: Project, c: Clip) {
    const v = c as Extract<Clip, { transform: unknown }>;
    const s = fittedSize(p, v);
    const w = s.w * v.transform.scale, h = s.h * (v.transform.scaleY ?? v.transform.scale);
    const rad = (v.transform.rotation * Math.PI) / 180;
    const hw = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2, hh = (Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h) / 2;
    const cx = p.width / 2 + v.transform.x * p.width, cy = p.height / 2 + v.transform.y * p.height;
    return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh, h };
  }
  const card = (p: Project) => clips(p).filter((c) => c.name === "End card" && c.type !== "color");
  const area = (p: Project) => {
    const s = safeArea(p);
    return { left: s.left * p.width, right: p.width * (1 - s.right), top: s.top * p.height, bottom: p.height * (1 - s.bottom) };
  };

  it("fits the end card as one: its parts keep their layout, never overlap, and stay centered in the safe area", () => {
    const p = vertical();
    const before = card(p).map((c) => boxOn(p, c));
    // The gaps between the parts against the headline's height, top to bottom.
    const rhythm = (boxes: ReturnType<typeof boxOn>[]) => {
      const order = [...boxes].sort((a, b) => a.top - b.top);
      const headline = order[1].h;
      return order.slice(1).map((b, i) => +((b.top - order[i].bottom) / headline).toFixed(3));
    };
    for (const ratio of ["16:9", "1:1", "4:5"] as const) {
      const q = reshape(p, ratio, "fill");
      const boxes = card(q).map((c) => boxOn(q, c));
      const order = [...boxes].sort((a, b) => a.top - b.top);
      for (let i = 1; i < order.length; i++) expect(order[i].top, ratio).toBeGreaterThanOrEqual(order[i - 1].bottom - 0.5);
      const r = area(q);
      expect(Math.min(...boxes.map((b) => b.top)), ratio).toBeGreaterThanOrEqual(r.top - 0.5);
      expect(Math.max(...boxes.map((b) => b.bottom)), ratio).toBeLessThanOrEqual(r.bottom + 0.5);
      expect((Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2, ratio).toBeCloseTo(q.width / 2, 0);
      // The same rhythm as the master's: the stack grew as its type did.
      rhythm(boxes).forEach((g, i) => expect(g, ratio).toBeCloseTo(rhythm(before)[i], 2));
    }
  });

  it("shrinks a group that would not fit, as one", () => {
    // Back to 9:16 from a 16:9 card as tall as its frame.
    let p: Project = { ...createProject({ width: 1920, height: 1080 }) };
    p = runCommand(p, "add_text", { text: "One\nTwo\nThree", start: 0, duration: 2, y: -0.2, style: { size: 150 } });
    p = runCommand(p, "add_text", { text: "Four\nFive", start: 0, duration: 2, y: 0.25, style: { size: 150 } });
    p = runCommand(p, "group_clips", { clip_ids: clips(p).map((c) => c.id) });
    const q = reshape(p, "9:16", "fill");
    const [a, b] = clips(q).map((c) => boxOn(q, c)).sort((x, y) => x.top - y.top);
    const r = area(q);
    expect(a.top).toBeGreaterThanOrEqual(r.top - 0.5);
    expect(b.bottom).toBeLessThanOrEqual(r.bottom + 0.5);
    expect(b.top).toBeGreaterThan(a.bottom);
    const [ta, tb] = clips(q) as TextClip[];
    expect(ta.style.size / tb.style.size).toBeCloseTo(1, 5);
    expect(ta.style.size).toBeLessThan(160 * (1080 / 1920) - 1);
  });

  it("keeps the badge in its corner and a centered picture centered", () => {
    const p = vertical();
    for (const ratio of ["16:9", "1:1", "4:5"] as const) {
      const q = reshape(p, ratio, "fill");
      const badge = clips(q).filter((c) => c.name === "Offer badge").map((c) => boxOn(q, c));
      const r = area(q);
      expect(Math.max(...badge.map((b) => b.right)), ratio).toBeCloseTo(r.right, 0);
      expect(Math.min(...badge.map((b) => b.top)), ratio).toBeCloseTo(r.top, 0);
      // The photo reached past 9:16's safe area into the captions' band; it
      // stays on the center line rather than against an edge.
      const photo = byType(q, "image").find((c) => c.assetId === "photo")!;
      expect([photo.transform.x, photo.transform.y], ratio).toEqual([0, 0]);
    }
  });

  it("keeps a shape's pixels against the short side", () => {
    const p = runCommand(createProject(), "add_shape", { kind: "rectangle", start: 0, duration: 2, y: 0.3, width: 0.4, height: 0.1, stroke_color: "#000000", stroke_width: 6 });
    const q = reshape(p, "9:16", "fill");
    const [a, b] = [clips(p)[0], clips(q)[0]] as (Clip & { shape: { width: number; height: number; stroke: { width: number } } })[];
    expect(b.shape.width * 1080).toBeCloseTo(a.shape.width * 1920, 1);
    expect(b.shape.height * 1920).toBeCloseTo(a.shape.height * 1080, 1);
    // Stroke pixels at a 1080-tall frame: the same 6 px on a 1920-tall one.
    expect((b.shape.stroke.width * 1920) / 1080).toBeCloseTo(6, 1);
  });
});
