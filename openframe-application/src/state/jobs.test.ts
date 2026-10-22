import { afterEach, expect, it, vi } from "vitest";
import { createJobRegistry } from "../lib/jobs";
import { projectWork } from "./projectWork";
import { runJob } from "./jobs";
import { dismiss, observeProgress, toast, updateToast } from "./toast";

afterEach(() => { projectWork.close(); vi.restoreAllMocks(); });
it("binds each operation's captured signal and progress without leaking into concurrent work", async () => {
  projectWork.open();
  const document = projectWork.signal(), jobs = createJobRegistry();
  let release!: () => void, first!: AbortSignal, second!: AbortSignal, notice = 0;
  const gate = new Promise<void>(r => { release = r; });
  const a = jobs.start("one", "p", document, c => runJob(c, async () => {
    first = projectWork.capture(); notice = toast("Reading audio", "progress");
    await gate;
    updateToast(notice, { progress: 0.4, text: "Listening" });
    first.throwIfAborted();
    return "first";
  }));
  const b = jobs.start("two", "p", document, c => runJob(c, async () => {
    second = projectWork.capture();
    return "second";
  }));
  await jobs.wait(b, 1);
  expect(projectWork.signal()).toBe(document);
  expect(first).not.toBe(second);
  release();
  await jobs.wait(a, 1);
  expect(jobs.status(a)).toMatchObject({ state: "done", result: "first" });
  dismiss(notice);
});
it("routes post-await progress by toast ID and removes the observer", () => {
  const report = vi.fn(), action = { label: "Cancel", run: vi.fn() };
  const owner = observeProgress(report, action);
  const id = owner.bind(() => toast("Decoding", "progress"));
  updateToast(id, { progress: 0.75, text: "Listening" });
  expect(report).toHaveBeenLastCalledWith(0.75, "Listening");
  owner.dispose();
  updateToast(id, { progress: 1 });
  expect(report).toHaveBeenCalledTimes(2);
  dismiss(id);
});


it("canceling an operation aborts its captured signal and prevents its delayed edit", async () => {
  projectWork.open();
  const jobs = createJobRegistry();
  let release!: () => void, captured!: AbortSignal, edits = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const id = jobs.start("one", "p", projectWork.signal(), context => runJob(context, async () => {
    captured = projectWork.capture();
    await gate;
    captured.throwIfAborted();
    edits++;
    return "changed";
  }));
  await Promise.resolve();
  jobs.cancel(id);
  expect(captured.aborted).toBe(true);
  expect(projectWork.signal().aborted).toBe(false);
  release();
  await jobs.wait(id, 1);
  expect(edits).toBe(0);
  expect(jobs.status(id).state).toBe("canceled");
});
