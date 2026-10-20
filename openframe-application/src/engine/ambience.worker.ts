// Ambience beds off the main thread (ADR-098): a bed of a few minutes is a
// few seconds of synthesis (lib/ambience.ts), so the editor keeps playing.

import { makeBed } from "../lib/ambience";
import { hashSeed } from "../lib/music/arrange";
import { encodeWav } from "../lib/wav";

interface Msg {
  id: number;
  bed: string;
  seconds: number;
  seed: number;
  rate: number;
  /** Raw samples for a preview instead of a WAV file. */
  pcm?: boolean;
}

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, bed, seconds, seed, rate, pcm } = e.data;
  try {
    let last = 0;
    const [L, R] = makeBed(bed, seconds, rate, seed, (p) => p - last >= 0.02 && post({ id, type: "download", progress: (last = p) }));
    if (pcm) {
      const [l, r] = [L.slice(), R.slice()];
      post({ id, type: "done", left: l, right: r }, [l.buffer, r.buffer]);
      return;
    }
    const wav = encodeWav([L, R], rate, hashSeed("ambience-dither", bed, seed));
    post({ id, type: "done", wav }, [wav.buffer]);
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
