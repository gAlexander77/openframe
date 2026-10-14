// Media files: one mediabunny Input per asset, opened lazily and shared by
// every clip of that asset, plus probing at import. Bytes come from the
// platform (a File on the web, a range-capable URL on the desktop); this
// file never knows which.

import {
  ALL_FORMATS,
  AudioBufferSink,
  EncodedPacketSink,
  Input,
  VideoSampleSink,
  type InputAudioTrack,
  type InputVideoTrack,
  type Source,
} from "mediabunny";
import type { Asset, AssetKind } from "../lib/project/types";
import { platform } from "../platform";

export interface MediaFile {
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
  videoSink: VideoSampleSink | null;
  keySink: EncodedPacketSink | null;
  audioSink: AudioBufferSink | null;
  /** First presentation timestamp; source time 0 maps to this. */
  videoStart: number;
  audioStart: number;
  /** Container rotation in quarter turns clockwise. */
  quarterTurns: 0 | 1 | 2 | 3;
  width: number;
  height: number;
}

export interface Probe {
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
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name);

async function openInput(source: Source): Promise<MediaFile> {
  const input = new Input({ source, formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const videoOk = video ? await video.canDecode() : false;
  const audioOk = audio ? await audio.canDecode() : false;
  const rotation = video ? await video.getRotation() : 0;
  return {
    input,
    video: videoOk ? video : null,
    audio: audioOk ? audio : null,
    videoSink: videoOk && video ? new VideoSampleSink(video) : null,
    keySink: videoOk && video ? new EncodedPacketSink(video) : null,
    audioSink: audioOk && audio ? new AudioBufferSink(audio) : null,
    videoStart: video ? await video.getFirstTimestamp() : 0,
    // A negative first timestamp is encoder priming the edit list says not
    // to present (AAC: 1024 samples). Counting it as source 0 played every
    // AAC file 21 ms late; the speed drive's beep-and-flash check found it.
    audioStart: audio ? Math.max(0, await audio.getFirstTimestamp()) : 0,
    quarterTurns: ((rotation / 90) % 4) as 0 | 1 | 2 | 3,
    width: video ? await video.getDisplayWidth() : 0,
    height: video ? await video.getDisplayHeight() : 0,
  };
}

const files = new Map<string, Promise<MediaFile>>();

/** The open media for an asset, preferring its proxy when it has one. */
export function mediaFor(asset: Asset): Promise<MediaFile> {
  const src = asset.proxy ?? asset.src;
  let m = files.get(src);
  if (!m) {
    m = platform.sourceFor(src).then(openInput);
    files.set(src, m);
    m.catch(() => files.delete(src));
  }
  return m;
}

/** Close an asset's decoders and file handle (asset removed or relinked). */
export async function closeMedia(src: string) {
  const m = files.get(src);
  files.delete(src);
  (await m?.catch(() => null))?.input.dispose();
}

// ---- images --------------------------------------------------------------------

const images = new Map<string, Promise<ImageBitmap>>();

/** Decoded still for an image asset, cached for the session. */
export function imageFor(asset: Asset): Promise<ImageBitmap> {
  let img = images.get(asset.src);
  if (!img) {
    img = platform.blobFor(asset.src).then((b) => createImageBitmap(b, { imageOrientation: "from-image" }));
    images.set(asset.src, img);
    img.catch(() => images.delete(asset.src));
  }
  return img;
}

// ---- probing ----------------------------------------------------------------------

/** Everything the media panel and the project need to know about a file. */
export async function probe(src: string, name: string): Promise<Probe> {
  if (IMAGE_EXT.test(name)) {
    const bmp = await createImageBitmap(await platform.blobFor(src));
    const out: Probe = { kind: "image", duration: 0, width: bmp.width, height: bmp.height, hasVideo: true, hasAudio: false, decodable: true };
    bmp.close();
    return out;
  }
  const input = new Input({ source: await platform.sourceFor(src), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
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
    };
  } finally {
    input.dispose();
  }
}
