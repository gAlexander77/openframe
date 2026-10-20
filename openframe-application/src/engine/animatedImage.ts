import { animatedFrameAt } from "../lib/animatedImage";
import { platform } from "../platform";
import { looksLikeMedia, SNIFF_BYTES, sniffFormat } from "../lib/mediaKind";
interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type DecoderClass = { new(options: { data: ArrayBuffer; type: string; preferAnimation: boolean }): Decoder; isTypeSupported(type: string): Promise<boolean> };
const cache = new Map<string, Promise<{ frames: ImageBitmap[]; durations: number[] } | null>>();
/** Frames become owned bitmaps immediately; decoder frames never escape. */
export function animationFor(src: string, name: string) {
  let pending = cache.get(src);
  if (!pending) {
    pending = decode(src, name);
    cache.set(src, pending);
    pending.catch(() => cache.delete(src));
  }
  return pending;
}
/** The decoder's type for a format that can animate, else null. */
const ANIMATES: Record<string, string> = { gif: "image/gif", webp: "image/webp", png: "image/png", apng: "image/png" };

async function decode(src: string, name: string) {
  // A name with a media extension says the format; a source without one
  // is told by its first bytes (an import by a path with no extension).
  const ext = looksLikeMedia(name) ? name.split(".").pop()!.toLowerCase() : sniffFormat(await platform.head(src, SNIFF_BYTES));
  const type = ext ? (ANIMATES[ext] ?? null) : null;
  if (!type) return null;
  const ImageDecoder = (globalThis as unknown as { ImageDecoder?: DecoderClass }).ImageDecoder;
  if (!ImageDecoder || !await ImageDecoder.isTypeSupported(type)) return null;
  const decoder = new ImageDecoder({ data: await (await platform.blobFor(src)).arrayBuffer(), type, preferAnimation: true });
  const frames: ImageBitmap[] = [], durations: number[] = [];
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    if (count < 2) return null;
    let bytes = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      try {
        bytes += image.displayWidth * image.displayHeight * 4;
        // ponytail: bounded decoded-loop cache; large animations need a streaming cursor.
        if (bytes > 256 * 1024 * 1024) throw new Error("Animated image exceeds the 256 MiB decoded loop limit");
        durations.push(Math.max(0.001, (image.duration ?? 100000) / 1e6));
        frames.push(await createImageBitmap(image));
      } finally { image.close(); }
    }
    return { frames, durations };
  } catch (e) { frames.forEach(f => f.close()); throw e; }
  finally { decoder.close(); }
}
export async function animatedBitmap(src: string, name: string, time: number) {
  const a = await animationFor(src, name);
  return a?.frames[animatedFrameAt(a.durations, time)];
}
export async function closeAnimation(src: string) {
  const pending = cache.get(src); cache.delete(src);
  (await pending?.catch(() => null))?.frames.forEach(f => f.close());
}
