import { measureMix } from "../engine/mixdown";
import { normalizeGain } from "../lib/analysis/loudness";
import { clipCaptions, clipSubjects, boxedText, placeClipText, prepareClipText } from "../lib/clipTemplate";
import { checkProject, seenTexts, type Finding } from "../lib/designCheck";
import { lookAtShots } from "./subjects";
import { measureForCheck } from "./check";
import { planClips, type ClipPlan, type ClipTemplate, type CreateClipsRequest } from "../lib/clipProjects";
import { runCommand } from "../lib/commands";
import { clipForAsset, createProject } from "../lib/project/defaults";
import { addClip, mainTrack, projectDuration, setLevel } from "../lib/project/ops";
import { projectSummary } from "../lib/project/summary";
import type { Asset, Project, VideoClip } from "../lib/project/types";
import { framesToSeconds, secondsToFrames } from "../lib/time";
import { timelineWords } from "../lib/transcript";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { clipWords, hearAsset } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";

export interface MadeClip { id: string; name: string; seconds: number; captions: number; notes: string[]; findings: Finding[] }
const latest: string[] = [];
let running = false;
export const createdClipProjects = () => [...latest];

/** Shared by Make clips and create_clips. It builds a detached document;
 * the open document, its selection, nested view and undo stay untouched. */
export async function makeClipProject(source: Project, asset: Asset, plan: ClipPlan, template: ClipTemplate, signal: AbortSignal): Promise<{ project: Project; captions: number; notes: string[]; findings: Finding[] }> {
  let p = createProject({ name: plan.name, width: plan.width, height: plan.height, fps: source.fps });
  // References only, including playbackProxy. Brand logos also share files.
  p.assets = source.assets.filter(a => a.id === asset.id || Object.values(source.brand?.logos ?? {}).includes(a.id));
  if (source.brand) p.brand = structuredClone(source.brand);
  const video = { ...clipForAsset(asset, 0, p.fps), in: plan.sourceIn, duration: plan.frames } as VideoClip;
  p = addClip(p, mainTrack(p).id, video);
  p = template.layout === "full" ? p : runCommand(p, "apply_stream_layout", { clip_id: video.id, ...(template.layout === "vertical_fill" ? {} : { facecam: template.facecam, gameplay: template.gameplay, split: template.split }) });
  let captions = 0;
  const notes: string[] = [];
  if (plan.steps.includes("captions")) {
    if (!asset.hasAudio) notes.push("Source has no audio; no captions were generated.");
    else {
      await hearAsset(p, asset.id, { from: plan.sourceIn, to: plan.sourceIn + plan.seconds }, signal);
      signal.throwIfAborted();
      const words = timelineWords(p, video, clipWords(p, video) ?? []);
      const opts = template.captions || {};
      const caps = clipCaptions(words, plan.seconds, opts.words ?? 2, p.fps.num / p.fps.den);
      captions = caps.length;
      if (captions) {
        p = runCommand(p, "add_captions", { captions: caps });
        p = runCommand(p, "set_caption_look", { look: opts.look ?? "pop", ...(opts.y !== undefined ? { y: opts.y } : {}) });
      } else notes.push("No speech found in this moment; review it before publishing.");
    }
  }
  if (plan.steps.includes("hook")) p = runCommand(p, "add_text", { text: plan.title, role: "headline", start: 0, duration: Math.min(2.5, plan.seconds), x: p.height > p.width ? -0.04 : 0, y: -0.32, style: { maxWidth: p.height > p.width ? 0.62 : 0.85 } });
  if (template.credit) {
    const { name, handle, platform: site } = template.credit;
    p = runCommand(p, "add_text", { text: `${name}${handle ? ` · ${handle}` : ""} · ${site}`, role: "label", start: 0, duration: Math.min(3, plan.seconds), x: p.height > p.width ? -0.04 : 0, y: p.height > p.width ? 0.12 : 0.35, style: { maxWidth: p.height > p.width ? 0.62 : 0.85, case: "none", stroke: { color: "#000000", width: 4 } } });
    p = runCommand(p, "add_ad_element", { element: "end_card", start: plan.seconds, duration: 2, headline: `Follow ${name} on ${site}`, cta: handle || `Follow ${name}`, url: "", logo: "none" });
  }
  if (asset.hasAudio) {
    const m = await measureMix(p, 0, plan.seconds, { signal });
    signal.throwIfAborted();
    if (Number.isFinite(m.integrated)) {
      const n = normalizeGain(m.integrated, template.loudness ?? -14, m.truePeak);
      p = setLevel(p, video.id, n.gain);
      if (n.limitedBy) notes.push(`Dialog gain limited by ${n.limitedBy}; export loudness applies the master limiter.`);
    } else notes.push("Source is silent; loudness could not be measured.");
  }
  p = prepareClipText(p, plan);
  const layoutFindings: Finding[] = [];
  let subjects: ReturnType<typeof clipSubjects> = [];
  if (plan.steps.includes("hook") && (template.layout === "full" || template.layout === "vertical_fill" || !template.facecam)) {
    const shot = p.tracks.flatMap(t => t.clips).find((c): c is VideoClip => c.type === "video");
    if (shot) {
      const looks = await lookAtShots(p, signal, [{ ...shot, duration: Math.min(shot.duration, secondsToFrames(Math.max(2.5, 0.4 * plan.title.trim().split(/\s+/).length), p.fps)) }]);
      subjects = clipSubjects(p, shot, looks[shot.id]);
      if (!subjects.length) notes.push("No distinct subject found for the hook; using a boxed upper-third fallback.");
    }
  }
  // Credit first, then hook, then captions: each later part clears the
  // actual boxes of the earlier parts, all inside the same safe column.
  const texts = seenTexts(p).filter(s => s.start < plan.frames);
  const pending = new Set(texts.map(s => s.c.id));
  for (const s of [...texts.filter(s => !s.c.caption && s.c.text !== plan.title), ...texts.filter(s => !s.c.caption && s.c.text === plan.title), ...texts.filter(s => s.c.caption)]) {
    const kind = s.c.caption ? "caption" : s.c.text === plan.title ? "hook" : "credit";
    pending.delete(s.c.id);
    const placed = placeClipText(p, s.c.id, kind, template, kind === "hook" ? subjects : [], pending);
    p = placed.project; layoutFindings.push(...placed.findings);
  }
  let measured = await measureForCheck(p, { signal });
  const low = new Set(Object.entries(measured.contrast ?? {}).filter(([, m]) => m.ratio < 4.5).map(([id]) => id));
  if (low.size) {
    p = { ...p, tracks: p.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.type === "text" && low.has(c.id) ? { ...boxedText(c), opacity: 1, animIn: undefined, animOut: undefined, animLoop: undefined, style: { ...boxedText(c).style, highlight: undefined } } : c) })) };
    measured = await measureForCheck(p, { signal });
  }
  const findings = [...layoutFindings, ...checkProject(p, "social_short", measured).findings];
  if (measured.contrastNote) notes.push(`Contrast measurement: ${measured.contrastNote}`);
  return { project: p, captions, notes, findings };
}

