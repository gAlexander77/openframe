import { allTracks, isTimed, sourceRange } from "./ops";
import type { Asset, Project } from "./types";

/** Seconds a file's duration may fall short of what it replaces: an MP3's
 * encoder delay and padding, which an MP3 imported before ADR-112 counted
 * in its duration (the same file is that much shorter now), and 1 ms. */
const slack = (replacement: Asset) => (replacement.gapless ? replacement.gapless.start + replacement.gapless.end : 0) + 0.001;

/** Keep the entire original source range, including unused trim handles. */
export function relinkProblem(original: Asset, replacement: Asset): string | null {
  if (original.kind !== replacement.kind) return `Choose a ${original.kind} file.`;
  if (original.hasAudio && !replacement.hasAudio) return "The replacement needs the original audio stream.";
  if (original.hasVideo && !replacement.hasVideo) return "The replacement needs a video stream.";
  if (original.kind !== "image" && (!Number.isFinite(replacement.duration) || replacement.duration + slack(replacement) < original.duration))
    return `The replacement must be at least ${original.duration.toFixed(3)} seconds long to preserve source handles.`;
  return null;
}

export function relinkAsset(p: Project, id: string, replacement: Asset): Project {
  const original = p.assets.find((a) => a.id === id);
  if (!original) throw new Error("The original media is no longer in this project.");
  const problem = relinkProblem(original, replacement);
  if (problem) throw new Error(problem);
  // A hand-written project may omit the duration (0): the clips still say
  // how much source they need.
  // Clips inside compound clips use the file too.
  const used = Math.max(0, ...allTracks(p).flatMap((t) => t.clips).filter(isTimed).filter((c) => "assetId" in c && c.assetId === id).map((c) => Math.max(...sourceRange(c, p.fps))));
  if (replacement.kind !== "image" && replacement.duration + slack(replacement) < used) throw new Error(`The replacement must be at least ${used.toFixed(3)} seconds long to cover the clips that use it.`);
  // Identity, label and library annotations belong to the original asset.
  const { src, proxy, animated, duration, gapless, width, height, fps, hasVideo, hasAudio, size, videoCodec, audioCodec, rotation } = replacement;
  return { ...p, assets: p.assets.map((a) => a.id === id ? { ...a, src, proxy, animated, duration, gapless, width, height, fps, hasVideo, hasAudio, size, videoCodec, audioCodec, rotation } : a) };
}
