// Parsed .cube tables by source location, shared by preview and export
// (ADR-021). The project only names a LUT's file; resolveSources awaits
// loadPlanLuts for every LUT a frame uses, so by the time the synchronous
// compositor pass runs, lutFor(src) has the table ready to upload.

import { parseCube, type Lut } from "../lib/lut";
import type { PlanItem } from "../lib/render/plan";
import { platform } from "../platform";

const pending = new Map<string, Promise<Lut>>();
const ready = new Map<string, Lut>();
const warned = new Set<string>();

export function loadLut(src: string): Promise<Lut> {
  let p = pending.get(src);
  if (!p) {
    p = platform
      .blobFor(src)
      .then((b) => b.text())
      .then((text) => {
        const lut = parseCube(text);
        ready.set(src, lut);
        return lut;
      });
    // A failed read (file moved, OPFS cleared) is retried on the next frame.
    p.catch(() => pending.delete(src));
    pending.set(src, p);
  }
  return p;
}

/** The parsed table, if loaded. */
export const lutFor = (src: string): Lut | undefined => ready.get(src);

/** Seed the cache with a table parsed at import, so the file is read once. */
export function primeLut(src: string, lut: Lut) {
  ready.set(src, lut);
  pending.set(src, Promise.resolve(lut));
}

/** Load every LUT a plan uses. A LUT that cannot load renders as no LUT,
 * with one console warning, rather than failing the frame. */
export async function loadPlanLuts(plan: PlanItem[]): Promise<void> {
  const srcs = new Set<string>();
  for (const i of plan) {
    const grades = i.kind === "adjust" ? [i.grade] : i.kind === "layer" ? [i.layer.grade] : [i.from.grade, i.to.grade];
    for (const g of grades) if (g?.lut) srcs.add(g.lut.src);
  }
  await Promise.all(
    [...srcs].map((src) =>
      loadLut(src).catch((e) => {
        if (!warned.has(src)) console.warn(`LUT ${src} could not load:`, e);
        warned.add(src);
      }),
    ),
  );
}
