// Headless rendering (ADR-029): when the desktop app was started with
// `--render project.json --out file`, export the project with the same
// engine as the export dialog and report to the calling pipeline as JSON
// lines on stdout — no window, no person.

import { exportProject } from "../engine/export";
import { defaultExportSettings, planExport, type ExportSettings, type QualityLevel, type ResolutionId, type VideoFormat } from "../lib/export";
import { normalizeProject } from "../lib/project/defaults";
import { platform } from "../platform";
import { store } from "./store";

const FORMATS: VideoFormat[] = ["mp4", "mov", "webm", "mkv"];

/** Run the render job if there is one. Returns true when the app is in
 * headless mode (the caller should not expect a user). */
export async function runHeadlessIfAsked(): Promise<boolean> {
  const h = platform.headless;
  const job = h ? await h.job() : null;
  if (!h || !job) return false;
  const line = (o: Record<string, unknown>) => JSON.stringify(o);
  try {
    const project = normalizeProject(JSON.parse(job.project));
    store.load(project);
    const settings: ExportSettings = { ...defaultExportSettings(project) };
    const ext = job.out.split(".").pop()?.toLowerCase();
    const format = (job.format ?? ext) as VideoFormat;
    if (FORMATS.includes(format)) {
      settings.format = format;
      // WebM carries VP9 or AV1, never H.264.
      if (format === "webm") settings.codec = "vp9";
    }
    if (job.resolution) settings.resolution = job.resolution as ResolutionId;
    if (job.quality) settings.quality = job.quality as QualityLevel;
    const plan = planExport(project, settings, { inPoint: null, outPoint: null });
    await h.report(line({ event: "start", frames: plan.frames, width: plan.video?.width, height: plan.video?.height, codec: plan.video?.codec, out: job.out }));
    const writable = await h.output();
    let last = 0;
    const started = performance.now();
    const result = await exportProject(project, plan, { writable }, (pr) => {
      const now = performance.now();
      if (now - last < 500 && pr.fraction < 1) return;
      last = now;
      void h.report(line({ event: "progress", fraction: +pr.fraction.toFixed(3), fps: +pr.fps.toFixed(1), eta: pr.eta === null ? null : +pr.eta.toFixed(1) }));
    });
    await h.finish(true, line({ event: "done", out: job.out, ...result, wallSeconds: +((performance.now() - started) / 1000).toFixed(2) }));
  } catch (e) {
    await h.finish(false, line({ event: "error", message: e instanceof Error ? e.message : String(e) }));
  }
  return true;
}
