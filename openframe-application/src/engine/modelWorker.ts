import { createIdleLease } from "../lib/memory";
import { memoryOwners } from "./memory";

export const MODEL_IDLE_MS = 120000;

/** A lease covers the entire operation (load plus all inference windows).
 * Termination frees WASM heaps and GPU sessions as well as model weights. */
export function modelWorker(name: string, make: () => Worker) {
  let worker: Worker | null = null, controller = new AbortController();
  let chain: Promise<unknown> = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined;
  let bytes = 0, model = "";
  const lease = createIdleLease(MODEL_IDLE_MS);
  const reset = (endSession = true) => {
    clearTimeout(timer);
    if (endSession) { controller.abort(); controller = new AbortController(); }
    worker?.terminate(); worker = null; bytes = 0; model = ""; lease.clear();
  };
  memoryOwners.register(name, () => ({ bytes, count: worker ? 1 : 0, estimated: true, detail: model || "unloaded" }), reset);
  return {
    run<T>(key: string, estimate: number, work: (worker: Worker, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
      const session = controller.signal;
      const task = chain.catch(() => {}).then(async () => {
        session.throwIfAborted(); signal?.throwIfAborted();
        clearTimeout(timer);
        if (model && model !== key) reset(false);
        worker ??= make(); model = key; bytes = estimate; lease.begin(key);
        const active = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
        try { return await work(worker, active); }
        catch (e) { reset(false); throw e; }
        finally {
          lease.end();
          if (worker) timer = setTimeout(() => { if (lease.expired()) reset(false); }, MODEL_IDLE_MS);
        }
      });
      chain = task.then(() => {}, () => {});
      return task;
    },
    reset,
  };
}
