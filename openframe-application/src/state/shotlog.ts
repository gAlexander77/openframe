import { useSyncExternalStore } from "react";
import { memoryOwners, MiB } from "../engine/memory";
import { ByteLru, retainedBytes } from "../lib/memory";
import { cutsFrom, describeOrder, editPoints, findMoments, joinAdvice, measureMoment, momentPrompt, MOMENT_SCHEMA, parseMoment, pageBlocks, parseShotLog, planMoments, screenplayBlocks, silencesFrom, type Range, type ShotLog } from "../lib/shotlog";
import { findClip, sourceRange } from "../lib/project/ops";
import { platform } from "../platform";
import type { DescriberStatus } from "../platform/types";
import type { JobContext, JobStatus } from "../lib/jobs";
import { jobs } from "./jobs";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { cachedAssetWords } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";

/** About 10,000 tokens: what an agent can read of a long log in one answer. */
export const SHOT_LOG_PAGE_CHARS = 40000;

export const SHOTLOG_DESKTOP_NOTE = "Shot logs need the desktop app: it runs a local vision model this browser build cannot.";
export const SHOTLOG_MODEL = "Qwen3-VL-4B-Instruct-Q4_K_M";
const logs = new ByteLru<string, ShotLog>(8 * MiB);
const running = new Map<string, string>();
const shown = new Map<object, { key: string; log: ShotLog }>();
/** A visible log is borrowed until its panel unmounts, even if it exceeds
 * the idle cache budget. Account for that working value separately. */
