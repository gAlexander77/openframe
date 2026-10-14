// Export settings as data, and the pure math that turns the dialog's choices
// into an export plan: output size, frame mapping between rates, bitrates,
// the size estimate and the audio windows. The dialog mirrors CapCut's
// (docs/research/CapCut desktop.md §6.1); the engine (src/engine/export.ts)
// runs the plan. Nothing here touches the DOM or WebCodecs.

import { projectDuration } from "./project/ops";
import type { Project } from "./project/types";
import { FPS_PRESETS, fpsValue, type Rational } from "./time";

export type VideoFormat = "mp4" | "mov" | "webm" | "mkv";
export type AudioFormat = "wav" | "m4a";
export type Container = VideoFormat | AudioFormat;
export type VideoCodec = "avc" | "hevc" | "vp9" | "av1";
export type AudioCodec = "aac" | "opus" | "pcm-s16";
export type QualityLevel = "lower" | "recommended" | "higher" | "custom";
export type ResolutionId = "480p" | "720p" | "1080p" | "2k" | "4k";

/** Video containers, the codecs each accepts (preference order), and the
 * sound that goes with them (ADR-015). */
export const VIDEO_FORMATS: Record<VideoFormat, { label: string; codecs: VideoCodec[]; audio: AudioCodec; mime: string }> = {
  mp4: { label: "MP4", codecs: ["avc", "hevc", "av1"], audio: "aac", mime: "video/mp4" },
  mov: { label: "MOV", codecs: ["avc", "hevc"], audio: "aac", mime: "video/quicktime" },
  webm: { label: "WebM", codecs: ["vp9", "av1"], audio: "opus", mime: "video/webm" },
  mkv: { label: "MKV", codecs: ["avc", "hevc", "vp9", "av1"], audio: "opus", mime: "video/x-matroska" },
};

export const AUDIO_FORMATS: Record<AudioFormat, { label: string; codec: AudioCodec; mime: string }> = {
  m4a: { label: "AAC (M4A)", codec: "aac", mime: "audio/mp4" },
  wav: { label: "WAV", codec: "pcm-s16", mime: "audio/wav" },
};

export const CODEC_LABELS: Record<VideoCodec, string> = {
  avc: "H.264",
  hevc: "HEVC (H.265)",
  vp9: "VP9",
  av1: "AV1",
};

/** CapCut's presets. The number names the short side, so "1080p" of a 9:16
 * project is 1080 x 1920. */
export const RESOLUTIONS: { id: ResolutionId; label: string; short: number }[] = [
  { id: "480p", label: "480p", short: 480 },
  { id: "720p", label: "720p", short: 720 },
  { id: "1080p", label: "1080p", short: 1080 },
  { id: "2k", label: "2K", short: 1440 },
  { id: "4k", label: "4K", short: 2160 },
];

export const QUALITY_LEVELS: { id: QualityLevel; label: string }[] = [
  { id: "lower", label: "Lower" },
  { id: "recommended", label: "Recommended" },
  { id: "higher", label: "Higher" },
  { id: "custom", label: "Custom" },
];

/** Mix rate and layout of every export (the project's mix rate). */
export const EXPORT_SAMPLE_RATE = 48000;
export const EXPORT_CHANNELS = 2;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output pixels for a preset: the short side is the preset, the long side
 * follows the project's aspect, and both are even (4:2:0 chroma halves each
 * axis, so H.264 and HEVC refuse odd sizes). */
export function outputSize(canvas: { width: number; height: number }, short: number) {
  const landscape = canvas.width >= canvas.height;
  const aspect = landscape ? canvas.width / canvas.height : canvas.height / canvas.width;
  const s = even(short);
  const l = even(short * aspect);
  return landscape ? { width: l, height: s } : { width: s, height: l };
}

/** The preset nearest the project's own short side (a 1080x1920 project
 * defaults to 1080p, as CapCut's does). */
export function defaultResolution(canvas: { width: number; height: number }): ResolutionId {
  const short = Math.min(canvas.width, canvas.height);
  let best = RESOLUTIONS[0];
  for (const r of RESOLUTIONS) if (Math.abs(r.short - short) < Math.abs(best.short - short)) best = r;
  return best.id;
}

/** Frame rates the dialog offers: CapCut's five, plus the project's own
 * when it is another (23.976, 29.97, 59.94), in ascending order. */
