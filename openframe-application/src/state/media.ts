// Getting media into the project: probe, add assets, place clips. Shared by
// the media panel, OS drag and drop, and the automation API.

import { isImageName, probe } from "../engine/media";
import { prepare } from "../engine/thumbs";
import { uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Asset, Id } from "../lib/project/types";
import { placeAsset } from "../lib/drop";
import { platform, type ImportedFile } from "../platform";
import { edit, provide } from "./actions";
import { importLuts, isLutName } from "./luts";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";
import { projectWork } from "./projectWork";
import type { SourceRange } from "../lib/sourceMonitor";
import { formatLimit, URL_COPY_LIMIT } from "../lib/urlImport";

/** Codecs as people say them in messages: "ProRes", not the parser's "prores". */
const CODEC_NAMES: Record<string, string> = {
  avc: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1", prores: "ProRes",
  aac: "AAC", opus: "Opus", mp3: "MP3", flac: "FLAC", vorbis: "Vorbis",
};
const codecName = (c: string | undefined) => (c ? (CODEC_NAMES[c] ?? c.toUpperCase()) : undefined);

const MEDIA_NAME = /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|mts|m2ts|ts|mxf|3gp|ogv|mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|png|jpe?g|gif|webp|bmp|avif|svg)$/i;
export const looksLikeMedia = (name: string) => MEDIA_NAME.test(name);

/** Probe and add files as assets. Returns the ones that worked; each
 * failure gets a toast that names the file and the reason. */
export async function importFiles(files: ImportedFile[], signal = projectWork.signal()): Promise<Asset[]> {
  const added = await probeFiles(files, signal);
  if (added.length && !signal.aborted) {
    store.edit(added.length === 1 ? `Import ${added[0].name}` : `Import ${added.length} files`, (p) => ({
      ...p,
      assets: [...p.assets, ...added],
    }));
    added.forEach(prepare);
  }
  return signal.aborted ? [] : added;
}

/** The assets `files` would add, probed but not added: a caller that makes
 * media as part of an edit (a voiceover's speech) adds them inside that
 * edit, so one undo takes the clips and their media together. Call
 * `prepare` on each once they are in the project. */
