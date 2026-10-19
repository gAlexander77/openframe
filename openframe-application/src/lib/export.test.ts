import { describe, expect, it } from "vitest";
import {
  audioWindows,
  CAPTION_EXPORTS,
  captionPlan,
  withFormat,
  defaultExportSettings,
  defaultResolution,
  estimateBytes,
  exportBlocker,
  EXPORT_PRESETS,
  gifDelays,
  matchingPreset,
  shapeWarning,
  presetOf,
  exportRange,
  formatBytes,
  formatEta,
  formatSize,
  fpsOptions,
  outputFrameCount,
  outputSize,
  planExport,
  renamedNote,
  safeFileName,
  timelineFrameFor,
  videoBitrate,
} from "./export";
import { createColorClip, createProject } from "./project/defaults";
import type { Project } from "./project/types";

const f30 = { num: 30, den: 1 };
const f24 = { num: 24, den: 1 };
const f60 = { num: 60, den: 1 };
const f2997 = { num: 30000, den: 1001 };
const noRange = { inPoint: null, outPoint: null };

function withClip(p: Project, frames: number): Project {
  const main = p.tracks[0];
  return { ...p, tracks: [{ ...main, clips: [createColorClip("#ff0000", 0, frames)] }] };
}

describe("output size", () => {
  it("names the short side, so portrait 1080p is 1080 wide", () => {
    expect(outputSize({ width: 1920, height: 1080 }, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize({ width: 1080, height: 1920 }, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize({ width: 1920, height: 1080 }, 2160)).toEqual({ width: 3840, height: 2160 });
  });
  it("keeps both sides even for 4:2:0 encoders", () => {
    // 21:9 at 480p is 1120 x 480; 4:3 at 720p is 960 x 720; an odd aspect rounds.
    expect(outputSize({ width: 2520, height: 1080 }, 480)).toEqual({ width: 1120, height: 480 });
    const odd = outputSize({ width: 1001, height: 999 }, 480);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });
  it("defaults to the preset nearest the project", () => {
    expect(defaultResolution({ width: 1920, height: 1080 })).toBe("1080p");
    expect(defaultResolution({ width: 1080, height: 1920 })).toBe("1080p");
    expect(defaultResolution({ width: 3840, height: 2160 })).toBe("4k");
    expect(defaultResolution({ width: 640, height: 360 })).toBe("480p");
  });
});

describe("frame rates", () => {
  it("offers CapCut's five plus the project's own", () => {
    expect(fpsOptions(f30).map((o) => o.label)).toEqual(["24", "25", "30", "50", "60"]);
    expect(fpsOptions(f2997).map((o) => o.label)).toEqual(["24", "25", "29.97", "30", "50", "60"]);
  });
  it("maps output frames one for one at the project rate", () => {
    expect(outputFrameCount(300, f30, f30)).toBe(300);
    for (const n of [0, 1, 150, 299]) expect(timelineFrameFor(n, 12, f30, f30)).toBe(12 + n);
  });
  it("drops frames going down and repeats them going up", () => {
    expect(outputFrameCount(300, f30, f24)).toBe(240);
    expect([0, 1, 2, 3, 4].map((n) => timelineFrameFor(n, 0, f30, f24))).toEqual([0, 1, 2, 3, 5]);
    expect(outputFrameCount(300, f30, f60)).toBe(600);
    expect([0, 1, 2, 3].map((n) => timelineFrameFor(n, 0, f30, f60))).toEqual([0, 0, 1, 1]);
  });
  it("is exact at NTSC rates over an hour", () => {
    const hour = 107892; // 29.97 frames in an hour
    expect(outputFrameCount(hour, f2997, f2997)).toBe(hour);
    expect(timelineFrameFor(hour - 1, 0, f2997, f2997)).toBe(hour - 1);
  });
});

describe("bitrates and size", () => {
  it("uses YouTube's 8 Mbps for recommended 1080p30 H.264", () => {
    expect(videoBitrate("avc", 1920, 1080, f30, "recommended")).toBe(8_000_000);
    expect(videoBitrate("avc", 1920, 1080, f30, "lower")).toBe(4_000_000);
    expect(videoBitrate("avc", 1920, 1080, f30, "higher")).toBe(16_000_000);
  });
  it("scales with size, rate and codec efficiency", () => {
    const hd60 = videoBitrate("avc", 1920, 1080, f60, "recommended");
    expect(hd60 / 1e6).toBeGreaterThan(11);
    expect(hd60 / 1e6).toBeLessThan(13);
    const uhd = videoBitrate("avc", 3840, 2160, f30, "recommended") / 1e6;
    expect(uhd).toBeGreaterThan(25);
    expect(uhd).toBeLessThan(40);
    expect(videoBitrate("hevc", 1920, 1080, f30, "recommended")).toBeLessThan(videoBitrate("avc", 1920, 1080, f30, "recommended"));
  });
  it("takes a custom bitrate in Mbps", () => {
    expect(videoBitrate("avc", 1920, 1080, f30, "custom", 12.5)).toBe(12_500_000);
  });
  it("estimates bytes from bits and seconds", () => {
    expect(estimateBytes(8_000_000, 10)).toBe(10_100_000);
    expect(formatSize(10_100_000)).toBe("about 10 MB");
    expect(formatSize(2_345_000)).toBe("about 2.3 MB");
    expect(formatSize(1_500_000_000)).toBe("about 1.5 GB");
    expect(formatSize(1000)).toBe("under 1 MB");
  });
});

describe("done and progress text", () => {
  it("states exact sizes", () => {
    expect(formatBytes(840_000)).toBe("840 KB");
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
    expect(formatBytes(2_500_000_000)).toBe("2.50 GB");
  });
  it("rounds time left up, the way people say it", () => {
    expect(formatEta(null)).toBe("estimating time left");
    expect(formatEta(7.2)).toBe("8 s left");
    expect(formatEta(150)).toBe("3 min left");
    expect(formatEta(3900)).toBe("1 h 5 min left");
  });
});

describe("ranges and windows", () => {
  const p = withClip(createProject(), 300);
  it("exports the whole timeline or the marked range", () => {
    expect(exportRange(p, "all", 30, 60)).toEqual({ from: 0, to: 300 });
    expect(exportRange(p, "inout", 30, 60)).toEqual({ from: 30, to: 60 });
    expect(exportRange(p, "inout", 60, 30)).toEqual({ from: 30, to: 60 });
    expect(exportRange(p, "inout", null, 90)).toEqual({ from: 0, to: 90 });
    expect(exportRange(p, "inout", 30, 9000)).toEqual({ from: 30, to: 300 });
  });
  it("cuts audio into sample-exact windows", () => {
    const w = audioWindows(1_000_001, 480_000);
    expect(w).toEqual([
      { start: 0, length: 480_000 },
      { start: 480_000, length: 480_000 },
      { start: 960_000, length: 40_001 },
    ]);
    expect(audioWindows(0, 480_000)).toEqual([]);
  });
});

describe("plan", () => {
  it("plans a 1080p30 MP4 with AAC by default", () => {
    const p = withClip(createProject({ name: "Trip: day 1" }), 90);
    const plan = planExport(p, defaultExportSettings(p), noRange);
    expect(plan.fileName).toBe("Trip day 1.mp4");
    expect(plan.video).toMatchObject({ codec: "avc", width: 1920, height: 1080, bitrate: 8_000_000 });
    expect(plan.audio).toMatchObject({ codec: "aac", sampleRate: 48000, channels: 2 });
    expect(plan.frames).toBe(90);
    expect(plan.seconds).toBe(3);
    expect(plan.estimatedBytes).toBe(estimateBytes(8_192_000, 3));
  });
  it("swaps a codec the container cannot carry for its first", () => {
    const p = withClip(createProject(), 30);
    const plan = planExport(p, { ...defaultExportSettings(p), format: "webm", codec: "avc" }, noRange);
    expect(plan.video?.codec).toBe("vp9");
    expect(plan.audio?.codec).toBe("opus");
  });
  it("plans audio-only when video is off", () => {
    const p = withClip(createProject(), 60);
    const plan = planExport(p, { ...defaultExportSettings(p), video: false, audioFormat: "wav" }, noRange);
    expect(plan.video).toBeNull();
    expect(plan.frames).toBe(0);
    expect(plan.fileName.endsWith(".wav")).toBe(true);
    expect(plan.audio?.codec).toBe("pcm-s16");
    expect(plan.seconds).toBe(2);
  });
  it("says why export is unavailable", () => {
    const empty = createProject();
    const s = defaultExportSettings(empty);
    expect(exportBlocker(empty, s, noRange)).toMatch(/empty/);
    const p = withClip(empty, 60);
    expect(exportBlocker(p, s, noRange)).toBeNull();
    expect(exportBlocker(p, { ...s, video: false, audio: false }, noRange)).toMatch(/Video or Audio/);
    expect(exportBlocker(p, { ...s, range: "inout" }, { inPoint: 20, outPoint: 20 })).toMatch(/empty range/);
  });
  it("cleans file names for every OS", () => {
    expect(safeFileName('a/b:c*?"<>|d')).toBe("a b c d");
    expect(safeFileName("  name. ")).toBe("name");
    expect(safeFileName("")).toBe("Untitled");
  });
  it("says when an agent's export took a numbered name, never silently", () => {
    expect(renamedNote("Trip.mp4", "D:\\Out\\Trip.mp4")).toBeUndefined();
    expect(renamedNote("Trip.mp4", "/home/x/Videos/OpenFrame/Trip (2).mp4")).toBe("Trip.mp4 was already there, so this file is Trip (2).mp4; nothing was replaced.");
  });
});

describe("GIF", () => {
  it("rounds frame delays to centiseconds without drifting", () => {
    const d = gifDelays(15, { num: 15, den: 1 });
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(new Set(d)).toEqual(new Set([60, 70]));
    expect(gifDelays(3, { num: 10, den: 1 })).toEqual([100, 100, 100]);
  });
  it("plans a silent GIF and limits its length and size", () => {
    const p = createProject();
    p.tracks[0].clips = [createColorClip("#fff", 0, 90)];
    const s = { ...defaultExportSettings(p), format: "gif" as const, codec: "gif" as const, resolution: "480p" as const, fps: { num: 15, den: 1 } };
    const plan = planExport(p, s, { inPoint: null, outPoint: null });
    expect(plan).toMatchObject({ container: "gif", audio: null, frames: 45, mime: "image/gif" });
    expect(plan.estimatedBytes).toBeGreaterThan(0);
    expect(exportBlocker(p, { ...s, resolution: "1080p" }, { inPoint: null, outPoint: null })).toMatch(/720p/);
    p.tracks[0].clips = [createColorClip("#fff", 0, 30 * 61)];
    expect(exportBlocker(p, s, { inPoint: null, outPoint: null })).toMatch(/60 seconds/);
  });
});

describe("export presets", () => {
  it("matches settings to a preset and keeps what a saved one needs", () => {
    const p = createProject();
    const s = { ...defaultExportSettings(p), ...EXPORT_PRESETS.find((x) => x.id === "gif")!.settings };
    expect(matchingPreset(s, EXPORT_PRESETS)?.id).toBe("gif");
    expect(matchingPreset({ ...s, resolution: "720p" }, EXPORT_PRESETS)).toBeUndefined();
    expect(presetOf(s)).toMatchObject({ format: "gif", audio: false });
    expect(presetOf({ ...s, video: false, audioFormat: "m4a" })).toEqual({ video: false, audio: true, audioFormat: "m4a" });
  });
});

describe("presets made for a canvas shape", () => {
  const social = EXPORT_PRESETS.find((p) => p.id === "social")!;
  const wide = createProject({ width: 1920, height: 1080 });
  const tall = createProject({ width: 1080, height: 1920 });
  const asSocial = { ...defaultExportSettings(wide), ...social.settings };

  it("names TikTok, Reels and Shorts only on a 9:16 canvas", () => {
    expect(matchingPreset(asSocial, EXPORT_PRESETS, tall)?.id).toBe("social");
    expect(matchingPreset(asSocial, EXPORT_PRESETS, wide)?.id).not.toBe("social");
  });

  it("says what a 16:9 project exports with it, and nothing on 9:16", () => {
    expect(shapeWarning(social, wide, { width: 1920, height: 1080 })).toBe(
      "Made for 9:16 video. This project is 16:9, so it exports at 1920×1080: export settings never reshape the canvas.",
    );
    expect(shapeWarning(social, tall, { width: 1080, height: 1920 })).toBeNull();
    expect(shapeWarning(EXPORT_PRESETS[0], tall, null)).toBeNull();
  });
});

describe("MP3 and captions on export", () => {
  it("plans an MP3 as an audio-only export", () => {
    const p = withClip(createProject(), 60);
    const plan = planExport(p, withFormat(defaultExportSettings(p), "mp3"), noRange);
    expect(plan).toMatchObject({ container: "mp3", extension: "mp3", mime: "audio/mpeg", video: null, frames: 0 });
    expect(plan.audio).toMatchObject({ codec: "mp3", bitrate: 256_000, sampleRate: 48000, channels: 2 });
    expect(EXPORT_PRESETS.find((x) => x.id === "mp3")!.settings).toEqual({ video: false, audio: true, audioFormat: "mp3" });
  });

  it("takes a format by name, fitting the codec to a video container", () => {
    const s = defaultExportSettings(createProject());
    expect(withFormat(s, undefined)).toBe(s);
    expect(withFormat(s, "wav")).toMatchObject({ video: false, audio: true, audioFormat: "wav" });
    expect(withFormat(s, "webm")).toMatchObject({ video: true, format: "webm", codec: "vp9" });
    expect(withFormat({ ...s, video: false }, "mov")).toMatchObject({ video: true, format: "mov", codec: "avc" });
    expect(() => withFormat(s, "avi")).toThrow("Unknown format avi");
  });

  it("burns captions in by default; an SRT goes beside the file when asked", () => {
    const s = defaultExportSettings(createProject());
    expect(s.captions).toBe("burn");
    expect(captionPlan(s)).toEqual({ burn: true, sidecar: false });
    expect(captionPlan({ ...s, captions: "srt" })).toEqual({ burn: false, sidecar: true });
    expect(captionPlan({ ...s, captions: "both" })).toEqual({ burn: true, sidecar: true });
    expect(captionPlan({ ...s, captions: "none" })).toEqual({ burn: false, sidecar: false });
    // Sound alone has no picture to burn into.
    expect(captionPlan({ ...s, video: false, captions: "both" })).toEqual({ burn: false, sidecar: true });
    expect(CAPTION_EXPORTS.map((c) => c.id)).toEqual(["burn", "srt", "both", "none"]);
  });
});
