import { beforeEach, expect, it, vi } from "vitest";
import { createProject, clipForAsset } from "../lib/project/defaults";
import type { Asset } from "../lib/project/types";
import { planMoments, type Measures, type ShotLog } from "../lib/shotlog";
import { platform } from "../platform";
import { memoryOwners } from "../engine/memory";
import { findAssetHighlights } from "./highlights";
import { store } from "./store";
import { jobs } from "./jobs";
import { projectWork } from "./projectWork";
import { analyzeFootage, borrowShotThumbnail, cancelShotLog, holdShotLog, loadShotLog, peekShotLog, shotLogJobAnswer, shotLogTool, SHOTLOG_DESKTOP_NOTE } from "./shotlog";
import { cachedAssetWords, hearAsset } from "./transcript";

vi.mock("../platform", () => ({ platform: { kind: "desktop", shotlog: { measure: vi.fn(), frames: vi.fn(), load: vi.fn(), save: vi.fn() }, describer: { status: vi.fn(), prepare: vi.fn(), ask: vi.fn(), stop: vi.fn() } } }));
vi.mock("./transcript", () => ({ cachedAssetWords: vi.fn(), hearAsset: vi.fn() }));
const asset: Asset = { id: "a", src: "a.mp4", name: "Footage", kind: "video", duration: 96, hasAudio: true, hasVideo: true };
const description = JSON.stringify({ shot_size: "medium", camera: "static", people: 1, on_screen_text: ["NASA"], action: "An astronaut waves.", mood: "calm", description: "A launch room." });
const reading: Measures = { duration: 96, width: 100, height: 100, frame_rate: 1, scene: Array(96).fill(0), step: 0.5, motion: Array(192).fill(0.02), luma: Array(192).fill(0.5), dx: [], dy: [], rgb: Array.from({ length: 192 }, () => [100, 100, 100]), audio_step: 0.1, audio_db: Array(960).fill(-20) };
const d = platform.describer!, s = platform.shotlog!;
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
let saved = new Map<string, string>();
beforeEach(() => {
  vi.resetAllMocks(); saved = new Map();
  const p = createProject(); p.assets = [asset]; const clip = clipForAsset(asset, 0, p.fps); if (clip.type !== "video") throw new Error("Expected video"); p.tracks[0].clips = [{ ...clip, id: "clip", in: 16, duration: 240 }]; store.load(p);
  vi.mocked(s.load).mockImplementation(async src => saved.get(src) ?? null);
  vi.mocked(s.save).mockImplementation(async (src, json) => { saved.set(src, json); });
  vi.mocked(s.measure).mockImplementation(async (_, progress) => { progress(0.5); return reading; });
  vi.mocked(s.frames).mockResolvedValue(["jpeg"]);
  const ready = { state: "ready" as const, runtime_installed: true, model_installed: true, bytes_needed: 0, device: "Vulkan1", error: null };
  vi.mocked(d.status).mockResolvedValue({ ...ready, state: "missing", bytes_needed: 2980000000 });
  vi.mocked(d.prepare).mockImplementation(async progress => { progress({ stage: "model", fraction: 0.5, bytes: 1490000000, total: 2980000000 }); return ready; });
  vi.mocked(d.ask).mockResolvedValue(description);
});
it("runs the exact fake platform pipeline, saves every ten descriptions and reports first-use bytes without editing", async () => {
  const p = store.document(), job = analyzeFootage("a");
  expect(analyzeFootage("a", { refresh: true }).job_id).toBe(job.job_id);
  const result = await shotLogJobAnswer(job) as Record<string, unknown>;
  expect(result).toMatchObject({ asset_id: "a", moments: 12, described: 12, complete: true, first_use_download_bytes: 2980000000 });
  expect(s.measure).toHaveBeenCalledWith("a.mp4", expect.any(Function), expect.any(AbortSignal));
  expect(s.frames).toHaveBeenNthCalledWith(1, "a.mp4", [1.2, 4, 6.8], 768);
  expect(s.frames).toHaveBeenNthCalledWith(2, "a.mp4", [65.2, 68, 70.8], 768);
  expect(d.ask).toHaveBeenCalledWith(expect.objectContaining({ images: ["jpeg"], maxTokens: 300, schema: expect.any(Object) }));
  expect(s.save).toHaveBeenCalledTimes(3); expect(store.document()).toBe(p); expect(store.history().undo).toEqual([]);
  expect(memoryOwners.snapshot().shot_logs.bytes).toBeGreaterThan(0);
});
it("measures only without preparing; resumes descriptions from disk and refreshes on demand", async () => {
  await shotLogJobAnswer(analyzeFootage("a", { describe: false }));
  expect(d.prepare).not.toHaveBeenCalled(); expect(peekShotLog("a")!.complete).toBe(false);
  memoryOwners.endSession();
  await shotLogJobAnswer(analyzeFootage("a"));
  expect(s.measure).toHaveBeenCalledTimes(1); expect(d.ask).toHaveBeenCalledTimes(12);
  await shotLogJobAnswer(analyzeFootage("a")); expect(d.ask).toHaveBeenCalledTimes(12);
  await shotLogJobAnswer(analyzeFootage("a", { refresh: true, describe: false, interval: 4 }));
  expect(s.measure).toHaveBeenCalledTimes(2); expect(peekShotLog("a")!.moments).toHaveLength(24);
});
it("keeps a canceled run's completed moments and continues in coarse-to-fine order", async () => {
  const gate = deferred<string>();
  vi.mocked(d.ask).mockImplementationOnce(() => gate.promise).mockImplementationOnce(() => gate.promise);
  const job = analyzeFootage("a");
  await vi.waitFor(() => expect(d.ask).toHaveBeenCalledTimes(2));
  cancelShotLog("a");
  const resumed = analyzeFootage("a"); expect(resumed.job_id).not.toBe(job.job_id);
  gate.resolve(description);
  await vi.waitFor(() => expect(vi.mocked(s.save).mock.calls.some(([, json]) => JSON.parse(json).moments.filter((m: ShotLog["moments"][number]) => m.described).length === 2)).toBe(true));
  expect(jobs.status(job.job_id).state).toBe("canceled");
  await shotLogJobAnswer(resumed);
  expect(d.ask).toHaveBeenCalledTimes(12); expect(peekShotLog("a")!.complete).toBe(true);
  expect(s.measure).toHaveBeenCalledTimes(1);
});
it("cancels measurement with the session signal and never repopulates a closed session", async () => {
  const gate = deferred<Measures>(); vi.mocked(s.measure).mockImplementationOnce(() => gate.promise);
  const job = analyzeFootage("a"); await vi.waitFor(() => expect(s.measure).toHaveBeenCalled());
  const signal = vi.mocked(s.measure).mock.calls[0][2]!;
  store.load(createProject()); expect(signal.aborted).toBe(true); gate.resolve(reading);
  await Promise.resolve(); await Promise.resolve();
  expect(jobs.status(job.job_id).state).toBe("canceled"); expect(s.frames).not.toHaveBeenCalled(); expect(peekShotLog("a")).toBeUndefined();
});
it("saves completed descriptions from an old session only to its captured source", async () => {
  const gate = deferred<string>(); vi.mocked(d.ask).mockImplementationOnce(() => gate.promise).mockImplementationOnce(() => gate.promise);
  const job = analyzeFootage("a"); await vi.waitFor(() => expect(d.ask).toHaveBeenCalledTimes(2));
  store.load(createProject()); gate.resolve(description);
  await vi.waitFor(() => expect(JSON.parse(saved.get("a.mp4")!).moments.filter((m: ShotLog["moments"][number]) => m.described)).toHaveLength(2));
  expect(jobs.status(job.job_id).state).toBe("canceled"); expect(memoryOwners.snapshot().shot_logs.count).toBe(0);
});
it("isolates simultaneous assets and rejects invalid intervals and model answers", async () => {
  store.set({ project: { ...store.document(), assets: [asset, { ...asset, id: "b", src: "b.mp4" }] } });
  const a = analyzeFootage("a", { describe: false }), b = analyzeFootage("b", { describe: false });
  expect(a.job_id).not.toBe(b.job_id); await Promise.all([shotLogJobAnswer(a), shotLogJobAnswer(b)]);
  expect(() => analyzeFootage("a", { interval: 3 })).toThrow("4 to 30");
  vi.mocked(d.ask).mockResolvedValue("invalid");
  await shotLogJobAnswer(analyzeFootage("a")); expect(peekShotLog("a")!.complete).toBe(false);
});
it("reads the clip source window and searches all disk logs without starting speech work", async () => {
  await shotLogJobAnswer(analyzeFootage("a"));
  const text = await shotLogTool("get_shot_log", { clip_id: "clip" });
  expect(text).toContain("00:16.00"); expect(text).not.toContain("00:00.00");
  expect(cachedAssetWords).toHaveBeenCalledWith("a", 16, 24);
  const json = await shotLogTool("get_shot_log", { asset_id: "a", from: 0, to: 8, format: "json", speech: false }) as ShotLog;
  expect(json.moments).toHaveLength(1);
  memoryOwners.endSession();
  const matches = await shotLogTool("find_shots", { query: "NASA", limit: 1 }) as unknown[];
  expect(matches).toHaveLength(1); expect(s.measure).toHaveBeenCalledTimes(1);
  expect(await shotLogTool("suggest_edit_points", { asset_id: "a", ranges: [{ start: 0, end: 3 }, { start: 4, end: 6 }] })).toMatchObject({ ranges: [expect.objectContaining({ join_to_next: expect.arrayContaining([expect.objectContaining({ kind: "jump_cut" })]) }), expect.any(Object)] });
});
it("answers missing-log and web errors explicitly, and rejects malformed disk logs", async () => {
  await expect(shotLogTool("get_shot_log", { asset_id: "a" })).rejects.toThrow("analyze_footage");
  saved.set("a.mp4", '{"version":1}'); expect(await loadShotLog("a")).toBeUndefined();
  const oldS = platform.shotlog, oldD = platform.describer; delete platform.shotlog; delete platform.describer;
  try { for (const name of ["analyze_footage", "get_shot_log", "find_shots", "suggest_edit_points", "describe_moment"]) await expect(shotLogTool(name, { asset_id: "a" })).rejects.toThrow(SHOTLOG_DESKTOP_NOTE); }
  finally { platform.shotlog = oldS; platform.describer = oldD; }
});
it("describes a specific moment directly when ready, clamps frames, and prepares through a job otherwise", async () => {
  vi.mocked(d.status).mockResolvedValueOnce({ state: "ready", runtime_installed: true, model_installed: true, bytes_needed: 0, device: null, error: null });
  expect(await shotLogTool("describe_moment", { asset_id: "a", time: 0 })).toMatchObject({ frames: [0, 0, 1], answer: { shot_size: "medium" } });
  expect(d.prepare).not.toHaveBeenCalled();
  vi.mocked(d.ask).mockResolvedValueOnce("One person waves.");
  expect(await shotLogTool("describe_moment", { asset_id: "a", time: 4, question: "What changes?" })).toMatchObject({ answer: "One person waves." });
  expect(d.prepare).toHaveBeenCalledTimes(1); expect(d.ask).toHaveBeenLastCalledWith(expect.not.objectContaining({ schema: expect.any(Object) }));
  expect(projectWork.signal().aborted).toBe(false);
});

