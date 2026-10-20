// How much of each title behind its subject the subject covers
// (lib/behind.ts, ADR-103), rendered as export draws it: the title alone
// and the subject's copy alone, each over black and over white, give
// their alphas; the share of the letters under the subject is the
// coverage. For check_project and export_versions (each version, and the
// master to compare).

import { exportStills } from "../engine/export";
import { alphaOf, behindPairs, hiddenShare, type Hidden } from "../lib/behind";
import type { Id, Project } from "../lib/project/types";

/** Each title with a subject's copy above it, at its worst measured
 * moment, at most `limit` pairs. */
export async function measureBehind(p: Project, limit = 6): Promise<Hidden[]> {
  const pairs = behindPairs(p).slice(0, limit);
  if (!pairs.length) return [];
  const w = Math.min(320, p.width), h = Math.max(2, Math.round((w * p.height) / p.width));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  // One clip alone over a plain background.
  const alone = (id: Id, background: string): Project => ({ ...p, background, tracks: p.tracks.map((t) => ({ ...t, hidden: false, clips: t.clips.filter((c) => c.id === id) })) });
  const pixels = async (q: Project, frames: number[]) => {
    const out: Uint8ClampedArray[] = [];
    for (const blob of await exportStills(q, frames, w, h)) {
      const bmp = await createImageBitmap(blob);
      g.clearRect(0, 0, w, h);
      g.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      out.push(g.getImageData(0, 0, w, h).data.slice());
    }
    return out;
  };
  const worst = new Map<Id, Hidden>();
  for (const { title, subject, frames } of pairs) {
    const [lb, lw, sb, sw] = [await pixels(alone(title.id, "#000000"), frames), await pixels(alone(title.id, "#ffffff"), frames), await pixels(alone(subject.id, "#000000"), frames), await pixels(alone(subject.id, "#ffffff"), frames)];
    frames.forEach((frame, i) => {
      const share = +hiddenShare(alphaOf(lb[i], lw[i]), alphaOf(sb[i], sw[i])).toFixed(3);
      const had = worst.get(title.id);
      if (!had || share > had.share) worst.set(title.id, { titleId: title.id, subjectId: subject.id, frame, share });
    });
  }
  return [...worst.values()];
}
