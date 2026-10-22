import { ByteLru } from "../lib/memory";
import { MiB, trackCache } from "../engine/memory";
// The app's look at a project's shots before export_versions frames them
// (ADR-097): every full-frame video or picture on the timeline, sampled
// every half second (at most 24 times a shot), decoded 128 pixels wide and
// turned into a saliency map (lib/analysis/subject.ts). lib/reframe.ts
// places each version's crop on what the maps show. Maps are kept for the
// session by media and source second, so the check sheet and the export
// that follows it decode each picture once.

import { sourceFrames } from "../engine/analyze";
import { saliencyMap, type SaliencyMap } from "../lib/analysis/subject";
import { getAsset, sourceTimeAt } from "../lib/project/ops";
import type { Project, VisualClip } from "../lib/project/types";
import type { Looks } from "../lib/reframe";
import { secondsToFrames } from "../lib/time";
import { fillsFrame } from "../lib/versions";

const WIDTH = 128;
const PER_SHOT = 24;

/** Maps by media and source second, oldest first. */
const seen = new ByteLru<string, SaliencyMap>(32 * MiB);
trackCache("subject_features", seen);
const remember = (key: string, map: SaliencyMap) => {
  seen.set(key, map, map.v.byteLength);
};

/** The source seconds a shot is looked at: every half second of what it
 * plays (fewer on a long shot), and its last frame. A still once. */
function timesOf(p: Project, c: VisualClip): number[] {
  if (c.type === "image") return [0];
  if (c.type !== "video") return [];
  const half = secondsToFrames(0.5, p.fps);
  const step = Math.max(half, Math.ceil(c.duration / PER_SHOT));
  const rels: number[] = [];
  for (let rel = 0; rel < c.duration; rel += step) rels.push(rel);
  if (rels.at(-1) !== c.duration - 1) rels.push(c.duration - 1);
  return rels.map((rel) => +sourceTimeAt(c, c.start + rel, p.fps).toFixed(3));
}

/** The shots a version can crop: full-frame videos and pictures on the
 * visible tracks of the timeline (inside compound clips, the compound is
 * the picture). */
export function shotsToLook(p: Project): VisualClip[] {
  return p.tracks.filter((t) => t.kind === "video" && !t.hidden).flatMap((t) => t.clips.filter((c): c is VisualClip => (c.type === "video" || c.type === "image") && !c.disabled && fillsFrame(p, c)));
}

/** Look at every shot a version can crop: its saliency maps at timesOf.
 * A shot whose pictures cannot be decoded is left out (it keeps the
 * centered framing). */
export async function lookAtShots(p: Project, signal?: AbortSignal, shots = shotsToLook(p)): Promise<Looks> {
  const looks: Looks = {};
  const canvas = new OffscreenCanvas(WIDTH, WIDTH);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const c of shots) {
    signal?.throwIfAborted();
    if (c.type !== "video" && c.type !== "image") continue;
    const asset = getAsset(p, c.assetId);
    if (!asset?.width || !asset.height) continue;
    const times = timesOf(p, c);
    const key = (t: number) => `${asset.id}@${t}`;
    const missing = times.filter((t) => !seen.has(key(t)));
    if (missing.length) {
      try {
        const pics = await sourceFrames(asset, missing, WIDTH, signal);
        for (const [i, pic] of pics.entries()) {
          signal?.throwIfAborted();
          if (!pic) continue;
          const w = WIDTH, h = Math.max(8, Math.round((WIDTH * asset.height) / asset.width));
          canvas.width = w;
          canvas.height = h;
          g.drawImage(pic, 0, 0, w, h);
          remember(key(missing[i]), saliencyMap(g.getImageData(0, 0, w, h).data, w, h));
        }
      } catch {
        // Undecodable here: this shot keeps the centered framing.
        continue;
      }
    }
    const got = times.filter((t) => seen.has(key(t)));
    if (got.length) looks[c.id] = { assetId: asset.id, times: got, maps: got.map((t) => seen.get(key(t))!) };
  }
  return looks;
}
