// Export: the timeline rendered into a file, entirely on this machine
// (ADR-003), looking exactly like the preview because it runs the same plan
// (lib/render/plan.ts), sources (player.ts) and compositor.
//
// The loop is deterministic (ADR-014): for every output frame, plan it,
// await every source (never drop), composite on a private canvas, then
// await the encoder (backpressure). Sound is mixed by the preview's own
// scheduler into OfflineAudioContext windows and fed ~1 s ahead of the
// picture (ADR-016). Nothing is tied to requestAnimationFrame, timers or
// captureStream, so a slow machine takes longer but never drops a frame
// (research pitfall 23).

import { beforePlan } from "../lib/viewerCompare";
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BufferSource,
  BufferTarget,
  CanvasSource,
  Input,
  MkvOutputFormat,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  WavOutputFormat,
  WebMOutputFormat,
  canEncodeAudio,
  getEncodableVideoCodecs,
  getFirstEncodableVideoCodec,
  type OutputFormat,
  type StreamTargetChunk,
} from "mediabunny";
import {
  CODEC_LABELS,
  VIDEO_FORMATS,
  audioWindows,
  timelineFrameFor,
  type AudioCodec,
  type Container,
  type ExportPlan,
  type VideoCodec,
  type VideoFormat,
} from "../lib/export";
import { getAsset } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
import { planFrame, planLayers } from "../lib/render/plan";
import { formatTimecode, type Rational } from "../lib/time";
import { applyLimiter, LIMIT_BLOCK, LoudnessMeter } from "../lib/analysis/loudness";
import { ceilingFor, loudnessOutcome, planLoudness, type LoudnessOutcome } from "../lib/analysis/delivery";
import { toDbtp, TruePeakMeter } from "../lib/analysis/truePeak";
import { hasSound, mixPreroll, planesOf, renderMixWindow, WINDOW_SECONDS } from "./mixdown";
import { Compositor } from "./compositor";
import { CursorPool, resolveSources, sourceImages, type Resolved } from "./player";

export interface ExportProgress {
  phase: "preparing" | "rendering" | "finalizing";
  /** Output frames done (audio-only: seconds done). */
  done: number;
  total: number;
  /** 0..1 */
  fraction: number;
  /** Render speed in output frames per second, 0 until measured. */
  fps: number;
  /** Seconds left, null until measured. */
  eta: number | null;
}

export interface ExportResult {
  frames: number;
  seconds: number;
  bytes: number;
  /** Wall-clock seconds the export took. */
  elapsed: number;
  videoCodec: VideoCodec | null;
  audioCodec: AudioCodec | null;
  /** Encoder delay removed with an edit list, in samples. */
  audioDelay: number;
  /** Warnings: what did not go as asked (a codec unavailable here, a mix
   * the peaks held short of its loudness target). */
  note?: string;
  /** Good news worth saying, shown as such: a mix normalized to its
   * target, AAC encoded in software. */
  info?: string;
  /** With a loudness target: what the mix reached, before the encoder
   * (LUFS integrated, dBTP true peak). */
  loudness?: { integrated: number; truePeak: number };
}

/** An export failure with a message meant for the person exporting. */
export class ExportError extends Error {}

/** Audio is kept this far ahead of the picture as both are muxed. */
const AUDIO_LEAD = 1;
/** No encoded output for this long while we wait on the encoder = hung
 * (Safari H.264 in quality mode, some hardware encoders; pitfall 13). */
const ENCODER_STALL_MS = 15_000;
/** A single frame's sources taking this long = a stuck decoder. */
const DECODE_STALL_MS = 60_000;
/** Where the calibration click sits, in samples. */
const CLICK_AT = 9600;
const delays = new Map<AudioCodec, Promise<number>>();

