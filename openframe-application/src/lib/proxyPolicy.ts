import type { Asset, PlaybackProxy } from "./project/types";

export type SourcePurpose = "preview" | "export" | "still" | "preview_frame" | "analysis" | "thumbnail" | "filmstrip" | "scopes";
export type ProxyState = "ready" | "stale" | "missing";
export interface ProxyHealth { fingerprint?: string; exists?: boolean }

/** Absence preserves legacy projects. Health is checked on this machine,
 * never saved into a traveling project. */
export function proxyState(asset: Asset, health: ProxyHealth = {}): ProxyState | undefined {
  const p = asset.playbackProxy;
  if (!p) return undefined;
  if (health.exists === false) return "missing";
  if (health.fingerprint !== undefined && p.fingerprint !== health.fingerprint) return "stale";
  return "ready";
}

/** Only disposable viewing pictures may use the smaller copy. */
export function proxySource(asset: Asset, purpose: SourcePurpose, playbackOn: boolean, health: ProxyHealth = {}): string {
  const mayProxy = purpose === "preview" || purpose === "thumbnail" || purpose === "filmstrip";
  return mayProxy && playbackOn && proxyState(asset, health) === "ready"
    ? asset.playbackProxy!.src : asset.proxy ?? asset.src;
}

export function normalizePlaybackProxy(raw: unknown): PlaybackProxy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.src !== "string" || !p.src.trim() || typeof p.fingerprint !== "string" || !p.fingerprint.trim()
    || typeof p.size !== "string" || !["half", "quarter", "720p"].includes(p.size)
    || typeof p.width !== "number" || !Number.isInteger(p.width) || p.width < 2
    || typeof p.height !== "number" || !Number.isInteger(p.height) || p.height < 2) return undefined;
  return { src: p.src, width: p.width, height: p.height, size: p.size as PlaybackProxy["size"], fingerprint: p.fingerprint };
}

export function heavyMedia(a: Asset): boolean {
  return a.kind === "video" && (Math.max(a.width ?? 0, a.height ?? 0) >= 3840 || /hevc|h265|prores/i.test(a.videoCodec ?? ""));
}
