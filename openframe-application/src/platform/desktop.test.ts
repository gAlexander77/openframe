import { beforeEach, expect, it, vi } from "vitest";
const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: vi.fn(), Channel: class { onmessage?: (value: unknown) => void } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import { desktop } from "./desktop";
beforeEach(() => { ipc.invoke.mockReset(); ipc.invoke.mockResolvedValue(undefined); });
it("calls every describer command, maps maxTokens, and delivers prepare progress through on_progress", async () => {
  await desktop.describer!.status(); expect(ipc.invoke).toHaveBeenLastCalledWith("describer_status");
  const progress = vi.fn(); await desktop.describer!.prepare(progress);
  expect(ipc.invoke).toHaveBeenLastCalledWith("describer_prepare", { on_progress: expect.any(Object) });
  const channel = ipc.invoke.mock.calls.at(-1)![1].on_progress;
  channel.onmessage({ stage: "model", fraction: 0.5, bytes: 10, total: 20 }); expect(progress).toHaveBeenCalledWith({ stage: "model", fraction: 0.5, bytes: 10, total: 20 });
  await desktop.describer!.ask({ images: ["jpeg"], prompt: "question", maxTokens: 300, schema: { type: "object" } });
  expect(ipc.invoke).toHaveBeenLastCalledWith("describer_ask", { request: { images: ["jpeg"], prompt: "question", max_tokens: 300, schema: { type: "object" } } });
  await desktop.describer!.ask({ images: [], prompt: "q" }); expect(ipc.invoke.mock.calls.at(-1)![1].request).toMatchObject({ schema: null, max_tokens: null });
  await desktop.describer!.stop(); expect(ipc.invoke).toHaveBeenLastCalledWith("describer_stop");
});
it("uses path, times, width and json exactly for native frames and persistence", async () => {
  await desktop.shotlog!.frames("source.mp4", [1, 2, 3], 768); expect(ipc.invoke).toHaveBeenLastCalledWith("shotlog_frames", { path: "source.mp4", times: [1, 2, 3], width: 768 });
  await desktop.shotlog!.load("source.mp4"); expect(ipc.invoke).toHaveBeenLastCalledWith("shotlog_load", { path: "source.mp4" });
  await desktop.shotlog!.save("source.mp4", "{}"); expect(ipc.invoke).toHaveBeenLastCalledWith("shotlog_save", { path: "source.mp4", json: "{}" });
});
it("measures with a numeric progress channel and cancels the job when its signal aborts", async () => {
  let resolve!: (v: unknown) => void;
  ipc.invoke.mockImplementation((name: string) => name === "shotlog_measure" ? new Promise(r => { resolve = r; }) : Promise.resolve());
  const abort = new AbortController(), progress = vi.fn();
  const task = desktop.shotlog!.measure("source.mp4", progress, abort.signal);
  expect(ipc.invoke).toHaveBeenLastCalledWith("shotlog_measure", { path: "source.mp4", job: expect.any(String), on_progress: expect.any(Object) });
  const { job, on_progress } = ipc.invoke.mock.calls[0][1]; on_progress.onmessage(0.3); expect(progress).toHaveBeenCalledWith(0.3);
  abort.abort(); expect(ipc.invoke).toHaveBeenLastCalledWith("shotlog_cancel", { job }); resolve({});
  await expect(task).rejects.toThrow();
  const count = ipc.invoke.mock.calls.length; abort.abort(); expect(ipc.invoke).toHaveBeenCalledTimes(count);
});
it("does not start an already canceled measurement and cleans up on native failure", async () => {
  const abort = new AbortController(); abort.abort();
  await expect(desktop.shotlog!.measure("a", vi.fn(), abort.signal)).rejects.toThrow(); expect(ipc.invoke).not.toHaveBeenCalled();
  const live = new AbortController(); ipc.invoke.mockRejectedValueOnce(new Error("decode failed"));
  await expect(desktop.shotlog!.measure("a", vi.fn(), live.signal)).rejects.toThrow("decode failed");
  live.abort(); expect(ipc.invoke).toHaveBeenCalledTimes(1);
});
