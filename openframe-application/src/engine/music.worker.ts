// The score generator off the main thread (ADR-085): plan, render, master
// and write the WAV files of a generate_music request, so the editor keeps
// playing while a minute of music is synthesized (about ten seconds).

import { planMusic, type MusicRequest } from "../lib/music/arrange";
import { ditherSeed, renderMusic } from "../lib/music/render";
import { balance, stats } from "../lib/music/measure";
import { STEMS } from "../lib/music/styles";
import { encodeWav } from "../lib/wav";

interface Msg {
  id: number;
  request: MusicRequest;
  stems: boolean;
  loudness: number;
  /** Raw samples for a preview instead of WAV files. */
  pcm?: boolean;
}

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, request, stems, loudness, pcm } = e.data;
  try {
    const plan = planMusic(request);
    let last = 0;
    // Progress rides workerRequest's "download" messages.
    const r = renderMusic(plan, { stems, loudness, brightness: request.brightness, onProgress: (p) => p - last >= 0.02 && post({ id, type: "download", progress: (last = p) }) });
    const b = balance(r.mix[0], r.mix[1], r.rate);
    const s = stats(r.mix[0], r.mix[1]);
    const measured = { ...r.master, plr: +(r.master.true_peak_dbtp - r.master.lufs).toFixed(2), correlation: s.correlation, clipped: s.clipped, low: b.low, mid: b.mid, high: b.high, slope_db_per_octave: b.slope };
    if (pcm) {
      post({ id, type: "done", rate: r.rate, left: r.mix[0], right: r.mix[1], measured }, [r.mix[0].buffer, r.mix[1].buffer]);
      return;
    }
    const seed = ditherSeed(plan);
    const mix = encodeWav(r.mix, r.rate, seed);
    const files: Record<string, Uint8Array> = {};
    if (r.stems) STEMS.forEach((stem, k) => (files[stem] = encodeWav(r.stems![stem], r.rate, seed + k + 1)));
    post({ id, type: "done", mix, stems: r.stems ? files : null, measured }, [mix.buffer, ...Object.values(files).map((f) => f.buffer as ArrayBuffer)]);
  } catch (err) {
    post({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