it("allows analysis after cancellation before the job body starts", async () => {
  const first = analyzeFootage("a"); cancelShotLog("a");
  await vi.waitFor(() => expect(jobs.status(first.job_id).state).toBe("canceled"));
  const next = analyzeFootage("a", { describe: false });
  expect(next.job_id).not.toBe(first.job_id); await shotLogJobAnswer(next);
});
it("persists completed descriptions when a later inference fails", async () => {
  vi.mocked(d.ask).mockResolvedValueOnce(description).mockRejectedValueOnce(new Error("model failed"));
  await expect(shotLogJobAnswer(analyzeFootage("a"))).rejects.toThrow("model failed");
  const disk = JSON.parse(saved.get("a.mp4")!) as ShotLog;
  expect(disk.moments.filter(m => m.described).length).toBeGreaterThanOrEqual(1); expect(disk.complete).toBe(false);
});
it("uses an installed but stopped describer directly; native ask starts it", async () => {
  vi.mocked(d.status).mockResolvedValueOnce({ state: "stopped", runtime_installed: true, model_installed: true, bytes_needed: 0, device: null, error: null });
  expect(await shotLogTool("describe_moment", { asset_id: "a", time: 10 })).toMatchObject({ time: 10, answer: { camera: "static" } });
  expect(d.prepare).not.toHaveBeenCalled();
});

