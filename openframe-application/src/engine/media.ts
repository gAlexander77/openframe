import { BorrowCache } from "../lib/memory";
import { animatedFrameAt } from "../lib/animatedImage";
import { memoryOwners, MiB, trackCache } from "./memory";
import { checkPlaybackProxy, originalFingerprint } from "./playbackProxies";
import { proxySource } from "../lib/proxyPolicy";
// Media files: one mediabunny Input per asset, opened lazily and shared by
// every clip of that asset, plus probing at import. Bytes come from the
// platform (a File on the web, a range-capable URL on the desktop); this
// file never knows which.

import {
  ALL_FORMATS,
  AudioBufferSink,
  EncodedPacketSink,
  Input,
  Mp3InputFormat,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
  type Source,
} from "mediabunny";
import type { Asset, AssetKind } from "../lib/project/types";
import { borrowAnimation, closeAnimation } from "./animatedImage";
import { platform } from "../platform";
import { AUDIO_EXT, IMAGE_EXT, SNIFF_BYTES, sniffFormat, sourceName } from "../lib/mediaKind";
import { id3v2Size, mp3Trim, MP3_TRIM_BYTES } from "../lib/gapless";

export interface MediaFile {
  /** Release this borrow after every sink/iterator using it has stopped. */
  release(): void;
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
  videoSink: VideoSampleSink | null;
  keySink: EncodedPacketSink | null;
  audioSink: AudioBufferSink | null;
  /** Container time that source time 0 maps to, shared by both tracks so
   * they stay in sync (see mediaOrigin); the sound's is past an MP3's
   * encoder delay (soundOrigin). */
  videoStart: number;
  audioStart: number;
  /** Container rotation in quarter turns clockwise. */
  quarterTurns: 0 | 1 | 2 | 3;
  width: number;
  height: number;
}

export interface Probe {
  animated?: boolean;
  kind: AssetKind;
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  rotation?: 0 | 90 | 180 | 270;
  /** False when the webview cannot decode the video track; the desktop
   * makes an ffmpeg proxy, the web says why it cannot open the file. */
  decodable: boolean;
  /** An MP3's encoder delay and padding, left out of `duration`. */
  gapless?: { start: number; end: number };
}

export { isImageName } from "../lib/mediaKind";

/** A picture's bytes as the browser decodes them: an SVG must say it is
 * one (a path without the .svg extension gives an untyped blob). */
async function decodable(blob: Blob): Promise<Blob> {
  if (blob.type) return blob;
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  return sniffFormat(head) === "svg" ? new Blob([blob], { type: "image/svg+xml" }) : blob;
}

/**
 * Seconds of a file decoded before the first one heard, and thrown away.
 * A decoder started cold at a packet gives that packet as silence when it
 * leans on the one before (an MP3 frame's bit reservoir): every 10 s
 * export window, and every clip starting mid-file, played 12-26 ms of
 * silence from an MP3 song (found measuring a song's splice, ADR-104).
 */
export const DECODE_PREROLL = 0.1;

/**
 * Where a file's source time 0 is, in container time. AAC's encoder priming
 * packet carries a negative timestamp (-21.3 ms at 48 kHz) that is decoded
 * but never presented; treating it as time 0 played every clip's sound
 * 21 ms late (found by the beat detector). Files that genuinely start late
 * (MPEG-TS, trimmed exports) keep their offset, and one origin for both
 * tracks keeps picture and sound together.
 */
export async function mediaOrigin(video: InputVideoTrack | null, audio: InputAudioTrack | null): Promise<number> {
  const firsts = await Promise.all([video?.getFirstTimestamp(), audio?.getFirstTimestamp()]);
  const known = firsts.filter((t): t is number => typeof t === "number");
  return known.length ? Math.max(0, Math.min(...known)) : 0;
}

const trims = new Map<string, Promise<{ start: number; end: number } | null>>();

/**
 * Seconds of an MP3's decoded sound that are not the sound: the encoder's
 * delay before it and its padding after, as its LAME tag names them
 * (lib/gapless.ts). WebCodecs presents both, ffmpeg and gapless players
 * leave them out; read once per file. Null for any other file (AAC's
 * priming is the container's edit list, which mediabunny honors).
 */
