// Getting .cube LUTs into the project (ADR-021): read and validate each file
// once, list it in project.luts by where it lives, and hand the parsed table
// to the engine so the first graded frame does not read it again. Shared by
// the LUT tab, OS drag and drop, and the automation API.

import { primeLut } from "../engine/luts";
import { parseCube } from "../lib/lut";
import { uid } from "../lib/project/defaults";
import type { Id, LutFile } from "../lib/project/types";
import { platform } from "../platform";
import { store } from "./store";
import { toast } from "./toast";
import { projectWork } from "./projectWork";

export const isLutName = (name: string) => /\.cube$/i.test(name);

/** Import LUT files; returns the ones that parsed. With `applyTo`, the
 * first one is also put on that clip at full intensity, in the same undo
 * step (what picking a file in the LUT tab means). */
export async function importLuts(files: { name: string; src: string }[], applyTo?: Id, signal = projectWork.signal()): Promise<LutFile[]> {
  if (signal.aborted) return [];
  const added: LutFile[] = [];
  for (const f of files) {
    try {
      const lut = parseCube(await (await platform.blobFor(f.src)).text());
      if (signal.aborted) return [];
      primeLut(f.src, lut);
      added.push({ id: uid("lut"), name: f.name, src: f.src, kind: lut.kind, size: lut.size });
    } catch (e) {
      if (signal.aborted) return [];
      toast(`${f.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  }
  if (!added.length) return added;
  store.edit(added.length === 1 ? `Import LUT ${added[0].name}` : `Import ${added.length} LUTs`, (p) => {
    const next = { ...p, luts: [...(p.luts ?? []), ...added] };
    if (!applyTo) return next;
    return {
      ...next,
      tracks: next.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === applyTo && "adjust" in c ? { ...c, adjust: { ...c.adjust, lut: { id: added[0].id, intensity: 1 } } } : c)),
      })),
    };
  });
  return added;
}