/**
 * An AAC encoder's delay ("priming"), in samples, measured on this device:
 * encode a click, decode it back, see how far it moved. WebCodecs does not
 * report it and it differs by encoder: Edge's Media Foundation encoder
 * measured 0, the WASM fallback 1024 (research §4.6, ADR-016). Stamping the
 * first sample at -delay makes mediabunny write an MP4 edit list that skips
 * exactly the priming. Measured once per session (~0.1 s).
 */
export function encoderDelay(codec: "aac", bitrate: number): Promise<number> {
  let d = delays.get(codec);
  if (!d) {
    d = (async () => {
      const sr = 48000;
      const target = new BufferTarget();
      const out = new Output({ format: new Mp4OutputFormat(), target });
      const src = new AudioBufferSource({ codec, quality: new Quality({ bitrate }) });
      out.addAudioTrack(src);
      await out.start();
      const click = new AudioBuffer({ length: sr / 2, numberOfChannels: 2, sampleRate: sr });
      click.getChannelData(0)[CLICK_AT] = click.getChannelData(1)[CLICK_AT] = 0.9;
      await src.add(click);
      src.close();
      await out.finalize();
      const input = new Input({ source: new BufferSource(target.buffer!), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryAudioTrack();
        if (!track || !(await track.canDecode())) return 0;
        let pos = 0;
        let peak = 0;
        let at = CLICK_AT;
        for await (const { buffer } of new AudioBufferSink(track).buffers()) {
          const ch = buffer.getChannelData(0);
          for (let i = 0; i < ch.length; i++) {
            if (Math.abs(ch[i]) > peak) {
              peak = Math.abs(ch[i]);
              at = pos + i;
            }
          }
          pos += ch.length;
        }
        return Math.max(0, at - CLICK_AT);
      } finally {
        input.dispose();
      }
    })().catch(() => 0);
    delays.set(codec, d);
  }
  return d;
}

/** The codecs this device can encode for a container at a size and rate,
 * in the container's preference order (for the dialog to grey out). */
export async function encodableVideoCodecs(format: VideoFormat, width: number, height: number, fps: Rational, bitrate: number): Promise<VideoCodec[]> {
  if (format === "gif") return ["gif"];
  const found = await getEncodableVideoCodecs(VIDEO_FORMATS[format].codecs as MediaCodec[], {
    width,
    height,
    frameRate: fps.num / fps.den,
    quality: new Quality({ bitrate }),
  });
  return VIDEO_FORMATS[format].codecs.filter((c) => found.includes(c as MediaCodec));
}

/** An in-memory export target with positional writes (MP4 patches its
 * header at the end). For automation and tests.
 * ponytail: the whole file lives in RAM; past ~1 GB use an OPFS target. */
export function memoryTarget() {
  let buf = new Uint8Array(1 << 20);
  let size = 0;
  const writable = new WritableStream<StreamTargetChunk>({
    write({ data, position }) {
      const end = position + data.byteLength;
      if (end > buf.byteLength) {
        const grown = new Uint8Array(Math.max(end, buf.byteLength * 2));
        grown.set(buf.subarray(0, size));
        buf = grown;
      }
      buf.set(data, position);
      size = Math.max(size, end);
    },
  });
  return { writable, bytes: () => buf.slice(0, size) };
}

/** The codecs mediabunny encodes (a GIF has its own encoder). */
type MediaCodec = Exclude<VideoCodec, "gif">;

function outputFormat(c: Container, plan: ExportPlan): OutputFormat {
  // MP4/MOV reserve room for the index up front ("fast start": playable
  // while downloading) - possible because the packet counts are known.
  switch (c) {
    case "mp4":
    case "m4a":
      return new Mp4OutputFormat({ fastStart: "reserve" });
    case "mov":
      return new MovOutputFormat({ fastStart: "reserve" });
    case "webm":
      return new WebMOutputFormat();
    case "mkv":
      return new MkvOutputFormat();
    case "wav":
      return new WavOutputFormat();
    case "mp3":
      return new Mp3OutputFormat();
    case "gif": // src/engine/gif.ts writes these
    default:
      throw new ExportError(`Unknown format ${c} for ${plan.fileName}`);
  }
}

/** AAC encoding where the platform has none (Linux Chromium, Windows N,
 * some WebKitGTK builds): a WASM encoder, loaded only when needed. */
export async function ensureAac(bitrate: number): Promise<string | undefined> {
  const opts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate }) };
  if (await canEncodeAudio("aac", opts)) return undefined;
  const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
  registerAacEncoder();
  if (!(await canEncodeAudio("aac", opts))) throw new ExportError("This device can't encode AAC audio. Choose WebM, or turn audio off.");
  return "AAC is encoded in software on this device.";
}

