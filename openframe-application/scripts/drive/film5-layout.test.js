import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const drive = (0, eval)(readFileSync(new URL("./film5-layout.js", import.meta.url), "utf8"));
const page = () => Object.assign(new EventEmitter(), {
  goto: async () => {},
  waitForFunction: async () => {},
  locator: () => ({ click: async () => {}, waitFor: async () => {} }),
  evaluate: vi.fn(() => new Promise(() => {})),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("throws the page's error while evaluate remains unsettled", async () => {
  const p = page();
  const result = drive(p);
  const failure = expect(result).rejects.toThrow("film5-layout pageerror: TypeError: Cannot read properties of undefined (reading 'toLocaleLowerCase')");
  await vi.waitFor(() => expect(p.evaluate).toHaveBeenCalled());
  p.emit("pageerror", new TypeError("Cannot read properties of undefined (reading 'toLocaleLowerCase')"));
  await failure;
  expect(p.listenerCount("pageerror")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("times out even if evaluate never resolves and the page reports no error", async () => {
  const p = page();
  const result = drive(p);
  const failure = expect(result).rejects.toThrow("film5-layout timed out after 60 seconds");
  await vi.waitFor(() => expect(p.evaluate).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(60000);
  await failure;
  expect(p.listenerCount("pageerror")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("returns completed checks and clears its timeout and error listener", async () => {
  const p = page(), details = { canvas: { ok: true } };
  p.evaluate.mockResolvedValue(details);
  expect(await drive(p)).toEqual({ ok: true, details });
  expect(p.listenerCount("pageerror")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
