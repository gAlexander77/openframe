import { describe, expect, it } from "vitest";
import { capBytes, formatLimit, TooBigToCopy, tooBigToCopy, URL_COPY_LIMIT } from "./urlImport";

const chunks = (...sizes: number[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const n of sizes) c.enqueue(new Uint8Array(n));
      c.close();
    },
  });

async function drain(s: ReadableStream<Uint8Array>) {
  let n = 0;
  const r = s.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) return n;
    n += value.byteLength;
  }
}

describe("copying a file imported by its address", () => {
  it("passes a file under the limit through, counting it", async () => {
    const seen: number[] = [];
    expect(await drain(chunks(10, 20, 5).pipeThrough(capBytes(100, (t) => seen.push(t))))).toBe(35);
    expect(seen).toEqual([10, 30, 35]);
  });

  it("stops a file that turns out bigger than the limit", async () => {
    await expect(drain(chunks(60, 60).pipeThrough(capBytes(100)))).rejects.toBeInstanceOf(TooBigToCopy);
  });

  it("refuses at once when the length is already too big", () => {
    expect(tooBigToCopy(String(URL_COPY_LIMIT + 1))).toBe(true);
    expect(tooBigToCopy(String(URL_COPY_LIMIT))).toBe(false);
    expect(tooBigToCopy(null)).toBe(false);
    expect(formatLimit(URL_COPY_LIMIT)).toBe("1 GB");
  });
});