it("drains a canceled source's partial save before another session resumes that file", async () => {
  const gate = deferred<string>(); vi.mocked(d.ask).mockImplementationOnce(() => gate.promise).mockImplementationOnce(() => gate.promise);
  analyzeFootage("a"); await vi.waitFor(() => expect(d.ask).toHaveBeenCalledTimes(2));
  const document = store.document(); store.load(document);
  const next = analyzeFootage("a");
  await Promise.resolve(); await Promise.resolve();
  expect(d.ask).toHaveBeenCalledTimes(2); expect(s.measure).toHaveBeenCalledTimes(1);
  gate.resolve(description); await shotLogJobAnswer(next);
  expect(d.ask).toHaveBeenCalledTimes(12); expect(s.measure).toHaveBeenCalledTimes(1);
  expect(peekShotLog("a")!.complete).toBe(true);
});

it("accounts for a visible log larger than the idle cache, releasing the borrow on close", async () => {
  const moments = planMoments(96, [], 0.02);
  for (const m of moments) m.described = { shot_size: "medium", camera: "static", people: 1, on_screen_text: Array(6).fill("x".repeat(60)), action: "x".repeat(160), mood: "x".repeat(40), description: "x".repeat(320) };
  saved.set("a.mp4", JSON.stringify({ version: 1, duration: 96, interval: 4, model: "test", measured_at: "today", shots: [{ start: 0, end: 96 }], moments, silences: [], complete: true }));
  const log = (await loadShotLog("a"))!;
  expect(log.moments).toHaveLength(4800); expect(peekShotLog("a")).toBeUndefined();
  const release = holdShotLog("a", log);
  expect(memoryOwners.snapshot().shot_logs.bytes).toBeGreaterThan(8 * 2 ** 20);
  release(); expect(memoryOwners.snapshot().shot_logs.bytes).toBe(0);
  holdShotLog("a", log); memoryOwners.endSession(); expect(memoryOwners.snapshot().shot_logs.bytes).toBe(0);
});