export function gaplessTrim(input: Input, src: string): Promise<{ start: number; end: number } | null> {
  let t = trims.get(src);
  if (!t) {
    t = (async () => {
      if (!((await input.getFormat()) instanceof Mp3InputFormat)) return null;
      let at = 0;
      for (let tag; (tag = id3v2Size(await platform.head(src, 10, at))); ) at += tag;
      const trim = mp3Trim(await platform.head(src, MP3_TRIM_BYTES, at));
      return trim && { start: trim.start / trim.sampleRate, end: trim.end / trim.sampleRate };
    })().catch(() => null);
    trims.set(src, t);
  }
  return t;
}

/**
 * Where an input's source time 0 is for its sound, in container time:
 * mediaOrigin, past an MP3's encoder delay (gaplessTrim), so playback,
 * export, waveforms and every analysis hear the file as ffmpeg decodes it
 * (ADR-112). Measured on music-30s.mp3: 23.02 ms (1105 samples) late
 * without it. An MP3 has no picture, so its tracks stay together.
 */
export async function soundOrigin(input: Input, src: string): Promise<number> {
  const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  return (await mediaOrigin(video, audio)) + ((await gaplessTrim(input, src))?.start ?? 0);
}

async function openInput(source: Source, src: string): Promise<Omit<MediaFile, "release">> {
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const videoOk = video ? await video.canDecode() : false;
    const audioOk = audio ? await audio.canDecode() : false;
    const rotation = video ? await video.getRotation() : 0;
    const origin = await mediaOrigin(video, audio);
    const delay = (await gaplessTrim(input, src))?.start ?? 0;
    return {
      input,
      video: videoOk ? video : null,
      audio: audioOk ? audio : null,
      videoSink: videoOk && video ? new VideoSampleSink(video) : null,
      keySink: videoOk && video ? new EncodedPacketSink(video) : null,
      audioSink: audioOk && audio ? new AudioBufferSink(audio) : null,
      videoStart: origin,
      audioStart: origin + delay,
      quarterTurns: ((rotation / 90) % 4) as 0 | 1 | 2 | 3,
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
    };
  } catch (e) { input.dispose(); throw e; }
}

const INPUT_CACHE_BUDGET = 32 * MiB, INPUT_RESERVE = 8 * MiB;
interface InputEntry { pending: Promise<Omit<MediaFile, "release">>; users: number; cached: boolean }
const files = new Map<string, InputEntry>();
// A retired session may still have cursors finishing an asynchronous read.
// Keep their inputs alive until the last cursor gives back its borrow.
const liveInputs = new Set<InputEntry>();
function disposeIdle(entry: InputEntry) {
  if (entry.cached || entry.users || !liveInputs.delete(entry)) return;
  void entry.pending.then(f => f.input.dispose(), () => {});
}
const drop = (key: string) => {
  const entry = files.get(key); files.delete(key);
  if (entry) { entry.cached = false; disposeIdle(entry); }
};
function trimInputs() {
  const idle = [...files].filter(([, e]) => !e.users);
  while (idle.length * INPUT_RESERVE > INPUT_CACHE_BUDGET) drop(idle.shift()![0]);
}
memoryOwners.register("idle_media_inputs", () => ({ bytes: [...files.values()].filter(e => !e.users).length * INPUT_RESERVE, count: [...files.values()].filter(e => !e.users).length, budget: INPUT_CACHE_BUDGET, estimated: true }), () => {
  for (const key of files.keys()) drop(key);
  trims.clear();
});
memoryOwners.register("active_media_inputs", () => ({ bytes: [...liveInputs].filter(e => e.users).length * INPUT_RESERVE, count: [...liveInputs].filter(e => e.users).length, estimated: true }));

/** The open media for an asset, preferring its proxy when it has one. */
export const mediaFor = async (asset: Asset): Promise<MediaFile> => {
  await checkPlaybackProxy(asset);
  const src = proxySource(asset, "analysis", false);
  return mediaForSrc(src, src === asset.src ? originalFingerprint(asset) : undefined);
};

/** The open media at a platform location (an asset's file, or a
 * background matte, which is stored like media). */
