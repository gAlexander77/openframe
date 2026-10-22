import { expect, it } from "vitest";
import { appendChapters, chapterBox, chaptersInRange, readChapterBox, readFileChapters } from "./chapters";
const fps = { num: 30, den: 1 };
it("exports only chapter starts, sorts, deduplicates and offsets partial exports", () => {
  const markers = [{ id: "a", frame: 30, label: "Intro", color: "red", duration: 20, chapter: true }, { id: "b", frame: 90, label: "Next", color: "red", chapter: true }, { id: "c", frame: 60, label: "Note", color: "red" }];
  expect(chaptersInRange(markers, fps, { from: 60, to: 120 })).toEqual([{ seconds: 0, title: "Intro" }, { seconds: 1, title: "Next" }]);
  expect(chaptersInRange([...markers, { ...markers[0], id: "duplicate" }], fps, { from: 0, to: 90 })).toEqual([{ seconds: 1, title: "Intro" }]);
});
it("writes Nero version one, 100 ns timestamps and valid UTF-8 byte lengths", () => {
  const b = chapterBox([{ seconds: 1.25, title: "Hello" }]);
  const v = new DataView(b.buffer);
  expect(v.getUint32(0)).toBe(b.length);
  expect([...b.slice(4, 8)]).toEqual([99, 104, 112, 108]);
  expect(b[8]).toBe(1); expect(b[16]).toBe(1);
  expect(v.getBigUint64(17)).toBe(12500000n); expect(b[25]).toBe(5);
  expect(new TextDecoder().decode(b.slice(26))).toBe("Hello");
  const long = chapterBox([{ seconds: 0, title: "\u{1f600}".repeat(100) }]);
  expect(long[25]).toBe(252); expect(new TextDecoder("utf-8", { fatal: true }).decode(long.slice(26))).toBe("\u{1f600}".repeat(63));
  expect(() => chapterBox(Array.from({ length: 256 }, (_, i) => ({ seconds: i, title: "x" })))).toThrow("255");
  expect(() => chapterBox([{ seconds: NaN, title: "x" }])).toThrow();
});
it("extends only movie metadata and preserves existing user data", () => {
  const empty = new Uint8Array([0, 0, 0, 8, 109, 111, 111, 118]);
  const added = appendChapters(empty, [{ seconds: 0, title: "x" }]);
  expect(new DataView(added.buffer).getUint32(0)).toBe(added.length);
  expect(new TextDecoder().decode(added.slice(12, 16))).toBe("udta");
  const existing = new Uint8Array([0, 0, 0, 24, 109, 111, 111, 118, 0, 0, 0, 16, 117, 100, 116, 97, 0, 0, 0, 8, 116, 101, 115, 116]);
  const out = appendChapters(existing, [{ seconds: 0, title: "x" }]);
  expect([...out.slice(16, 24)]).toEqual([...existing.slice(16)]);
  expect(new DataView(out.buffer).getUint32(8)).toBe(out.length - 8);
  expect(() => appendChapters(empty.slice(1), [])).toThrow();
});

it("film 5: independently reads both delivered chapter titles and times from an MP4", async () => {
  const chapters = [{ seconds: 3, title: "Jeanette Epps \u2014 Preparation" }, { seconds: 778 / 30, title: "Brigette Hesman \u2014 Discovery" }];
  const moov = appendChapters(new Uint8Array([0, 0, 0, 8, 109, 111, 111, 118]), chapters);
  expect(readChapterBox(moov)).toEqual(chapters.map(c => ({ ...c, seconds: Math.round(c.seconds * 1e7) / 1e7 })));
  // A large mdat is skipped by offset, rather than downloaded/allocated.
  const reads: [number, number][] = [];
  const read = async (at: number, n: number) => {
    reads.push([at, n]);
    if (at === 0) return new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]).slice(0, n);
    if (at === 16) return new Uint8Array([0, 16, 0, 0, 109, 100, 97, 116]).slice(0, n);
    if (at === 16 + 1048576) return moov.slice(0, n);
    return new Uint8Array();
  };
  expect(await readFileChapters(read)).toEqual(readChapterBox(moov));
  expect(reads.every(([, n]) => n <= moov.length)).toBe(true);
  expect(readChapterBox(chapterBox([{ seconds: 0, title: "\u{1f600}".repeat(100) }]))[0].title).toBe("\u{1f600}".repeat(63));
});

it("refuses malformed chapter payloads and bounds metadata reads", async () => {
  const b = chapterBox([{ seconds: 1, title: "Chapter" }]);
  const bad = b.slice(); bad[25] = 255;
  expect(() => readChapterBox(bad)).toThrow(/chapter/);
  const header = new Uint8Array([2, 0, 0, 1, 109, 111, 111, 118, 0, 0, 0, 0, 0, 0, 0, 0]);
  await expect(readFileChapters(async () => header)).rejects.toThrow(/32 MiB/);
  expect(await readFileChapters(async () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toEqual([]);
});
