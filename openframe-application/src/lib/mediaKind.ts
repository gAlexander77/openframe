// What kind of media a file is, told from the file itself: its source's
// name (a path, a URL, the web build's storage key) and, when that has no
// extension, its first bytes. Never from the name it shows in the library:
// import_media's `name` is a label, and "launch" for launch.mp4 once made
// the import answer [] with no error (the Codex film test, ADR-095).

export const IMAGE_EXT = /\.(a?png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;
export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?)$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mts|m2ts|ts|mxf|3gp|ogv|mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|a?png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name);
export const looksLikeMedia = (name: string) => MEDIA_EXT.test(name);

/** The file name at the end of a path, URL or storage key, without a
 * URL's query or fragment: "C:\\a\\launch.mp4", "https://x/y/launch.mp4?v=2"
 * and "1a2b3c4d-launch.mp4" all end in a name with ".mp4". */
export function sourceName(src: string): string {
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(src) ? src.replace(/[?#].*$/, "") : src;
  const last = path.split(/[\\/]/).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Imports may omit the library label. Resolve it before the browser copies
 * the source to a storage key, and when reading older unnamed assets. */
export function mediaName(file: { name?: unknown; src: string }): string {
  return typeof file.name === "string" && file.name.trim() ? file.name : sourceName(file.src) || "Media";
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const has = (b: Uint8Array, text: string, within = b.length) => ascii(b, 0, Math.min(within, b.length)).includes(text);

/** How many bytes sniffFormat wants to read. */
export const SNIFF_BYTES = 512;

/**
 * A media file's format from its first bytes, as the extension that names
 * it ("mp4", "png", "mp3"...), or null when they are not one this app
 * opens. Containers that hold either picture or sound (MP4, Ogg) are named
 * by what their header says; the decoder then finds the tracks.
 */
export function sniffFormat(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  // Pictures.
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpg";
  if (ascii(b, 0, 4) === "GIF8") return "gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  // ISO base media (MP4, MOV, M4A, AVIF): the brand after "ftyp".
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "avif" || brand === "avis") return "avif";
    if (brand === "M4A " || brand === "M4B " || brand === "M4P ") return "m4a";
    if (brand === "qt  ") return "mov";
    return "mp4";
  }
  if (ascii(b, 4, 4) === "moov" || ascii(b, 4, 4) === "mdat" || ascii(b, 4, 4) === "wide") return "mov";
  // BMP: "BM", then the size of a header BMP knows (12, 40, 56, 108, 124).
  if (ascii(b, 0, 2) === "BM" && [12, 40, 52, 56, 64, 108, 124].includes(b[14]) && at(15, 0, 0, 0)) return "bmp";
  // An icon: reserved 0, type 1, at least one image.
  if (at(0, 0, 0, 1, 0) && (b[4] || b[5])) return "ico";
  // Matroska and WebM: the EBML header names its DocType.
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return has(b, "webm", 64) ? "webm" : "mkv";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "AVI ") return "avi";
  if (ascii(b, 0, 4) === "FORM" && (ascii(b, 8, 4) === "AIFF" || ascii(b, 8, 4) === "AIFC")) return "aiff";
  if (ascii(b, 0, 4) === "fLaC") return "flac";
  // Ogg: Theora is a video, the rest (Vorbis, Opus) sound.
  if (ascii(b, 0, 4) === "OggS") return has(b, "theora") ? "ogv" : "ogg";
  if (at(0, 0x30, 0x26, 0xb2, 0x75)) return "wmv";
  // MPEG transport stream: a sync byte every 188.
  if (b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47) return "ts";
  if (ascii(b, 0, 3) === "ID3") return "mp3";
  // A bare audio frame: MPEG audio, or AAC in ADTS (layer bits 00).
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0x06) === 0 ? "aac" : "mp3";
  // SVG is text: an XML prolog or a comment may come first.
  const text = ascii(b, 0, Math.min(b.length, SNIFF_BYTES)).replace(/^\uFEFF|^\xEF\xBB\xBF/, "").trimStart();
  if (/^(<\?xml|<!--|<!DOCTYPE svg|<svg)/i.test(text) && /<svg[\s>]/i.test(text)) return "svg";
  return null;
}

/**
 * The name whose extension says how to open a file: its source's own name
 * when that has a media extension; otherwise, from its first bytes (when
 * given), its source's name with the format's extension added; null when
 * neither tells (not media this app opens). The display name is never
 * consulted.
 */
export function formatName(src: string, head?: Uint8Array): string | null {
  const own = sourceName(src);
  if (looksLikeMedia(own)) return own;
  const ext = head ? sniffFormat(head) : null;
  return ext ? `${own || "media"}.${ext}` : null;
}
