// Gapless MP3: the samples an MP3 decoder outputs that are not the sound.
// A LAME-family encoder starts its stream late (its encoder delay, 576
// samples for LAME) and pads its last frame; every MP3 decoder adds 529
// samples of its own delay on top. The encoder writes the delay and the
// padding into the stream's first frame, the Xing/"Info" tag's LAME
// extension, and gapless players (ffmpeg, iTunes, foobar2000) leave both
// out. WebCodecs presents them, so the app played every MP3 23 ms late
// (1105 samples at 48 kHz, measured against ffmpeg; ADR-112).
//
// Read as ffmpeg reads it (libavformat/mp3dec.c mp3_parse_info_tag): from
// the first frame only, for LAME, Lavf and Lavc encoders only, skipping
// the delay plus 529 at the start and the padding less 529 at the end when
// the tag counts its frames. The first frame is found as mediabunny finds
// it (past every ID3v2 tag, the first word that is a frame header), so the
// trim lands on the stream mediabunny decodes.

/** What a gapless decoder leaves out of an MP3, in samples at `sampleRate`. */
export interface Mp3Trim {
  /** Before the sound: the encoder's delay and the decoder's 529. */
  start: number;
  /** After it: the encoder's padding less the decoder's 529. */
  end: number;
  sampleRate: number;
}

/** The decoder delay every MP3 decoder adds (ffmpeg's 528 + 1). */
export const MP3_DECODER_DELAY = 529;

const ID3_HEADER = 10;

/**
 * Bytes of the ID3v2 tag at the start of `b` (header, body and footer),
 * or 0 when `b` does not start with one. Tags can follow each other; the
 * first audio frame comes after the last.
 */
export function id3v2Size(b: Uint8Array): number {
  if (b.length < ID3_HEADER || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  if (b[3] === 0xff || b[4] === 0xff || (b[6] | b[7] | b[8] | b[9]) & 0x80) return 0;
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return ID3_HEADER + size + (b[5] & 0x10 ? ID3_HEADER : 0);
}

interface FrameHeader {
  /** 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5. */
  version: number;
  sampleRate: number;
  mono: boolean;
}

function frameHeader(b: Uint8Array, at: number): FrameHeader | null {
  if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3;
  const layer = (b[at + 1] >> 1) & 3;
  const bitrate = b[at + 2] >> 4;
  const rate = (b[at + 2] >> 2) & 3;
  if (version === 1 || layer === 0 || bitrate === 0 || bitrate === 15 || rate === 3) return null;
  return { version, sampleRate: [44100, 48000, 32000][rate] >> (version === 3 ? 0 : version === 2 ? 1 : 2), mono: b[at + 3] >> 6 === 3 };
}

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/**
 * The trim the first frame in `b` names, `b` starting where the ID3v2
 * tags end (junk before the frame is skipped, as mediabunny skips it).
 * Null when that frame has no Xing/Info tag, the tag no LAME extension
 * from LAME, Lavf or Lavc, or `b` ends before the extension does.
 */
export function mp3Trim(b: Uint8Array): Mp3Trim | null {
  let at = 0;
  while (at + 4 <= b.length && !frameHeader(b, at)) at++;
  const header = frameHeader(b, at);
  if (!header) return null;
  // The tag sits after the side information: 32 bytes for MPEG-1 stereo,
  // 17 for MPEG-1 mono and MPEG-2 stereo, 9 for MPEG-2 mono.
  let p = at + 4 + (header.version === 3 ? (header.mono ? 17 : 32) : header.mono ? 9 : 17);
  const word = ascii(b, p, 4);
  if (word !== "Xing" && word !== "Info") return null;
  p += 4;
  if (p + 4 > b.length) return null;
  const flags = u32(b, p);
  p += 4;
  const counted = (flags & 1) !== 0;
  // Frame count, byte count, seek table, quality: each there when flagged.
  p += (counted ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
  // Encoder (9 bytes), then revision, lowpass, peak (4), two gains (2 + 2),
  // encoding flags and bitrate: the delay and padding follow, 12 bits each.
  const encoder = ascii(b, p, 4);
  p += 9 + 12;
  if (p + 3 > b.length || !["LAME", "Lavf", "Lavc"].includes(encoder)) return null;
  const delay = (b[p] << 4) | (b[p + 1] >> 4);
  const padding = ((b[p + 1] & 0x0f) << 8) | b[p + 2];
  return {
    start: delay + MP3_DECODER_DELAY,
    end: counted ? Math.max(0, padding - MP3_DECODER_DELAY) : 0,
    sampleRate: header.sampleRate,
  };
}

/** Bytes read after the ID3v2 tags for mp3Trim: the delay and padding end
 * at most 180 bytes into the first frame, so this leaves room for junk
 * before it. */
export const MP3_TRIM_BYTES = 4096;
