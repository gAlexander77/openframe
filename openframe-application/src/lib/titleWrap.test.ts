// New titles wrap inside the canvas's safe area (titleWrap): a centered
// one within 90% of the width, on 9:16 within the column the apps' buttons
// leave, one off center within twice the room on its nearer side. Titles
// already made keep their width, so older projects draw the same.

import { describe, expect, it } from "vitest";
import { titleWrap } from "./ads";
import { runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Project, TextClip } from "./project/types";
import { setTextMeasure } from "./render/size";

// About 0.55 em a character, wrapping between words at the style's width.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080, em = size * 0.55;
  const lines = c.text.split("\n").flatMap((para) => {
    const out: string[] = [];
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length * em > c.style.maxWidth * w) {
        out.push(line);
        line = word;
      } else line = next;
    }
    return [...out, line];
  });
  return { width: Math.max(...lines.map((l) => l.length * em)), height: size * c.style.lineHeight * lines.length };
});

const titles = (p: Project) => p.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === "text");
const LONG = "Every edit in OpenFrame is a tool an agent can call";

describe("titles fit their canvas", () => {
  it("measures the room a title has where it stands", () => {
    expect(titleWrap({ width: 1920, height: 1080 })).toBe(0.9);
    expect(titleWrap({ width: 1080, height: 1080 })).toBe(0.9);
    expect(titleWrap({ width: 1080, height: 1350 })).toBe(0.9);
    // 9:16: even margins about the center (the right 19% is the buttons'),
    // the whole column on its own center.
    expect(titleWrap({ width: 1080, height: 1920 })).toBe(0.62);
    expect(titleWrap({ width: 1080, height: 1920 }, -0.04)).toBe(0.7);
    // Off center: twice the room on the nearer side, at least a quarter.
    expect(titleWrap({ width: 1920, height: 1080 }, 0.25)).toBe(0.4);
    expect(titleWrap({ width: 1920, height: 1080 }, -0.44)).toBe(0.25);
  });

  it("wraps a new title on 9:16 inside the apps' column, where check_project wants it", () => {
    let p = runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: LONG, start: 0, duration: 4, y: -0.1, style: { size: 70, bold: true } });
    expect(titles(p)[0].style.maxWidth).toBe(0.62);
    const layout = checkProject(p).findings.filter((f) => ["text_outside_title_safe", "text_under_app_buttons"].includes(f.rule));
    expect(layout).toEqual([]);
    // The same title with the old default ran into the buttons.
    p = runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: LONG, start: 0, duration: 4, y: -0.1, style: { size: 70, bold: true, maxWidth: 0.9 } });
    expect(checkProject(p).findings.some((f) => f.rule === "text_under_app_buttons")).toBe(true);
  });

  it("wraps a title off center on 16:9 inside the safe area, and leaves a centered one as before", () => {
    const p = runCommand(runCommand(createProject(), "add_text", { text: LONG, start: 0, duration: 4, x: 0.25, style: { size: 96 } }), "add_text", { text: "Centered", start: 0, duration: 4 });
    const [side, mid] = titles(p).sort((a, b) => b.transform.x - a.transform.x);
    expect(side.style.maxWidth).toBe(0.4);
    expect(mid.style.maxWidth).toBe(0.9);
    expect(checkProject(p).findings.filter((f) => f.rule === "text_outside_title_safe")).toEqual([]);
  });

  it("keeps a width that is asked for, and never changes a title already made", () => {
    const p = runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: LONG, start: 0, duration: 4, style: { maxWidth: 0.5 } });
    expect(titles(p)[0].style.maxWidth).toBe(0.5);
    // An older project's title (the old default) on a 9:16 canvas: any edit leaves its width.
    const old = titles(runCommand(createProject({ width: 1080, height: 1920 }), "add_text", { text: LONG, start: 0, duration: 4, style: { maxWidth: 0.9 } }))[0];
    const q: Project = { ...createProject({ width: 1080, height: 1920 }), tracks: [{ ...createProject().tracks[0], clips: [old] }] };
    expect(titles(runCommand(q, "set_text", { clip_id: old.id, text: "Shorter" }))[0].style.maxWidth).toBe(0.9);
  });
});
