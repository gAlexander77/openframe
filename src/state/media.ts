// Getting media into the project: probe, add assets, place clips. Shared by
// the media panel, OS drag and drop, and the automation API.

import { isImageName, probe } from "../engine/media";
import { prepare } from "../engine/thumbs";
import { clipForAsset, createTrack, uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Asset, Clip, Id, Project } from "../lib/project/types";
import { FPS_PRESETS, fpsValue } from "../lib/time";
import { platform, type ImportedFile } from "../platform";
import { edit, provide } from "./actions";
import { importLuts, isLutName } from "./luts";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

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
export async function importFiles(files: ImportedFile[]): Promise<Asset[]> {
  // A dropped .cube is a LUT for the project, not media for the library.
  const luts = files.filter((f) => isLutName(f.name));
  if (luts.length) {
    void importLuts(luts).then((l) => l.length && toast(l.length === 1 ? `LUT ${l[0].name} is ready in Adjust > LUT` : `${l.length} LUTs are ready in Adjust > LUT`));
    files = files.filter((f) => !isLutName(f.name));
  }
  const added: Asset[] = [];
  for (const f of files) {
    if (!looksLikeMedia(f.name) && !isImageName(f.name)) {
      toast(`${f.name} isn't a video, audio or image file`, "error");
      continue;
    }
    try {
      const canProxy = !!platform.makeProxy && !isImageName(f.name);
      // When the webview cannot decode it, or cannot even open it (AVI,
      // MXF), the desktop converts it with FFmpeg and edits the copy.
      let info = await probe(f.src, f.name).catch((e) => (canProxy ? null : Promise.reject(e)));
      let proxy: string | undefined;
      if (!info?.decodable && canProxy) {
        proxy = await convert(f);
        info = await probe(proxy, f.name);
      }
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
      toast(`Couldn't open ${f.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  }
  if (added.length) {
    store.edit(added.length === 1 ? `Import ${added[0].name}` : `Import ${added.length} files`, (p) => ({
      ...p,
      assets: [...p.assets, ...added],
    }));
    added.forEach(prepare);
  }
  return added;
}

/** The desktop's FFmpeg proxy, with its progress in a toast. */
async function convert(f: ImportedFile): Promise<string> {
  const id = toast(`Converting ${f.name} for editing`, "progress");
  try {
    return await platform.makeProxy!(f.src, (progress) => updateToast(id, { progress }));
  } finally {
    dismiss(id);
  }
}

/** CapCut: the first clip on an empty timeline sets the canvas size and
 * frame rate, so phone footage gets a vertical project automatically —
 * unless the user already chose a canvas, which then only takes the
 * clip's frame rate (UX-02). */
function adoptSettings(p: Project, a: Asset): Project {
  const empty = p.tracks.every((t) => t.clips.length === 0);
  if (!empty || a.kind === "audio" || !a.width || !a.height) return p;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  let fps = p.fps;
  if (a.fps) {
    const nearest = FPS_PRESETS.reduce((b, x) => (Math.abs(fpsValue(x.fps) - a.fps!) < Math.abs(fpsValue(b.fps) - a.fps!) ? x : b));
    if (Math.abs(fpsValue(nearest.fps) - a.fps) < 0.5) fps = nearest.fps;
  }
  return p.canvasFixed ? { ...p, fps } : { ...p, width: even(a.width), height: even(a.height), fps };
}

/**
 * Put an asset on the timeline (the media card's + button, or a drop).
 * Video and images go on the main track at the playhead — with the magnet
 * on, at the nearest cut, since CapCut never overwrites the main track —
 * and audio goes on the first audio track with room, or a new one.
 */
export function addToTimeline(asset: Asset, at?: number, trackId?: Id): Id {
  let id = "";
  edit(`Add ${asset.name}`, (p0) => {
    let p = adoptSettings(p0, asset);
    const s = store.get();
    let start = at ?? s.playhead;
    let clip: Clip = clipForAsset(asset, start, p.fps);
    id = clip.id;
    if (asset.kind === "audio") {
      let track = trackId ? ops.findTrack(p, trackId) : p.tracks.find((t) => t.kind === "audio" && !t.locked && ops.rangeFree(t, start, clip.duration));
      if (!track || track.kind !== "audio") {
        track = createTrack("audio", "Audio");
        p = ops.addTrack(p, track);
      }
      return ops.placeClip(p, track.id, clip, { collision: "newTrack" });
    }
    const target = trackId ? ops.findTrack(p, trackId) : ops.mainTrack(p);
    if (!target || target.kind !== "video") return p;
    if (target.main && s.magnet) {
      // Snap to the nearest cut so nothing is split by an insert.
      const cuts = [0, ...target.clips.map((c) => c.start + c.duration)];
      start = cuts.reduce((b, x) => (Math.abs(x - start) < Math.abs(b - start) ? x : b), cuts[cuts.length - 1]);
      clip = { ...clip, start };
      return ops.addClip(p, target.id, clip, "insert");
    }
    return ops.placeClip(p, target.id, clip, { collision: "newTrack" });
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
  const files = await platform.pickMedia();
  return files.length ? importFiles(files) : [];
}

// The menu item and the shortcut open the same picker as the Import button.
provide({ importMedia: () => void pickAndImport() });
