// export_versions on the Northbound test's layouts (ADR-103): an end card
// built as a compound (a wide, tracked wordmark, an italic tagline, a pill,
// a url, a soft glow behind them), a full-width gradient scrim, and a
// centered headline. On 9:16 the card's offsets were scaled to a third
// while its type was raised to the floor, so the pill sat on the tagline;
// the scrim kept its pixels and showed hard edges; the headline was wrapped
// to the zone's edge exactly, so the outline the check suggested pushed it
// under the apps' buttons.

import { describe, expect, it } from "vitest";
import { VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { runCommand } from "./commands";
import { checkProject } from "./designCheck";
import { createProject } from "./project/defaults";
import type { Clip, ColorClip, CompoundClip, Project, TextClip, VisualClip } from "./project/types";
import { setTextMeasure } from "./render/size";
import { lookReach } from "./textLook";
import { boxOf, versionProject } from "./versions";

// The engine's measure: about 0.55 em a character plus the tracking,
// wrapping between words, with its margin for the box, outline and shadow.
setTextMeasure((c, w, h) => {
  const size = (c.style.size * h) / 1080, em = size * 0.55 + (c.style.letterSpacing * h) / 1080;
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
  // Room around the letters for the box, outline and shadow, as the engine leaves it.
  const pad = Math.ceil(lookReach(c.style, h / 1080).total + 2);
  return { width: Math.max(...lines.map((l) => l.length * em)) + 2 * pad, height: size * c.style.lineHeight * lines.length + 2 * pad, layout: { pad } };
});

const inside = (p: Project) => [...p.tracks.flatMap((t) => t.clips), ...(p.compounds ?? []).flatMap((k) => k.tracks.flatMap((t) => t.clips))];
const added = (before: Project, after: Project) => inside(after).filter((c) => !inside(before).some((o) => o.id === c.id));
const byId = <T extends Clip = VisualClip>(p: Project, id: string) => inside(p).find((c) => c.id === id) as T;

function northbound(): { p: Project; ids: Record<string, string> } {
  let p: Project = { ...createProject({ name: "Northbound" }), assets: [{ id: "sea", kind: "video" as const, name: "sea.mp4", src: "sea.mp4", duration: 12, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: false }] };
  const ids: Record<string, string> = {};
  const step = (cmd: string, args: Record<string, unknown>, name?: string) => {
    const q = runCommand(p, cmd, args);
    if (name) ids[name] = added(p, q)[0].id;
    p = q;
  };
  step("add_media_clip", { asset_id: "sea", start: 0, duration: 4 });
  step("add_color_clip", { color: "#0B1620", start: 4, duration: 6, track_id: p.tracks[0].id });
  step("add_shape", { kind: "rectangle", start: 0, duration: 2, y: -0.3, width: 1.02, height: 0.6, gradient: { from: "#000000b0", to: "transparent", angle: 90 } }, "scrim");
  step("add_text", { text: "GO FURTHER", start: 0, duration: 2, y: -0.3, style: { size: 190, bold: true, letterSpacing: 10, shadow: { color: "rgba(0,0,0,0.7)", blur: 36, y: 6 } } }, "further");
  step("add_text", { text: "NORTHBOUND", start: 2, duration: 2, x: 0.009, y: 0.36, style: { size: 150, bold: true, letterSpacing: 34, shadow: { color: "rgba(0,0,0,0.7)", blur: 36, y: 6 } } }, "wordmark");
  step("add_shape", { kind: "ellipse", start: 4, duration: 6, y: -0.13, width: 0.6, height: 0.75, gradient: { kind: "radial", from: "#F5B84150", to: "transparent" }, feather: 220 }, "glow");
  step("add_text", { text: "NORTHBOUND", start: 4, duration: 6, y: -0.14, style: { size: 140, bold: true, letterSpacing: 34 } }, "head");
  step("add_text", { text: "Find your north.", start: 4, duration: 6, y: 0, style: { font: "Georgia", italic: true, size: 64 } }, "tag");
  step("add_text", { text: "Plan your trip", start: 4, duration: 6, y: 0.14, style: { size: 50, bold: true, background: { color: "#F5B841", padding: 26, radius: 40 } } }, "pill");
  step("add_text", { text: "northbound.example", start: 4, duration: 6, y: 0.27, style: { size: 49, letterSpacing: 4 } }, "url");
  step("create_compound_clip", { clip_ids: [ids.glow, ids.head, ids.tag, ids.pill, ids.url], name: "Northbound title card" }, "card");
  return { p, ids };
}

/** A clip's box on the frame, where its compound clip draws it. */
function drawnIn(q: Project, card: CompoundClip, id: string) {
  const k = q.compounds!.find((x) => x.id === card.compoundId)!;
  const inner = boxOf({ ...q, tracks: k.tracks }, byId(q, id), 0);
  const s = card.transform.scale, cx = q.width / 2 + card.transform.x * q.width, cy = q.height / 2 + card.transform.y * q.height;
  return { left: cx + (inner.left - q.width / 2) * s, right: cx + (inner.right - q.width / 2) * s, top: cy + (inner.top - q.height / 2) * s, bottom: cy + (inner.bottom - q.height / 2) * s };
}

/** The area check_project judges titles in, pixels. */
function zone(q: Project) {
  const s = q.height > q.width ? VERTICAL_SAFE : { left: 0.05, top: 0.05, right: 0.05, bottom: 0.05 };
  return { left: s.left * q.width, right: q.width * (1 - s.right), top: s.top * q.height, bottom: q.height * (1 - s.bottom) };
}
const within = (b: { left: number; right: number; top: number; bottom: number }, r: typeof b) => b.left >= r.left - 1 && b.right <= r.right + 1 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
const layoutRules = ["text_outside_title_safe", "text_under_app_buttons", "text_too_small"];

describe("the Northbound layouts in versions", () => {
  for (const ratio of ["9:16", "1:1", "4:5"] as const) {
    it(`refits the compound card as one picture on ${ratio}: readable, in order, nothing overlapping, inside the zone`, () => {
      const { p, ids } = northbound();
      const q = versionProject(p, { ratio });
      const card = byId<CompoundClip>(q, ids.card);
      const k = q.compounds!.find((x) => x.id === card.compoundId)!;
      const order = [ids.head, ids.tag, ids.pill, ids.url];
      const boxes = order.map((id) => drawnIn(q, card, id));
      // Top to bottom as designed, none on another.
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].top, `${ratio} part ${i}`).toBeGreaterThanOrEqual(boxes[i - 1].bottom - 0.5);
      // Every part drawn at the frame's readable size or more.
      for (const id of order) {
        const t = k.tracks.flatMap((x) => x.clips).find((c) => c.id === id) as TextClip;
        expect(t.style.size * card.transform.scale, `${ratio} ${t.text}`).toBeGreaterThanOrEqual(minTextSize(q.width, q.height) - 0.01);
      }
      // Inside the area check_project judges, which finds nothing in its layout.
      for (const b of boxes) expect(within(b, zone(q)), ratio).toBe(true);
      expect(checkProject(q).findings.filter((f) => layoutRules.includes(f.rule)).map((f) => f.message), ratio).toEqual([]);
      // Where the titles sat up and down the safe area, as in the master
      // (the glow's tall box does not push them to the top).
      const placeOf = (pr: Project, bs: typeof boxes) => {
        const z = zone(pr), top = Math.min(...bs.map((b) => b.top)), bottom = Math.max(...bs.map((b) => b.bottom));
        return (top - z.top) / (z.bottom - z.top - (bottom - top));
      };
      const master = byId<CompoundClip>(p, ids.card);
      expect(placeOf(q, boxes), ratio).toBeCloseTo(placeOf(p, order.map((id) => drawnIn(p, master, id))), 1);
      // The glow stays behind the wordmark.
      const glow = drawnIn(q, card, ids.glow), head = boxes[0];
      expect((glow.left + glow.right) / 2, ratio).toBeCloseTo((head.left + head.right) / 2, 0);
      expect(glow.top, ratio).toBeLessThan(head.top);
    });

    it(`stretches the full-width scrim to the ${ratio} frame, as footage`, () => {
      const { p, ids } = northbound();
      const scrim = byId<ColorClip>(versionProject(p, { ratio }), ids.scrim);
      // Its share of the frame: the whole width, the top half.
      expect(scrim.shape).toMatchObject({ width: 1.02, height: 0.6 });
      expect([scrim.transform.x, scrim.transform.y, scrim.transform.scale], ratio).toEqual([0, -0.3, 1]);
    });

    it(`leaves the ${ratio} titles room for the outline check_project suggests`, () => {
      const { p, ids } = northbound();
      const q = versionProject(p, { ratio });
      expect(checkProject(q).findings.filter((f) => layoutRules.includes(f.rule)).map((f) => f.message), ratio).toEqual([]);
      // The wordmark, one word as wide as the column, and the headline.
      for (const id of [ids.wordmark, ids.further]) {
        const t = byId<TextClip>(q, id);
        const outlined = runCommand(q, "set_text", { clip_id: id, style: { stroke: { color: "#000000", width: Math.max(2, Math.round(t.style.size * 0.05)) } } });
        expect(checkProject(outlined).findings.filter((f) => f.clip_id === id && layoutRules.includes(f.rule)).map((f) => f.message), `${ratio} ${t.text}`).toEqual([]);
      }
    });
  }
});