export async function createClips(request: CreateClipsRequest) {
  if (running) throw new Error("A clip batch is already being created");
  const source = store.document(), asset = source.assets.find(a => a.id === request.asset_id);
  if (!asset || asset.kind !== "video") throw new Error("Choose an imported video VOD");
  const template = request.template ?? {};
  const plans = planClips(asset, request.clips, template, source.fps);
  const signal = projectWork.signal();
  signal.throwIfAborted();
  const made: MadeClip[] = [];
  running = true;
  const tid = toast(`Making ${plans.length} clips`, "progress");
  try {
    for (const [i, plan] of plans.entries()) {
      updateToast(tid, { text: `Making ${i + 1} of ${plans.length}: ${plan.name}`, progress: i / plans.length });
      const { project, captions, notes, findings } = await makeClipProject(source, asset, plan, template, signal);
      signal.throwIfAborted();
      await platform.saveProject(project, projectSummary(project));
      latest.push(project.id);
      made.push({ id: project.id, name: project.name, seconds: framesToSeconds(projectDuration(project), project.fps), captions, notes, findings });
    }
    toast(`Made ${made.length} clip projects`);
    return { projects: made, note: "The original project stays open and unchanged. Media and playback proxies are shared." };
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : e}${made.length ? ` Saved projects: ${made.map(p => `${p.name} (${p.id})`).join(", ")}.` : " No projects saved."}`);
  } finally { running = false; dismiss(tid); }
}
