// Export settings as data, and the pure math that turns the dialog's choices
// into an export plan: output size, frame mapping between rates, bitrates,
// the size estimate and the audio windows. The dialog mirrors CapCut's
// (docs/research/CapCut desktop.md §6.1); the engine (src/engine/export.ts)
// runs the plan. Nothing here touches the DOM or WebCodecs.

import { ratioOf } from "./canvas";
import { projectDuration } from "./project/ops";
import type { Project } from "./project/types";
import { FPS_PRESETS, fpsValue, type Rational } from "./time";

export type VideoFormat = "mp4" | "mov" | "webm" | "mkv" | "gif";
export type AudioFormat = "wav" | "m4a" | "mp3";
export type Container = VideoFormat | AudioFormat;
export type VideoCodec = "avc" | "hevc" | "vp9" | "av1" | "gif";
export type AudioCodec = "aac" | "opus" | "mp3" | "pcm-s16";
export type QualityLevel = "lower" | "recommended" | "higher" | "custom";
export type ResolutionId = "480p" | "720p" | "1080p" | "2k" | "4k";

/** Video containers, the codecs each accepts (preference order), and the
 * sound that goes with them (ADR-015). */
export const VIDEO_FORMATS: Record<VideoFormat, { label: string; codecs: VideoCodec[]; audio: AudioCodec; mime: string }> = {
  mp4: { label: "MP4", codecs: ["avc", "hevc", "av1"], audio: "aac", mime: "video/mp4" },
  mov: { label: "MOV", codecs: ["avc", "hevc"], audio: "aac", mime: "video/quicktime" },
  webm: { label: "WebM", codecs: ["vp9", "av1"], audio: "opus", mime: "video/webm" },
  mkv: { label: "MKV", codecs: ["avc", "hevc", "vp9", "av1"], audio: "opus", mime: "video/x-matroska" },
  // Silent; its own encoder (src/engine/gif.ts). The audio entry is unused.
  gif: { label: "GIF (animated)", codecs: ["gif"], audio: "aac", mime: "image/gif" },
};

export const AUDIO_FORMATS: Record<AudioFormat, { label: string; codec: AudioCodec; mime: string }> = {
  m4a: { label: "AAC (M4A)", codec: "aac", mime: "audio/mp4" },
  // Encoded by LAME in WebAssembly where the platform has no MP3 encoder
  // (every webview today): engine/export.ts loads it when needed.
  mp3: { label: "MP3", codec: "mp3", mime: "audio/mpeg" },
  wav: { label: "WAV", codec: "pcm-s16", mime: "audio/wav" },
};

export const CODEC_LABELS: Record<VideoCodec, string> = {
  avc: "H.264",
  hevc: "HEVC (H.265)",
  vp9: "VP9",
  av1: "AV1",
  gif: "GIF",
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
/** GIF rates: low, as GIFs are; 15 is the usual one. */
export const GIF_FPS: { label: string; fps: Rational }[] = [10, 12, 15, 20, 25].map((n) => ({ label: String(n), fps: { num: n, den: 1 } }));
/** GIFs are built in memory: these keep the file and the wait sane. */
export const GIF_LIMITS = { seconds: 60, short: 720 };

/** Frame delays in milliseconds whose centisecond rounding (the GIF's
 * unit) adds up to the real time, so a 15 fps GIF does not run fast. */
export function gifDelays(frames: number, fps: Rational): number[] {
  const cs = (n: number) => Math.round((n * 100 * fps.den) / fps.num);
  return Array.from({ length: frames }, (_, n) => (cs(n + 1) - cs(n)) * 10);
}

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
const CODEC_EFFICIENCY: Record<VideoCodec, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4, gif: 0 };

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
 * most program audio, MP3 needs 256k to be (LAME's own guidance puts
 * transparency around V0, about 245k); PCM is what it is. */
export function audioBitrate(codec: AudioCodec): number {
  if (codec === "pcm-s16") return EXPORT_SAMPLE_RATE * EXPORT_CHANNELS * 16;
  return codec === "aac" ? 192_000 : codec === "mp3" ? 256_000 : 160_000;
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

/** An exact size for the done view: "1.2 MB", "840 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}

/** Time left, rounded the way people say it: "8 s left", "3 min left". */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !isFinite(seconds)) return "estimating time left";
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))} s left`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min left`;
  const h = Math.floor(seconds / 3600);
  return `${h} h ${Math.ceil((seconds - h * 3600) / 60)} min left`;
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
  /** Premiere's export Loudness Normalization: the integrated LUFS the
   * mix is brought to, its true peak held under -1 dBTP (-2 for -24, ATSC
   * A/85's; lib/analysis/delivery.ts ceilingFor). null = as mixed. */
  loudness: number | null;
  /** What becomes of the captions (add_captions' clips): drawn into the
   * picture, an SRT file beside the export, both, or neither. */
  captions: CaptionExport;
}

