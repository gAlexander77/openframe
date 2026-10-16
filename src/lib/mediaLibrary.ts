import type { Asset, AssetKind, Track } from "./project/types";

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

/** References count even on disabled clips or hidden/locked/muted tracks. */
export function mediaUsage(tracks: Track[]): Map<string, MediaUse[]> {
  const result = new Map<string, MediaUse[]>();
  for (const track of tracks) for (const clip of track.clips) {
    if (!("assetId" in clip)) continue;
    const uses = result.get(clip.assetId) ?? [];
    uses.push({ clipId: clip.id, start: clip.start });
    result.set(clip.assetId, uses);
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
      && asset.name.toLocaleLowerCase().includes(query)
      && (options.folder === null || (asset.folder ?? "") === options.folder)
      && (!options.favorites || asset.favorite === true)
      && (options.usage === "all" || (options.usage === "used" ? used : !used));
  });
  if (options.sort === "name" || options.sort === "name-desc") {
    const sign = options.sort === "name" ? 1 : -1;
    list.sort((a, b) => sign * a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
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
