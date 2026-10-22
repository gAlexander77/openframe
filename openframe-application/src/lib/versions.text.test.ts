import { afterAll, expect, it, vi } from "vitest";
import { rasterizeText } from "../engine/text";
import { titleZone } from "./align";
import { runCommand } from "./commands";
import { checkProject, seenLetters, seenTexts } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";
import { textLines } from "./render/size";
import { boxOf, versionProject } from "./versions";

// Only the native canvas is replaced. The real rasterizer registers the
// measurement used by versions AND check_project: word wrapping, weight,
// tracking, line pitch, rounded raster sizes and shadow/background padding.
// Font advances are deterministic here; the lead checks real fonts in Edge.
vi.stubGlobal("OffscreenCanvas", class {
  constructor(public width: number, public height: number) {}
  getContext() {
    return {
      font: "", letterSpacing: "0px", textBaseline: "alphabetic",
      measureText(text: string) {
        const size = Number(/([\d.]+)px/.exec(this.font)![1]);
        const em = this.font.startsWith("800 ") ? 0.64 : 0.5;
        return { width: text.length * (size * em + parseFloat(this.letterSpacing)), fontBoundingBoxAscent: size * 0.8, fontBoundingBoxDescent: size * 0.2 };
      },
      save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {},
    };
  }
});
afterAll(() => vi.unstubAllGlobals());

it("retains the measured 1080p gap after a tracked headline wraps above a boxed subhead", () => {
  let p = runCommand(createProject(), "add_text", { text: "VOICES FROM ORBIT", start: 0.4, duration: 3.2, y: -0.04, style: { size: 100, letterSpacing: 14, weight: 800 } });
  p = runCommand(p, "add_text", { text: "Training for the Moon, underground", role: "subhead", start: 0.4, duration: 3.2, y: 0.08, style: { background: { color: "#111111", padding: 8, radius: 4 } } });
  const measured = (project: Project) => seenTexts(project).sort((a, b) => a.c.transform.y - b.c.transform.y).map((s) => ({ c: s.c, box: seenLetters(project, s)!.box }));
  const [head, sub] = measured(p);
  const gap = sub.box.top - head.box.bottom;
  expect(gap).toBeGreaterThan(0);
  // The shadow's empty margin made the OLD neighbor test reject this pair.
  expect(boxOf(p, sub.c).top - boxOf(p, head.c).bottom).toBeLessThan(-0.5);
  expect(textLines(p, head.c)).toEqual(["VOICES FROM ORBIT"]);
  const q = versionProject(p, { ratio: "9:16" });
  const [a, b] = measured(q), z = titleZone(q);
  const raster = rasterizeText(a.c, q.width, q.height);
  expect(textLines(q, a.c)!.length).toBeGreaterThan(1);
  expect(raster.height).toBe(Math.ceil(raster.layout.lineHeight * textLines(q, a.c)!.length + raster.layout.pad * 2));
  expect(a.c.style.weight).toBe(800);
  expect(a.c.style.letterSpacing).toBeGreaterThan(0);
  expect(b.c.style.background!.padding).toBeGreaterThan(0);
  expect(b.box.top - a.box.bottom).toBeCloseTo(gap, 2);
  for (const { box } of [a, b]) {
    expect(box.left).toBeGreaterThanOrEqual(z.left * q.width - 1);
    expect(box.right).toBeLessThanOrEqual((1 - z.right) * q.width + 1);
    expect(box.top).toBeGreaterThanOrEqual(z.top * q.height - 1);
    expect(box.bottom).toBeLessThanOrEqual((1 - z.bottom) * q.height + 1);
  }
  expect(checkProject(q).findings.filter((f) => f.rule === "text_overlaps_text")).toEqual([]);
});