export function fpsOptions(projectFps: Rational): { label: string; fps: Rational }[] {
  const base = FPS_PRESETS.filter((p) => ["24", "25", "30", "50", "60"].includes(p.label));
  const own = FPS_PRESETS.find((p) => sameRate(p.fps, projectFps)) ?? { label: fpsLabel(projectFps), fps: projectFps };
  const list = base.some((p) => sameRate(p.fps, projectFps)) ? base : [...base, own];
  return list.sort((a, b) => fpsValue(a.fps) - fpsValue(b.fps));
}

export const sameRate = (a: Rational, b: Rational) => a.num * b.den === b.num * a.den;

export function fpsLabel(fps: Rational): string {
  const v = fpsValue(fps);
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "");
}

// ---- bitrates and the size estimate ---------------------------------------------

/** Relative bits each codec needs for the same picture (mediabunny's codec
 * efficiency table; AVC is the reference). */
const CODEC_EFFICIENCY: Record<VideoCodec, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4 };

/** "Recommended" is YouTube's upload guidance for H.264 SDR: 8 Mbps at
 * 1080p30. Lower halves it, Higher doubles it. */
const RECOMMENDED_1080P30 = 8_000_000;
const LEVEL_FACTOR: Record<Exclude<QualityLevel, "custom">, number> = { lower: 0.5, recommended: 1, higher: 2 };

/**
 * Video bits per second for a quality level. Scales with pixels^0.9 and
 * rate^0.6, which tracks YouTube's ladder (5 Mbps 720p30, 12 Mbps 1080p60,
 * ~35 Mbps 4K30) without a table per size.
 */
export function videoBitrate(codec: VideoCodec, width: number, height: number, fps: Rational, level: QualityLevel, customMbps = 8): number {
  if (level === "custom") return Math.round(clamp(customMbps, 0.2, 400) * 1e6);
  const pixels = (width * height) / (1920 * 1080);
  const rate = Math.max(1, fpsValue(fps)) / 30;
  const bps = RECOMMENDED_1080P30 * pixels ** 0.9 * rate ** 0.6 * CODEC_EFFICIENCY[codec] * LEVEL_FACTOR[level];
  return Math.round(bps / 1000) * 1000;
}

/** Audio bits per second: AAC at 192k and Opus at 160k are transparent for
 * most program audio; PCM is what it is. */
export function audioBitrate(codec: AudioCodec): number {
  if (codec === "pcm-s16") return EXPORT_SAMPLE_RATE * EXPORT_CHANNELS * 16;
  return codec === "aac" ? 192_000 : 160_000;
}

/** Expected file size in bytes: the bitrates over the duration, plus ~1%
 * container overhead. Variable bitrate lands within ~20% of this. */
export function estimateBytes(bitsPerSecond: number, seconds: number): number {
  return Math.round(((bitsPerSecond * seconds) / 8) * 1.01);
}

/** "about 12 MB", the way CapCut's footer says it. */
export function formatSize(bytes: number): string {
  if (bytes < 1e6) return "under 1 MB";
  if (bytes < 1e9) return `about ${bytes < 1e7 ? (bytes / 1e6).toFixed(1) : Math.round(bytes / 1e6)} MB`;
  return `about ${(bytes / 1e9).toFixed(1)} GB`;
}

// ---- frames, ranges, audio windows -----------------------------------------------

/** Timeline frames [from, to) to export. Out points are exclusive, like a
 * clip's end (rangeToClip sets out = start + duration). */
