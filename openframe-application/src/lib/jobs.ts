/** Session jobs keep their complete tool answer until the retention window
 * expires. Cancellation wins even when an underlying worker settles later. */
export interface JobContext {
  tool: string;
  signal: AbortSignal;
  cancel: () => void;
  progress: (fraction: number, stage?: string) => void;
}
export interface JobStatus<T = unknown> {
  job_id: string;
  tool: string;
  project_id: string;
  started_at: number;
  updated_at: number;
  state: "running" | "done" | "failed" | "canceled";
  progress: number;
  stage: string;
  elapsed_seconds: number;
  quiet_seconds: number;
  result?: T;
  error?: string;
}
export function createJobRegistry<T = unknown>(now = Date.now, retention = 30 * 60_000) {
  let next = 0;
  const jobs = new Map<string, { status: JobStatus<T>; controller: AbortController; finished?: number; done: Promise<void> }>();
  const prune = () => { for (const [id, j] of jobs) if (j.finished !== undefined && now() - j.finished >= retention) jobs.delete(id); };
  const status = (id: string): JobStatus<T> => {
    prune();
    const j = jobs.get(id);
    if (!j) throw new Error(`Unknown or expired job ${id}; job_status lists recent jobs`);
    return { ...j.status, elapsed_seconds: +(((j.finished ?? now()) - j.status.started_at) / 1000).toFixed(3), quiet_seconds: +(((j.finished ?? now()) - j.status.updated_at) / 1000).toFixed(3) };
  };
  const cancel = (id: string) => {
    const j = jobs.get(id);
    if (!j) return status(id);
    if (j.status.state === "running") {
      j.status.state = "canceled"; j.status.stage = "Canceled"; j.finished = now();
      j.controller.abort();
    }
    return status(id);
  };
  return {
    status,
    all: () => { prune(); return [...jobs.keys()].map(status); },
    cancel,
    start(tool: string, project: string, scope: AbortSignal | undefined, work: (context: JobContext) => Promise<T>) {
      prune();
      // Tools with singleton engines must return their existing job even
      // when a retry sends different arguments.
      const existing = [...jobs.values()].find(j => j.status.tool === tool && j.status.project_id === project && j.status.state === "running");
      if (existing) return existing.status.job_id;
      const id = `job_${now().toString(36)}_${++next}`, controller = new AbortController();
      const j = { status: { job_id: id, tool, project_id: project, started_at: now(), updated_at: now(), state: "running", progress: 0, stage: "Starting", elapsed_seconds: 0, quiet_seconds: 0 } as JobStatus<T>, controller, finished: undefined as number | undefined, done: Promise.resolve() };
      jobs.set(id, j);
      const abort = () => cancel(id);
      scope?.addEventListener("abort", abort, { once: true });
      if (scope?.aborted) abort();
      j.done = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        const result = await work({ tool, signal: controller.signal, cancel: () => { cancel(id); }, progress: (fraction, stage) => {
          if (j.status.state !== "running") return;
          j.status.updated_at = now();
          if (Number.isFinite(fraction)) j.status.progress = Math.max(0, Math.min(1, fraction));
          if (stage) j.status.stage = stage;
        } });
        if (j.status.state === "running") { j.status.result = result; j.status.state = "done"; j.status.progress = 1; j.status.stage = "Done"; }
      }).catch(e => {
        if (j.status.state !== "running") return;
        j.status.state = "failed"; j.status.stage = "Failed"; j.status.error = e instanceof Error ? e.message : String(e);
      }).finally(() => { j.finished ??= now(); scope?.removeEventListener("abort", abort); });
      return id;
    },
    async wait(id: string, seconds: number): Promise<JobStatus<T>> {
      const j = jobs.get(id);
      if (!j) return status(id);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort = () => {};
      const canceled = new Promise<void>(resolve => {
        abort = resolve;
        if (j.controller.signal.aborted) resolve();
        else j.controller.signal.addEventListener("abort", abort, { once: true });
      });
      await Promise.race([j.done, canceled, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, Math.min(45, seconds)) * 1000); })]);
      clearTimeout(timer);
      j.controller.signal.removeEventListener("abort", abort);
      return status(id);
    },
  };
}
export type JobRegistry = ReturnType<typeof createJobRegistry>;
