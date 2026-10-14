import { describe, expect, it } from "vitest";
import { ANIMATIONS } from "./catalog";
import { runCommand } from "./commands";
import { createProject, createTextClip, DEFAULT_TEXT_STYLE } from "./project/defaults";
import { findClip } from "./project/ops";
import type { ColorClip, TextClip } from "./project/types";
import { addTemplate, findTemplate, TEXT_TEMPLATES, templateClips, wordArtStyle } from "./templates";

const fps = { num: 30, den: 1 };

describe("template catalog", () => {
  it("has enough of each kind, every layer either text or a box, every animation known", () => {
    const all = Object.values(TEXT_TEMPLATES);
    expect(all.filter((t) => t.category === "Word art").length).toBeGreaterThanOrEqual(10);
    expect(all.filter((t) => t.category === "Templates").length).toBeGreaterThanOrEqual(8);
    for (const t of all) {
      for (const l of t.layers) {
        expect(!!l.box !== (l.text !== undefined)).toBe(true);
        for (const a of [l.in, l.out, l.loop]) if (a) expect(ANIMATIONS[a[0]], `${t.label}: ${a[0]}`).toBeDefined();
        // Layers stay inside the template's time.
        expect((l.delay ?? 0) + (l.seconds ?? 0)).toBeLessThanOrEqual(t.seconds);
      }
    }
  });

  it("finds templates by key or label", () => {
    expect(findTemplate("lowerThird")?.[1].label).toBe("Name and title");
    expect(findTemplate("neon PINK")?.[0]).toBe("neonPink");
    expect(findTemplate("nope")).toBeUndefined();
  });
});

describe("templateClips", () => {
  it("turns layers into staggered, animated text and box clips", () => {
    const clips = templateClips(TEXT_TEMPLATES.lowerThird, 30, fps);
    expect(clips.map((c) => c.type)).toEqual(["color", "color", "text", "text"]);
    const [box, , name] = clips as [ColorClip, ColorClip, TextClip];
    // A box is a color clip cropped evenly around its center.
    expect(box.crop.left).toBeCloseTo(0.35);
    expect(box.crop.top).toBeCloseTo((1 - 0.115) / 2);
    expect(box.opacity).toBe(0.88);
    expect(box.animIn).toEqual({ type: "slideRight", duration: 15 });
    // The name enters 0.2 s later and still ends with the template.
    expect(name.start).toBe(36);
    expect(name.start + name.duration).toBe(30 + 150);
    expect(name.text).toBe("Alex Rivera");
    expect(name.transform.x).toBe(-0.31);
  });

  it("plays sequential layers one after another", () => {
    const clips = templateClips(TEXT_TEMPLATES.countdown, 0, fps) as TextClip[];
    expect(clips.map((c) => [c.text, c.start, c.duration])).toEqual([
      ["3", 0, 30],
      ["2", 30, 30],
      ["1", 60, 30],
    ]);
  });
});

describe("addTemplate", () => {
  it("stacks layers bottom to top and keeps sequential ones on one row", () => {
    const { project: p, clipIds } = addTemplate(createProject(), TEXT_TEMPLATES.lowerThird, 0);
    const rows = clipIds.map((id) => p.tracks.indexOf(findClip(p, id)!.track));
    expect(rows).toEqual([...rows].sort((a, b) => b - a));
    expect(new Set(rows).size).toBe(4);
    const count = addTemplate(createProject(), TEXT_TEMPLATES.countdown, 0);
    expect(new Set(count.clipIds.map((id) => findClip(count.project, id)!.track.id)).size).toBe(1);
  });
});

describe("wordArtStyle", () => {
  it("replaces the look and keeps size and layout", () => {
    const boxed = createTextClip("Hi", 0, 30, { size: 64, align: "left", background: { color: "#000", padding: 4, radius: 2 }, shadow: { color: "#f00", blur: 3, x: 0, y: 0 } });
    const s = wordArtStyle(boxed.style, TEXT_TEMPLATES.yellow);
    expect(s.color).toBe("#ffe600");
    expect(s.stroke).toEqual({ color: "#000000", width: 8 });
    expect(s.size).toBe(64);
    expect(s.align).toBe("left");
    expect("background" in s).toBe(false);
    expect("shadow" in s).toBe(false);
    expect(s.font).toBe(DEFAULT_TEXT_STYLE.font);
  });
});

describe("template commands", () => {
  it("add_text_template places a template with its words replaced in order", () => {
    const p = runCommand(createProject(), "add_text_template", { name: "Name and title", start: 1, texts: ["Sam Park", "Editor"] });
    const texts = p.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === "text");
    expect(texts.map((c) => c.text).sort()).toEqual(["Editor", "Sam Park"]);
    expect(Math.min(...p.tracks.flatMap((t) => t.clips).map((c) => c.start))).toBe(30);
    expect(() => runCommand(createProject(), "add_text_template", { name: "nope", start: 0 })).toThrow(/no text template/);
  });

  it("apply_word_art restyles text and refuses anything else", () => {
    let p = runCommand(createProject(), "add_text", { text: "Hey", start: 0, duration: 2 });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "apply_word_art", { clip_ids: [id], name: "neonPink" });
    expect((p.tracks.flatMap((t) => t.clips)[0] as TextClip).style.shadow?.color).toBe("#ff1fd2");
    expect(() => runCommand(p, "apply_word_art", { clip_ids: [id], name: "lowerThird" })).toThrow(/no word art/);
  });
});