export type CaptionExport = "burn" | "srt" | "both" | "none";

/** The Export dialog's Captions choices, as export_video names them. */
export const CAPTION_EXPORTS: { id: CaptionExport; label: string }[] = [
  { id: "burn", label: "Burn into the picture" },
  { id: "srt", label: "SRT file beside it" },
  { id: "both", label: "Burn in and SRT file" },
  { id: "none", label: "Leave out" },
];

/** Whether the captions are drawn and whether an SRT goes beside the
 * file. An audio-only export has no picture to draw them in. */
export function captionPlan(s: Pick<ExportSettings, "video" | "captions">): { burn: boolean; sidecar: boolean } {
  const c = s.captions;
  return { burn: s.video && (c === "burn" || c === "both"), sidecar: c === "srt" || c === "both" };
}

/** Targets platforms and broadcasters normalize to, as the export dialog
 * offers them. */
export const LOUDNESS_TARGETS: [number, string][] = [
  [-14, "-14 LUFS · YouTube, Spotify, TikTok"],
  [-16, "-16 LUFS · Apple Music, podcasts"],
  [-23, "-23 LUFS · EBU R128 broadcast"],
  [-24, "-24 LKFS · ATSC A/85, US TV (-2 dBTP)"],
];

export interface ExportPlan {
  fileName: string;
  extension: string;
  mime: string;
  container: Container;
  video: { codec: VideoCodec; width: number; height: number; fps: Rational; bitrate: number } | null;
  audio: { codec: AudioCodec; bitrate: number; sampleRate: number; channels: number } | null;
  /** Timeline frames [from, to). */
  range: { from: number; to: number };
  /** Integrated LUFS to bring the mix to, or null for as mixed. */
  loudness: number | null;
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
    loudness: null,
    captions: "burn",
  };
}

/** A format by name, as export_video and the renderer take it: a video
 * container, or an audio one for an audio-only export. */
export function withFormat(s: ExportSettings, format: string | undefined): ExportSettings {
  if (format === undefined) return s;
  if (format in AUDIO_FORMATS) return { ...s, video: false, audio: true, audioFormat: format as AudioFormat };
  if (format in VIDEO_FORMATS) {
    const f = format as VideoFormat;
    // A container takes only some codecs (WebM: VP9 or AV1).
    return { ...s, video: true, format: f, codec: VIDEO_FORMATS[f].codecs.includes(s.codec) ? s.codec : VIDEO_FORMATS[f].codecs[0] };
  }
  throw new Error(`Unknown format ${format}: ${[...Object.keys(VIDEO_FORMATS), ...Object.keys(AUDIO_FORMATS)].join(", ")}`);
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
    if (s.audio && s.format !== "gif") audio = audioPlan(fmt.audio);
  } else {
    container = s.audioFormat;
    mime = AUDIO_FORMATS[s.audioFormat].mime;
    if (s.audio) audio = audioPlan(AUDIO_FORMATS[s.audioFormat].codec);
  }
  // A GIF frame runs about a third of a byte per pixel after LZW.
  const bits = (video?.bitrate ?? 0) + (audio?.bitrate ?? 0) + (video?.codec === "gif" ? video.width * video.height * 0.35 * 8 * (frames / Math.max(seconds, 1e-9)) : 0);
  return {
    fileName: `${safeFileName(s.name)}.${container}`,
    extension: container,
    mime,
    container,
    video,
    audio,
    range,
    loudness: audio ? (s.loudness ?? null) : null,
    frames,
    seconds,
    estimatedBytes: estimateBytes(bits, seconds),
  };
}

const audioPlan = (codec: AudioCodec) => ({ codec, bitrate: audioBitrate(codec), sampleRate: EXPORT_SAMPLE_RATE, channels: EXPORT_CHANNELS });

/** What a preset sets: the dialog's choices, never the name or range. */
export type PresetSettings = Partial<Pick<ExportSettings, "video" | "format" | "codec" | "resolution" | "quality" | "customMbps" | "fps" | "audio" | "audioFormat">>;
export interface ExportPreset {
  id: string;
  label: string;
  settings: PresetSettings;
  /** Saved by the viewer, not built in. */
  own?: boolean;
  /** The canvas shape it is made for (w:h), when it is made for one:
   * the settings scale the canvas, they never reshape it (ADR-073). */
  shape?: { w: number; h: number };
}

