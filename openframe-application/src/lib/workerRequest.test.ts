import { describe, expect, it, vi } from "vitest";
import { workerRequest } from "./workerRequest";

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  get worker() { return this as unknown as Worker; }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

describe("workerRequest", () => {
  it("routes replies by id, reports download progress, and stops listening after completion", async () => {
    const w = new FakeWorker();
    const progress = vi.fn();
    const result = workerRequest(w.worker, { id: 7, type: "load" }, { onDownload: progress });
    w.reply({ id: 8, type: "ready" });
    w.reply({ id: 7, type: "download", progress: 0.5 });
    w.reply({ id: 7, type: "ready", device: "wasm" });
    await expect(result).resolves.toEqual({ id: 7, type: "ready", device: "wasm" });
    w.reply({ id: 7, type: "download", progress: 1 });
    expect(progress.mock.calls).toEqual([[0.5]]);
  });

  it("rejects worker startup errors without waiting for a reply", async () => {
    const w = new FakeWorker();
    const progress = vi.fn();
    const result = workerRequest(w.worker, { id: 1, type: "load" }, { onDownload: progress });
    const error = Object.assign(new Event("error"), { message: "Module failed to load" });
    w.dispatchEvent(error);
    await expect(result).rejects.toThrow("Module failed to load");
    w.reply({ id: 1, type: "download", progress: 1 });
    expect(progress).not.toHaveBeenCalled();
  });

  it("rejects unreadable and worker-reported failures", async () => {
    const w = new FakeWorker();
    const unreadable = workerRequest(w.worker, { id: 1 });
    w.dispatchEvent(new Event("messageerror"));
    await expect(unreadable).rejects.toThrow("unreadable response");
    const failed = workerRequest(w.worker, { id: 2 });
    w.reply({ id: 2, type: "error", message: "Model download failed" });
    await expect(failed).rejects.toThrow("Model download failed");
  });

  it("cancels a pending request and ignores late progress", async () => {
    const w = new FakeWorker();
    const controller = new AbortController();
    const progress = vi.fn();
    const result = workerRequest(w.worker, { id: 1 }, { signal: controller.signal, onDownload: progress });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    w.reply({ id: 1, type: "download", progress: 1 });
    expect(progress).not.toHaveBeenCalled();
  });

  it("does not send an already-canceled request and surfaces postMessage failures", async () => {
    const w = new FakeWorker();
    const controller = new AbortController();
    controller.abort();
    await expect(workerRequest(w.worker, { id: 1 }, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(w.postMessage).not.toHaveBeenCalled();
    w.postMessage.mockImplementation(() => { throw new Error("Cannot transfer buffer"); });
    await expect(workerRequest(w.worker, { id: 2 })).rejects.toThrow("Cannot transfer buffer");
  });
});
