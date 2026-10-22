import { minTextSize } from "./brandKit";
import { secondsToFrames } from "./time";
import { safeArea } from "./ads";
import { subjectBox, type Rect01 } from "./analysis/subject";
import { captionReading, wordsToCaptions, DEFAULT_LINES, type Word } from "./captions";
import { seenLetters, seenTexts, type Finding } from "./designCheck";
import { inSource, onCanvas } from "./follow";
import { updateClip } from "./project/ops";
import type { Project, TextClip, VideoClip } from "./project/types";
import { relOf, restLayer, type ShotLook } from "./reframe";
import { streamBands } from "./streamLayout";
import type { ClipPlan, ClipTemplate } from "./clipProjects";

/** Keep small chunks when readable. Borrow silence first, then join words
 * rather than flashing them or discarding the last words of a moment. */
export function clipCaptions(words: Word[], seconds: number, maxWords = 2, fps = 30) {
  const caps = wordsToCaptions(words, { ...DEFAULT_LINES, maxWords, minDuration: 5 / 6 });
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i], next = caps[i + 1];
    const need = Math.max(5 / 6, c.text.replace(/\s+/g, " ").trim().length / 19) + 1 / fps;
    c.end = Math.min(seconds, next?.start ?? seconds, Math.max(c.end, c.start + need));
    if (captionReading(c).met) continue;
    if (next) {
      caps.splice(i, 2, { start: c.start, end: next.end, text: `${c.text} ${next.text}`, words: [...(c.words ?? []), ...(next.words ?? [])] });
      i--;
    } else if (i > 0) {
      const prev = caps[i - 1];
      caps.splice(i - 1, 2, { start: prev.start, end: c.end, text: `${prev.text} ${c.text}`, words: [...(prev.words ?? []), ...(c.words ?? [])] });
      i -= 2;
    }
  }
  return caps.filter(c => c.end > c.start);
}

/** The subject in the portion of the source this clip actually shows,
 * carried to canvas pixels through its crop, scale and position. */
export function clipSubjects(p: Project, c: VideoClip, look?: ShotLook): Rect01[] {
  if (!look) return [];
  return look.maps.flatMap((map, i) => {
    const rel = relOf(c, look.times[i], p.fps);
    if (rel === null) return [];
    const layer = restLayer(c, rel);
    const a = inSource(p, c, layer, 0, 0), b = inSource(p, c, layer, p.width, p.height);
    const crop = c.crop;
    const within = { left: Math.max(0, crop.left, Math.min(a.u, b.u)), right: Math.min(1, 1 - crop.right, Math.max(a.u, b.u)), top: Math.max(0, crop.top, Math.min(a.v, b.v)), bottom: Math.min(1, 1 - crop.bottom, Math.max(a.v, b.v)) };
    const subject = subjectBox(map, within);
    if (!subject) return [];
    const pts = [[subject.left, subject.top], [subject.right, subject.top], [subject.left, subject.bottom], [subject.right, subject.bottom]].map(([u, v]) => onCanvas(p, c, layer, u, v));
    return [{ left: Math.min(...pts.map(q => q.x)), right: Math.max(...pts.map(q => q.x)), top: Math.min(...pts.map(q => q.y)), bottom: Math.max(...pts.map(q => q.y)) }];
  });
}

const intersects = (a: Rect01, b: Rect01, gap = 0) => a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

/** A solid box gives the measured contrast a floor independent of footage,
 * brands and caption looks. Keep word highlighting if it reads on black. */
export function boxedText(c: TextClip): TextClip {
  return { ...c, style: { ...c.style, color: "#ffffff", gradient: undefined, runs: undefined, stroke: undefined, stroke2: undefined, shadow: undefined, glow: undefined, background: { color: "#000000", padding: 10, radius: 6 } } };
}

/** Place the actual letters and box, as check_project measures them. A
 * stream hook's room starts below the facecam, including large splits. */
