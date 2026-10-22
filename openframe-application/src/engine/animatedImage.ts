import { memoryOwners, MiB, trackCache } from "./memory";
import { BorrowCache } from "../lib/memory";
import { platform } from "../platform";
import { looksLikeMedia, SNIFF_BYTES, sniffFormat } from "../lib/mediaKind";
interface Decoder {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>;
  close(): void;
}
type DecoderClass = { new(options: { data: ArrayBuffer; type: string; preferAnimation: boolean }): Decoder; isTypeSupported(type: string): Promise<boolean> };
type Animation = { frames: ImageBitmap[]; durations: number[] } | null;
const cache = new BorrowCache<string, Animation>(256 * MiB, a => a?.frames.reduce((n, f) => n + f.width * f.height * 4, 0) ?? 64, a => a?.frames.forEach(f => f.close()));
trackCache("animated_images", cache);
memoryOwners.register("animated_image_borrows", () => ({ bytes: cache.borrowedBytes, count: 0 }));
export const borrowAnimation = (src: string, name: string) => cache.acquire(src, () => decode(src, name));
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
export const closeAnimation = (src: string) => cache.delete(src);
