import { memoryOwners } from "./memory";
import type { Asset } from "../lib/project/types";
import { proxySource, proxyState, type ProxyHealth, type SourcePurpose } from "../lib/proxyPolicy";
import { platform } from "../platform";

const health = new Map<string, ProxyHealth>();
const checking = new Map<string, Promise<void>>();
let generation = 0;
memoryOwners.register("proxy_health", () => ({ bytes: 0, count: health.size }), () => { generation++; health.clear(); checking.clear(); });
const key = (a: Asset) => JSON.stringify([a.src, a.playbackProxy]);
let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach((l) => l()); };
export const proxyHealth = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  version: () => version,
};
const known = (a: Asset) => health.get(key(a)) ?? (platform.playbackProxyInfo ? { exists: false } : {});
export const originalFingerprint = (a: Asset) => health.get(key(a))?.fingerprint;
export const playbackProxyState = (a: Asset) => proxyState(a, known(a));

/** Recheck on project load/relink and before a batch operation. A missing
 * cache on another computer is ordinary: preview uses the original. */
export function checkPlaybackProxy(a: Asset, force = false): Promise<void> {
  if (!a.playbackProxy || !platform.playbackProxyInfo) return Promise.resolve();
  const k = key(a);
  const pending = checking.get(k);
  if (pending) return pending;
  if (!force && health.has(k)) return Promise.resolve();
  const session = generation;
  const work = platform.playbackProxyInfo(a).then((h) => { if (session === generation) health.set(k, h); })
    .catch(() => { if (session === generation) health.set(k, { exists: false }); })
    .finally(() => { if (session === generation) { checking.delete(k); notify(); } });
  checking.set(k, work);
  return work;
}
export function missingPlaybackProxy(a: Asset) { health.set(key(a), { ...known(a), exists: false }); notify(); }
export function sourceForPurpose(a: Asset, purpose: SourcePurpose, on = true): string {
  void checkPlaybackProxy(a);
  return proxySource(a, purpose, on, known(a));
}
