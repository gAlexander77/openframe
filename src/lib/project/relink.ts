import type { Asset, Project } from "./types";

/** Keep the entire original source range, including unused trim handles. */
export function relinkProblem(original: Asset, replacement: Asset): string | null {
  if (original.kind !== replacement.kind) return `Choose a ${original.kind} file.`;
  if (original.hasAudio && !replacement.hasAudio) return "The replacement needs the original audio stream.";
  if (original.hasVideo && !replacement.hasVideo) return "The replacement needs a video stream.";
  if (original.kind !== "image" && (!Number.isFinite(replacement.duration) || replacement.duration + 0.001 < original.duration))
    return `The replacement must be at least ${original.duration.toFixed(3)} seconds long to preserve source handles.`;
  return null;
}

export function relinkAsset(p: Project, id: string, replacement: Asset): Project {
  const original = p.assets.find((a) => a.id === id);
  if (!original) throw new Error("The original media is no longer in this project.");
  const problem = relinkProblem(original, replacement);
  if (problem) throw new Error(problem);
  // Identity, label and library annotations belong to the original asset.
  const { src, proxy, duration, width, height, fps, hasVideo, hasAudio, size, videoCodec, audioCodec, rotation } = replacement;
  return { ...p, assets: p.assets.map((a) => a.id === id ? { ...a, src, proxy, duration, width, height, fps, hasVideo, hasAudio, size, videoCodec, audioCodec, rotation } : a) };
}
