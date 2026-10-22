// Listen back (MCP review_voiceover): each voice line heard by Whisper on
// this machine and compared with its script, its pace, silences and pitch
// measured from its file, its loudness and its margin over the music
// measured from the mix as export renders it (measure_loudness's
// machinery), and a verdict naming the tool that fixes each problem. The
// model making the video cannot listen; this is its ears. A line that
// differs from its script is heard again by a larger Whisper before the
// voice is blamed: what only the small one misheard needs no retake.

import { decodeMono } from "../engine/analyze";
import { measureMix } from "../engine/mixdown";
import { transcribePcm } from "../engine/transcribe";
import { BALANCE_WINDOWS, isMusic, isolateTracks } from "../lib/analysis/balance";
import { pitchStats, pitchTrack, speechActivity } from "../lib/analysis/speech";
import { toDbtp } from "../lib/analysis/truePeak";
import { paramAt } from "../lib/keyframes";
import { clipEnd, findClip, getAsset, sourceTimeAt } from "../lib/project/ops";
import type { Id } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { voiceClips, type VoiceClip } from "../lib/voiceLines";
import { advise, bandOf, isSignoff, paceOnTarget, compareScript, judgeHearings, matchShare, scriptPace, verdict, type LineMeasure } from "../lib/voiceReview";
import { bandSource, paceOf } from "../lib/voicePace";
import { parseLine } from "../lib/voiceScript";
import { currentScreen } from "./project";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { TRANSCRIPT_MODEL } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";

const RATE = 16000;

/** The second opinion on a line that differs from its script: Whisper
 * small (249 MB, downloaded once), against base's first hearing. */
export const RECHECK_MODEL = "onnx-community/whisper-small.en_timestamped";
const round = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : +x.toFixed(d));

