import type { Asset, AssetKind, Compound, Track } from "./project/types";
import { mediaName } from "./mediaKind";

export interface MediaBrowser {
  query: string;
  kind: "all" | AssetKind;
  usage: "all" | "used" | "unused";
  sort: "import" | "name" | "name-desc" | "duration" | "duration-desc";
  view: "grid" | "list";
  folder: string | null;
  favorites: boolean;
}

export const DEFAULT_MEDIA_BROWSER: MediaBrowser = { query: "", kind: "all", usage: "all", sort: "import", view: "grid", folder: null, favorites: false };
export interface MediaUse { clipId: string; start: number }

/** References count even on disabled clips or hidden/locked/muted tracks.
 * A file used inside a compound clip is used at the compound clip that
 * plays it, the clip on these tracks that shows it (ADR-037). */
export function mediaUsage(tracks: Track[], compounds: Compound[] = []): Map<string, MediaUse[]> {
  const result = new Map<string, MediaUse[]>();
  const add = (assetId: string, use: MediaUse) => {
    const uses = result.get(assetId) ?? [];
    if (!uses.some((u) => u.clipId === use.clipId)) uses.push(use);
    result.set(assetId, uses);
  };
  const inside = (id: string, use: MediaUse, seen: Set<string>) => {
    const k = compounds.find((x) => x.id === id);
    if (!k || seen.has(id)) return;
    for (const t of k.tracks) for (const c of t.clips) {
      if ("assetId" in c) add(c.assetId, use);
      else if (c.type === "compound") inside(c.compoundId, use, new Set([...seen, id]));
    }
  };
  for (const track of tracks) for (const clip of track.clips) {
    if ("assetId" in clip) add(clip.assetId, { clipId: clip.id, start: clip.start });
    else if (clip.type === "compound") inside(clip.compoundId, { clipId: clip.id, start: clip.start }, new Set());
  }
  for (const uses of result.values()) uses.sort((a, b) => a.start - b.start);
  return result;
}

/** A view over the imports; never reorder or annotate the saved assets. */
export function filterMedia(assets: Asset[], usage: Map<string, MediaUse[]>, options: MediaBrowser): Asset[] {
  const query = options.query.trim().toLocaleLowerCase();
  const list = assets.filter((asset) => {
    const used = (usage.get(asset.id)?.length ?? 0) > 0;
    return !asset.sticker && (options.kind === "all" || asset.kind === options.kind)
      && mediaName(asset).toLocaleLowerCase().includes(query)
      && (options.folder === null || (asset.folder ?? "") === options.folder)
      && (!options.favorites || asset.favorite === true)
      && (options.usage === "all" || (options.usage === "used" ? used : !used));
  });
  if (options.sort === "name" || options.sort === "name-desc") {
    const sign = options.sort === "name" ? 1 : -1;
    list.sort((a, b) => sign * mediaName(a).localeCompare(mediaName(b), undefined, { numeric: true, sensitivity: "base" }));
  } else if (options.sort === "duration" || options.sort === "duration-desc") {
    const duration = (a: Asset) => a.kind !== "image" && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : null;
    const sign = options.sort === "duration" ? 1 : -1;
    list.sort((a, b) => {
      const x = duration(a), y = duration(b);
      // Stills have no source duration; keep them last in both directions.
      return x === null ? (y === null ? 0 : 1) : y === null ? -1 : sign * (x - y);
    });
  }
  return list;
}
