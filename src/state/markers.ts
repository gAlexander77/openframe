import { store } from "./store";

export function openMarkers(id: string | null = null) {
  const marker = store.get().project.markers.find((m) => m.id === id);
  store.set({ leftTab: "markers", scopes: false, markerEdit: marker?.id ?? null,
    ...(marker ? { playhead: marker.frame, hoverFrame: null } : {}) });
}
