import { measureMix } from "../engine/mixdown";
import { normalizeGain } from "../lib/analysis/loudness";
import { wordsToCaptions, DEFAULT_LINES } from "../lib/captions";
import { planClips, type ClipPlan, type ClipTemplate, type CreateClipsRequest } from "../lib/clipProjects";
import { runCommand } from "../lib/commands";
import { clipForAsset, createProject } from "../lib/project/defaults";
import { addClip, mainTrack, projectDuration, setLevel } from "../lib/project/ops";
import { projectSummary } from "../lib/project/summary";
import type { Asset, Project, VideoClip } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { timelineWords } from "../lib/transcript";
import { platform } from "../platform";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { clipWords, hearAsset } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";

export interface MadeClip { id: string; name: string; seconds: number; captions: number; notes: string[] }
const latest: string[] = [];
let running = false;
export const createdClipProjects = () => [...latest];

/** Shared by Make clips and create_clips. It builds a detached document;
 * the open document, its selection, nested view and undo stay untouched. */
export async function makeClipProject(source: Project, asset: Asset, plan: ClipPlan, template: ClipTemplate, signal: AbortSignal): Promise<{ project: Project; captions: number; notes: string[] }> {
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
      const caps = wordsToCaptions(words, { ...DEFAULT_LINES, maxWords: opts.words ?? 2, minDuration: 0.25 }).map(c => ({ ...c, end: Math.min(c.end, plan.seconds) })).filter(c => c.end > c.start);
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
  return { project: p, captions, notes };
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
      const { project, captions, notes } = await makeClipProject(source, asset, plan, template, signal);
      signal.throwIfAborted();
      await platform.saveProject(project, projectSummary(project));
      latest.push(project.id);
      made.push({ id: project.id, name: project.name, seconds: framesToSeconds(projectDuration(project), project.fps), captions, notes });
    }
    toast(`Made ${made.length} clip projects`);
    return { projects: made, note: "The original project stays open and unchanged. Media and playback proxies are shared." };
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : e}${made.length ? ` Saved projects: ${made.map(p => `${p.name} (${p.id})`).join(", ")}.` : " No projects saved."}`);
  } finally { running = false; dismiss(tid); }
}
