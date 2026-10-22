import { beforeEach, expect, it, vi } from "vitest";
import { clipForAsset, createProject, createTrack } from "../lib/project/defaults";
import type { Project } from "../lib/project/types";

const state = vi.hoisted(() => ({ project: undefined as unknown as Project, edits: 0 }));
vi.mock("./store", () => ({ store: { edit: (_label: string, fn: (p: Project) => Project) => { state.edits++; state.project = fn(state.project); }, subscribe: () => () => {}, get: () => ({ project: state.project, selected: new Set() }) } }));
vi.mock("./actions", () => ({ edit: (_label: string, fn: (p: Project) => Project) => { state.project = fn(state.project); } }));
vi.mock("./toast", () => ({ toast: () => "toast", updateToast: () => {}, dismiss: () => {} }));
vi.mock("../platform", () => ({ platform: {} }));
vi.mock("./media", () => ({ adoptAndImport: vi.fn() }));
vi.mock("../engine/analyze", () => ({ decodeMono: vi.fn(async () => new Float32Array(16000)), decodePcm: vi.fn(), frameGrays: vi.fn(), frameScores: vi.fn(), measureLoudness: vi.fn() }));
vi.mock("../engine/transcribe", () => ({ transcribePcm: vi.fn(async () => [
  { text: " Well,", start: 24.7, end: 25 },
  { text: " um,", start: 25.28, end: 25.5 },
  { text: " we", start: 25.7, end: 26 },
  { text: " go.", start: 26.1, end: 26.4 },
]) }));
import { transcribePcm } from "../engine/transcribe";
import { decodeMono } from "../engine/analyze";
import { analyzeFillers } from "./ai";
import { runCommand } from "../lib/commands";
import { autoCaptions } from "./captions";
import { projectWork } from "./projectWork";
import { clipTranscript, hearAsset } from "./transcript";

beforeEach(() => { vi.clearAllMocks(); state.edits = 0; projectWork.open(); });
it("hears only a requested clip window and reuses that window without treating the rest of a VOD as heard", async () => {
  const p = createProject();
  const a = { id: "bounded-vod", kind: "video" as const, name: "VOD.mp4", src: "vod.mp4", duration: 7200, hasAudio: true, hasVideo: true };
  p.assets = [a];
  await hearAsset(p, a.id, { from: 24, to: 27 });
  await hearAsset(p, a.id, { from: 24, to: 27 });
  expect(decodeMono).toHaveBeenCalledTimes(1);
  expect(decodeMono).toHaveBeenCalledWith(a, 24, 27, 16000, expect.any(Function), expect.any(AbortSignal));
  expect(transcribePcm).toHaveBeenCalledWith(expect.any(Float32Array), 24, expect.anything(), expect.any(Function), expect.any(AbortSignal));
  await hearAsset(p, a.id, { from: 60, to: 80 });
  expect(decodeMono).toHaveBeenCalledTimes(2);
  expect(decodeMono).toHaveBeenLastCalledWith(a, 60, 80, 16000, expect.any(Function), expect.any(AbortSignal));
});
it("get_transcript and filler removal share a clip-window hearing, including ' um,'", async () => {
  projectWork.open();
  const p = createProject();
  const asset = { id: "source", kind: "audio" as const, name: "interview.wav", src: "interview.wav", duration: 34, hasAudio: true, hasVideo: false };
  const clip = { ...clipForAsset(asset, 0, p.fps), in: 24, duration: 90 };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Interview"), role: "dialog", clips: [clip] }] };
  const transcript = await clipTranscript(clip.id);
  const fillers = await analyzeFillers(clip.id);
  expect(transcript.words.map((w) => w.text)).toContain(" um,");
  expect(fillers.words).toEqual(["um,"]);
  expect(fillers.heard).toBe(transcript.words.length);
  expect(decodeMono).toHaveBeenCalledWith(asset, 21, 30, 16000, expect.any(Function), expect.any(AbortSignal));
  expect(transcribePcm).toHaveBeenCalledTimes(1);
  // A different model still means a deliberate new hearing, as in the UI.
  await analyzeFillers(clip.id, { model: "onnx-community/whisper-small.en_timestamped" });
  expect(transcribePcm).toHaveBeenCalledTimes(2);
});