export async function mediaForSrc(src: string, fingerprint?: string): Promise<MediaFile> {
  const key = fingerprint ? `${src}\0${fingerprint}` : src;
  let entry = files.get(key);
  if (!entry) {
    entry = { pending: platform.sourceFor(src).then(source => openInput(source, src)), users: 0, cached: true };
    files.set(key, entry);
    liveInputs.add(entry);
    entry.pending.catch(() => { if (files.get(key) === entry) drop(key); });
  }
  files.delete(key); files.set(key, entry);
  entry.users++;
  try {
    const file = await entry.pending;
    let released = false;
    return { ...file, release() { if (!released) { released = true; entry.users--; disposeIdle(entry); trimInputs(); } } };
  } catch (e) { entry.users--; disposeIdle(entry); throw e; }
}

/** Retire an asset's cached resources (removed or relinked). Active
 * cursors keep their file handle until they return their last borrow. */
export async function closeMedia(src: string) {
  await closeAnimation(src);
  trims.delete(src);
  images.delete(src);
  for (const key of files.keys()) if (key === src || key.startsWith(`${src}\0`)) drop(key);
}

// ---- images --------------------------------------------------------------------

const images = new BorrowCache<string, ImageBitmap>(128 * MiB, b => b.width * b.height * 4, b => b.close());
trackCache("image_bitmaps", images);
memoryOwners.register("image_borrows", () => ({ bytes: images.borrowedBytes, count: 0 }));

/** The caller borrows the image until rendering or copying it completes. */
export async function borrowImage(asset: Asset, time = 0): Promise<{ value: ImageBitmap; release: () => void }> {
  if (asset.animated) {
    const borrowed = await borrowAnimation(asset.src, sourceName(asset.src));
    if (borrowed.value) return { value: borrowed.value.frames[animatedFrameAt(borrowed.value.durations, time)], release: borrowed.release };
    borrowed.release();
  }
  return images.acquire(asset.src, () => platform.blobFor(asset.src).then(decodable).then(b => createImageBitmap(b, { imageOrientation: "from-image" })));
}

// ---- probing ----------------------------------------------------------------------

/** Everything the media panel and the project need to know about a file.
 * `name` is the one whose extension says its format (lib/mediaKind.ts
 * formatName: the source's own, or what its bytes are), never the label
 * the library shows. */
export async function probe(src: string, name: string): Promise<Probe> {
  if (IMAGE_EXT.test(name)) {
    const borrowed = await borrowAnimation(src, name);
    try {
      const animation = borrowed.value;
      if (animation) return { kind: "image", animated: true, duration: animation.durations.reduce((a, b) => a + b, 0), width: animation.frames[0].width, height: animation.frames[0].height, hasVideo: true, hasAudio: false, decodable: true };
    } finally { borrowed.release(); }
    const bmp = await createImageBitmap(await decodable(await platform.blobFor(src)));
    const out: Probe = { kind: "image", duration: 0, width: bmp.width, height: bmp.height, hasVideo: true, hasAudio: false, decodable: true };
    bmp.close();
    return out;
  }
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const gapless = (await gaplessTrim(input, src)) ?? undefined;
    const duration = (await input.computeDuration()) - (gapless ? gapless.start + gapless.end : 0);
    const kind: AssetKind = video && !AUDIO_EXT.test(name) ? "video" : "audio";
    let fps: number | undefined;
    if (video) {
      const stats = await video.computePacketStats(120);
      fps = stats.averagePacketRate > 0 ? Math.round(stats.averagePacketRate * 1000) / 1000 : undefined;
    }
    const rotation = video ? await video.getRotation() : 0;
    return {
      kind,
      duration,
      width: video ? await video.getDisplayWidth() : undefined,
      height: video ? await video.getDisplayHeight() : undefined,
      fps,
      hasVideo: !!video,
      hasAudio: !!audio,
      videoCodec: (await video?.getCodec()) ?? undefined,
      audioCodec: (await audio?.getCodec()) ?? undefined,
      rotation: rotation as Probe["rotation"],
      decodable: video ? await video.canDecode() : audio ? await audio.canDecode() : false,
      ...(gapless ? { gapless } : {}),
    };
  } finally {
    input.dispose();
  }
}
