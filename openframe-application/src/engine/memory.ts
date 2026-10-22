import { createMemoryRegistry } from "../lib/memory";

export const memoryOwners = createMemoryRegistry();
export const MiB = 2 ** 20;
export function trackCache(name: string, cache: { bytes: number; size: number; budget: number; clear(): void }) {
  memoryOwners.register(name, () => ({ bytes: cache.bytes, count: cache.size, budget: cache.budget }), () => cache.clear());
}
export function memorySnapshot() {
  const kinds = memoryOwners.snapshot();
  return { kinds, total_known_bytes: Object.values(kinds).reduce((sum, kind) => sum + kind.bytes, 0),
    note: "Known retained resources; estimates exclude browser/driver allocations, model runtime scratch and decoder queues. Use process memory alongside this readout." };
}