export async function reviewVoiceover(clipIds?: Id[], opts: { music?: boolean; recheck?: boolean } = {}) {
  if (currentScreen() === "home") throw new Error("No project is open: open_project or new_project first.");
  const p = store.document();
  const lines: VoiceClip[] = clipIds?.length
    ? clipIds.map((id) => {
        const c = findClip(p, id)?.clip;
        if (!c || c.type !== "audio") throw new Error(`No voice line ${id}: review_voiceover takes audio clips (describe_project lists the Voiceover track's)`);
        return c;
      })
    : voiceClips(p);
  if (!lines.length) throw new Error("No voiceover lines to review: add_voiceover first, or name clip_ids.");
  const signal = projectWork.signal();
  const tid = toast(`Listening to ${lines.length === 1 ? "the line" : `${lines.length} lines`}`, "progress");
  const fps = p.fps;
  try {
    const measured: (LineMeasure & { heard: string; matched: number; words: number; pitchHz: number | null; diffAt: (number | null)[]; clipRate: ReturnType<typeof paceOf>["clip"]; marksOut: number; recheck?: { heard: string; match: number | null } })[] = [];
    const heardPcm: Float32Array[] = [];
    for (const [k, c] of lines.entries()) {
      const asset = getAsset(p, c.assetId);
      if (!asset) throw new Error(`${c.id} has no media`);
      const start = framesToSeconds(c.start, fps), end = framesToSeconds(clipEnd(c), fps);
      const from = c.in, to = sourceTimeAt(c, clipEnd(c), fps);
      const speed = c.speed || 1;
      const pcm = await decodeMono(asset, from, to, RATE, undefined, signal);
      const heardWords = await transcribePcm(pcm, 0, { model: TRANSCRIPT_MODEL, language: null }, () => undefined, signal);
      const heard = heardWords.map((w) => w.text.trim()).join(" ");
      heardPcm.push(pcm);
      const act = speechActivity(pcm, RATE);
      const pitch = pitchStats(pitchTrack(pcm, RATE));
      const sp = asset.speech;
      const cmp = sp ? compareScript(sp.text, heard, sp.pronounce, sp.caption) : { words: heardWords.length, matched: heardWords.length, differences: [] };
      // As mixed: the voice's track alone, and the music under it, from the
      // line's first word to its last (the line window, ADR-096: the music
      // in its lead-in and tail is not under any word).
      const voiceTrack = findClip(p, c.id)!.track.id;
      const [said0, said1] = act ? [start + act.first / speed, start + act.last / speed] : [start, end];
      const voice = await measureMix(isolateTracks(p, [voiceTrack]), said0, said1, { signal });
      const beds = p.tracks.filter((t) => isMusic(t, p) && t.id !== voiceTrack && t.clips.some((m) => m.start < clipEnd(c) && clipEnd(m) > c.start && (m.type === "audio" || m.type === "video")));
      let overMusic: number | null = null, musicClip: string | undefined, musicDuck = 0;
      if (opts.music !== false && beds.length) {
        const bed = await measureMix(isolateTracks(p, beds.map((t) => t.id)), said0, said1, { signal });
        overMusic = Number.isFinite(bed.integrated) && Number.isFinite(voice.integrated) ? voice.integrated - bed.integrated : null;
        const music = beds.flatMap((t) => t.clips).find((m) => m.start < clipEnd(c) && clipEnd(m) > c.start);
        musicClip = music?.id;
        // Its duck now: the volume at the line's middle against its loudest key.
        const keys = music?.keyframes?.volume;
        if (music && keys?.length) {
          const at = paramAt(music, "volume", Math.round((c.start + clipEnd(c)) / 2) - music.start);
          const top = Math.max(...keys.map((k) => k.v));
          musicDuck = at > 0 && top > 0 ? 20 * Math.log10(top / at) : 40;
        }
      }
      // Pace in two windows: over the speech (first word to last, its own
      // pauses in, its pause marks out: the script's beats, not the
      // reader's pace, as the read was landed, ADR-104) and over the clip
      // (its lead-in and tail too).
      const said = act ? (act.last - act.first) / speed : 0;
      const marks = sp ? parseLine(sp.text).pauses.reduce((n, x) => n + x.seconds, 0) : 0;
      const marksOut = said - marks > 0.3 ? marks : 0;
      const pace = paceOf(sp ? sp.text : heardWords.map((w) => w.text).join(" "), said - marksOut, end - start);
      const band = bandSource(sp);
      measured.push({
        clipId: c.id,
        start,
        end,
        text: sp?.text,
        voice: sp?.voice,
        speed: sp?.speed,
        pronounce: sp?.pronounce,
        pace: sp?.pace,
        asked: band.wps,
        readAs: band.readAs,
        speedChosen: sp?.speedChosen,
        volume: c.volume,
        compressed: !!c.compressor,
        wps: pace.speech?.words_per_second ?? null,
        sps: pace.speech?.syllables_per_second ?? null,
        clipRate: pace.clip,
        marksOut: +marksOut.toFixed(2),
        lead: round(act ? act.first / speed : end - start)!,
        tail: round(act ? (pcm.length / RATE - act.last) / speed : 0)!,
        longestPause: round(Math.max(0, ...(act?.pauses ?? []).map((x) => (x.end - x.start) / speed)))!,
        marks: sp ? parseLine(sp.text).pauses.map((x) => x.seconds) : [],
        lufs: round(voice.integrated, 1),
        truePeak: round(toDbtp(voice.truePeak), 1),
        rangeSt: pitch?.rangeSt ?? null,
        pitchHz: pitch?.medianHz ?? null,
        overMusic: round(overMusic, 1),
        musicClip,
        musicDuckDb: round(musicDuck, 1) ?? 0,
        differences: cmp.differences,
        // Where each difference was heard, on the timeline.
        diffAt: cmp.differences.map((d) => (heardWords[d.near] ? round(start + heardWords[d.near].start / speed) : null)),
        heard,
        matched: cmp.matched,
        words: cmp.words,
      });
      updateToast(tid, { progress: (k + 1) / lines.length });
    }
    // A second hearing, by a larger model, of each line that differs from
    // its script: what it hears right was the first recognizer's mistake.
    const doubtful = measured.map((m, i) => ({ m, i, sp: getAsset(p, lines[i].assetId)?.speech })).filter(({ m, sp }) => sp && m.differences.some((d) => !d.minor));
    let recheckFailed: string | undefined;
    if (opts.recheck !== false && doubtful.length) {
      updateToast(tid, { text: "Hearing the doubtful lines again, with a larger model" });
      try {
        for (const { m, i, sp } of doubtful) {
          const again = (await transcribePcm(heardPcm[i], 0, { model: RECHECK_MODEL, language: null }, () => undefined, signal)).map((w) => w.text.trim()).join(" ");
          const second = compareScript(sp!.text, again, sp!.pronounce, sp!.caption);
          m.differences = judgeHearings(m.differences, second.differences);
          m.recheck = { heard: again, match: second.words ? matchShare(second.matched, second.differences) : null };
        }
      } catch (e) {
        if (signal.aborted) throw e;
        recheckFailed = e instanceof Error ? e.message : String(e);
      }
    }
    const levels = measured.map((m) => m.lufs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const median = levels.length ? levels[Math.floor(levels.length / 2)] : null;
    const out = measured.map((m) => {
      const fixes = verdict(m, levels.length > 1 ? median : null);
      const advice = advise(m);
      const band = bandOf(m);
      return {
        voice_clip: m.clipId,
        start: round(m.start, 3),
        end: round(m.end, 3),
        ...(m.voice ? { voice: m.voice } : {}),
        ...(m.text ? { script: parseLine(m.text).written } : {}),
        heard: m.heard,
        // Never 1 while a difference is reported: a word heard that is not
        // in the script counts against it too.
        match: m.words ? matchShare(m.matched, m.differences) : null,
        differences: m.differences.map((d, i) => ({ kind: d.kind, ...(d.script ? { script: d.script } : {}), ...(d.heard ? { heard: d.heard } : {}), at: m.diffAt[i], ...(d.minor ? { minor: true } : {}), ...(d.likely ? { likely: d.likely } : {}) })),
        ...(m.recheck ? { heard_again: m.recheck.heard, match_again: m.recheck.match } : {}),
        ...(m.differences.some((d) => d.likely === "recognizer") ? { notes: m.differences.filter((d) => d.likely === "recognizer").map((d) => `"${d.script ?? d.heard}": misheard by the first recognizer, heard right by a larger model; the voice is fine`) } : {}),
        // Over the speech (what the band is held to) and over the clip.
        pace: {
          ...(m.pace && m.pace !== "normal" ? { meant: m.pace } : {}),
          target_words_per_second: isSignoff(m) ? null : band,
          ...(isSignoff(m) ? { note: "A sign-off of up to three words is not paced." } : {}),
          over_speech: m.wps === null ? null : { words_per_second: m.wps, syllables_per_second: m.sps, ...(m.marksOut ? { pause_marks_out: m.marksOut } : {}) },
          over_clip: m.clipRate ? { words_per_second: m.clipRate.words_per_second, syllables_per_second: m.clipRate.syllables_per_second } : null,
          on_target: paceOnTarget(m),
        },
        lead_silence: m.lead,
        tail_silence: m.tail,
        longest_pause: m.longestPause,
        loudness_lufs: m.lufs,
        true_peak_dbtp: m.truePeak,
        pitch: m.pitchHz ? { median_hz: m.pitchHz, range_st: m.rangeSt } : null,
        // This line alone, its first word to its last (the line window).
        voice_above_music_lu: m.overMusic,
        // ok: nothing fails it (advice may still say something).
        verdict: fixes.length ? fixes.map((f) => f.problem).join("; ") : "ok",
        ...(fixes.length ? { fixes } : {}),
        ...(advice.length ? { advice } : {}),
      };
    });
    const ok = out.filter((l) => l.verdict === "ok").length;
    // The script's pace, only over lines in a row (ADR-121).
    const reviewed = new Set(lines.map((c) => c.id));
    const script = scriptPace(
      measured.map((m) => ({ first: m.start + m.lead, last: m.end - m.tail, words: m.words })),
      voiceClips(p).filter((c) => !reviewed.has(c.id)).map((c) => ({ start: framesToSeconds(c.start, fps), end: framesToSeconds(clipEnd(c), fps) })),
    );
    const rates = measured.map((m) => m.wps).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const margins = measured.map((m) => m.overMusic).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const mid = (xs: number[]) => xs[Math.floor(xs.length / 2)];
    return {
      lines: out,
      summary: {
        ok,
        to_fix: out.length - ok,
        with_advice: out.filter((l) => l.advice).length,
        pace: {
          on_target: out.filter((l) => l.pace.on_target).length,
          ...(rates.length ? { lines_words_per_second: { min: rates[0], median: mid(rates), max: rates.at(-1)!, window: "each line over its speech, first word to last" } } : {}),
          // The script's pace with every pause between lines in: lower than
          // the lines' own (2.3-2.8 inside lines reads about 1.8-2.4 here).
          script_words_per_second: script.words_per_second,
          script_window: script.window,
        },
        ...(margins.length ? { voice_above_music: { window: "line", means: BALANCE_WINDOWS.line, min_lu: margins[0], median_lu: mid(margins), max_lu: margins.at(-1)! } } : {}),
        loudness_spread_lu: levels.length > 1 ? round(levels.at(-1)! - levels[0], 1) : 0,
        heard_with: TRANSCRIPT_MODEL.split("/").pop(),
        ...(measured.some((m) => m.recheck) ? { heard_again_with: RECHECK_MODEL.split("/").pop() } : {}),
        ...(recheckFailed ? { heard_again: `not done: the larger model could not run (${recheckFailed}); a difference may be the recognizer's` } : {}),
      },
    };
  } finally {
    dismiss(tid);
  }
}