it("auto captions maps cut source words, applies only the new look, and edits once", async () => {
  const p = createProject();
  const asset = { id: "captions-source", kind: "audio" as const, name: "interview.wav", src: "interview.wav", duration: 34, hasAudio: true, hasVideo: false };
  const clip = { ...clipForAsset(asset, 0, p.fps), in: 24, duration: 90 };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Interview"), role: "dialog", clips: [clip] }] };
  state.project = runCommand(state.project, "add_captions", { captions: [{ start: 4, end: 5, text: "Existing" }], style: { color: "#ff0000" } });
  state.project = runCommand(state.project, "cut_ranges", { clip_id: clip.id, ranges: [{ start: 25.1, end: 25.6 }], ripple: true });
  const result = await autoCaptions("", { words_per_caption: 2, replace: false, look: "pop", style: { color: "#00ffff" }, y: -0.2, detail: "full" });
  expect(result.words).toBe(3);
  // The default English model (base.en) refuses a language; the desktop run threw on "en".
  expect(vi.mocked(transcribePcm).mock.calls.at(-1)![2]).toMatchObject({ language: null });
  expect(result.captions!.map((c) => c.text)).toEqual(["Well,", "we go."]);
  expect(result.captions![1].start).toBeCloseTo(1.2, 2);
  expect(state.edits).toBe(1);
  const texts = state.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text");
  expect(texts.find((c) => c.text === "Existing")!.style.color).toBe("#ff0000");
  const added = texts.find((c) => c.text === "we go.")!;
  expect(added.style.color).toBe("#00ffff");
  expect(added.style.highlight).toBeDefined();
  expect(added.wordTimes).toHaveLength(2);
  expect(added.transform.y).toBe(-0.2);
});

