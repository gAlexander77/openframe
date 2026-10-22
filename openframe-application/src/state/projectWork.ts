import { memoryOwners } from "../engine/memory";
import { createTaskScope } from "../lib/taskScope";

const scope = createTaskScope();
let current: AbortSignal | undefined;
export const projectWork = {
  ...scope,
  open() { scope.close(); memoryOwners.endSession().forEach(e => console.warn("Memory cleanup failed:", e)); scope.open(); },
  close() { scope.close(); memoryOwners.endSession().forEach(e => console.warn("Memory cleanup failed:", e)); },
  capture: () => current ?? scope.signal(),
  /** Entry points capture their signal before the first await. Only the
   * synchronous invocation is bound; concurrent jobs never share context. */
  within<T>(signal: AbortSignal, work: () => T): T {
    const previous = current;
    current = AbortSignal.any([scope.signal(), signal]);
    try { return work(); } finally { current = previous; }
  },
};