/** MP3 encoding: no webview has an MP3 encoder (WebCodecs never added
 * one), so LAME in WebAssembly is loaded on first use. */
export async function ensureMp3(bitrate: number): Promise<void> {
  const opts = { numberOfChannels: 2, sampleRate: 48000, quality: new Quality({ bitrate }) };
  const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
  registerMp3Encoder();
  if (!(await canEncodeAudio("mp3", opts))) throw new ExportError("This device can't encode MP3 audio. Choose WAV or AAC (M4A).");
}

/**
 * Render `plan` of `project` into `target`. Resolves when the file is
 * complete; rejects with an ExportError (human message) or, when `signal`
 * aborts, with an AbortError. A canceled export aborts the target, so a
 * partial file is never committed.
 */
export async function exportProject(
  project: Project,
  plan: ExportPlan,
  target: { writable: WritableStream<StreamTargetChunk> },
  onProgress: (p: ExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<ExportResult> {
  const started = performance.now();
  const p = project;
  const notes: string[] = [];
  const infos: string[] = [];

  // ---- stop: user cancel or watchdog -----------------------------------------
  let stopError: unknown = null;
  let rejectStop!: (e: unknown) => void;
  const stopped = new Promise<never>((_, reject) => (rejectStop = reject));
  stopped.catch(() => undefined);
  const stop = (e: unknown) => {
    if (stopError) return;
    stopError = e;
    rejectStop(e);
  };
  const onAbort = () => stop(signal?.reason ?? new DOMException("Export canceled", "AbortError"));
  if (signal?.aborted) onAbort();
  signal?.addEventListener("abort", onAbort);
  /** Await `x`, unless the export is stopped first. */
  const guard = <T>(x: Promise<T>): Promise<T> => Promise.race([x, stopped]);

  // What the loop is waiting on, for the watchdog.
  let waiting: { on: "encoder" | "decoder" | "audio"; since: number; at?: number } | null = null;
  let lastPacket = performance.now();
  const wait = async <T>(on: "encoder" | "decoder" | "audio", x: Promise<T>, at?: number): Promise<T> => {
    waiting = { on, since: performance.now(), at };
    try {
      return await guard(x);
    } finally {
      waiting = null;
    }
  };
  const watchdog = setInterval(() => {
    const w = waiting;
    if (!w) return;
    const now = performance.now();
    if (w.on === "encoder" && now - Math.max(w.since, lastPacket) > ENCODER_STALL_MS) {
      stop(new ExportError(`The ${plan.video ? CODEC_LABELS[plan.video.codec] : "audio"} encoder stopped responding. Try another codec or a lower resolution.`));
    } else if (w.on !== "encoder" && now - w.since > DECODE_STALL_MS) {
      const where = w.at !== undefined ? ` at ${formatTimecode(w.at, p.fps)}` : "";
      stop(new ExportError(`Reading the media stopped responding${where}. Check that the source files are still available.`));
    }
  }, 1000);

  // ---- the canceled file must not be committed ---------------------------------
  const inner = target.writable.getWriter();
  let bytes = 0;
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => {
      bytes = Math.max(bytes, chunk.position + chunk.data.byteLength);
      return inner.write(chunk);
    },
    close: () => (stopError ? inner.abort(stopError) : inner.close()),
    abort: (reason) => inner.abort(reason),
  });

  let output: Output | null = null;
  let comp: Compositor | null = null;
  const pool = new CursorPool();
  let windowJob: { index: number; buffer: Promise<AudioBuffer> } | null = null;

  try {
    if (!plan.video && !plan.audio) throw new ExportError("Nothing to export: turn on Video or Audio.");
    onProgress({ phase: "preparing", done: 0, total: plan.frames || Math.ceil(plan.seconds), fraction: 0, fps: 0, eta: null });
    // Titles must rasterize in their real font from the first frame.
    await guard(document.fonts.ready);

    output = new Output({ format: outputFormat(plan.container, plan), target: new StreamTarget(writable, { chunked: true, chunkSize: 8 * 2 ** 20 }) });

    // ---- video track ------------------------------------------------------------
    let video: CanvasSource | null = null;
    let videoCodec: VideoCodec | null = null;
    const v = plan.video;
    if (v) {
      const fmt = VIDEO_FORMATS[plan.container as VideoFormat];
      const order = [v.codec, ...fmt.codecs.filter((c) => c !== v.codec)] as MediaCodec[];
      videoCodec = (await guard(
        getFirstEncodableVideoCodec(order, { width: v.width, height: v.height, frameRate: v.fps.num / v.fps.den, quality: new Quality({ bitrate: v.bitrate }) }),
      )) as VideoCodec | null;
      if (!videoCodec) {
        throw new ExportError(`This device can't encode ${fmt.label} video at ${v.width}×${v.height}. Try a lower resolution or another format.`);
      }
      if (videoCodec !== v.codec) notes.push(`${CODEC_LABELS[v.codec]} isn't available here, so ${CODEC_LABELS[videoCodec]} was used.`);
      comp = new Compositor(new OffscreenCanvas(v.width, v.height));
      comp.resize(v.width, v.height);
      video = new CanvasSource(comp.canvas, {
        codec: videoCodec as MediaCodec,
        quality: new Quality({ bitrate: v.bitrate, bitrateMode: "variable" }),
        keyFrameInterval: 2,
        latencyMode: "quality",
        onEncodedPacket: () => {
          lastPacket = performance.now();
        },
      });
      output.addVideoTrack(video, { frameRate: v.fps.num / v.fps.den, maximumPacketCount: Math.ceil(plan.frames * 1.05) + 16 });
    }

    // ---- audio track ------------------------------------------------------------
    const a = plan.audio;
    const totalSamples = a ? Math.round(plan.seconds * a.sampleRate) : 0;
    let audio: AudioBufferSource | null = null;
    let priming = 0;
    if (a) {
      if (a.codec === "aac") {
        const note = await guard(ensureAac(a.bitrate));
        if (note) infos.push(note);
      }
      // ponytail: LAME's encoder delay (about 1100 samples, 23 ms) is not
      // trimmed: no gapless header is written. Fine for audio-only files.
      if (a.codec === "mp3") await guard(ensureMp3(a.bitrate));
      const isobmff = plan.container === "mp4" || plan.container === "mov" || plan.container === "m4a";
      priming = a.codec === "aac" && isobmff ? await guard(encoderDelay("aac", a.bitrate)) : 0;
      audio = new AudioBufferSource(
        {
          codec: a.codec,
          ...(a.codec === "pcm-s16" ? {} : { quality: new Quality({ bitrate: a.bitrate }) }),
          onEncodedPacket: () => {
            lastPacket = performance.now();
          },
        },
        { startTimestamp: -priming / a.sampleRate },
      );
      output.addAudioTrack(audio, { maximumPacketCount: Math.ceil(((totalSamples + priming) / 960) * 1.1) + 16 });
    }

    await guard(output.start());

    // ---- audio feed: rendered in windows, added in ~1 s slices ------------------
    const fromSec = (plan.range.from * p.fps.den) / p.fps.num;
    const windows = audioWindows(totalSamples, WINDOW_SECONDS * (a?.sampleRate ?? 48000));
    const sounding = a ? hasSound(p) : false;
    let fed = 0; // samples handed to the encoder
    let slice: { buffer: AudioBuffer; offset: number } | null = null;
    // Loudness normalization, set by the measuring pass below: a gain and
    // the limiter's gains that hold the peaks it raises.
    let limit: { gain: number; gains: Float32Array } | null = null;
    // Windows start early by the longest effect tail, so a reverb rings
    // across their edges (ADR-060).
    const preroll = a && sounding ? mixPreroll(p) : 0;
    const renderWindow = (i: number): Promise<AudioBuffer> => {
      const w = windows[i];
      const sr = a!.sampleRate;
      if (!sounding) return Promise.resolve(new AudioBuffer({ length: w.length, numberOfChannels: a!.channels, sampleRate: sr }));
      return renderMixWindow(p, fromSec + w.start / sr, w.length, sr, a!.channels, preroll).then((b) => {
        if (limit) applyLimiter(planesOf(b), w.start, limit.gain, limit.gains);
        return b;
      });
    };
    // Loudness normalization (Premiere's): a first pass renders and measures
    // the whole mix (BS.1770) and its true peaks, then every window is
    // rendered again through the gain that meets the target, with a limiter
    // holding the raised true peaks under the target's ceiling (-2 dBTP for
    // ATSC A/85, else -1; ADR-061). Gain alone stopped the RacePulse promo
    // at -17 LUFS of -14: speech peaks far above its loudness.
    let finalMeter: LoudnessMeter | null = null;
    let finalPeak: TruePeakMeter | null = null;
    let loudnessNote: ((reached: number) => LoudnessOutcome) | null = null;
    if (a && sounding && plan.loudness !== null) {
      const meter = new LoudnessMeter(a.sampleRate, a.channels);
      const tp = new TruePeakMeter(a.channels);
      const peaks = new Float32Array(Math.ceil(totalSamples / LIMIT_BLOCK) + 1);
      for (let i = 0; i < windows.length; i++) {
        const b = await wait("audio", renderWindow(i));
        meter.push(planesOf(b), b.length);
        tp.push(planesOf(b), b.length, peaks);
      }
      tp.flush(peaks);
      const measured = meter.integrated();
      const ceiling = ceilingFor(plan.loudness);
      // Up to MAX_LIMITING_DB over the ceiling goes to the limiter.
      const n = planLoudness(measured, tp.peak, peaks, plan.loudness, ceiling);
      if (n) {
        limit = { gain: n.gain, gains: n.gains };
        finalMeter = new LoudnessMeter(a.sampleRate, a.channels);
        finalPeak = new TruePeakMeter(a.channels);
        const target = plan.loudness;
        loudnessNote = (reached) => loudnessOutcome(measured, reached, target, n);
      } else if (Number.isFinite(measured)) infos.push(`Loudness ${measured.toFixed(1)} LUFS, already at the target.`);
    }
    /** Next rendered window, starting the one after it in the background. */
    const nextWindow = async (i: number): Promise<AudioBuffer> => {
      const job = windowJob?.index === i ? windowJob.buffer : renderWindow(i);
      windowJob = i + 1 < windows.length ? { index: i + 1, buffer: renderWindow(i + 1) } : null;
      windowJob?.buffer.catch(() => undefined);
      return job;
    };
    let windowIndex = 0;
    const feedAudio = async (untilSec: number) => {
      if (!audio || !a) return;
      const until = Math.min(totalSamples, Math.round(untilSec * a.sampleRate));
      while (fed < until) {
        if (!slice || slice.offset >= slice.buffer.length) {
          const buffer = await wait("audio", nextWindow(windowIndex++), timelineAtSample(fed));
          finalMeter?.push(planesOf(buffer), buffer.length);
          finalPeak?.push(planesOf(buffer), buffer.length);
          slice = { buffer, offset: 0 };
        }
        const n = Math.min(a.sampleRate, slice.buffer.length - slice.offset, until - fed);
        const piece = new AudioBuffer({ length: n, numberOfChannels: a.channels, sampleRate: a.sampleRate });
        for (let c = 0; c < a.channels; c++) piece.copyToChannel(slice.buffer.getChannelData(c).subarray(slice.offset, slice.offset + n), c);
        slice.offset += n;
        fed += n;
        await wait("encoder", audio.add(piece));
      }
    };
    const timelineAtSample = (s: number) => plan.range.from + Math.floor(((s / (a?.sampleRate ?? 48000)) * p.fps.num) / p.fps.den);

    // ---- progress -----------------------------------------------------------------
    const total = v ? plan.frames : Math.max(1, totalSamples);
    const recent: { t: number; done: number }[] = [];
    let lastReport = 0;
    const report = (done: number) => {
      const now = performance.now();
      if (now - lastReport < 100) return;
      lastReport = now;
      recent.push({ t: now, done });
      while (recent.length > 2 && now - recent[0].t > 3000) recent.shift();
      const first = recent[0];
      const rate = now > first.t + 250 ? ((done - first.done) * 1000) / (now - first.t) : 0;
      const perSec = v ? rate : rate / (a?.sampleRate ?? 48000);
      onProgress({
        phase: "rendering",
        done: v ? done : done / (a?.sampleRate ?? 48000),
        total: v ? total : plan.seconds,
        fraction: total ? done / total : 1,
        fps: perSec,
        eta: rate > 0 ? (total - done) / rate : null,
      });
    };

    // ---- the loop -------------------------------------------------------------------
    if (v && video && comp) {
      const frameDur = v.fps.den / v.fps.num;
      for (let n = 0; n < plan.frames; n++) {
        if (stopError) throw stopError;
        const f = timelineFrameFor(n, plan.range.from, p.fps, v.fps);
        const items = planFrame(p, f);
        const resolved = await wait("decoder", resolveSources(p, items, pool), f);
        assertSources(p, items, resolved, f);
        comp.render(items, sourceImages(resolved, v.width, v.height), p.background);
        // CanvasSource snapshots the canvas synchronously inside add().
        await wait("encoder", video.add(n * frameDur, frameDur));
        if (n % 30 === 29) pool.sweep(2000); // clips already passed
        await feedAudio((n + 1) * frameDur + AUDIO_LEAD);
        report(n + 1);
      }
      video.close();
    }
    if (audio) {
      if (!v) {
        // Audio-only: feed by the second, reporting as we go.
        while (fed < totalSamples) {
          await feedAudio(fed / a!.sampleRate + 1);
          report(fed);
        }
      }
      await feedAudio(plan.seconds + 1);
      audio.close();
    }

    onProgress({ phase: "finalizing", done: total, total, fraction: 1, fps: 0, eta: 0 });
    await wait("encoder", output.finalize());
    if (loudnessNote && finalMeter) {
      const o = loudnessNote(finalMeter.integrated());
      (o.ok ? infos : notes).push(o.text);
    }
    finalPeak?.flush();
    return {
      ...(finalMeter && finalPeak ? { loudness: { integrated: +finalMeter.integrated().toFixed(2), truePeak: +toDbtp(finalPeak.peak).toFixed(2) } } : {}),
      frames: plan.frames,
      seconds: plan.seconds,
      bytes,
      elapsed: (performance.now() - started) / 1000,
      videoCodec,
      audioCodec: a?.codec ?? null,
      audioDelay: priming,
      ...(notes.length ? { note: notes.join(" ") } : {}),
      ...(infos.length ? { info: infos.join(" ") } : {}),
    };
  } catch (e) {
    if (!stopError) stop(e);
    await output?.cancel().catch(() => undefined);
    // mediabunny closes the stream on cancel; make sure it is aborted, not
    // committed, even if it never started.
    await inner.abort(stopError).catch(() => undefined);
    throw humanize(stopError);
  } finally {
    clearInterval(watchdog);
    signal?.removeEventListener("abort", onAbort);
    pool.clear();
    if (comp) {
      const gl = comp.gl;
      comp.dispose();
      // Free the context now: Chrome keeps ~16 and drops the OLDEST when
      // over, which would be the preview's.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
}

/** Any clip whose pixels could not be produced fails the export, rather
 * than exporting black where the preview showed a picture. */
function assertSources(p: Project, items: ReturnType<typeof planFrame>, resolved: Resolved, f: number) {
  for (const l of planLayers(items)) {
    if (l.source.kind !== "video" && l.source.kind !== "image") continue;
    const name = getAsset(p, l.source.assetId)?.name ?? "a clip";
    if (!resolved.has(l.clipId)) {
      throw new ExportError(`Couldn't read ${name} at ${formatTimecode(f, p.fps)}. Check that the file is still available.`);
    }
    // Exporting the clip with its background back would not be what the
    // preview promised.
    if (l.matte && !resolved.get(l.clipId)!.matte) {
      throw new ExportError(`The removed background of ${name} is missing. Turn Remove background off and on again to make it again.`);
    }
  }
}

function humanize(e: unknown): unknown {
  if (e instanceof ExportError || (e instanceof DOMException && e.name === "AbortError")) return e;
  const msg = e instanceof Error ? e.message : String(e);
  if (/quota|QuotaExceeded|disk|space/i.test(msg)) return new ExportError("The disk is full, so the export stopped. Free some space and try again.");
  if (/reclaim/i.test(msg)) return new ExportError("The browser closed the video encoder. Keep this window open and try again.");
  return new ExportError(`The export failed: ${msg}`);
}

/** One frame as a PNG at the export size: CapCut's "export still frame". */
export async function exportStill(p: Project, frame: number, width: number, height: number): Promise<Blob> {
  return (await exportStills(p, [frame], width, height))[0];
}

/** Frames as PNGs at the export size, drawn as the export draws them,
 * through one compositor and one set of decoders: a contact sheet's
 * frames read on through the same files instead of opening them again.
 * With `drawAt` (a larger size), each is drawn at that size and brought
 * down to width x height, as a file exported at that size looks at this
 * one: titles rasterized at a third of their size came out heavier (their
 * hinting and antialiasing thicken small type; ADR-098). Brought down
 * bilinearly, as a player scales video and as the compositor scaled
 * footage before: a smoother filter took a dark sky's grain away and its
 * JPEG sheet banded (ADR-073). */
export async function exportStills(p: Project, frames: number[], width: number, height: number, drawAt?: { width: number; height: number }, before?: { clipIds?: readonly string[]; signal?: AbortSignal }): Promise<Blob[]> {
  const big = drawAt && drawAt.width > width ? drawAt : { width, height };
  const comp = new Compositor(new OffscreenCanvas(big.width, big.height));
  const pool = new CursorPool();
  const small = big.width > width ? new OffscreenCanvas(width, height) : null;
  try {
    await document.fonts.ready;
    comp.resize(big.width, big.height);
    const out: Blob[] = [];
    for (const frame of frames) {
      before?.signal?.throwIfAborted();
      const plan = planFrame(p, frame);
      const items = before ? beforePlan(plan, before.clipIds) : plan;
      const resolved = await resolveSources(p, items, pool);
      before?.signal?.throwIfAborted();
      comp.render(items, sourceImages(resolved, big.width, big.height), p.background);
      if (small) {
        const bmp = await createImageBitmap(comp.canvas as OffscreenCanvas, { resizeWidth: width, resizeHeight: height, resizeQuality: "low" });
        const g = small.getContext("2d")!;
        g.clearRect(0, 0, width, height);
        g.drawImage(bmp, 0, 0);
        bmp.close();
        out.push(await small.convertToBlob({ type: "image/png" }));
      } else out.push(await (comp.canvas as OffscreenCanvas).convertToBlob({ type: "image/png" }));
    }
    return out;
  } finally {
    pool.clear();
    const gl = comp.gl;
    comp.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
