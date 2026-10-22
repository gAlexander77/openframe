import { useSyncExternalStore } from "react";
import { missingPlaybackProxy, checkPlaybackProxy, playbackProxyState, proxyHealth } from "../engine/playbackProxies";
import { prepare } from "../engine/thumbs";
import type { Asset, PlaybackProxy, PlaybackProxySize } from "../lib/project/types";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

const making = new Set<string>();
let revision = 0;
const listeners = new Set<() => void>();
const notify = () => { revision++; listeners.forEach((l) => l()); };
proxyHealth.subscribe(notify);
export function useProxies() {
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => revision);
}
export const proxyStatus = (a: Asset) => making.has(a.id) ? "making" : playbackProxyState(a);
export const proxyDetails = (a: Asset) => proxyStatus(a) ? `Proxy: ${proxyStatus(a)}${a.playbackProxy ? ` · ${a.playbackProxy.size} · ${a.playbackProxy.width}×${a.playbackProxy.height}` : ""}` : "No playback proxy";
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
export const proxyAction = (work: Promise<unknown>) => {
  void work.then((answer) => {
    if (!Array.isArray(answer)) return;
    const errors = answer.filter((r) => r.error);
    if (errors.length) toast(errors.map((r) => `${r.asset_id}: ${r.error}`).join("; "), "error");
    else if (answer.length) toast(`Playback proxies updated for ${answer.length} ${answer.length === 1 ? "video" : "videos"}`);
  }).catch((e) => toast(errorText(e), "error"));
};

let signature = "";
let lastAssets: Asset[] | undefined;
let session: AbortSignal | undefined;
store.subscribe(() => {
  const signal = projectWork.signal();
  const assets = store.document().assets;
  if (lastAssets === assets && signal === session) return;
  lastAssets = assets;
  const next = JSON.stringify(assets.map((a) => [a.src, a.playbackProxy]));
  if (next === signature && signal === session) return;
  signature = next; session = signal;
  for (const a of assets) void checkPlaybackProxy(a, true);
});

function chosen(ids: string[]): Asset[] {
  if (platform.kind !== "desktop") throw new Error("Playback proxies are not available in the browser build. Use the desktop app.");
  if (!ids.length) throw new Error("Choose at least one media asset.");
  return [...new Set(ids)].map((id) => {
    const a = store.document().assets.find((a) => a.id === id);
    if (!a) throw new Error(`Unknown asset: ${id}`);
    if (a.kind !== "video") throw new Error(`${a.name}: playback proxies need video media.`);
    return a;
  });
}

