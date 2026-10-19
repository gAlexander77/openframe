// The loudness report an agent reads before delivering (MCP
// measure_loudness, ADR-061): the open project's mix measured as export
// renders it, against the delivery specs (lib/analysis/delivery.ts).

import { isolateTracks, isDialog, isMusic, loudnessDifference } from "../lib/analysis/balance";
import { measureMix } from "../engine/mixdown";
import { checkSpec, LOUDNESS_SPECS, SPEC_IDS, type SpecId } from "../lib/analysis/delivery";
import { toDbtp } from "../lib/analysis/truePeak";
import { projectDuration } from "../lib/project/ops";
import { framesToSeconds } from "../lib/time";
import { currentScreen } from "./project";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { dismiss, toast, updateToast } from "./toast";

export interface ReportOptions {
  /** Timeline seconds; default the whole timeline. */
  start?: number;
  end?: number;
  /** Measure as export with this loudness target delivers it. */
  loudness?: number;
  /** Report isolated tracks as mixed, before export normalization. */
  by_track?: boolean;
}

const round = (x: number, digits = 1) => (Number.isFinite(x) ? +x.toFixed(digits) : null);

/**
 * Measure the mix (or [start, end)) and check it against `spec`, or
 * against every spec when `spec` is empty. Values are rounded as meters
 * show them; -Infinity (silence) is null.
 */
export async function loudnessReport(spec = "", opts: ReportOptions = {}) {
  if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
  if (spec && !(spec in LOUDNESS_SPECS)) throw new Error(`Unknown spec ${spec}: use ${SPEC_IDS.join(", ")}`);
  const p = store.document();
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(opts.end ?? Infinity, framesToSeconds(projectDuration(p), p.fps));
  if (!(end > start)) throw new Error("Nothing to measure: the timeline is empty there.");
  const tid = toast("Measuring loudness", "progress");
  try {
    const m = await measureMix(p, start, end, { loudness: opts.loudness, signal: projectWork.signal(), onProgress: (x) => updateToast(tid, { progress: x }) });
    const tracks = [];
    let balance;
    if (opts.by_track) {
      const signal = projectWork.signal();
      for (const t of p.tracks.filter(t => t.kind === "audio")) {
        const stem = await measureMix(isolateTracks(p, [t.id]), start, end, { signal });
        tracks.push({ track_id: t.id, name: t.name, integrated_lufs: round(stem.integrated),
          short_term_max_lufs: round(stem.shortTermMax),
          short_term: stem.shortTerm.map(s => ({ end: round(start + s.end, 2), lufs: round(s.lufs) })) });
      }
      const dialog = p.tracks.filter(isDialog).map(t => t.id);
      const music = p.tracks.filter(isMusic).map(t => t.id);
      if (dialog.length && music.length) {
        const voice = await measureMix(isolateTracks(p, dialog), start, end, { signal });
        const bed = await measureMix(isolateTracks(p, music), start, end, { signal });
        const difference = loudnessDifference(voice.integrated, bed.integrated);
        balance = { dialog_tracks: dialog, music_tracks: music, dialog_lufs: round(voice.integrated),
          music_lufs: round(bed.integrated), voice_above_music_lu: difference === null ? null : round(difference) };
      }
    }
    const truePeak = toDbtp(m.truePeak);
    const checks = (spec ? [spec as SpecId] : SPEC_IDS).map((id) => checkSpec({ integrated: m.integrated, truePeak }, LOUDNESS_SPECS[id]));
    const failed = spec && !checks[0].pass ? LOUDNESS_SPECS[spec as SpecId] : null;
    return {
      seconds: round(m.seconds, 2),
      ...(opts.by_track ? { by_track: tracks, track_measurement: "as mixed, before master normalization", ...(balance ? { balance } : {}) } : {}),
      integrated_lufs: round(m.integrated),
      loudness_range_lu: round(m.range),
      short_term_max_lufs: round(m.shortTermMax),
      momentary_max_lufs: round(m.momentaryMax),
      true_peak_dbtp: round(truePeak),
      sample_peak_dbfs: round(toDbtp(m.samplePeak)),
      // The mix is summed in floating point; a file of it squares off
      // whatever passes full scale.
      ...(m.samplePeak > 1 ? { clips: true, clipping: "The mix passes 0 dBFS, so a file of it clips: turn tracks or clips down, or export with a loudness target (its limiter holds the peaks)." } : {}),
      ...(opts.loudness !== undefined ? { as_exported_at: opts.loudness, gain_db: round(m.plan ? 20 * Math.log10(m.plan.gain) : 0), limited_db: round(m.plan?.heldDb ?? 0) } : {}),
      ...(spec
        ? { spec, pass: checks[0].pass, problems: checks[0].problems }
        : { specs: Object.fromEntries(checks.map((c) => [c.spec, { pass: c.pass, ...(c.problems.length ? { problems: c.problems } : {}) }])) }),
      ...(failed && opts.loudness === undefined
        ? { fix: `export_video with loudness ${failed.target} delivers ${failed.target} LUFS with the true peak held under ${failed.maxTruePeak} dBTP (measure_loudness with that loudness first shows the result); or normalize_loudness with spec ${failed.id} on the clips.` }
        : {}),
    };
  } finally {
    dismiss(tid);
  }
}
