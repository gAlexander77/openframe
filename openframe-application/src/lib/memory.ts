/** A byte budget, including native resources whose JS wrapper is tiny. */
export class ByteLru<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>();
  bytes = 0;
  constructor(readonly budget: number, private release: (value: V, key: K) => void = () => {}) {}
  get size() { return this.entries.size; }
  peek(key: K) { return this.entries.get(key)?.value; }
  get(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  has(key: K) { return this.entries.has(key); }
  set(key: K, value: V, bytes: number): boolean {
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error("Cache size must be finite and nonnegative");
    this.delete(key);
    if (bytes > this.budget) { this.release(value, key); return false; }
    while (this.bytes + bytes > this.budget && this.entries.size) this.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    return true;
  }
  delete(key: K) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.bytes -= entry.bytes;
    this.release(entry.value, key);
  }
  clear() { for (const key of this.entries.keys()) this.delete(key); }
}

/** An evicted resource stays alive until its last borrower finishes. This
 * bounds reusable bytes without closing an image halfway through a render. */
export class BorrowCache<K, V> {
  private entries = new Map<K, { pending: Promise<V>; value?: V; users: number; cached: boolean; bytes: number }>();
  private cache: ByteLru<K, { pending: Promise<V>; value?: V; users: number; cached: boolean; bytes: number }>;
  private generation = 0;
  constructor(readonly budget: number, private measure: (value: V) => number, private dispose: (value: V) => void) {
    this.cache = new ByteLru(budget, (entry, key) => { entry.cached = false; this.drop(key, entry); });
  }
  private drop(key: K, entry: { value?: V; users: number; cached: boolean }) {
    if (entry.cached || entry.users) return;
    if (this.entries.get(key) === entry) this.entries.delete(key);
    if (entry.value !== undefined) this.dispose(entry.value);
  }
  get bytes() { return this.cache.bytes; }
  get size() { return this.cache.size; }
  get borrowedBytes() { return [...this.entries.values()].filter(e => !e.cached).reduce((n, e) => n + e.bytes, 0); }
  async acquire(key: K, load: () => Promise<V>) {
    let entry = this.entries.get(key);
    if (!entry) {
      const generation = this.generation;
      const created = { pending: Promise.resolve(undefined as V) as Promise<V>, users: 0, cached: false, bytes: 0, value: undefined as V | undefined };
      entry = created;
      this.entries.set(key, entry);
      created.pending = Promise.resolve().then(load).then(value => {
        created.value = value; created.bytes = this.measure(value);
        if (generation === this.generation) { created.cached = true; this.cache.set(key, created, created.bytes); }
        return value;
      }, error => { if (this.entries.get(key) === created) this.entries.delete(key); throw error; });
    }
    entry.users++; this.cache.get(key);
    const borrowed = entry;
    const release = () => { if (!released) { released = true; borrowed.users--; this.drop(key, borrowed); } };
    let released = false;
    try { return { value: await entry.pending, release }; }
    catch (e) { release(); throw e; }
  }
  delete(key: K) { this.cache.delete(key); }
  clear() { this.generation++; this.cache.clear(); }
}

export interface MemoryReading { bytes: number; count: number; budget?: number; estimated?: boolean; detail?: string }

/** Conservative payload accounting for feature objects, without serializing
 * large arrays or counting structurally shared undo data twice. */
export function retainedBytes(value: unknown, seen = new Set<object>()): number {
  if (typeof value === "string") return value.length * 2;
  if (typeof value === "number") return 8;
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value instanceof Map) return [...value].reduce((n, [k, v]) => n + retainedBytes(k, seen) + retainedBytes(v, seen) + 32, 0);
  return Object.entries(value).reduce((n, [k, v]) => n + k.length * 2 + retainedBytes(v, seen) + 16, 32);
}

/** Owners register once; ending a session releases values, not the owners.
 * One broken disposer must not prevent the other resources from closing. */
export function createMemoryRegistry() {
  const owners = new Map<string, { read: () => MemoryReading; clear?: () => void }>();
  return {
    register(name: string, read: () => MemoryReading, clear?: () => void) {
      owners.set(name, { read, clear });
      return () => { owners.delete(name); };
    },
    endSession() {
      const errors: unknown[] = [];
      for (const owner of [...owners.values()]) { try { owner.clear?.(); } catch (e) { errors.push(e); } }
      return errors;
    },
    snapshot: () => Object.fromEntries([...owners].map(([name, owner]) => [name, owner.read()])),
  };
}

/** A model is replaceable only between operations; idle time starts after
 * the last operation, not when a long inference starts. */
export function createIdleLease(idleMs: number, now = Date.now) {
  let key: string | undefined, busy = 0, last = now();
  return {
    begin(next: string) { const replace = key !== undefined && key !== next; key = next; busy++; return replace; },
    end() { busy = Math.max(0, busy - 1); last = now(); },
    expired: () => busy === 0 && key !== undefined && now() - last >= idleMs,
    clear() { key = undefined; busy = 0; },
  };
}
