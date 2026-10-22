import { afterEach, expect, it, vi } from "vitest";
import { memoryOwners } from "./memory";
import { modelWorker, MODEL_IDLE_MS } from "./modelWorker";
import { workerRequest } from "../lib/workerRequest";

afterEach(() => { memoryOwners.endSession(); vi.useRealTimers(); });

it("keeps one worker per model size and terminates it after idle time", async () => {
  vi.useFakeTimers();
  const instances: { terminate: ReturnType<typeof vi.fn> }[] = [];
  const managed = modelWorker("test_model", () => { const w = { terminate: vi.fn() }; instances.push(w); return w as unknown as Worker; });
  await managed.run("tiny", 10, async () => "words");
  await managed.run("tiny", 10, async () => "more words");
  expect(instances).toHaveLength(1);
  await managed.run("base", 20, async () => "new words");
  expect(instances).toHaveLength(2);
  expect(instances[0].terminate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(MODEL_IDLE_MS - 1);
  expect(instances[1].terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(instances[1].terminate).toHaveBeenCalledTimes(1);
  expect(memoryOwners.snapshot().test_model.count).toBe(0);
});

it("does not expire during inference; session close rejects the RPC and queued work", async () => {
  vi.useFakeTimers();
  class FakeWorker extends EventTarget { terminate = vi.fn(); postMessage() {} }
  const worker = new FakeWorker();
  const managed = modelWorker("test_model", () => worker as unknown as Worker);
  const pending = managed.run("base", 20, (w, signal) => workerRequest(w, { id: 1 }, { signal }));
  const canceled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const next = vi.fn(async () => "late");
  const queued = managed.run("small", 30, next);
  const canceledQueue = expect(queued).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(MODEL_IDLE_MS * 2);
  expect(worker.terminate).not.toHaveBeenCalled();
  memoryOwners.endSession();
  await canceled; await canceledQueue;
  expect(next).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
