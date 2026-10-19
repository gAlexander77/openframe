import type { Id, Marker, Project } from "./project/types";
import { formatTimecode, type Rational } from "./time";

/** Markers are absolute timeline notes; moving one never moves a clip. */
export function updateMarker(p: Project, id: Id, patch: Partial<Pick<Marker, "frame" | "label" | "color">>): Project {
  const marker = p.markers.find((m) => m.id === id);
  if (!marker) throw new Error(`No marker with id ${id}`);
  if (patch.frame !== undefined && (!Number.isSafeInteger(patch.frame) || patch.frame < 0)) throw new Error("Marker position must be a nonnegative integer frame");
  const next = { ...marker, ...patch };
  if (next.frame === marker.frame && next.label === marker.label && next.color === marker.color) return p;
  return { ...p, markers: p.markers.map((m) => m.id === id ? next : m).sort((a, b) => a.frame - b.frame) };
}

export function deleteMarkers(p: Project, ids: Id[]): Project {
  const chosen = new Set(ids);
  for (const id of chosen) if (!p.markers.some((m) => m.id === id)) throw new Error(`No marker with id ${id}`);
  if (!chosen.size) return p;
  return { ...p, markers: p.markers.filter((m) => !chosen.has(m.id)) };
}

export function filterMarkers(markers: Marker[], fps: Rational, query: string, color = ""): Marker[] {
  const q = query.trim().toLowerCase();
  return markers.filter((m) => (!color || m.color === color) &&
    (!q || m.label.toLowerCase().includes(q) || formatTimecode(m.frame, fps).includes(q)))
    .sort((a, b) => a.frame - b.frame);
}

/** Loaded JSON can list markers in any order, including coincident ones. */
export function adjacentMarker(markers: Marker[], frame: number, direction: -1 | 1): Marker | undefined {
  return markers.filter((m) => direction * (m.frame - frame) > 0)
    .sort((a, b) => direction * (a.frame - b.frame))[0];
}