/** Where videos usually go (CapCut's and Premiere's named presets). A
 * preset without a frame rate keeps the project's. */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "youtube-1080", label: "YouTube 1080p", settings: { video: true, format: "mp4", codec: "avc", resolution: "1080p", quality: "recommended", audio: true } },
  { id: "youtube-4k", label: "YouTube 4K", settings: { video: true, format: "mp4", codec: "avc", resolution: "4k", quality: "recommended", audio: true } },
  { id: "social", label: "TikTok, Reels and Shorts", shape: { w: 9, h: 16 }, settings: { video: true, format: "mp4", codec: "avc", resolution: "1080p", quality: "higher", fps: { num: 30, den: 1 }, audio: true } },
  { id: "small", label: "Small file (720p)", settings: { video: true, format: "mp4", codec: "avc", resolution: "720p", quality: "lower", audio: true } },
  { id: "master", label: "High quality master (HEVC)", settings: { video: true, format: "mov", codec: "hevc", resolution: "4k", quality: "higher", audio: true } },
  { id: "gif", label: "Animated GIF", settings: { video: true, format: "gif", codec: "gif", resolution: "480p", fps: { num: 15, den: 1 }, audio: false } },
  { id: "wav", label: "Audio only (WAV)", settings: { video: false, audio: true, audioFormat: "wav" } },
  { id: "mp3", label: "Audio only (MP3)", settings: { video: false, audio: true, audioFormat: "mp3" } },
];

/** Whether the settings are the preset's. */
export const presetMatches = (s: ExportSettings, pr: ExportPreset) =>
  (Object.entries(pr.settings) as [keyof PresetSettings, unknown][]).every(([k, v]) => JSON.stringify(s[k]) === JSON.stringify(v));

/** Whether a canvas has the preset's shape (any size), or it has none. */
export const fitsShape = (pr: ExportPreset, canvas: { width: number; height: number }) =>
  !pr.shape || Math.abs(pr.shape.w / pr.shape.h - canvas.width / canvas.height) < 0.01;

/** The preset the settings match, if any. A preset made for a shape only
 * matches a canvas of that shape: settings remembered from a 9:16 export
 * no longer show a 16:9 project as "TikTok, Reels and Shorts". */
export function matchingPreset(s: ExportSettings, presets: ExportPreset[], canvas?: { width: number; height: number }): ExportPreset | undefined {
  return presets.find((pr) => presetMatches(s, pr) && (!canvas || fitsShape(pr, canvas)));
}

/** What to tell someone who picked a preset made for another shape, or
 * null when the canvas fits it. `size` is what the export will be. */
export function shapeWarning(pr: ExportPreset, canvas: { width: number; height: number }, size: { width: number; height: number } | null): string | null {
  if (fitsShape(pr, canvas) || !pr.shape) return null;
  const want = `${pr.shape.w}:${pr.shape.h}`;
  const have = ratioOf(canvas.width, canvas.height)?.label ?? `${canvas.width}×${canvas.height}`;
  return `Made for ${want} video. This project is ${have}, so it exports${size ? ` at ${size.width}×${size.height}` : " in that shape"}: export settings never reshape the canvas.`;
}

/** The settings worth keeping as a preset. */
export function presetOf(s: ExportSettings): PresetSettings {
  return s.video
    ? { video: true, format: s.format, codec: s.codec, resolution: s.resolution, quality: s.quality, ...(s.quality === "custom" ? { customMbps: s.customMbps } : {}), fps: s.fps, audio: s.audio && s.format !== "gif" }
    : { video: false, audio: true, audioFormat: s.audioFormat };
}

/** Why the Export button is disabled, in words; null when it is not. */
export function exportBlocker(p: Project, s: ExportSettings, inOut: { inPoint: number | null; outPoint: number | null }): string | null {
  if (projectDuration(p) === 0) return "The timeline is empty. Add a clip to export.";
  if (!s.video && !s.audio) return "Turn on Video or Audio to export.";
  const r = exportRange(p, s.range, inOut.inPoint, inOut.outPoint);
  if (r.to <= r.from) return "The In and Out points mark an empty range.";
  if (s.video && outputFrameCount(r.to - r.from, p.fps, s.fps) === 0) return "The range is shorter than one frame.";
  if (s.video && s.format === "gif") {
    if (((r.to - r.from) * p.fps.den) / p.fps.num > GIF_LIMITS.seconds) return `GIFs are limited to ${GIF_LIMITS.seconds} seconds: mark In and Out and export that range.`;
    if ((RESOLUTIONS.find((x) => x.id === s.resolution)?.short ?? 1080) > GIF_LIMITS.short) return `GIFs go up to ${GIF_LIMITS.short}p: choose a lower resolution.`;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
