// The loudness report an agent reads before delivering (MCP
// measure_loudness, ADR-061): the open project's mix measured as export
// renders it, against the delivery specs (lib/analysis/delivery.ts).

import { activeSpan, BALANCE_WINDOWS, isolateTracks, isDialog, isMusic, lineBalances, loudnessDifference, marginSummary, speechWindows, windowLoudness } from "../lib/analysis/balance";
import { assetsOf, trackRole } from "../lib/audioRoles";
import { measureMix, type MixMeasurement } from "../engine/mixdown";
import { duckRangeContext } from "../lib/analysis/duck";
import { checkSpec, LOUDNESS_SPECS, PROGRAM_KINDS, rangeVerdict, SPEC_IDS, type ProgramKind, type SpecId } from "../lib/analysis/delivery";
import { toDbtp } from "../lib/analysis/truePeak";
import { clipEnd, projectDuration } from "../lib/project/ops";
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
  /** With by_track: each track's three-second loudness every second. */
  per_second?: boolean;
  /** What the mix is for, to judge its loudness range against. */
  kind?: ProgramKind;
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
  if (opts.kind !== undefined && !PROGRAM_KINDS.includes(opts.kind)) throw new Error(`Unknown kind ${opts.kind}: use ${PROGRAM_KINDS.join(", ")}`);
  const p = store.document();
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(opts.end ?? Infinity, framesToSeconds(projectDuration(p), p.fps));
  if (!(end > start)) throw new Error("Nothing to measure: the timeline is empty there.");
  const cancel = new AbortController();
  const signal = AbortSignal.any([cancel.signal, projectWork.capture()]);
  const tid = toast("Measuring loudness", "progress", undefined, { label: "Cancel", run: () => cancel.abort() });
  try {
    const m = await measureMix(p, start, end, { loudness: opts.loudness, signal, onProgress: (x) => updateToast(tid, { progress: x }) });
    const tracks = [];
    let balance;
    if (opts.by_track) {
      // Each stem rendered once, whichever answer it serves.
      const stems = new Map<string, Promise<MixMeasurement>>();
      const stem = (ids: string[]) => {
        const key = [...ids].sort().join(",");
        if (!stems.has(key)) stems.set(key, measureMix(isolateTracks(p, ids), start, end, { signal }));
        return stems.get(key)!;
      };
      for (const t of p.tracks.filter(t => t.kind === "audio")) {
        const s = await stem([t.id]);
        tracks.push({ track_id: t.id, name: t.name, role: trackRole(t, assetsOf(p)), integrated_lufs: round(s.integrated),
          short_term_max_lufs: round(s.shortTermMax), loudness_range_lu: round(s.range),
          ...(opts.per_second ? { short_term: s.shortTerm.map(x => ({ end: round(start + x.end, 2), lufs: round(x.lufs) })) } : {}) });
      }
      const dialog = p.tracks.filter(t => isDialog(t, p)).map(t => t.id);
      const music = p.tracks.filter(t => isMusic(t, p)).map(t => t.id);
      if (dialog.length && music.length) {
        const voice = await stem(dialog);
        const bed = await stem(music);
        const lu = (v: number, b: number) => {
          const d = loudnessDifference(v, b);
          return { dialog_lufs: round(v), music_lufs: round(b), voice_above_music_lu: d === null ? null : round(d) };
        };
        // The lines: the voice clips, each from its first word to its last.
        const fps = p.fps;
        const said = p.tracks.filter((t) => isDialog(t, p) && !t.muted).flatMap((t) => t.clips)
          .filter((c) => (c.type === "audio" || c.type === "video") && !c.disabled && !c.muted)
          .map((c) => [Math.max(start, framesToSeconds(c.start, fps)), Math.min(end, framesToSeconds(clipEnd(c), fps))] as [number, number])
          .filter(([a, b]) => b > a)
          .map(([a, b]) => activeSpan(voice.steps, start, a, b))
          .filter((s): s is [number, number] => s !== null)
          .sort((x, y) => x[0] - y[0]);
        const speaking = speechWindows(said, 0.001);
        balance = {
          dialog_tracks: dialog,
          music_tracks: music,
          program: { window: "program", means: BALANCE_WINDOWS.program, start: round(start, 2), end: round(end, 2), ...lu(voice.integrated, bed.integrated) },
          ...(said.length
            ? {
                speech: { window: "speech", means: BALANCE_WINDOWS.speech, stretches: speaking.length, seconds: round(speaking.reduce((n, [a, b]) => n + b - a, 0)), ...lu(windowLoudness(voice.steps, start, speaking), windowLoudness(bed.steps, start, speaking)) },
                per_line: { window: "line", means: BALANCE_WINDOWS.line, ...(marginSummary(lineBalances(voice.steps, bed.steps, start, said)) ?? { lines: 0 }) },
              }
            : {}),
          note: "The three windows differ by design: music that rises between lines lowers the program margin, and a line over a quiet passage sits higher than the speech window's average. duck_under_speech aims voice_above_music_lu at the speech window and min_line_lu at every line.",
        };
      }
    }
    const truePeak = toDbtp(m.truePeak);
    const checks = (spec ? [spec as SpecId] : SPEC_IDS).map((id) => checkSpec({ integrated: m.integrated, truePeak }, LOUDNESS_SPECS[id]));
    const failed = spec && !checks[0].pass ? LOUDNESS_SPECS[spec as SpecId] : null;
    return {
      seconds: round(m.seconds, 2),
      ...(opts.by_track ? { by_track: tracks, track_measurement: `as mixed, before master normalization${opts.per_second ? "" : "; per_second true adds each track's three-second loudness every second"}`, ...(balance ? { balance } : {}) } : {}),
      integrated_lufs: round(m.integrated),
      loudness_range_lu: round(m.range),
      range: rangeVerdict(m.range, opts.kind, duckRangeContext(p, start, end)),
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
