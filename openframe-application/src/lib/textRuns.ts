import type { TextRun, TextStyle } from "./project/types";
import { cleanWeight } from "./textLook";

/** Canonical nonoverlapping ranges; later ranges override only fields they set. */
export function cleanRuns(raw: unknown, length: number): TextRun[] {
  if (!Array.isArray(raw)) return [];
  const runs: TextRun[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object" || !Number.isFinite(v.start) || !Number.isFinite(v.end)) continue;
    const r: TextRun = { start: Math.max(0, Math.floor(v.start)), end: Math.min(length, Math.floor(v.end)) };
    if (r.end <= r.start) continue;
    if (typeof v.color === "string" && v.color.trim()) r.color = v.color;
    if (v.gradient && typeof v.gradient.from === "string" && typeof v.gradient.to === "string" && Number.isFinite(v.gradient.angle)) r.gradient = { from: v.gradient.from, to: v.gradient.to, angle: v.gradient.angle };
    const weight = cleanWeight(v.weight);
    if (weight !== undefined) r.weight = weight;
    for (const k of ["italic", "underline"] as const) if (typeof v[k] === "boolean") r[k] = v[k];
    if (typeof v.scale === "number" && Number.isFinite(v.scale)) r.scale = Math.min(4, Math.max(0.25, v.scale));
    if (Object.keys(r).length > 2) runs.push(r);
  }
  const points = [...new Set(runs.flatMap(r => [r.start, r.end]))].sort((a, b) => a - b);
  const out: TextRun[] = [];
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i];
    const active = runs.filter(r => r.start <= start && r.end >= end);
    if (!active.length) continue;
    const r = active.reduce<TextRun>((a, b) => {
      const next = { ...a, ...b, start, end };
      if (b.color !== undefined && !b.gradient) delete next.gradient;
      if (b.gradient) delete next.color;
      return next;
    }, { start, end });
    const last = out.at(-1);
    if (last && last.end === start && JSON.stringify({ ...last, start: 0, end: 0 }) === JSON.stringify({ ...r, start: 0, end: 0 })) last.end = end;
    else out.push(r);
  }
  return out;
}

/** Map surviving UTF-16 characters with a linear-space LCS. Offsets match
 * the textarea and stored runs. Insertions inside surviving runs inherit. */
export function shiftRuns(runs: TextRun[] | undefined, before: string, after: string): TextRun[] {
  if (!runs?.length) return [];
  if (before.length === after.length) return cleanRuns(runs, after.length);
  const positions = new Map<number, number>();
  const lengths = (a: string, b: string) => {
    let row = new Uint32Array(b.length + 1);
    for (let i = 0; i < a.length; i++) {
      const next = new Uint32Array(b.length + 1);
      for (let j = 0; j < b.length; j++) next[j + 1] = a[i] === b[j] ? row[j] + 1 : Math.max(row[j + 1], next[j]);
      row = next;
    }
    return row;
  };
  const match = (a: string, b: string, ai: number, bi: number): void => {
    if (!a.length || !b.length) return;
    if (a.length === 1) {
      const j = b.indexOf(a);
      if (j >= 0) positions.set(ai, bi + j);
      return;
    }
    const mid = Math.floor(a.length / 2);
    const left = lengths(a.slice(0, mid), b);
    const right = lengths(a.slice(mid).split("").reverse().join(""), b.split("").reverse().join(""));
    let cut = 0;
    for (let j = 1; j <= b.length; j++) if (left[j] + right[b.length - j] > left[cut] + right[b.length - cut]) cut = j;
    match(a.slice(0, mid), b.slice(0, cut), ai, bi);
    match(a.slice(mid), b.slice(cut), ai + mid, bi + cut);
  };
  match(before, after, 0, 0);
  return cleanRuns(runs.flatMap(r => {
    const kept = [...positions].filter(([i]) => i >= r.start && i < r.end).map(([, j]) => j);
    return kept.length ? [{ ...r, start: Math.min(...kept), end: Math.max(...kept) + 1 }] : [];
  }), after.length);
}

export function runStyle(base: TextStyle, offset: number): TextStyle {
  const r = base.runs?.find(r => r.start <= offset && offset < r.end);
  if (!r) return base;
  return { ...base, ...r, size: base.size * (r.scale ?? 1), ...(r.color && !r.gradient ? { gradient: undefined } : {}) };
}

export function runSegments(text: string, start: number, style: TextStyle) {
  const ends = [...new Set([start, start + text.length, ...(style.runs ?? []).flatMap(r => [r.start, r.end]).filter(n => n > start && n < start + text.length)])].sort((a,b) => a-b);
  return ends.slice(1).filter((end, i) => end > ends[i]).map((end, i) => ({ text: text.slice(ends[i] - start, end - start), start: ends[i], style: runStyle(style, ends[i]) }));
}

export function measureRuns(text: string, start: number, style: TextStyle, measure: (text: string, style: TextStyle) => number): number {
  return runSegments(text, start, style).reduce((width, r) => width + measure(r.text, r.style), 0);
}

/** A piece of a title as the rasterizer draws it: where its text starts,
 * its left edge and width, and its line's middle (raster pixels). */
export interface RunPiece { start?: number; text?: string; x: number; width: number; y: number }

/** The box each run's letters cover in the raster, across every line it
 * wraps onto (ADR-099): a run's own gradient runs from its first letter to
 * its last, as a word styled in a layout tool does, not across the whole
 * title. A piece's width is its advance, which counts `letterSpacing`
 * after its last letter too: the box ends on the letter (ADR-108). Keyed
 * by the run. */
export function runBoxes(runs: TextRun[], pieces: RunPiece[], lineHeight: number, letterSpacing = 0): Map<TextRun, { left: number; top: number; right: number; bottom: number }> {
  const boxes = new Map<TextRun, { left: number; top: number; right: number; bottom: number }>();
  for (const p of pieces) {
    const at = p.start ?? 0;
    const run = runs.find((r) => r.start <= at && at < r.end);
    if (!run) continue;
    const b = boxes.get(run);
    const top = p.y - lineHeight / 2, bottom = p.y + lineHeight / 2;
    const right = p.x + p.width - (p.text === "" ? 0 : letterSpacing);
    boxes.set(run, b ? { left: Math.min(b.left, p.x), top: Math.min(b.top, top), right: Math.max(b.right, right), bottom: Math.max(b.bottom, bottom) } : { left: p.x, top, right, bottom });
  }
  return boxes;
}

/** How far to move each piece down so a line's pieces share one baseline
 * (ADR-099). `above` is how far below the line's middle a piece's own font
 * puts its baseline when drawn centered there (it grows with the size):
 * the line takes its tallest piece's baseline, so a scaled word sits on
 * the line with its neighbors instead of hanging below them, and the line's
 * content stays inside its height. Pieces are grouped into lines by `y`. */
export function baselineShifts(pieces: { y: number; above: number }[]): number[] {
  const deepest = new Map<number, number>();
  for (const p of pieces) deepest.set(p.y, Math.max(deepest.get(p.y) ?? -Infinity, p.above));
  return pieces.map((p) => deepest.get(p.y)! - p.above);
}

export function styleRange(text: string, runs: TextRun[] | undefined, start: number, end: number, style: Partial<TextRun>, clear = false): TextRun[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || start >= end) throw new Error("Text range must be within the text, with start before end");
  if (!clear) return cleanRuns([...(runs ?? []), { ...style, start, end }], text.length);
  return cleanRuns((runs ?? []).flatMap(r => r.end <= start || r.start >= end ? [r] : [{ ...r, end: start }, { ...r, start: end }]), text.length);
}
