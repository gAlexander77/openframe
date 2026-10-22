import type { Marker } from "./project/types";
import { framesToSeconds, type Rational } from "./time";

export interface Chapter { seconds: number; title: string }
/** Exported chapters use starts, even for range markers; a range follows
 * its start too. A partial export carries its preceding chapter to zero. */
export function chaptersInRange(markers: Marker[], fps: Rational, range: { from: number; to: number }): Chapter[] {
  const sorted = markers.filter((m) => m.chapter === true && m.frame < range.to).sort((a, b) => a.frame - b.frame);
  const prior = sorted.filter((m) => m.frame < range.from).at(-1);
  const selected = [...(prior ? [prior] : []), ...sorted.filter((m) => m.frame >= range.from)];
  return selected.filter((m, i) => i === 0 || m.frame !== selected[i - 1].frame).map((m) => ({ seconds: framesToSeconds(Math.max(0, m.frame - range.from), fps), title: m.label || "Chapter" }));
}

function box(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(body.length + 8);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4); out.set(body, 8);
  return out;
}
const join = (a: Uint8Array, b: Uint8Array) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };
/** Nero chpl v1: full-box flags, reserved word, byte count, then 100 ns
 * timestamps and length-prefixed UTF-8 titles. No media offsets change. */
export function chapterBox(chapters: Chapter[]): Uint8Array<ArrayBuffer> {
  if (chapters.length > 255) throw new Error("MP4 chapters support at most 255 chapter markers.");
  const rows = chapters.map((c, i) => {
    if (!Number.isFinite(c.seconds) || c.seconds < 0 || (i > 0 && c.seconds <= chapters[i - 1].seconds)) throw new Error("Chapter starts must be finite, nonnegative and increasing.");
    let title = "";
    for (const char of c.title) { if (new TextEncoder().encode(title + char).length > 255) break; title += char; }
    const text = new TextEncoder().encode(title), row = new Uint8Array(9 + text.length);
    new DataView(row.buffer).setBigUint64(0, BigInt(Math.round(c.seconds * 1e7)));
    row[8] = text.length; row.set(text, 9); return row;
  });
  let body = new Uint8Array(9); body[0] = 1; body[8] = rows.length;
  for (const row of rows) body = join(body, row);
  return box("chpl", body);
}

/** Extend an EOF moov, adding to an existing udta when present. The engine
 * uses fastStart false only for chapter exports, so no chunk offsets move. */
export function appendChapters(moov: Uint8Array, chapters: Chapter[]): Uint8Array<ArrayBuffer> {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const type = (at: number) => String.fromCharCode(...moov.subarray(at + 4, at + 8));
  if (moov.length < 8 || view.getUint32(0) !== moov.length || type(0) !== "moov") throw new Error("Expected a complete 32-bit movie header.");
  const chpl = chapterBox(chapters);
  for (let at = 8; at < moov.length;) {
    if (at + 8 > moov.length) throw new Error("Truncated movie header.");
    const size = view.getUint32(at);
    if (size < 8 || at + size > moov.length) throw new Error("Invalid movie header box.");
    if (type(at) === "udta") return box("moov", join(join(moov.subarray(8, at), box("udta", join(moov.subarray(at + 8, at + size), chpl))), moov.subarray(at + size)));
    at += size;
  }
  return box("moov", join(moov.subarray(8), box("udta", chpl)));
}