it("records a video with no audio instead of quiet audio", async () => {
  vi.mocked(s.measure).mockResolvedValueOnce({ ...reading, audio_db: [] });
  await shotLogJobAnswer(analyzeFootage("a", { describe: false }));
  expect(peekShotLog("a")).toMatchObject({ has_audio: false, silences: [] });
  expect(await shotLogTool("get_shot_log", { asset_id: "a", detail: "brief" })).toContain("[no audio]");
});
it("clamps every range and names the empty one", async () => {
  await shotLogJobAnswer(analyzeFootage("a", { describe: false }));
  expect(await shotLogTool("suggest_edit_points", { asset_id: "a", ranges: [{ start: -2, end: 4 }, { start: 90, end: 110 }] })).toMatchObject({ ranges: [{ start: 0, end: 4 }, { start: 90, end: 96 }] });
  await expect(shotLogTool("suggest_edit_points", { asset_id: "a", ranges: [{ start: 0, end: 4 }, { start: 100, end: 110 }] })).rejects.toThrow("Range 2");
});
it("frames questions as one moment of one video", async () => {
  vi.mocked(d.ask).mockResolvedValueOnce("One astronaut");
  await shotLogTool("describe_moment", { asset_id: "a", time: 4, question: "What changes?" });
  expect(vi.mocked(d.ask).mock.calls[0][0].prompt).toContain("3 frames from one moment of one video");
  expect(vi.mocked(d.ask).mock.calls[0][0].prompt).toContain("seconds apart");
});
it("explains reversed and sped-up clip playback in both read tools", async () => {
  const p = store.document(), c = p.tracks[0].clips[0];
  store.set({ project: { ...p, tracks: [{ ...p.tracks[0], clips: [{ ...c, reverse: true, speed: 2 } as typeof c] }] } });
  await shotLogJobAnswer(analyzeFootage("a", { describe: false }));
  const text = await shotLogTool("get_shot_log", { clip_id: "clip" });
  expect(text).toContain("reversed at 2x; times here are source seconds");
  expect(await shotLogTool("suggest_edit_points", { clip_id: "clip", ranges: [{ start: 10, end: 20 }] })).toMatchObject({ note: expect.stringContaining("reversed at 2x") });
});
it("explains picture and sound-only targets before measuring", async () => {
  for (const [kind, name, hasVideo, hasAudio, message] of [["image", "Photo", true, false, "Photo is a picture"], ["audio", "Song", false, true, "Song is sound only"]] as const) {
    store.set({ project: { ...store.document(), assets: [{ ...asset, kind, name, hasVideo, hasAudio }] } });
    expect(() => analyzeFootage("a")).toThrow(message);
  }
  expect(s.measure).not.toHaveBeenCalled();
});


