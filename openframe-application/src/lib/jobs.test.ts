import { describe, expect, it } from "vitest";
import { createJobRegistry } from "./jobs";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
describe("long tool jobs", () => {
  it("clamps progress, reuses a running tool and retains its entire answer", async () => {
    let clock = 1000;
    const jobs = createJobRegistry(() => clock, 60_000), done = deferred<unknown>();
    const id = jobs.start("hear", "project", undefined, async c => { c.progress(2, "Listening"); return done.promise; });
    await Promise.resolve();
    expect(jobs.status(id)).toMatchObject({ state: "running", progress: 1, stage: "Listening", project_id: "project" });
    expect(jobs.start("hear", "project", undefined, async () => "wrong")).toBe(id);
    const answer = { words: [{ text: "hello", start: 1440 }], more: [1, 2, 3] };
    done.resolve(answer);
    clock = 3000;
    expect(await jobs.wait(id, 1)).toMatchObject({ state: "done", result: answer, elapsed_seconds: 2 });
    clock = 62_999;
    expect(jobs.all()).toHaveLength(1);
    clock = 63_000;
    expect(jobs.all()).toEqual([]);
    expect(() => jobs.status(id)).toThrow(/expired/);
  });
  it("returns a running job when the wait budget expires", async () => {
    const jobs = createJobRegistry(), done = deferred<string>();
    const id = jobs.start("hear", "p", undefined, async () => done.promise);
    expect(await jobs.wait(id, 0)).toMatchObject({ job_id: id, state: "running" });
    done.resolve("heard");
    expect(await jobs.wait(id, 1)).toMatchObject({ state: "done", result: "heard" });
  });
  it("keeps failures and lets a new run start", async () => {
    const jobs = createJobRegistry();
    const id = jobs.start("hear", "p", undefined, async () => { throw new Error("No audio"); });
    expect(await jobs.wait(id, 1)).toMatchObject({ state: "failed", error: "No audio" });
    expect(jobs.start("hear", "p", undefined, async () => "ok")).not.toBe(id);
  });
  it("cancels immediately and discards a late worker result", async () => {
    const jobs = createJobRegistry(), done = deferred<string>();
    let signal!: AbortSignal;
    const id = jobs.start("hear", "p", undefined, async c => { signal = c.signal; return done.promise; });
    await Promise.resolve();
    expect(jobs.cancel(id).state).toBe("canceled");
    expect(signal.aborted).toBe(true);
    done.resolve("late");
    expect(await jobs.wait(id, 1)).toMatchObject({ state: "canceled" });
    expect(jobs.status(id).result).toBeUndefined();
  });
  it("a project switch cancels only that session's jobs, including reopening the same ID", async () => {
    const jobs = createJobRegistry(), old = new AbortController(), next = new AbortController();
    const first = jobs.start("hear", "same-id", old.signal, () => new Promise(() => {}));
    const other = jobs.start("render", "other", next.signal, () => new Promise(() => {}));
    old.abort();
    expect(jobs.status(first).state).toBe("canceled");
    expect(jobs.status(other).state).toBe("running");
    expect(jobs.start("hear", "same-id", next.signal, async () => "new session")).not.toBe(first);
    next.abort();
  });
});


it("ends a waiting call promptly on cancellation even if its worker has not stopped", async () => {
  const jobs = createJobRegistry();
  const id = jobs.start("hear", "p", undefined, () => new Promise(() => {}));
  const waiting = jobs.wait(id, 45);
  jobs.cancel(id);
  expect(await waiting).toMatchObject({ state: "canceled" });
});

it("releases delivered media without changing the answer already handed to a caller", async () => {
  const jobs = createJobRegistry();
  const image = { content: [{ type: "image", data: "x".repeat(100000), mimeType: "image/png" }, { type: "text", text: "measurements" }] };
  const id = jobs.start("preview_frame", "p", undefined, async () => image);
  const answer = await jobs.wait(id, 1);
  const before = jobs.memory().bytes;
  jobs.delivered(id);
  expect(answer.result).toEqual(image);
  expect(jobs.memory().bytes).toBeLessThan(before / 10);
  expect(JSON.stringify(jobs.status(id))).not.toContain("xxxxx");
  expect(JSON.stringify(jobs.status(id))).toContain("measurements");
});

it("bounds retained answers by bytes and releases them when a project closes", async () => {
  const jobs = createJobRegistry(Date.now, 60_000, 600);
  const first = jobs.start("one", "p", undefined, async () => "x".repeat(200));
  await jobs.wait(first, 1);
  const second = jobs.start("two", "p", undefined, async () => "y".repeat(200));
  await jobs.wait(second, 1);
  expect(jobs.memory().bytes).toBeLessThanOrEqual(600);
  expect(jobs.status(first)).toMatchObject({ state: "done", result_released: true });
  expect(jobs.status(second).result).toHaveLength(200);
  jobs.releaseResults();
  expect(jobs.memory().bytes).toBe(0);
});

it("deduplicates per-asset jobs without blocking a different asset's analysis", async () => {
  const jobs = createJobRegistry();
  const a = jobs.start("analyze_footage", "p", undefined, () => new Promise(() => {}), "asset-a");
  const b = jobs.start("analyze_footage", "p", undefined, () => new Promise(() => {}), "asset-b");
  expect(a).not.toBe(b);
  expect(jobs.start("analyze_footage", "p", undefined, async () => "wrong", "asset-a")).toBe(a);
  jobs.cancel(a); jobs.cancel(b);
});
