import { createJobRegistry, type JobContext } from "../lib/jobs";
import { projectWork } from "./projectWork";
import { dismiss, observeProgress, toast } from "./toast";

export const jobs = createJobRegistry();

/** Existing engine callbacks update their own toast. Observe those by ID
 * for the lifetime of the job, including callbacks after an await. */
export async function runJob<T>(context: JobContext, work: () => Promise<T>): Promise<T> {
  const label = `Running ${context.tool.replace(/_/g, " ")}…`;
  context.progress(0, label);
  const notice = toast(label, "progress", undefined, { label: "Cancel", run: context.cancel });
  const report = (fraction: number, stage?: string) => {
    context.progress(fraction, stage);
    // The engine's own toast now carries progress and Cancel. Keep the
    // fallback only for operations that do not raise a progress toast.
    dismiss(notice);
  };
  const stop = observeProgress(report, { label: "Cancel", run: context.cancel });
  const abort = () => dismiss(notice);
  context.signal.addEventListener("abort", abort, { once: true });
  try { return await projectWork.within(context.signal, () => stop.bind(work)); }
  finally { stop.dispose(); dismiss(notice); context.signal.removeEventListener("abort", abort); }
}
