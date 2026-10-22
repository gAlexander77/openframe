import { secondsToFrames, framesToSeconds, type Rational } from "./time";
import { CAPTION_LOOKS } from "./captionLooks";
import { checkRegion, type SourceRegion } from "./streamLayout";
import type { VersionRatio } from "./versions";
import type { Project } from "./project/types";
import { sourceTimeAt } from "./project/ops";

export interface ClipMoment { start: number; end: number; title?: string; name?: string; peak?: number }
export interface ClipTemplate {
  layout?: "stream" | "full" | "vertical_fill";
  facecam?: SourceRegion;
  gameplay?: SourceRegion;
  split?: number;
  captions?: false | { words?: number; look?: string; y?: number };
  hook?: boolean;
  credit?: { name: string; handle?: string; platform: "twitch" | "youtube" | "kick" };
  loudness?: number;
  lead_in?: number;
  lead_out?: number;
}
export interface CreateClipsRequest { asset_id: string; clips: ClipMoment[]; template?: ClipTemplate }
export interface ExportProjectsRequest { project_ids?: string[]; folder?: string; loudness?: number; resolution?: "480p" | "720p" | "1080p" | "2k" | "4k"; ratios?: VersionRatio[]; replace?: boolean }
export interface ClipPlan { name: string; title: string; sourceIn: number; frames: number; seconds: number; width: number; height: number; steps: ("layout" | "captions" | "hook" | "credit" | "normalize")[]; endCard: number }

export function momentsFromMarkers(p: Project, assetId: string): ClipMoment[] {
  return p.markers.flatMap(m => {
    if (!/^Highlight\s+\d+/i.test(m.label) || !m.duration) return [];
    const c = p.tracks.flatMap(t => t.clips).find(c => c.type === "video" && c.assetId === assetId && c.start <= m.frame && c.start + c.duration >= m.frame + m.duration!);
    if (!c || c.type !== "video" || c.reverse || c.speedCurve) return [];
    return [{ start: sourceTimeAt(c, m.frame, p.fps), end: sourceTimeAt(c, m.frame + m.duration, p.fps), title: m.label }];
  });
}

/** Validate the entire batch before any project is saved. Source windows
 * snap once to the document's rate; every clip references the same file. */
export function planClips(source: { name: string; duration: number }, moments: ClipMoment[], template: ClipTemplate = {}, fps: Rational = { num: 30, den: 1 }): ClipPlan[] {
  if (!moments.length || moments.length > 100) throw new Error("Choose between 1 and 100 moments");
  for (const r of [template.facecam, template.gameplay]) if (r) checkRegion(r);
  if (template.layout && !["stream", "full", "vertical_fill"].includes(template.layout)) throw new Error("Unknown clip layout");
  if (template.split !== undefined && (!Number.isFinite(template.split) || template.split < 0.1 || template.split > 0.9)) throw new Error("Use split 0.1 to 0.9");
  for (const n of [template.lead_in, template.lead_out]) if (n !== undefined && (!Number.isFinite(n) || n < 0)) throw new Error("Lead times must be nonnegative seconds");
  if (template.loudness !== undefined && (!Number.isFinite(template.loudness) || template.loudness < -40 || template.loudness > -5)) throw new Error("Use loudness -40 to -5 LUFS");
  if (template.captions) {
    const { words = 2, look = "pop", y } = template.captions;
    if (![1, 2, 3].includes(words) || !CAPTION_LOOKS[look] || (y !== undefined && (!Number.isFinite(y) || Math.abs(y) > 0.5))) throw new Error("Use 1 to 3 caption words, a caption look and y within the canvas");
  }
  if (template.credit && (!template.credit.name.trim() || !["twitch", "youtube", "kick"].includes(template.credit.platform))) throw new Error("Credit needs a name and platform");
  const wide = template.layout === "full";
  return moments.map((m, i) => {
    if (![m.start, m.end].every(Number.isFinite) || m.start < 0 || m.end <= m.start || m.end > source.duration + 0.001) throw new Error(`Moment ${i + 1} is outside the source or has no length`);
    const from = secondsToFrames(Math.max(0, m.start - (template.lead_in ?? 0)), fps);
    const to = Math.min(Math.floor(source.duration * fps.num / fps.den), secondsToFrames(Math.min(source.duration, m.end + (template.lead_out ?? 0)), fps));
    if (to <= from) throw new Error(`Moment ${i + 1} is shorter than one frame`);
    const title = m.title?.trim() || m.name?.trim() || `Clip ${i + 1}`;
    return { name: `${m.name?.trim() || title} (${source.name})`.slice(0, 120), title, sourceIn: framesToSeconds(from, fps), frames: to - from, seconds: framesToSeconds(to - from, fps), width: wide ? 1920 : 1080, height: wide ? 1080 : 1920,
      steps: ["layout", ...(template.captions === false ? [] : ["captions" as const]), ...(template.hook === false ? [] : ["hook" as const]), ...(template.credit ? ["credit" as const] : []), "normalize"], endCard: template.credit ? secondsToFrames(2, fps) : 0 };
  });
}

/** Project order, then original and requested shapes. Deduplicate IDs and
 * shapes so replace never overwrites an earlier member of this batch. */
export function planProjectExports(ids: string[], ratios: VersionRatio[] = []) {
  if (!ids.length || ids.length > 100) throw new Error("Choose between 1 and 100 projects");
  if (ratios.some(r => !["original", "16:9", "9:16", "1:1", "4:5"].includes(r))) throw new Error("Unknown export ratio");
  return [...new Set(ids)].flatMap(id => [...new Set<VersionRatio>(["original", ...ratios])].map(ratio => ({ id, ratio })));
}