export function placeClipText(p: Project, id: string, kind: "hook" | "credit" | "caption", template: ClipTemplate, subjects: Rect01[] = [], pending?: ReadonlySet<string>): { project: Project; findings: Finding[] } {
  const s = safeArea(p), W = p.width, H = p.height, gap = H * 0.012;
  const room = { left: s.left * W + gap, right: (1 - s.right) * W - gap, top: s.top * H + gap, bottom: (1 - s.bottom) * H - gap };
  if (kind === "hook" && template.layout !== "full" && template.layout !== "vertical_fill" && template.facecam) room.top = Math.max(room.top, streamBands(W, H, template).gameplay.y + gap);
  let seen = seenTexts(p).find(t => t.c.id === id);
  let g = seen && seenLetters(p, seen);
  // A long handle or hook can still wrap into too many lines. Fit only
  // down to the readable floor, then report any space we cannot make.
  const floor = minTextSize(W, H, true);
  while (seen && g && (g.box.right - g.box.left > room.right - room.left || g.box.bottom - g.box.top > room.bottom - room.top) && seen.c.style.size > floor) {
    p = updateClip(p, id, c => c.type === "text" ? { ...c, style: { ...c.style, size: Math.max(floor, c.style.size * 0.9) } } : c);
    seen = seenTexts(p).find(t => t.c.id === id);
    g = seen && seenLetters(p, seen);
  }
  if (!seen || !g) return { project: p, findings: [] };
  const hw = (g.box.right - g.box.left) / 2, hh = (g.box.bottom - g.box.top) / 2;
  const cx = (g.box.right + g.box.left) / 2, cy = (g.box.bottom + g.box.top) / 2;
  const x = (room.left + room.right) / 2;
  const y = kind === "credit" ? room.top + hh : kind === "caption" ? room.bottom - hh : Math.max(room.top + hh, H / 3);
  // Later parts will move to clear this one. Their initial positions must
  // not push the credit into the hook's band or falsely block the hook.
  const occupied = seenTexts(p).filter(t => t.c.id !== id && !pending?.has(t.c.id) && t.start < seen.start + seen.duration && seen.start < t.start + t.duration).flatMap(t => seenLetters(p, t)?.box ?? []);
  const avoid = [...subjects, ...occupied];
  const candidates = [{ x, y }, { x, y: room.top + hh }, { x, y: room.bottom - hh }, ...avoid.flatMap(b => [{ x, y: b.bottom + gap + hh }, { x, y: b.top - gap - hh }, { x: b.left - gap - hw, y }, { x: b.right + gap + hw, y }])];
  const boxAt = (q: { x: number; y: number }) => ({ left: q.x - hw, right: q.x + hw, top: q.y - hh, bottom: q.y + hh });
  const fits = (q: { x: number; y: number }) => { const b = boxAt(q); return b.left >= room.left - 0.5 && b.right <= room.right + 0.5 && b.top >= room.top - 0.5 && b.bottom <= room.bottom + 0.5; };
  const chosen = candidates.find(q => fits(q) && avoid.every(b => !intersects(boxAt(q), b, gap)));
  // If the band has no clear room, omit the hook rather than cover a face.
  if (!chosen && kind === "hook") return { project: updateClip(p, id, c => ({ ...c, disabled: true })), findings: [{ rule: "hook_no_clear_room", level: "warning", clip_id: id, at: 0, message: "The hook was omitted: no subject-free room inside the safe area.", fix: "Shorten the hook or change the stream split, then add_text in the clear area." }] };
  const q = chosen ?? candidates.find(fits) ?? { x, y };
  return { project: updateClip(p, id, c => c.type === "text" ? { ...c, transform: { ...c.transform, x: c.transform.x + (q.x - cx) / W, y: c.transform.y + (q.y - cy) / H } } : c), findings: [] };
}

/** Repair the generated titles before measuring: readable sizes and holds,
 * opaque contrast protection, and an end card long enough for its parts. */
export function prepareClipText(p: Project, plan: ClipPlan): Project {
  // Layout and readability are judged on the same boxes as check_project.
  const endTexts = seenTexts(p).filter(s => s.start >= plan.frames);
  const cardEnd = Math.max(plan.frames + plan.endCard, ...endTexts.map(s => s.start + secondsToFrames(Math.max(1.5, 0.4 * s.c.text.trim().split(/\s+/).length), p.fps)));
  const floor = minTextSize(p.width, p.height, true), safe = safeArea(p);
  const wrap = 1 - safe.left - safe.right - 0.1;
  p = { ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.map(c => {
    if (c.start >= plan.frames) return { ...c, duration: cardEnd - c.start };
    if (c.type !== "text") return c;
    const need = Math.max(1.5, 0.4 * c.text.trim().split(/\s+/).length);
    return { ...boxedText(c), style: { ...boxedText(c).style, size: Math.max(floor, Math.min(c.style.size, c.caption ? 72 : 54)), maxWidth: Math.min(c.style.maxWidth, wrap) }, ...(c.caption ? {} : { duration: Math.min(plan.frames - c.start, Math.max(c.duration, secondsToFrames(need, p.fps))) }) };
  }) })) };
  // End-card parts already use add_ad_element's safe-area fitter. Box them
  // without changing their padding or geometry, including custom brands.
  p = { ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.type === "text" && c.start >= plan.frames ? { ...boxedText(c), style: { ...boxedText(c).style, background: { color: "#000000", padding: c.style.background?.padding ?? 0, radius: c.style.background?.radius ?? 0 } } } : c) })) };
  return p;
}