export async function probeFiles(files: ImportedFile[], signal = projectWork.signal()): Promise<Asset[]> {
  if (signal.aborted) return [];
  // A dropped .cube is a LUT for the project, not media for the library.
  const luts = files.filter((f) => isLutName(f.name));
  if (luts.length) {
    void importLuts(luts, undefined, signal).then((l) => l.length && toast(l.length === 1 ? `LUT ${l[0].name} is ready in Adjust > LUT` : `${l.length} LUTs are ready in Adjust > LUT`));
    files = files.filter((f) => !isLutName(f.name));
  }
  const added: Asset[] = [];
  for (let f of files) {
    if (!looksLikeMedia(f.name) && !isImageName(f.name)) {
      toast(`${f.name} isn't a video, audio or image file`, "error");
      continue;
    }
    try {
      if (platform.adoptUrl && /^https?:/i.test(f.src)) f = await copyFromUrl(f, signal);
      if (signal.aborted) return [];
      const canProxy = !!platform.makeProxy && !isImageName(f.name);
      // When the webview cannot decode it, or cannot even open it (AVI,
      // MXF), the desktop converts it with FFmpeg and edits the copy.
      let info = await probe(f.src, f.name).catch((e) => (canProxy ? null : Promise.reject(e)));
      if (signal.aborted) return [];
      let proxy: string | undefined;
      if (!info?.decodable && canProxy) {
        proxy = await convert(f, signal);
        if (signal.aborted) return [];
        info = await probe(proxy, f.name);
      }
      if (signal.aborted) return [];
      if (!info?.decodable) {
        toast(
          proxy
            ? `${f.name}: even its converted copy can't be decoded`
            : `${f.name}: this browser can't decode ${codecName(info?.videoCodec ?? info?.audioCodec) ?? "this format"}. The desktop app can.`,
          "error",
        );
        continue;
      }
      added.push({
        id: uid("a"),
        kind: info.kind,
        name: f.name,
        src: f.src,
        proxy,
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
        size: f.size,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        rotation: info.rotation,
      });
    } catch (e) {
      if (signal.aborted) return [];
      toast(`Couldn't open ${f.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  }
  return added;
}

/**
 * The web build copies a file imported by its address into the browser's
 * storage, as it does a picked file, so the project keeps working when the
 * address goes away (ADR-073); the toast says so while it copies. Over
 * URL_COPY_LIMIT, or when the browser keeps nothing (a private window), it
 * stays linked to the address, and a toast says that too.
 */
async function copyFromUrl(f: ImportedFile, signal: AbortSignal): Promise<ImportedFile> {
  const id = toast(`Copying ${f.name} into this browser`, "progress");
  try {
    const copy = await platform.adoptUrl!(f.src, f.name, (progress) => updateToast(id, { progress }));
    if (copy || signal.aborted) return copy ?? f;
    toast(`${f.name} is over ${formatLimit(URL_COPY_LIMIT)}, so it plays from its address and goes offline with it. Import it from a file to keep a copy.`, "info", 8000);
  } catch (e) {
    if (signal.aborted) return f;
    toast(`${f.name} plays from its address and goes offline with it: copying it failed (${e instanceof Error ? e.message : e}).`, "error");
  } finally {
    dismiss(id);
  }
  return f;
}

/** The desktop's FFmpeg proxy, with its progress in a toast. */
async function convert(f: ImportedFile, signal?: AbortSignal): Promise<string> {
  const id = toast(`Converting ${f.name} for editing`, "progress");
  try {
    return await platform.makeProxy!(f.src, (progress) => updateToast(id, { progress }), signal);
  } finally {
    dismiss(id);
  }
}

/**
 * Put an asset on the timeline (the media card's + button, or a drop), by
 * placeAsset's rules (src/lib/drop.ts), at the playhead unless `at` says
 * otherwise. The playhead moves after the clip only for an add at the
 * playhead, so repeated adds line up.
 */
export function addToTimeline(asset: Asset, at?: number, trackId?: Id | "overlay", range?: SourceRange, mode?: ops.PlaceMode): Id {
  if (projectWork.signal().aborted || !store.get().project.assets.some((a) => a.id === asset.id)) return "";
  let id = "";
  edit(mode === "insert" ? `Insert ${asset.name}` : mode === "overwrite" ? `Overwrite with ${asset.name}` : `Add ${asset.name}`, (p0) => {
    const s = store.get();
    const r = placeAsset(p0, asset, at ?? s.playhead, trackId, s.magnet, range, mode);
    id = r.clipId;
    return r.project;
  });
  if (id) {
    // Leave the playhead after the new clip so repeated adds line up in
    // order, as an insert edit does in Premiere.
    const c = ops.findClip(store.get().project, id)?.clip;
    store.select([id]);
    if (c && at === undefined) store.seek(c.start + c.duration);
  }
  return id;
}

/** Import files from the OS picker; returns the new assets. */
export async function pickAndImport(): Promise<Asset[]> {
  const signal = projectWork.signal();
  const files = await platform.pickMedia();
  return files.length ? importFiles(files, signal) : [];
}

/** Capture ownership before copying/adopting browser files, too. */
export async function adoptAndImport(files: File[]): Promise<Asset[]> {
  const signal = projectWork.signal();
  return importFiles(await platform.adoptFiles(files), signal);
}

/** Files made in the app (speech), saved where the project keeps media
 * and probed, for the caller's edit to add (probeFiles). */
export async function adoptAndProbe(files: File[]): Promise<Asset[]> {
  const signal = projectWork.signal();
  return probeFiles(await platform.adoptFiles(files), signal);
}

export { prepare };

// The menu item and the shortcut open the same picker as the Import button.
provide({ importMedia: () => void pickAndImport() });
