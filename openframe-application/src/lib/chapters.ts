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

/** The Nero chapter table in a complete MP4 moov or chpl box.
 * Counts, lengths, timestamps and UTF-8 are checked before exposure. */
export function readChapterBox(data: Uint8Array): Chapter[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const walk = (from: number, end: number): Chapter[] => {
    for (let at = from; at + 8 <= end;) {
      const size = view.getUint32(at), type = String.fromCharCode(...data.subarray(at + 4, at + 8));
      if (size < 8 || at + size > end) throw new Error("Invalid chapter metadata box.");
      if (type === "chpl") {
        if (size < 17 || data[at + 8] !== 1) throw new Error("Unsupported chapter table.");
        const chapters: Chapter[] = []; let pos = at + 17;
        for (let i = 0; i < data[at + 16]; i++) {
          if (pos + 9 > at + size) throw new Error("Truncated chapter table.");
          const seconds = Number(view.getBigUint64(pos)) / 1e7, n = data[pos + 8]; pos += 9;
          if (pos + n > at + size || (chapters.length && seconds <= chapters.at(-1)!.seconds)) throw new Error("Invalid chapter table.");
          const title = new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(pos, pos + n)); pos += n;
          chapters.push({ seconds, title });
        }
        return chapters;
      }
      if (type === "moov" || type === "udta") { const found = walk(at + 8, at + size); if (found.length) return found; }
      at += size;
    }
    return [];
  };
  return walk(0, data.length);
}

/** Inspect top-level headers by range, skipping mdat. No whole movie read.
 * ponytail: Nero chpl only (OpenFrame's writer); QuickTime chapter tracks
 * and other containers need separate demux adapters. */
export async function readFileChapters(read: (at: number, bytes: number) => Promise<Uint8Array>): Promise<Chapter[]> {
  let at = 0;
  for (let boxes = 0; boxes < 10000; boxes++) {
    const header = await read(at, 16);
    if (header.length < 8) return [];
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const type = String.fromCharCode(...header.subarray(4, 8));
    if (at === 0 && !["ftyp", "moov", "mdat", "free", "wide"].includes(type)) return [];
    const small = view.getUint32(0), size = small === 1 && header.length >= 16 ? Number(view.getBigUint64(8)) : small;
    if (!Number.isSafeInteger(size) || size < (small === 1 ? 16 : 8) || !Number.isSafeInteger(at + size)) return [];
    if (type === "moov") {
      if (size > 32 * 1024 * 1024) throw new Error("Movie metadata exceeds the 32 MiB inspection limit.");
      const data = await read(at, size);
      if (data.length !== size) throw new Error("Truncated movie metadata.");
      // Extended-size containers are converted to the bounded 32-bit form.
      if (small === 1) return readChapterBox(box("moov", data.subarray(16)));
      return readChapterBox(data);
    }
    at += size;
  }
  throw new Error("Too many movie boxes to inspect chapters.");
}
