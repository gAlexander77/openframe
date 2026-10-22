import { describe, expect, it } from "vitest";
import { heavyMedia, normalizePlaybackProxy, proxySource, proxyState, type SourcePurpose } from "./proxyPolicy";
import { normalizeProject } from "./project/defaults";
import { relinkAsset } from "./project/relink";
import type { Asset } from "./project/types";

const proxy = { src: "small.mp4", width: 960, height: 540, size: "half" as const, fingerprint: "original|100|123" };
const asset: Asset = { id: "a", name: "Heavy", kind: "video", src: "original.mov", proxy: "fallback.mp4", duration: 10, hasVideo: true, hasAudio: true, playbackProxy: proxy };
const viewing: SourcePurpose[] = ["preview", "thumbnail", "filmstrip"];
const delivery: SourcePurpose[] = ["export", "still", "preview_frame", "analysis", "scopes"];

describe("purpose-aware source selection", () => {
  for (const purpose of [...viewing, ...delivery]) {
    it(`${purpose} chooses its permitted source and preserves legacy media`, () => {
      expect(proxySource(asset, purpose, true)).toBe(viewing.includes(purpose) ? proxy.src : asset.proxy);
      expect(proxySource({ ...asset, proxy: undefined }, purpose, true)).toBe(viewing.includes(purpose) ? proxy.src : asset.src);
      expect(proxySource(asset, purpose, false)).toBe(asset.proxy);
      expect(proxySource({ ...asset, playbackProxy: undefined }, purpose, true)).toBe(asset.proxy);
      expect(proxySource({ ...asset, proxy: undefined, playbackProxy: undefined }, purpose, true)).toBe(asset.src);
      for (const health of [{ fingerprint: "replaced" }, { exists: false }, { fingerprint: "replaced", exists: false }]) {
        expect(proxySource(asset, purpose, true, health)).toBe(asset.proxy);
        expect(proxySource({ ...asset, proxy: undefined }, purpose, true, health)).toBe(asset.src);
      }
    });
  }
  it("reports machine-local health, with a missing cache taking priority", () => {
    expect(proxyState(asset, { fingerprint: proxy.fingerprint, exists: true })).toBe("ready");
    expect(proxyState(asset, { exists: false })).toBe("missing");
    expect(proxyState(asset, { fingerprint: "new", exists: false })).toBe("missing");
    expect(proxyState(asset, { fingerprint: "new", exists: true })).toBe("stale");
    expect(proxyState({ ...asset, playbackProxy: undefined })).toBeUndefined();
  });
  it("retains a relinked proxy reference but refuses its old fingerprint", () => {
    const p = normalizeProject({ assets: [asset] });
    const relinked = relinkAsset(p, asset.id, { ...asset, src: "replacement.mov" }).assets[0];
    expect(relinked.playbackProxy).toEqual(proxy);
    expect(proxySource(relinked, "preview", true, { fingerprint: "replacement|100|123" })).toBe(asset.proxy);
  });
});

it("drops malformed playback proxies at the project trust boundary", () => {
  const invalid: unknown[] = [null, [], "small.mp4", {}, { ...proxy, src: "" }, { ...proxy, src: 2 },
    { ...proxy, fingerprint: " " }, { ...proxy, size: "eighth" }, { ...proxy, width: NaN }, { ...proxy, height: Infinity },
    { ...proxy, width: 0 }, { ...proxy, height: -1 }, { ...proxy, width: 12.5 }];
  for (const playbackProxy of invalid) {
    expect(normalizePlaybackProxy(playbackProxy)).toBeUndefined();
    expect(normalizeProject({ assets: [{ ...asset, playbackProxy }] }).assets[0]).not.toHaveProperty("playbackProxy");
  }
  expect(normalizeProject({ assets: [asset] }).assets[0].playbackProxy).toEqual(proxy);
  expect(normalizeProject({ assets: [{ ...asset, futureField: "kept" }] }).assets[0]).toHaveProperty("futureField", "kept");
});

it("offers the heavy-media hint for 4K, portrait 4K, HEVC and ProRes video", () => {
  for (const patch of [{ width: 3840 }, { height: 4096 }, { videoCodec: "hevc" }, { videoCodec: "prores" }]) expect(heavyMedia({ ...asset, ...patch })).toBe(true);
  expect(heavyMedia({ ...asset, width: 1920, height: 1080, videoCodec: "avc" })).toBe(false);
  expect(heavyMedia({ ...asset, kind: "image", width: 8000 })).toBe(false);
});
