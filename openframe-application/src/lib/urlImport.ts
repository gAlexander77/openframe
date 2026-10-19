// Media imported by its address on the web build is copied into the
// browser's storage, as picked files are (ADR-073), up to a size: past it
// the file stays linked, and the project needs the address online.

/** The largest file the web build copies from an address: 1 GiB. A longer
 * download would hold the import for minutes; such a file is better
 * picked from the disk, which the browser copies without a download. */
export const URL_COPY_LIMIT = 1024 ** 3;

/** Thrown through a copy that went past its limit. */
export class TooBigToCopy extends Error {
  constructor(readonly limit: number) {
    super(`over ${formatLimit(limit)}`);
  }
}

export const formatLimit = (bytes: number) => (bytes >= 1024 ** 3 ? `${+(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

/** Whether a response's Content-Length already says it is too big. */
export const tooBigToCopy = (contentLength: string | null, limit = URL_COPY_LIMIT) => Number(contentLength) > limit;

/** Bytes pass through, counted to `onBytes`; past `limit` the stream fails
 * with TooBigToCopy (a server that sent no length, or lied about it). */
export function capBytes(limit: number, onBytes?: (total: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, out) {
      total += chunk.byteLength;
      if (total > limit) throw new TooBigToCopy(limit);
      onBytes?.(total);
      out.enqueue(chunk);
    },
  });
}