export function exportRange(p: Project, mode: "all" | "inout", inPoint: number | null, outPoint: number | null) {
  const end = projectDuration(p);
  if (mode === "all") return { from: 0, to: end };
  const a = clamp(inPoint ?? 0, 0, end);
  const b = clamp(outPoint ?? end, 0, end);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/** Output frames for `frames` timeline frames re-timed to `out` fps. At the
 * project rate it is one for one. */
export function outputFrameCount(frames: number, project: Rational, out: Rational): number {
  return Math.round((frames * out.num * project.den) / (out.den * project.num));
}

/** The timeline frame on screen at output frame n: the frame showing at
 * that instant, so a lower rate drops frames and a higher one repeats them
 * (no blending, as CapCut without optical flow). */
export function timelineFrameFor(n: number, from: number, project: Rational, out: Rational): number {
  return from + Math.floor((n * out.den * project.num) / (out.num * project.den) + 1e-9);
}

/** Split `total` samples into windows of at most `size`, sample-exact, so
 * consecutive OfflineAudioContext renders butt together with no gap or
 * overlap (research §4.3). */
export function audioWindows(total: number, size: number): { start: number; length: number }[] {
  const out: { start: number; length: number }[] = [];
  for (let start = 0; start < total; start += size) out.push({ start, length: Math.min(size, total - start) });
  return out;
}

// ---- settings and plans ------------------------------------------------------------

export interface ExportSettings {
  name: string;
  /** Off = audio-only export in `audioFormat`. */
  video: boolean;
  format: VideoFormat;
  codec: VideoCodec;
  resolution: ResolutionId;
  quality: QualityLevel;
  /** Video bitrate for the Custom level, Mbps. */
  customMbps: number;
  fps: Rational;
  audio: boolean;
  audioFormat: AudioFormat;
  range: "all" | "inout";
}

export interface ExportPlan {
  fileName: string;
  extension: string;
  mime: string;
  container: Container;
  video: { codec: VideoCodec; width: number; height: number; fps: Rational; bitrate: number } | null;
  audio: { codec: AudioCodec; bitrate: number; sampleRate: number; channels: number } | null;
  /** Timeline frames [from, to). */
  range: { from: number; to: number };
  /** Output video frames; 0 for audio-only. */
  frames: number;
  seconds: number;
  estimatedBytes: number;
}

export function defaultExportSettings(p: Project): ExportSettings {
  const resolution = defaultResolution(p);
  const short = RESOLUTIONS.find((r) => r.id === resolution)!.short;
  const { width, height } = outputSize(p, short);
  return {
    name: p.name,
    video: true,
    format: "mp4",
    codec: "avc",
    resolution,
    quality: "recommended",
    customMbps: Math.round(videoBitrate("avc", width, height, p.fps, "recommended") / 1e5) / 10,
    fps: p.fps,
    audio: true,
    audioFormat: "m4a",
    range: "all",
  };
}

/** Characters Windows, macOS and Linux all accept in a file name. */
export function safeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
  return clean || "Untitled";
}

export function planExport(p: Project, s: ExportSettings, inOut: { inPoint: number | null; outPoint: number | null }): ExportPlan {
  const range = exportRange(p, s.range, inOut.inPoint, inOut.outPoint);
  const timelineFrames = range.to - range.from;
  let video: ExportPlan["video"] = null;
  let audio: ExportPlan["audio"] = null;
  let container: Container;
  let mime: string;
  let frames = 0;
  let seconds = (timelineFrames * p.fps.den) / p.fps.num;
  if (s.video) {
    const fmt = VIDEO_FORMATS[s.format];
    const codec = fmt.codecs.includes(s.codec) ? s.codec : fmt.codecs[0];
    const short = (RESOLUTIONS.find((r) => r.id === s.resolution) ?? RESOLUTIONS[2]).short;
    const { width, height } = outputSize(p, short);
    frames = outputFrameCount(timelineFrames, p.fps, s.fps);
    seconds = (frames * s.fps.den) / s.fps.num;
    video = { codec, width, height, fps: s.fps, bitrate: videoBitrate(codec, width, height, s.fps, s.quality, s.customMbps) };
    container = s.format;
    mime = fmt.mime;
    if (s.audio) audio = audioPlan(fmt.audio);
  } else {
    container = s.audioFormat;
    mime = AUDIO_FORMATS[s.audioFormat].mime;
    if (s.audio) audio = audioPlan(AUDIO_FORMATS[s.audioFormat].codec);
  }
  const bits = (video?.bitrate ?? 0) + (audio?.bitrate ?? 0);
  return {
    fileName: `${safeFileName(s.name)}.${container}`,
    extension: container,
    mime,
    container,
    video,
    audio,
    range,
    frames,
    seconds,
    estimatedBytes: estimateBytes(bits, seconds),
  };
}

const audioPlan = (codec: AudioCodec) => ({ codec, bitrate: audioBitrate(codec), sampleRate: EXPORT_SAMPLE_RATE, channels: EXPORT_CHANNELS });

/** Why the Export button is disabled, in words; null when it is not. */
export function exportBlocker(p: Project, s: ExportSettings, inOut: { inPoint: number | null; outPoint: number | null }): string | null {
  if (projectDuration(p) === 0) return "The timeline is empty. Add a clip to export.";
  if (!s.video && !s.audio) return "Turn on Video or Audio to export.";
  const r = exportRange(p, s.range, inOut.inPoint, inOut.outPoint);
  if (r.to <= r.from) return "The In and Out points mark an empty range.";
  if (s.video && outputFrameCount(r.to - r.from, p.fps, s.fps) === 0) return "The range is shorter than one frame.";
  return null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