// All UI and MCP batches share one serial queue; FFmpeg never competes with
// another proxy job in this webview. Capture ownership before joining it.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work);
  queue = next.catch(() => undefined);
  return next;
}
export function createProxies(ids: string[], size: PlaybackProxySize = "half") {
  const assets = chosen(ids);
  const signal = projectWork.signal();
  return serial(async () => {
    if (signal.aborted) throw new Error("The project closed before the proxy batch started.");
    const cancel = new AbortController();
    const abort = () => cancel.abort();
    signal.addEventListener("abort", abort, { once: true });
    const made = new Map<string, { original: Asset; proxy: PlaybackProxy }>();
    const results: { asset_id: string; proxy: string; size?: PlaybackProxySize; seconds: number; error?: string }[] = [];
    const notice = toast("Creating playback proxies", "progress", 0, { label: "Cancel", run: abort });
    try {
      for (const a of assets) {
        if (cancel.signal.aborted) break;
        const current = store.document().assets.find((x) => x.id === a.id);
        if (!current || current.src !== a.src) {
          results.push({ asset_id: a.id, proxy: current ? playbackProxyState(current) ?? "none" : "none", seconds: 0, error: "The source changed before its proxy job started." });
          continue;
        }
        making.add(a.id); notify();
        const started = performance.now();
        try {
          updateToast(notice, { text: `Creating ${size} proxy: ${a.name}`, progress: 0 });
          const proxy = await platform.makePlaybackProxy(current, size, (progress) => updateToast(notice, { progress }), cancel.signal);
          if (!cancel.signal.aborted) {
            made.set(a.id, { original: current, proxy });
            results.push({ asset_id: a.id, proxy: "ready", size, seconds: (performance.now() - started) / 1000 });
          }
        } catch (e) {
          results.push({ asset_id: a.id, proxy: playbackProxyState(a) ?? "none", size: a.playbackProxy?.size, seconds: (performance.now() - started) / 1000, error: errorText(e) });
        } finally { making.delete(a.id); notify(); }
      }
      if (!signal.aborted && made.size) {
        // Metadata only: no magnetic timeline settle, one undo step per batch.
        store.editDocument("Create playback proxies", (p) => ({ ...p, assets: p.assets.map((a) => {
          const m = made.get(a.id);
          return m && a.src === m.original.src && a.playbackProxy === m.original.playbackProxy ? { ...a, playbackProxy: m.proxy } : a;
        }) }));
        for (const a of store.document().assets) if (made.has(a.id)) { await checkPlaybackProxy(a, true); prepare(a); }
      }
      if (cancel.signal.aborted) for (const a of assets) if (!results.some((r) => r.asset_id === a.id)) results.push({ asset_id: a.id, proxy: playbackProxyState(a) ?? "none", size: a.playbackProxy?.size, seconds: 0, error: "canceled" });
      return results.map((r) => {
        if (r.error) return r;
        const a = store.document().assets.find((a) => a.id === r.asset_id);
        const expected = made.get(r.asset_id)?.proxy;
        if (signal.aborted || a?.playbackProxy?.src !== expected?.src) return { ...r, proxy: a ? playbackProxyState(a) ?? "none" : "none", error: signal.aborted ? "canceled" : "The source changed while making its proxy." };
        return { ...r, proxy: playbackProxyState(a!), size: a!.playbackProxy!.size };
      });
    } finally { signal.removeEventListener("abort", abort); dismiss(notice); }
  });
}
export function deleteProxies(ids: string[]) {
  chosen(ids);
  const signal = projectWork.signal();
  return serial(async () => {
    if (signal.aborted) throw new Error("The project closed before the proxy batch started.");
    const assets = chosen(ids);
    const removed = new Set<string>();
    const results = [];
    for (const a of assets) {
      if (signal.aborted) break;
      const started = performance.now();
      try {
        if (a.playbackProxy) {
          await platform.deletePlaybackProxy(a.playbackProxy.src);
          missingPlaybackProxy(a);
          removed.add(a.id);
        }
        results.push({ asset_id: a.id, proxy: "none", size: a.playbackProxy?.size, seconds: (performance.now() - started) / 1000 });
      } catch (e) { results.push({ asset_id: a.id, proxy: playbackProxyState(a) ?? "none", size: a.playbackProxy?.size, seconds: (performance.now() - started) / 1000, error: errorText(e) }); }
    }
    if (signal.aborted) for (const a of assets) if (!results.some((r) => r.asset_id === a.id)) results.push({ asset_id: a.id, proxy: playbackProxyState(a) ?? "none", size: a.playbackProxy?.size, seconds: 0, error: "canceled" });
    if (!signal.aborted && removed.size) store.editDocument("Delete playback proxies", (p) => ({ ...p, assets: p.assets.map((a) => {
      const original = assets.find((x) => x.id === a.id);
      if (!removed.has(a.id) || a.playbackProxy !== original?.playbackProxy) return a;
      const { playbackProxy: _proxy, ...rest } = a;
      return rest;
    }) }));
    return results.map((r) => {
      if (r.error) return r;
      const a = store.document().assets.find((a) => a.id === r.asset_id);
      return { ...r, proxy: a ? playbackProxyState(a) ?? "none" : "none" };
    });
  });
}
