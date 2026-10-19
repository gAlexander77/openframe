import { describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { createProject, DEFAULT_TEXT_STYLE } from "./project/defaults";
import type { TextClip } from "./project/types";
import { cleanWeight, distinctWeights, fontWeight, gradientLine, lookReach, stroke2Width } from "./textLook";

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

describe("font weight", () => {
  it("is the style's weight, else 700 bold and 400 regular", () => {
    expect(fontWeight({ bold: true })).toBe(700);
    expect(fontWeight({ bold: false })).toBe(400);
    expect(fontWeight({ bold: true, weight: 300 })).toBe(300);
    expect(cleanWeight(850.4)).toBe(850);
    expect(cleanWeight(20)).toBe(100);
    expect(cleanWeight(1200)).toBe(900);
    expect(cleanWeight("bold")).toBeUndefined();
  });

  it("names one weight per face a font draws", () => {
    // Regular and bold only (Arial): 100..500 draw regular, 600..900 bold.
    expect(distinctWeights(["r", "r", "r", "r", "r", "b", "b", "b", "b"])).toEqual([400, 700]);
    // Segoe UI: light, semilight-as-regular run, semibold, bold, black.
    expect(distinctWeights(["l", "l", "l", "r", "r", "sb", "b", "k", "k"])).toEqual([300, 400, 600, 700, 900]);
    // Every weight its own face (a variable font).
    expect(distinctWeights(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900]);
    // One face for all.
    expect(distinctWeights(Array(9).fill("x"))).toEqual([400]);
  });

  it("set_text: a weight sets bold to match; bold alone clears the weight", () => {
    let p = runCommand(createProject(), "add_text", { text: "Thin", start: 0, duration: 2, style: { weight: 300 } });
    const id = p.tracks.flatMap((t) => t.clips)[0].id;
    const style = () => (p.tracks.flatMap((t) => t.clips)[0] as TextClip).style;
    expect([style().weight, style().bold]).toEqual([300, false]);
    p = runCommand(p, "set_text", { clip_id: id, style: { weight: 800 } });
    expect([style().weight, style().bold]).toEqual([800, true]);
    p = runCommand(p, "set_text", { clip_id: id, style: { bold: false } });
    expect([style().weight, style().bold]).toEqual([undefined, false]);
    expect(() => runCommand(p, "set_text", { clip_id: id, style: { weight: 950 } })).toThrow(/weight/);
  });
});
