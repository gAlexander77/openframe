import { ByteLru } from "../lib/memory";
import { MiB, trackCache } from "./memory";

const urls = new ByteLru<string, ReturnType<typeof setTimeout>>(128 * MiB, (timer, url) => {
  clearTimeout(timer); URL.revokeObjectURL(url);
});
trackCache("answer_blob_urls", urls);

/** MCP previews send bytes and file exports send paths, so neither needs
 * an object URL. Raw automation render()/still() callers fetch their URL
 * before releasing it; expiration also covers abandoned answers. */
export function answerUrl(blob: Blob): string {
  if (blob.size > urls.budget) throw new Error("In-memory export exceeds 128 MiB. Export to a file instead.");
  const url = URL.createObjectURL(blob);
  urls.set(url, setTimeout(() => urls.delete(url), 60_000), blob.size);
  return url;
}
export const releaseAnswerUrl = (url: string) => urls.delete(url);
