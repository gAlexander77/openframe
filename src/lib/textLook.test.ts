import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject, DEFAULT_TEXT_STYLE } from "./project/defaults";
import type { TextClip } from "./project/types";
import { gradientLine, lookReach, stroke2Width } from "./textLook";

describe("text look geometry", () => {
  it("reaches past the glyphs by both outlines, the larger of shadow and glow, and the box", () => {
    const r = lookReach({ ...DEFAULT_TEXT_STYLE, stroke: { color: "#000", width: 4 }, stroke2: { color: "#fff", width: 6 }, shadow: { color: "#000", blur: 8, x: 0, y: 4 }, glow: { color: "#0ff", blur: 20 }, background: { color: "#000", padding: 10, radius: 4 } }, 2);
    expect(r).toMatchObject({ stroke: 8, stroke2: 12, shadow: 24, glow: 40, box: 20, total: 80 });
    expect(lookReach(DEFAULT_TEXT_STYLE, 1).total).toBe(0);
  });

  it("runs a gradient edge to edge at its angle", () => {
    expect(gradientLine(50, 20, 100, 40, 0)).toEqual([0, 20, 100, 20]);
    const [x0, y0, x1, y1] = gradientLine(50, 20, 100, 40, 90);
    expect([x0, y0, x1, y1].map((v) => +v.toFixed(6) || 0)).toEqual([50, 0, 50, 40]);
  });

  it("draws the second outline's pen around the first", () => {
    expect(stroke2Width(4, 6)).toBe(20);
  });
});

describe("text look in commands", () => {
  const add = (style: object) => {
    const p = runCommand(createProject(), "add_text", { text: "Sale", start: 0, duration: 2, style });
    return (p.tracks.flatMap((t) => t.clips)[0] as TextClip).style;
  };

  it("fills the parts an agent leaves out with defaults", () => {
    const s = add({ glow: { color: "#00e5ff" }, gradient: { from: "#fff", to: "#f0c" }, stroke2: { color: "#000" }, accent: "#ff0" });
    expect(s.glow).toEqual({ color: "#00e5ff", blur: 24 });
    expect(s.gradient).toEqual({ from: "#fff", to: "#f0c", angle: 0 });
    expect(s.stroke2).toEqual({ color: "#000", width: 6 });
    expect(s.accent).toBe("#ff0");
  });

  it("removes a part given an empty color", () => {
    let p = runCommand(createProject(), "add_text", { text: "Sale", start: 0, duration: 2, style: { glow: { color: "#0ff" }, gradient: { from: "#fff", to: "#000" }, accent: "#ff0" } });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    p = runCommand(p, "set_text", { clip_id: id, style: { glow: { color: "" }, gradient: { from: "", to: "" }, accent: "" } });
    const s = (p.tracks.flatMap((t) => t.clips)[0] as TextClip).style;
    expect(s.glow).toBeUndefined();
    expect(s.gradient).toBeUndefined();
    expect(s.accent).toBeUndefined();
  });
});