export function holdShotLog(id: string, log: ShotLog) {
  const token = {};
  shown.set(token, { key: keyOf(id), log });
  return () => { shown.delete(token); };
}
// Drain a canceled native call and its partial save before reopening the
// same source, even across document sessions. The contract cannot abort ask.
const sourceWork = new Map<string, Promise<void>>();
let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; listeners.forEach(l => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useShotLogs = () => useSyncExternalStore(subscribe, () => version);
const keyOf = (id: string) => {
  const a = store.get().project.assets.find(a => a.id === id);
  return a ? JSON.stringify([a.id, a.src, a.size, a.duration]) : id;
};
export const peekShotLog = (id: string) => logs.get(keyOf(id));
export const shotLogJob = (id: string) => { const job = running.get(keyOf(id)); return job ? jobs.status(job) : undefined; };
export const cancelShotLog = (id: string) => { const job = shotLogJob(id); if (job) { jobs.cancel(job.job_id); changed(); } };
memoryOwners.register("shot_logs", () => {
  const borrowed = new Set([...shown.values()].filter(v => logs.peek(v.key) !== v.log).map(v => v.log));
  return { bytes: logs.bytes + [...borrowed].reduce((n, log) => n + retainedBytes(log), 0), count: logs.size + borrowed.size, budget: logs.budget, detail: "8 MiB idle cache; visible borrowed logs stay until the panel closes" };
}, () => { logs.clear(); shown.clear(); running.clear(); changed(); });

export function shotLogTarget(args: { asset_id?: string; clip_id?: string }) {
  if (!!args.asset_id === !!args.clip_id) throw new Error("Give exactly one asset_id or clip_id");
  const p = store.get().project;
  const clip = args.clip_id ? findClip(p, args.clip_id)?.clip : undefined;
  if (args.clip_id && clip?.type !== "video") throw new Error("Choose a video clip");
  const asset = p.assets.find(a => a.id === (args.asset_id ?? (clip && "assetId" in clip ? clip.assetId : "")));
  if (!asset?.hasVideo) throw new Error("Choose a video asset");
  const [start, end] = clip?.type === "video" ? sourceRange(clip, p.fps) : [0, asset.duration];
  const range = { start: Math.max(0, start), end: Math.min(asset.duration, clip?.type === "video" && clip.freeze ? start + 1 / (p.fps.num / p.fps.den) : end) };
  return { asset, clip, range };
}
export async function loadShotLog(id: string): Promise<ShotLog | undefined> {
  const key = keyOf(id), cached = logs.get(key);
  if (cached) return cached;
  const scope = projectWork.capture(), asset = store.get().project.assets.find(a => a.id === id);
  if (!asset || !platform.shotlog) return;
  const saved = await platform.shotlog.load(asset.src);
  scope.throwIfAborted();
  if (keyOf(id) !== key) return;
  const log = saved ? parseShotLog(saved) : undefined;
  if (log) { logs.set(key, log, retainedBytes(log)); changed(); return log; }
}
/** Test fixture injection for the real web drive; never persisted in a project. */
export function installShotLogForTest(id: string, log: ShotLog) {
  if (!import.meta.env.DEV) throw new Error("Shot log fixtures require a development build");
  const parsed = parseShotLog(JSON.stringify(log));
  if (!parsed || !store.get().project.assets.some(a => a.id === id)) throw new Error("Invalid shot log fixture");
  logs.set(keyOf(id), parsed, retainedBytes(parsed)); changed();
}
const packed = (answer: unknown) => ({ content: [{ type: "text", text: JSON.stringify(answer) }] });
export async function shotLogJobAnswer(status: JobStatus, wait = 45) {
  const result = await jobs.wait(status.job_id, wait);
  if (result.state === "failed") throw new Error(result.error);
  if (result.state === "done") {
    const answer = result.result as { content: { text: string }[] } | undefined;
    if (!answer) throw new Error("Shot log answer was released; read get_shot_log");
    return JSON.parse(answer.content[0].text);
  }
  return { ...result, note: "call job_status with job_id; cancel_job stops it" };
}
async function prepare(context: JobContext, progress: (stage: string, fraction: number) => void): Promise<number> {
  const d = platform.describer!;
  const status = await d.status(); context.signal.throwIfAborted();
  const bytes = status.bytes_needed;
  progress(bytes ? `Downloading the describer (${(bytes / 1e9).toFixed(1)} GB, once)` : "Preparing the describer", 0);
  await d.prepare(p => { if (!context.signal.aborted) progress(p.stage === "starting" ? "Preparing the describer" : `Downloading the describer (${(bytes / 1e9).toFixed(1)} GB, once)`, p.fraction); });
  context.signal.throwIfAborted();
  return bytes;
}
/** UI and MCP share retained jobs, one analysis per asset in this session. */
export function analyzeFootage(assetId: string, { interval = 8, refresh = false, describe = true }: { interval?: number; refresh?: boolean; describe?: boolean } = {}) {
  if (!platform.shotlog || (describe && !platform.describer)) throw new Error(SHOTLOG_DESKTOP_NOTE);
  if (!Number.isFinite(interval) || interval < 4 || interval > 30) throw new Error("Interval must be 4 to 30 seconds");
  const { asset } = shotLogTarget({ asset_id: assetId }), scope = projectWork.capture(), key = keyOf(assetId);
  scope.throwIfAborted();
  const existing = shotLogJob(assetId);
  if (existing?.state === "running") return existing;
  let entered = false;
  const preceding = sourceWork.get(asset.src);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const drained = (preceding ?? Promise.resolve()).then(() => gate);
  sourceWork.set(asset.src, drained);
  const finish = () => { release(); void drained.then(() => { if (sourceWork.get(asset.src) === drained) sourceWork.delete(asset.src); }); };
  const job = jobs.start("analyze_footage", store.document().id, scope, async context => {
    entered = true;
    const started = performance.now(), signal = context.signal;
    let log: ShotLog | undefined, bytes = 0, savedAtEnd = false;
    const notice = toast("Measuring shots and sound", "progress", undefined, { label: "Cancel", run: context.cancel });
    const progress = (stage: string, fraction: number) => { if (signal.aborted) return; context.progress(fraction, stage); updateToast(notice, { text: stage, progress: fraction }); changed(); };
    const current = () => { signal.throwIfAborted(); if (keyOf(assetId) !== key) throw new Error("The source changed; analyze footage again"); };
    const save = async () => {
      if (!log) return;
      // Saving a canceled run is allowed only to the captured source on disk.
      // Never repopulate a closed session's cache with a late answer.
      await platform.shotlog!.save(asset.src, JSON.stringify(log));
      if (!scope.aborted && keyOf(assetId) === key) { logs.set(key, log, retainedBytes(log)); changed(); }
    };
    try {
      await preceding; current();
      if (!refresh) log = await projectWork.within(scope, () => loadShotLog(assetId));
      current();
      if (!log) {
        progress("Measuring shots and sound", 0);
        const measured = await platform.shotlog!.measure(asset.src, f => progress("Measuring shots and sound", f), signal);
        current();
        const cuts = cutsFrom(measured), moments = planMoments(measured.duration, cuts, interval);
        if (!moments.length) throw new Error("The footage has no measurable duration");
        moments.forEach(m => { m.measured = measureMoment(m, measured); });
        const edges = [0, ...cuts, measured.duration];
        log = { version: 1, duration: measured.duration, interval, model: SHOTLOG_MODEL, measured_at: new Date().toISOString(), shots: edges.slice(0, -1).map((start, i) => ({ start, end: edges[i + 1] })), moments, silences: silencesFrom(measured), complete: false };
        await save(); current();
      }
      if (describe && !log.complete) {
        bytes = await prepare(context, progress);
        let sinceSave = 0, done = log.moments.filter(m => m.described).length;
        for (const i of describeOrder(log.moments)) {
          current();
          const m = log.moments[i];
          if (m.described) continue;
          progress(`Describing moment ${done + 1} of ${log.moments.length}`, done / log.moments.length);
          const images = await platform.shotlog!.frames(asset.src, m.frames, 768); current();
          const text = await platform.describer!.ask({ images, prompt: momentPrompt(m), schema: MOMENT_SCHEMA, maxTokens: 300 }); current();
          m.described = parseMoment(text);
          if (m.described) done++;
          if (++sinceSave === 10) { await save(); sinceSave = 0; }
        }
      }
      current();
      log.complete = log.moments.every(m => !!m.described);
      await save(); current(); savedAtEnd = true;
      return packed({ asset_id: assetId, duration: log.duration, shots: log.shots.length, moments: log.moments.length, described: log.moments.filter(m => m.described).length, complete: log.complete, model: log.model, elapsed_seconds: (performance.now() - started) / 1000, ...(bytes ? { first_use_download_bytes: bytes } : {}), note: log.complete ? "Shot log complete. Preview chosen frames before cutting." : "Partial shot log; analyze_footage continues undescribed moments." });
    } finally {
      try { if (!savedAtEnd && log) { log.complete = log.moments.every(m => !!m.described); await save(); } }
      finally { finish(); dismiss(notice); changed(); }
    }
  }, key);
  running.set(key, job); changed();
  void (async () => {
    let status;
    do { status = await jobs.wait(job, 45); } while (status.state === "running");
    if (!entered) finish();
    changed();
  })().catch(() => {});
  return jobs.status(job);
}
export const describerStatus = (): Promise<DescriberStatus | undefined> => platform.describer?.status() ?? Promise.resolve(undefined);

export async function shotLogTool(name: string, a: Record<string, unknown>): Promise<unknown> {
  // Test-installed logs let the web drive exercise read tools and the panel.
  if (!platform.shotlog && !logs.size) throw new Error(SHOTLOG_DESKTOP_NOTE);
  if (name === "analyze_footage") {
    if (!platform.shotlog || !platform.describer) throw new Error(SHOTLOG_DESKTOP_NOTE);
    const { asset } = shotLogTarget(a);
    return shotLogJobAnswer(analyzeFootage(asset.id, a), Number(a.wait ?? 45));
  }
  if (name === "find_shots") {
    const scope = projectWork.capture();
    const assets = a.asset_id ? [shotLogTarget({ asset_id: String(a.asset_id) }).asset] : store.get().project.assets.filter(a => a.hasVideo);
    const found: { asset: string; log: ShotLog }[] = [];
    for (const asset of assets) { const log = await loadShotLog(asset.id); scope.throwIfAborted(); if (log) found.push({ asset: asset.id, log }); }
    if (!platform.shotlog && !found.length) throw new Error(SHOTLOG_DESKTOP_NOTE);
    return findMoments(found, String(a.query), Number(a.limit ?? 10)).map(({ asset, ...m }) => ({ asset_id: asset, ...m }));
  }
  if (!platform.shotlog && (name === "describe_moment" || !logs.size)) throw new Error(SHOTLOG_DESKTOP_NOTE);
  const { asset, range } = shotLogTarget(a), scope = projectWork.capture();
  if (name === "describe_moment") {
    if (!platform.describer || !platform.shotlog) throw new Error(SHOTLOG_DESKTOP_NOTE);
    const time = Number(a.time), span = Number(a.span ?? 1);
    if (time > asset.duration) throw new Error("Time is outside the source duration");
    const times = [time - span, time, time + span].map(t => Math.max(0, Math.min(Math.max(0, asset.duration - 0.001), t)));
    const work = async (signal: AbortSignal) => {
      const images = await platform.shotlog!.frames(asset.src, times, 768); signal.throwIfAborted();
      const text = await platform.describer!.ask({ images, prompt: a.question ? `${String(a.question)}\nFrames in time order at ${times.join(", ")} source seconds. Name only what you can see.` : momentPrompt({ frames: times }), ...(a.question ? {} : { schema: MOMENT_SCHEMA }), maxTokens: 300 }); signal.throwIfAborted();
      const answer = a.question ? text : parseMoment(text);
      if (!answer) throw new Error("The describer returned an invalid answer; try again");
      return { asset_id: asset.id, time, frames: times, answer };
    };
    const status = await platform.describer.status(); scope.throwIfAborted();
    if (status.state === "ready" || (status.state === "stopped" && status.runtime_installed && status.model_installed)) return work(scope);
    const id = jobs.start("describe_moment", store.document().id, scope, async context => {
      const notice = toast("Preparing the describer", "progress", undefined, { label: "Cancel", run: context.cancel });
      try { await prepare(context, (stage, fraction) => { context.progress(fraction, stage); updateToast(notice, { text: stage, progress: fraction }); }); return packed(await work(context.signal)); }
      finally { dismiss(notice); }
    });
    return shotLogJobAnswer(jobs.status(id), Number(a.wait ?? 45));
  }
  const log = await loadShotLog(asset.id); scope.throwIfAborted();
  if (!log) throw new Error("This source has no shot log; run analyze_footage first");
  if (name === "get_shot_log") {
    // A window past the end reads to the end; only an empty window is refused.
    const from = Math.max(0, Number(a.from ?? range.start)), to = Math.min(log.duration, Number(a.to ?? range.end));
    if (from >= to) throw new Error(`Give a source window with from < to inside 0 to ${log.duration} seconds`);
    const described = log.moments.filter(m => !!m.described).length;
    const note = log.complete ? "Complete shot log" : `Partial shot log: ${described} of ${log.moments.length} moments described; analyze_footage continues it`;
    if (a.format === "json") {
      // At most 150 moments a page: a 45-minute log is about 400 KB of JSON.
      const moments = log.moments.filter(m => m.end > from && m.start < to), next = moments[150]?.start;
      return { asset_id: asset.id, ...log, from, to, moments: moments.slice(0, 150), note, ...(next === undefined ? {} : { next_from: +next.toFixed(3) }) };
    }
    // Brief by default past 10 minutes: a 45-minute log reads about 190,000 characters in full.
    const detail = a.detail === "full" || a.detail === "brief" ? a.detail : to - from > 600 ? "brief" : "full";
    const page = pageBlocks(screenplayBlocks(log, { from, to, detail, words: a.speech === false ? undefined : cachedAssetWords(asset.id, from, to) }), SHOT_LOG_PAGE_CHARS);
    const more = page.next === undefined ? "" : `\nContinued: call get_shot_log with from=${+page.next.toFixed(3)} for the rest.`;
    return `${note} (${detail}${detail === "brief" ? "; detail full for every field of a shorter window" : ""})\n${page.text}${more}`;
  }
  const ranges = a.ranges as Range[];
  if (!ranges.length || ranges.some(r => r.start >= r.end || r.end > log.duration)) throw new Error("Ranges must have start < end within the source duration");
  return { asset_id: asset.id, ranges: ranges.map((r, i) => ({ ...r, ...editPoints(log, r, { window: a.window as number | undefined, words: cachedAssetWords(asset.id, Math.max(0, r.start - Number(a.window ?? 2)), Math.min(log.duration, r.end + Number(a.window ?? 2))) }), ...(i < ranges.length - 1 ? { join_to_next: joinAdvice(log, r, log, ranges[i + 1]) } : {}) })) };
}
