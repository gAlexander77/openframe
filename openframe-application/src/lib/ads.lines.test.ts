import { afterAll, expect, it, vi } from "vitest";
import { addAdElement } from "./ads";
import { minTextSize } from "./brandKit";
import { rasterizeText } from "../engine/text";
import { seenTexts } from "./designCheck";
import { createProject } from "./project/defaults";

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

it("keeps the explicit end-card headline in two readable lines inside the portrait column", () => {
  const p = createProject({ width: 1080, height: 1920 });
  const headline = "Make every trip\nfeel cinematic";
  const q = addAdElement(p, "end_card", { start: 0, headline }).project;
  const c = seenTexts(q).find((s) => s.c.text === headline)!.c;
  const r = rasterizeText(c, q.width, q.height);
  expect(r.layout.lines).toEqual(headline.split("\n"));
  expect(c.style.size).toBeGreaterThanOrEqual(minTextSize(q.width, q.height));
  const unwrapped = rasterizeText({ ...c, style: { ...c.style, maxWidth: 10 } }, q.width, q.height);
  expect(unwrapped.width - 2 * unwrapped.layout.pad).toBeLessThanOrEqual(c.style.maxWidth * q.width + 1);
});