it("hears speech only when requested and skips files measured without audio", async () => {
  await shotLogJobAnswer(analyzeFootage("a", { describe: false })); expect(hearAsset).not.toHaveBeenCalled();
  vi.mocked(hearAsset).mockImplementationOnce(async (_p, _id, _opts, _signal, progress) => {
    progress?.({ stage: "transcribing", progress: 0.5 });
    expect(jobs.all().some(j => j.stage === "Hearing speech")).toBe(true);
    return { audio_seconds: 96, elapsed_seconds: 1, model: "test", cached: false };
  });
  await shotLogJobAnswer(analyzeFootage("a", { speech: true, describe: false }));
  expect(hearAsset).toHaveBeenCalledWith(store.get().project, "a", {}, expect.any(AbortSignal), expect.any(Function));
  vi.mocked(hearAsset).mockClear(); vi.mocked(s.measure).mockResolvedValueOnce({ ...reading, audio_db: [] });
  await shotLogJobAnswer(analyzeFootage("a", { refresh: true, speech: true, describe: false })); expect(hearAsset).not.toHaveBeenCalled();
});
it("caches 160px middle-frame thumbnails, shares pending work and releases them with the project", async () => {
  const gate = deferred<string[]>(); vi.mocked(s.frames).mockReturnValueOnce(gate.promise);
  const first = borrowShotThumbnail("a", 4), second = borrowShotThumbnail("a", 4);
  expect(s.frames).toHaveBeenCalledExactlyOnceWith("a.mp4", [4], 160);
  gate.resolve(["jpeg"]); const a = await first, b = await second;
  expect(a?.src).toBe("data:image/jpeg;base64,jpeg"); expect(b?.src).toBe(a?.src);
  a?.release(); b?.release();
  const cached = await borrowShotThumbnail("a", 4); cached?.release(); expect(s.frames).toHaveBeenCalledTimes(1);
  expect(memoryOwners.snapshot().shot_log_thumbnails.bytes).toBeGreaterThan(0);
  const late = deferred<string[]>(); vi.mocked(s.frames).mockReturnValueOnce(late.promise);
  const pending = borrowShotThumbnail("a", 12); store.load(createProject()); late.resolve(["late"]);
  expect(await pending).toBeUndefined(); expect(memoryOwners.snapshot().shot_log_thumbnails.bytes).toBe(0);
});
it("does not request thumbnails on the web", async () => {
  const old = platform.shotlog; delete platform.shotlog;
  try { expect(await borrowShotThumbnail("a", 4)).toBeUndefined(); expect(s.frames).not.toHaveBeenCalled(); }
  finally { platform.shotlog = old; }
});


