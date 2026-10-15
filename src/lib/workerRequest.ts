// One worker RPC, including failures before the worker's message handler loads.
export function workerRequest<T>(
  worker: Worker,
  message: { id: number; [key: string]: unknown },
  options: { onDownload?: (progress: number) => void; transfer?: Transferable[]; signal?: AbortSignal } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      options.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (error: unknown) => { cleanup(); reject(error); };
    const onAbort = () => fail(new DOMException("Canceled", "AbortError"));
    const onError = (e: ErrorEvent) => fail(new Error(e.message || "Background processing couldn't start. Try again."));
    const onMessageError = () => fail(new Error("Background processing returned an unreadable response. Try again."));
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.id !== message.id) return;
      if (m.type === "download") options.onDownload?.(m.progress);
      else {
        cleanup();
        if (m.type === "error") reject(new Error(m.message));
        else resolve(m as T);
      }
    };
    if (options.signal?.aborted) { onAbort(); return; }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    options.signal?.addEventListener("abort", onAbort);
    try { worker.postMessage(message, options.transfer ?? []); }
    catch (e) { fail(e); }
  });
}
