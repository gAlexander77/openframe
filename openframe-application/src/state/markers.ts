import { store } from "./store";
import { safeFileName } from "../lib/export";
import type { MarkerTextFormat } from "../lib/markerText";
import { platform } from "../platform";

export function openMarkers(id: string | null = null) {
  const marker = store.get().project.markers.find((m) => m.id === id);
  store.set({ leftTab: "markers", scopes: false, markerEdit: marker?.id ?? null,
    ...(marker ? { playhead: marker.frame, hoverFrame: null } : {}) });
}

/** File export uses the same platform boundary as movies and captions. */
export async function saveMarkerText(text: string, format: MarkerTextFormat): Promise<string | null> {
  const target = await platform.createExportTarget(safeFileName(`${store.get().project.name} ${format}`), "txt");
  if (!target) return null;
  const writer = target.writable.getWriter();
  try {
    await writer.write({ type: "write", data: new TextEncoder().encode(text + "\n"), position: 0 });
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  } finally {
    writer.releaseLock();
  }
  if (target.revealLabel) await target.reveal();
  return target.displayName;
}