it("lets find_highlights read a saved log and report its picture signal", async () => {
  store.set({ project: { ...store.document(), assets: [{ ...asset, hasAudio: false }] } });
  vi.mocked(s.measure).mockResolvedValueOnce({ ...reading, audio_db: [] });
  vi.mocked(d.ask).mockResolvedValue(JSON.stringify({ ...JSON.parse(description), action: "People cheering and raising their arms", mood: "euphoric" }));
  await shotLogJobAnswer(analyzeFootage("a"));
  const calls = vi.mocked(d.ask).mock.calls.length;
  const answer = await findAssetHighlights({ asset_id: "a", scenes: false, count: 1, min_length: 1, max_length: 8 });
  expect(answer.signals).toContain("shot_log");
  expect(answer.highlights[0].reasons.join()).toContain("picture: People cheering");
  expect(d.ask).toHaveBeenCalledTimes(calls);
});


it("serializes ten-moment checkpoints while the second worker continues and counts finished moments", async () => {
  store.set({ project: { ...store.document(), assets: [{ ...asset, duration: 192 }] } });
  vi.mocked(s.measure).mockResolvedValueOnce({ ...reading, duration: 192 });
  const gate = deferred<void>(); let saves = 0;
  vi.mocked(s.save).mockImplementation(async (src, json) => {
    if (++saves === 2) await gate.promise;
    saved.set(src, json);
  });
  const job = analyzeFootage("a");
  try {
    await vi.waitFor(() => expect(d.ask).toHaveBeenCalledTimes(20));
    expect(s.save).toHaveBeenCalledTimes(2);
    expect(jobs.status(job.job_id)).toMatchObject({ progress: 20 / 24, stage: "Described 20 of 24 moments" });
  } finally { gate.resolve(); }
  await shotLogJobAnswer(job);
  expect(vi.mocked(s.save).mock.calls.map(([, json]) => JSON.parse(json).moments.filter((m: ShotLog["moments"][number]) => m.described).length)).toEqual([0, 10, 20, 24]);
  expect(JSON.parse(saved.get("a.mp4")!).complete).toBe(true);
});
it("uses Y1's overall download fractions and byte counts across runtime and model stages", async () => {
  vi.mocked(d.prepare).mockImplementationOnce(async progress => {
    progress({ stage: "runtime", fraction: 0.1, bytes: 300000000, total: 3000000000 });
    expect(jobs.all().find(j => j.state === "running")!).toMatchObject({ progress: 0.1, stage: "Downloading the describer: runtime (0.30 / 3.00 GB)" });
    progress({ stage: "model", fraction: 0.75, bytes: 2250000000, total: 3000000000 });
    expect(jobs.all().find(j => j.state === "running")!).toMatchObject({ progress: 0.75, stage: "Downloading the describer: model (2.25 / 3.00 GB)" });
    return { state: "ready", runtime_installed: true, model_installed: true, bytes_needed: 0, device: "Vulkan1", error: null };
  });
  await shotLogJobAnswer(analyzeFootage("a"));
});


it("does not refill thumbnail caches after explicit memory-owner cleanup", async () => {
  const gate = deferred<string[]>(); vi.mocked(s.frames).mockReturnValueOnce(gate.promise);
  const pending = borrowShotThumbnail("a", 4);
  memoryOwners.endSession(); gate.resolve(["late"]);
  expect(await pending).toBeUndefined(); expect(memoryOwners.snapshot().shot_log_thumbnails.bytes).toBe(0);
});
