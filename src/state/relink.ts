import { isImageName, probe } from "../engine/media";
import { prepare } from "../engine/thumbs";
import { relinkAsset, relinkProblem } from "../lib/project/relink";
import type { Asset } from "../lib/project/types";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
import { store } from "./store";

export async function pickReplacement(original: Asset, signal = projectWork.signal()): Promise<Asset | null> {
  const files = await platform.pickMedia();
  if (signal.aborted || !files.length) return null;
  if (files.length !== 1) throw new Error("Choose one replacement file at a time.");
  const f = files[0];
  const canProxy = !!platform.makeProxy && !isImageName(f.name);
  let info = await probe(f.src, f.name).catch((e) => canProxy ? null : Promise.reject(e));
  if (signal.aborted) return null;
  let proxy: string | undefined;
  if (!info?.decodable && canProxy) {
    proxy = await platform.makeProxy!(f.src, () => {}, signal);
    if (signal.aborted) return null;
    info = await probe(proxy, f.name);
  }
  if (signal.aborted) return null;
  if (!info?.decodable) throw new Error("This file cannot be decoded. Choose another source.");
  const candidate = { ...f, ...info, proxy, id: original.id };
  const problem = relinkProblem(original, candidate);
  if (problem) throw new Error(problem);
  return candidate;
}

export function applyReplacement(original: Asset, replacement: Asset, signal: AbortSignal) {
  if (signal.aborted) throw new Error("The project changed. Reopen the media manager.");
  const current = store.get().project.assets.find((a) => a.id === original.id);
  if (!current || current.src !== original.src || current.proxy !== original.proxy) throw new Error("This media changed while choosing a replacement. Check it again.");
  store.edit(`Relink ${original.name}`, (p) => relinkAsset(p, original.id, replacement));
  prepare(store.get().project.assets.find((a) => a.id === original.id)!);
}
