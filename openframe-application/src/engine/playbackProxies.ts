import type { Asset } from "../lib/project/types";
import { proxySource, proxyState, type ProxyHealth, type SourcePurpose } from "../lib/proxyPolicy";
import { platform } from "../platform";

const health = new Map<string, ProxyHealth>();
const checking = new Map<string, Promise<void>>();
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
  const work = platform.playbackProxyInfo(a).then((h) => { health.set(k, h); })
    .catch(() => { health.set(k, { exists: false }); })
    .finally(() => { checking.delete(k); notify(); });
  checking.set(k, work);
  return work;
}
export function missingPlaybackProxy(a: Asset) { health.set(key(a), { ...known(a), exists: false }); notify(); }
export function sourceForPurpose(a: Asset, purpose: SourcePurpose, on = true): string {
  void checkPlaybackProxy(a);
  return proxySource(a, purpose, on, known(a));
}
