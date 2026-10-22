import { describe, expect, it } from "vitest";
import { BorrowCache, ByteLru, createIdleLease, createMemoryRegistry, retainedBytes } from "./memory";

it("pins borrowed resources across eviction and discards loads that finish after close", async () => {
  const closed: string[] = [];
  const cache = new BorrowCache<string, string>(4, s => s.length, s => closed.push(s));
  const a = await cache.acquire("a", async () => "AAAA");
  const b = await cache.acquire("b", async () => "BBBB");
  expect(cache.bytes).toBe(4);
  expect(cache.borrowedBytes).toBe(4);
  expect(closed).toEqual([]);
  a.release(); a.release();
  expect(closed).toEqual(["AAAA"]);
  let finish!: (value: string) => void;
  const pending = cache.acquire("late", () => new Promise<string>(resolve => { finish = resolve; }));
  await Promise.resolve();
  cache.clear();
  expect(closed).toEqual(["AAAA"]);
  finish("late");
  const late = await pending;
  expect(cache.size).toBe(0);
  late.release(); b.release();
  expect(closed).toEqual(["AAAA", "late", "BBBB"]);
  expect(cache.borrowedBytes).toBe(0);
});

it("accounts for typed data and counts shared document objects once", () => {
  expect(retainedBytes(new Float32Array(100))).toBe(400);
  const clip = { text: "hello" };
  expect(retainedBytes([clip, clip])).toBeLessThan(retainedBytes([clip, { ...clip }]));
  const cycle: unknown[] = []; cycle.push(cycle);
  expect(Number.isFinite(retainedBytes(cycle))).toBe(true);
});

describe("byte budgets", () => {
  it("evicts the least recently used bytes and closes each value once", () => {
    const closed: string[] = [], cache = new ByteLru<string, string>(10, v => closed.push(v));
    cache.set("a", "A", 4); cache.set("b", "B", 4);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 6);
    expect(cache.peek("b")).toBeUndefined();
    expect(cache.bytes).toBe(10);
    cache.set("a", "new A", 2);
    expect(cache.bytes).toBe(8);
    expect(cache.set("huge", "huge", 11)).toBe(false);
    cache.clear(); cache.clear();
    expect(cache.bytes).toBe(0);
    expect(closed).toEqual(["B", "A", "huge", "C", "new A"]);
  });
  it("rejects invalid accounting and admits an exact budget", () => {
    const cache = new ByteLru<string, number>(4);
    expect(() => cache.set("bad", 0, NaN)).toThrow();
    expect(() => cache.set("bad", 0, -1)).toThrow();
    expect(cache.set("a", 1, 4)).toBe(true);
    expect(cache.size).toBe(1);
  });
});

it("releases project owners on close and again on the next session, despite a failed owner", () => {
  const registry = createMemoryRegistry(), cache = new ByteLru<string, number>(10);
  registry.register("broken", () => ({ bytes: 0, count: 0 }), () => { throw Error("broken"); });
  registry.register("peaks", () => ({ bytes: cache.bytes, count: cache.size, budget: cache.budget }), () => cache.clear());
  cache.set("first project", 1, 8);
  expect(registry.endSession()).toHaveLength(1);
  expect(registry.snapshot().peaks.bytes).toBe(0);
  cache.set("same project reopened", 2, 9);
  registry.endSession();
  expect(cache.size).toBe(0);
});

it("unloads models between sizes and after idle time, never during inference", () => {
  let now = 0;
  const lease = createIdleLease(120000, () => now);
  expect(lease.begin("tiny")).toBe(false);
  now = 300000;
  expect(lease.expired()).toBe(false);
  lease.end(); now += 119999;
  expect(lease.expired()).toBe(false);
  now++;
  expect(lease.expired()).toBe(true);
  expect(lease.begin("base")).toBe(true);
  expect(lease.expired()).toBe(false);
  lease.end(); lease.clear();
  expect(lease.begin("small")).toBe(false);
});
