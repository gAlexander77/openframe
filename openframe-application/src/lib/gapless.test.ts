import { describe, expect, it } from "vitest";
import { id3v2Size, mp3Trim, MP3_DECODER_DELAY } from "./gapless";

/** The first frame of an MP3 as an encoder writes it: a Layer III header,
 * the side information left zero, and a Xing/Info tag with its LAME
 * extension (encoder name, then the delay and padding, 12 bits each). */
function firstFrame(o: { version?: 3 | 2 | 0; rate?: 0 | 1 | 2; mono?: boolean; word?: string; flags?: number; encoder?: string; delay?: number; padding?: number; junk?: number } = {}) {
  const { version = 3, rate = 1, mono = false, word = "Info", flags = 0xf, encoder = "LAME3.100", delay = 576, padding = 1000, junk = 0 } = o;
  const b = new Uint8Array(junk + 417);
  let p = junk;
  b.set([0xff, 0xe0 | (version << 3) | (1 << 1) | 1, (9 << 4) | (rate << 2), mono ? 0xc0 : 0x00], p);
  p += 4 + (version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17);
  const put = (text: string) => { for (const ch of text) b[p++] = ch.charCodeAt(0); };
  const u32 = (v: number) => { b.set([v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255], p); p += 4; };
  put(word);
  u32(flags);
  if (flags & 1) u32(1251);
  if (flags & 2) u32(720_000);
  if (flags & 4) p += 100;
  if (flags & 8) u32(57);
  put(encoder.padEnd(9, "\0").slice(0, 9));
  p += 12;
  b.set([delay >> 4, ((delay & 15) << 4) | (padding >> 8), padding & 255], p);
  return b;
}

function id3(body: number, footer = false) {
  const b = new Uint8Array(10 + body + (footer ? 10 : 0));
  b.set([0x49, 0x44, 0x33, 4, 0, footer ? 0x10 : 0, (body >> 21) & 127, (body >> 14) & 127, (body >> 7) & 127, body & 127]);
  return b;
}

const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (h) => parseInt(h, 16));

describe("id3v2Size", () => {
  it("reads the synchsafe size, with the footer", () => {
    expect(id3v2Size(id3(34))).toBe(44);
    expect(id3v2Size(id3(300_000))).toBe(300_010);
    expect(id3v2Size(id3(34, true))).toBe(54);
  });
  it("is 0 for anything else", () => {
    expect(id3v2Size(firstFrame())).toBe(0);
    expect(id3v2Size(new Uint8Array(4))).toBe(0);
    const bad = id3(34);
    bad[7] = 0x80; // not synchsafe
    expect(id3v2Size(bad)).toBe(0);
  });
});

describe("mp3Trim", () => {
  it("reads LAME's delay and padding as ffmpeg does", () => {
    // 576 + 529 skipped before (23.02 ms at 48 kHz), 1000 - 529 after.
    expect(mp3Trim(firstFrame())).toEqual({ start: 1105, end: 471, sampleRate: 48000 });
    expect(mp3Trim(firstFrame({ word: "Xing", encoder: "Lavc61.19", delay: 1105, padding: 1500 }))).toEqual({ start: 1105 + MP3_DECODER_DELAY, end: 971, sampleRate: 48000 });
  });

  it("finds the tag at every layout's offset and rate", () => {
    expect(mp3Trim(firstFrame({ mono: true, rate: 0 }))).toMatchObject({ start: 1105, sampleRate: 44100 });
    expect(mp3Trim(firstFrame({ version: 2, rate: 1 }))).toMatchObject({ start: 1105, sampleRate: 24000 });
    expect(mp3Trim(firstFrame({ version: 2, mono: true, rate: 0 }))).toMatchObject({ start: 1105, sampleRate: 22050 });
    expect(mp3Trim(firstFrame({ version: 0, rate: 2 }))).toMatchObject({ start: 1105, sampleRate: 8000 });
  });

  it("walks the optional fields the flags name", () => {
    for (const flags of [0, 1, 2, 4, 8, 5, 0xf]) expect(mp3Trim(firstFrame({ flags, delay: 1234, padding: 2000 }))?.start).toBe(1234 + MP3_DECODER_DELAY);
  });

  it("drops nothing at the end without a frame count or with padding under the decoder's delay", () => {
    expect(mp3Trim(firstFrame({ flags: 0xe }))?.end).toBe(0);
    expect(mp3Trim(firstFrame({ padding: 300 }))?.end).toBe(0);
  });

  it("skips junk before the first frame", () => {
    expect(mp3Trim(firstFrame({ junk: 37 }))).toEqual({ start: 1105, end: 471, sampleRate: 48000 });
  });

  it("trims nothing an encoder it does not know wrote, or no tag at all", () => {
    // mediabunny's own MP3 muxer writes a Xing tag with no LAME extension.
    expect(mp3Trim(firstFrame({ word: "Xing", encoder: "" }))).toBeNull();
    expect(mp3Trim(firstFrame({ encoder: "GOGO3.13" }))).toBeNull();
    expect(mp3Trim(firstFrame({ word: "VBRI" }))).toBeNull();
    expect(mp3Trim(new Uint8Array(1000))).toBeNull();
    expect(mp3Trim(firstFrame().subarray(0, 150))).toBeNull();
  });

  it("reads the head ffmpeg's libmp3lame writes (music-30s.mp3)", () => {
    // ID3v2 (ffmpeg's TSSE), then the Info frame of a 48 kHz mono stream:
    // ffprobe reports "pad 576 576" and skips 1105 samples; 1251 frames
    // of 1152 less 1105 and 47 are its 30.000 s.
    const head = hex(
      "49443304000000000022545353450000000e0000034c61766636312e372e3130300000000000000000000000fffbb4c00000000000000000000000000000000000496e666f0000000f000004e3000b0100000305080a0d0f1214171a1c1f212426292c2e313336383b3d404345484a4d4f5154575a5c5f616366686c6e717375787a7d808385878a8c8f919497999c9ea1a3a6a8abaeb0b3b5b8babdc0c2c5c7cacccfd1d4d7d9dcdee1e3e6e8ebeef0f3f5f8fafc000000004c61766336312e3139000000000000000000000000240240000000",
    );
    const at = id3v2Size(head);
    expect(at).toBe(44);
    const trim = mp3Trim(head.subarray(at))!;
    expect(trim).toEqual({ start: 1105, end: 47, sampleRate: 48000 });
    expect((1251 * 1152 - trim.start - trim.end) / trim.sampleRate).toBe(30);
  });
});
