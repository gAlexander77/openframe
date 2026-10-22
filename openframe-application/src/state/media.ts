import { heavyMedia } from "../lib/proxyPolicy";
import { createProxies, proxyAction } from "./proxies";
// Getting media into the project: probe, add assets, place clips. Shared by
// the media panel, OS drag and drop, and the automation API.

import { probe } from "../engine/media";
import { formatName, isImageName, mediaName, SNIFF_BYTES, sourceName } from "../lib/mediaKind";
import { prepare } from "../engine/thumbs";
import { uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Asset, Id, LutFile } from "../lib/project/types";
import { placeAsset, placeSourceEdit } from "../lib/drop";
import { platform, type ImportedFile } from "../platform";
import { edit, provide } from "./actions";
import { importLuts, isLutName } from "./luts";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";
import { projectWork } from "./projectWork";
import type { SourceMarks, SourceRange } from "../lib/sourceMonitor";
import { formatLimit, URL_COPY_LIMIT } from "../lib/urlImport";

/** Codecs as people say them in messages: "ProRes", not the parser's "prores". */
const CODEC_NAMES: Record<string, string> = {
  avc: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1", prores: "ProRes",
  aac: "AAC", opus: "Opus", mp3: "MP3", flac: "FLAC", vorbis: "Vorbis",
};
const codecName = (c: string | undefined) => (c ? (CODEC_NAMES[c] ?? c.toUpperCase()) : undefined);

/** What became of one file of an import, in the order given: its asset, or
 * the LUT it was, or why it failed (import_media answers every one). */
export type ImportOutcome = { file: ImportedFile; asset: Asset } | { file: ImportedFile; lut: LutFile } | { file: ImportedFile; error: string };

/** Probe and add files as assets. Returns the ones that worked; each
 * failure gets a toast that names the file and the reason. */
export async function importFiles(files: ImportedFile[], signal = projectWork.signal()): Promise<Asset[]> {
  return (await importEach(files, signal)).flatMap((o) => ("asset" in o ? [o.asset] : []));
}

/**
 * Import files and say what became of each, in the order given: the
 * assets are added as one undo step, a .cube becomes a project LUT, and a
 * file that fails says why (also in a toast). Empty when the project
 * closed meanwhile.
 */
export async function importEach(files: ImportedFile[], signal = projectWork.signal()): Promise<ImportOutcome[]> {
  const out = await probeEach(files, signal);
  if (signal.aborted) return [];
  const added = out.flatMap((o) => ("asset" in o ? [o.asset] : []));
  if (added.length) {
    store.edit(added.length === 1 ? `Import ${added[0].name}` : `Import ${added.length} files`, (p) => ({
      ...p,
      assets: [...p.assets, ...added],
    }));
    added.forEach(prepare);
    const heavy = added.filter(heavyMedia);
    if (heavy.length) toast("This media may play slowly. Create proxies?", "info", 10000, { label: "Create proxies", run: () => {
      if (!signal.aborted) proxyAction(Promise.resolve().then(() => createProxies(heavy.map((a) => a.id))));
    } });
  }
  // A .cube is a LUT for the project, not media for the library.
  const cubes = out.flatMap((o) => ("lutFile" in o ? [o.file] : []));
  const luts = cubes.length ? await importLuts(cubes, undefined, signal) : [];
  if (luts.length) toast(luts.length === 1 ? `LUT ${luts[0].name} is ready in Adjust > LUT` : `${luts.length} LUTs are ready in Adjust > LUT`);
  return signal.aborted
    ? []
    : out.map((o): ImportOutcome => {
        if (!("lutFile" in o)) return o;
        const lut = luts.find((l) => l.src === o.file.src);
        return lut ? { file: o.file, lut } : { file: o.file, error: "not a LUT this app can read (a 1D or 3D .cube)" };
      });
}

/** The assets `files` would add, probed but not added: a caller that makes
 * media as part of an edit (a voiceover's speech) adds them inside that
 * edit, so one undo takes the clips and their media together. Call
 * `prepare` on each once they are in the project. */
export async function probeFiles(files: ImportedFile[], signal = projectWork.signal()): Promise<Asset[]> {
  return (await probeEach(files, signal)).flatMap((o) => ("asset" in o ? [o.asset] : []));
}

type Probed = { file: ImportedFile; asset: Asset } | { file: ImportedFile; lutFile: true } | { file: ImportedFile; error: string };

