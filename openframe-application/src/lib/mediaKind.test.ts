import { describe, expect, it } from "vitest";
import { formatName, isImageName, looksLikeMedia, mediaName, sniffFormat, sourceName } from "./mediaKind";

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p));
  return new Uint8Array(out.concat(new Array(Math.max(0, 600 - out.length)).fill(0x20)));
};

describe("sourceName", () => {
  it("takes the name at the end of a path, a URL or a storage key", () => {
    expect(sourceName("C:\\Footage\\launch.mp4")).toBe("launch.mp4");
    expect(sourceName("/home/x/launch.MOV")).toBe("launch.MOV");
    expect(sourceName("https://example.com/media/launch%20day.mp4?v=2#t=1")).toBe("launch day.mp4");
    expect(sourceName("1a2b3c4d-launch.mp4")).toBe("1a2b3c4d-launch.mp4");
    expect(sourceName("https://example.com/download?id=3")).toBe("download");
  });
});

it("resolves missing, empty or invalid display names before a source is copied", () => {
  const src = "http://localhost:1420/fixtures/media/color-bars.png";
  for (const name of [undefined, null, "", "   ", 42]) expect(mediaName({ name, src })).toBe("color-bars.png");
  expect(mediaName({ src: "https://example.com/launch%20day.mp4?v=2" })).toBe("launch day.mp4");
  expect(mediaName({ src: "C:\\Footage\\launch.mp4" })).toBe("launch.mp4");
  expect(mediaName({ src: "https://example.com/" })).toBe("Media");
  expect(mediaName({ name: "Launch", src })).toBe("Launch");
});

describe("sniffFormat", () => {
  it("names pictures by their signatures", () => {
    expect(sniffFormat(bytes([0x89], "PNG\r\n"))).toBe("png");
    expect(sniffFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffFormat(bytes("GIF89a"))).toBe("gif");
    expect(sniffFormat(bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "))).toBe("webp");
    expect(sniffFormat(bytes("BM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0, 0, 0]))).toBe("bmp");
    expect(sniffFormat(bytes([0, 0, 1, 0, 1, 0]))).toBe("ico");
    expect(sniffFormat(bytes([0xef, 0xbb, 0xbf], "<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\">"))).toBe("svg");
    expect(sniffFormat(bytes("<svg width=\"10\" height=\"10\"></svg>"))).toBe("svg");
    expect(sniffFormat(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
  });

  it("names video and sound containers", () => {
    expect(sniffFormat(bytes([0, 0, 0, 0x20], "ftypisom"))).toBe("mp4");
    expect(sniffFormat(bytes([0, 0, 0, 0x14], "ftypqt  "))).toBe("mov");
    expect(sniffFormat(bytes([0, 0, 0, 0x20], "ftypM4A "))).toBe("m4a");
    expect(sniffFormat(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], "webm"))).toBe("webm");
    expect(sniffFormat(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], "matroska"))).toBe("mkv");
    expect(sniffFormat(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))).toBe("wav");
    expect(sniffFormat(bytes("RIFF", [0, 0, 0, 0], "AVI LIST"))).toBe("avi");
    expect(sniffFormat(bytes("ID3", [4, 0]))).toBe("mp3");
    expect(sniffFormat(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe("mp3");
    expect(sniffFormat(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe("aac");
    expect(sniffFormat(bytes("fLaC"))).toBe("flac");
    expect(sniffFormat(bytes("OggS", [0, 2], "OpusHead"))).toBe("ogg");
    expect(sniffFormat(bytes("OggS", [0, 2], [0x80], "theora"))).toBe("ogv");
    expect(sniffFormat(bytes("FORM", [0, 0, 0, 0], "AIFF"))).toBe("aiff");
    const ts = new Uint8Array(600);
    ts[0] = ts[188] = ts[376] = 0x47;
    expect(sniffFormat(ts)).toBe("ts");
  });

  it("says null for what is not media", () => {
    expect(sniffFormat(bytes("Hello, this is a text file."))).toBeNull();
    expect(sniffFormat(bytes("{\"tracks\": []}"))).toBeNull();
    expect(sniffFormat(bytes("BMW 3 series brochure"))).toBeNull();
    expect(sniffFormat(new Uint8Array([0x89]))).toBeNull();
  });
});

describe("formatName", () => {
  it("trusts the source's extension, never the label shown in the library", () => {
    expect(formatName("C:\\promo\\launch.mp4")).toBe("launch.mp4");
    expect(formatName("https://example.com/a/logo.png?x=1")).toBe("logo.png");
  });

  it("falls back to the first bytes when the source has no extension", () => {
    expect(formatName("/tmp/upload-7f3a", bytes([0, 0, 0, 0x20], "ftypisom"))).toBe("upload-7f3a.mp4");
    expect(formatName("1a2b3c4d-launch", bytes("GIF89a"))).toBe("1a2b3c4d-launch.gif");
    expect(formatName("/tmp/notes", bytes("plain words"))).toBeNull();
    expect(formatName("/tmp/notes")).toBeNull();
  });

  it("knows the media extensions", () => {
    expect(looksLikeMedia("a.mp4") && looksLikeMedia("b.WAV") && looksLikeMedia("c.svg")).toBe(true);
    expect(looksLikeMedia("launch") || looksLikeMedia("notes.txt")).toBe(false);
    expect(isImageName("x.jpeg") && !isImageName("x.mp4")).toBe(true);
  });
});
