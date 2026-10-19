/** A document session, not a project ID: reopening the same ID is new work. */
export function createTaskScope() {
  let controller = new AbortController();
  controller.abort();
  return {
    signal: () => controller.signal,
    open() {
      controller.abort();
      controller = new AbortController();
    },
    close() { controller.abort(); },
  };
}