/**
 * Each file probed, in order. The format is told by the file, never by the
 * name it will show in the library (ADR-095): the source's own name (a
 * path, a URL, the web's storage key), or, when that has no extension, its
 * first bytes. A failure is toasted and answered with its reason.
 */
async function probeEach(files: ImportedFile[], signal: AbortSignal): Promise<Probed[]> {
  const out: Probed[] = [];
  for (const file of files) {
    if (signal.aborted) return [];
    const given = { ...file, name: mediaName(file) };
    // Answers name the file as it was given, whatever copy is made of it.
    const fail = (error: string) => {
      toast(`${given.name}: ${error}`, "error");
      out.push({ file: given, error });
    };
    if (isLutName(sourceName(given.src))) {
      out.push({ file: given, lutFile: true });
      continue;
    }
    try {
      // What the file is, read where it is, before anything is copied.
      let format = formatName(given.src);
      if (!format) {
        const head = await platform.head(given.src, SNIFF_BYTES).catch(() => undefined);
        if (signal.aborted) return [];
        if (!head) {
          fail("it could not be read: check that the path or address is right");
          continue;
        }
        format = formatName(given.src, head);
      }
      if (!format) {
        fail("isn't a video, audio or image file (its name has no media extension and its contents are no format this app opens)");
        continue;
      }
      // The web keeps a copy of a file imported by its address, under a
      // name that says the format.
      let f = given;
      if (platform.adoptUrl && /^https?:/i.test(f.src)) f = { ...(await copyFromUrl(f, format, signal)), name: given.name };
      if (signal.aborted) return [];
      const canProxy = !!platform.makeProxy && !isImageName(format);
      // When the webview cannot decode it, or cannot even open it (AVI,
      // MXF), the desktop converts it with FFmpeg and edits the copy.
      let info = await probe(f.src, format).catch((e) => (canProxy ? null : Promise.reject(e)));
      if (signal.aborted) return [];
      let proxy: string | undefined;
      if (!info?.decodable && canProxy) {
        proxy = await convert(f, signal);
        if (signal.aborted) return [];
        info = await probe(proxy, format);
      }
      if (signal.aborted) return [];
      if (!info?.decodable) {
        fail(proxy ? "even its converted copy can't be decoded" : `this browser can't decode ${codecName(info?.videoCodec ?? info?.audioCodec) ?? "this format"}. The desktop app can.`);
        continue;
      }
      const asset: Asset = {
        id: uid("a"),
        kind: info.kind,
        animated: info.animated,
        name: f.name,
        src: f.src,
        proxy,
        duration: info.duration,
        ...(info.gapless ? { gapless: info.gapless } : {}),
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
        size: f.size,
        videoCodec: info.videoCodec,
        audioCodec: info.audioCodec,
        rotation: info.rotation,
      };
      out.push({ file: given, asset });
    } catch (e) {
      if (signal.aborted) return [];
      fail(`couldn't be opened: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

/**
 * The web build copies a file imported by its address into the browser's
 * storage, as it does a picked file, so the project keeps working when the
 * address goes away (ADR-073); the toast says so while it copies. Over
 * URL_COPY_LIMIT, or when the browser keeps nothing (a private window), it
 * stays linked to the address, and a toast says that too. The copy is
 * kept under `keyName`, a name whose extension says the format.
 */
async function copyFromUrl(f: ImportedFile, keyName: string, signal: AbortSignal): Promise<ImportedFile> {
  const id = toast(`Copying ${f.name} into this browser`, "progress");
  try {
    const copy = await platform.adoptUrl!(f.src, keyName, (progress) => updateToast(id, { progress }));
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

/** A marked source placement is one timing edit, with marks cleared only on success. */
export function editFromSource(asset: Asset, mode: ops.PlaceMode, marks: SourceMarks): Id {
  let id = "";
  edit(mode === "insert" ? "Insert source" : "Overwrite source", (p) => {
    const r = placeSourceEdit(p, asset, store.get().playhead, marks, mode);
    id = r.clipId;
    return r.project;
  }, { magnet: false });
  if (id) {
    store.select([id]);
    store.set({ inPoint: null, outPoint: null });
    const c = ops.findClip(store.get().project, id)?.clip;
    if (c) store.seek(ops.clipEnd(c));
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