it("auto captions keeps the script spelling and clips to a requested stretch", async () => {
  const p = createProject();
  const asset = { id: "script-source", kind: "audio" as const, name: "voice.wav", src: "voice.wav", duration: 3, hasAudio: true, hasVideo: false, speech: { text: "Save 20% off today.", voice: "af_heart", speed: 1 } };
  vi.mocked(transcribePcm).mockResolvedValueOnce([
    { text: " save", start: 0.2, end: 0.5 }, { text: " twenty", start: 0.6, end: 0.9 }, { text: " percent", start: 0.9, end: 1.2 }, { text: " off", start: 1.3, end: 1.5 }, { text: " today.", start: 1.6, end: 2 },
  ]);
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Voiceover"), role: "dialog", clips: [clipForAsset(asset, 0, p.fps)] }] };
  const full = await autoCaptions("", { words_per_caption: 2, detail: "full" });
  expect(full.captions!.map((c) => c.text).join(" ")).toBe("Save 20% off today.");
  const partial = await autoCaptions("", { start: 1.3, end: 1.9, detail: "full" });
  expect(partial.captions!.every((c) => c.start >= 1.3 && c.end <= 1.9)).toBe(true);
  expect(partial.words).toBe(2);
  expect(state.project.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text")).toHaveLength(partial.count);
  expect(transcribePcm).toHaveBeenCalledTimes(1);
});

it("refuses an empty or music-only timeline without editing", async () => {
  state.project = createProject();
  await expect(autoCaptions("")).rejects.toThrow(/Nothing.*speech/);
  const p = state.project;
  const asset = { id: "music-source", kind: "audio" as const, name: "song.wav", src: "song.wav", duration: 3, hasAudio: true, hasVideo: false };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Music"), role: "music", clips: [clipForAsset(asset, 0, p.fps)] }] };
  await expect(autoCaptions("")).rejects.toThrow(/Nothing.*speech/);
  expect(state.edits).toBe(0);
  expect(transcribePcm).not.toHaveBeenCalled();
});


it("shares simultaneous transcript and filler requests for one asset", async () => {
  const p = createProject();
  const asset = { id: "simultaneous-source", kind: "audio" as const, name: "interview.wav", src: "interview.wav", duration: 34, hasAudio: true, hasVideo: false };
  const clip = { ...clipForAsset(asset, 0, p.fps), in: 24, duration: 90 };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Interview"), role: "dialog", clips: [clip] }] };
  const [transcript, fillers] = await Promise.all([clipTranscript(clip.id), analyzeFillers(clip.id)]);
  expect(fillers.heard).toBe(transcript.words.length);
  expect(fillers.words).toEqual(["um,"]);
  expect(transcribePcm).toHaveBeenCalledTimes(1);
});

it("reports whole-line readability from exact frames before rounding answer timestamps", async () => {
  const p = createProject({ fps: { num: 30, den: 1 } });
  const asset = { id: "short-caption-source", kind: "audio" as const, name: "short.wav", src: "short.wav", duration: 25 / 30, hasAudio: true, hasVideo: false };
  const c = clipForAsset(asset, 0, p.fps);
  vi.mocked(transcribePcm).mockResolvedValueOnce([{ text: "Hello.", start: 0, end: 0.4 }]);
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Dialog"), role: "dialog", clips: [c] }] };
  const result = await autoCaptions("", { detail: "full" });
  expect(result.last.end).toBe(0.833);
  expect(result.readability?.met).toBe(true);
});

it("captions a 30-second middle clip by hearing 36 seconds, then reuses it for transcript", async () => {
  const p = createProject({ fps: { num: 30, den: 1 } });
  const asset = { id: "six-minute-window", kind: "audio" as const, name: "VOD.wav", src: "six.wav", duration: 360, hasAudio: true, hasVideo: false };
  const clip = { ...clipForAsset(asset, 0, p.fps), in: 180, duration: 900 };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Dialog"), role: "dialog", clips: [clip] }] };
  vi.mocked(decodeMono).mockResolvedValueOnce(new Float32Array(36 * 16000));
  vi.mocked(transcribePcm).mockResolvedValueOnce([{ text: " Hello.", start: 181, end: 182 }]);
  const result = await autoCaptions("");
  expect(decodeMono).toHaveBeenCalledWith(asset, 177, 213, 16000, expect.any(Function), expect.any(AbortSignal));
  expect(result).toMatchObject({ audio_seconds: 36, model: "onnx-community/whisper-base.en_timestamped", words: 1 });
  const reused = await clipTranscript(clip.id);
  expect(reused).toMatchObject({ audio_seconds: 0, cached: true });
  expect(transcribePcm).toHaveBeenCalledTimes(1);
});

it("a project switch rejects a queued hearing promptly and discards late words", async () => {
  const p = createProject();
  const asset = { id: "canceled-source", kind: "audio" as const, name: "VOD.wav", src: "canceled.wav", duration: 360, hasAudio: true, hasVideo: false };
  const clip = { ...clipForAsset(asset, 0, p.fps), in: 180, duration: 900 };
  state.project = { ...p, assets: [asset], tracks: [{ ...createTrack("audio", "Dialog"), role: "dialog", clips: [clip] }] };
  let finish!: (words: { text: string; start: number; end: number }[]) => void;
  vi.mocked(transcribePcm).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const hearing = clipTranscript(clip.id);
  const canceled = expect(hearing).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(transcribePcm).toHaveBeenCalledTimes(1));
  projectWork.close();
  await canceled;
  finish([{ text: "late", start: 181, end: 182 }]);
  projectWork.open();
  await clipTranscript(clip.id);
  expect(transcribePcm).toHaveBeenCalledTimes(2);
});

it("hears a long source in bounded overlapping windows and drops words on session end", async () => {
  const p = createProject();
  const asset = { id: "long-bounded-source", kind: "audio" as const, name: "long.wav", src: "long.wav", duration: 181, hasAudio: true, hasVideo: false };
  p.assets = [asset];
  vi.mocked(transcribePcm).mockImplementation(async (_pcm, offset) => [{ text: "spoken", start: offset + 2, end: offset + 3 }]);
  const result = await hearAsset(p, asset.id);
  expect(result.cached).toBe(false);
  expect(vi.mocked(decodeMono).mock.calls.map(c => [c[1], c[2]])).toEqual([[0, 61], [59, 121], [119, 181], [179, 181]]);
  expect(vi.mocked(decodeMono).mock.calls.every(c => c[2] - c[1] <= 62)).toBe(true);
  const count = vi.mocked(decodeMono).mock.calls.length;
  expect((await hearAsset(p, asset.id)).cached).toBe(true);
  projectWork.close(); projectWork.open();
  expect((await hearAsset(p, asset.id)).cached).toBe(false);
  expect(decodeMono).toHaveBeenCalledTimes(count * 2);
});
