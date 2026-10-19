// Listen back (MCP review_voiceover): each voice line heard by Whisper on
// this machine and compared with its script, its pace, silences and pitch
// measured from its file, its loudness and its margin over the music
// measured from the mix as export renders it (measure_loudness's
// machinery), and a verdict naming the tool that fixes each problem. The
// model making the video cannot listen; this is its ears.

import { decodeMono } from "../engine/analyze";
import { measureMix } from "../engine/mixdown";
import { transcribePcm } from "../engine/transcribe";
import { isMusic, isolateTracks } from "../lib/analysis/balance";
import { pitchStats, pitchTrack, speechActivity } from "../lib/analysis/speech";
import { toDbtp } from "../lib/analysis/truePeak";
import { paramAt } from "../lib/keyframes";
import { clipEnd, findClip, getAsset, sourceTimeAt } from "../lib/project/ops";
import type { Id } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { voiceClips, type VoiceClip } from "../lib/voiceLines";
import { compareScript, verdict, type LineMeasure } from "../lib/voiceReview";
import { parseLine, syllables, writtenWords } from "../lib/voiceScript";
import { currentScreen } from "./project";
import { projectWork } from "./projectWork";
import { store } from "./store";
import { TRANSCRIPT_MODEL } from "./transcript";
import { dismiss, toast, updateToast } from "./toast";

const RATE = 16000;
const round = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? null : +x.toFixed(d));

export async function reviewVoiceover(clipIds?: Id[], opts: { music?: boolean } = {}) {
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
    const measured: (LineMeasure & { heard: string; matched: number; words: number; pitchHz: number | null; diffAt: (number | null)[] })[] = [];
    for (const [k, c] of lines.entries()) {
      const asset = getAsset(p, c.assetId);
      if (!asset) throw new Error(`${c.id} has no media`);
      const start = framesToSeconds(c.start, fps), end = framesToSeconds(clipEnd(c), fps);
      const from = c.in, to = sourceTimeAt(c, clipEnd(c), fps);
      const speed = c.speed || 1;
      const pcm = await decodeMono(asset, from, to, RATE, undefined, signal);
      const heardWords = await transcribePcm(pcm, 0, { model: TRANSCRIPT_MODEL, language: null }, () => undefined, signal);
      const heard = heardWords.map((w) => w.text.trim()).join(" ");
      const act = speechActivity(pcm, RATE);
      const pitch = pitchStats(pitchTrack(pcm, RATE));
      const sp = asset.speech;
      const cmp = sp ? compareScript(sp.text, heard, sp.pronounce) : { words: heardWords.length, matched: heardWords.length, differences: [] };
      // As mixed: the voice's track alone, and the music under it.
      const voiceTrack = findClip(p, c.id)!.track.id;
      const voice = await measureMix(isolateTracks(p, [voiceTrack]), start, end, { signal });
      const beds = p.tracks.filter((t) => isMusic(t) && t.id !== voiceTrack && t.clips.some((m) => m.start < clipEnd(c) && clipEnd(m) > c.start && (m.type === "audio" || m.type === "video")));
      let overMusic: number | null = null, musicClip: string | undefined, musicDuck = 0;
      if (opts.music !== false && beds.length) {
        const bed = await measureMix(isolateTracks(p, beds.map((t) => t.id)), start, end, { signal });
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
      const said = sp ? writtenWords(sp.text) : heardWords.map((w) => w.text);
      const words = said.length;
      const syll = said.reduce((n, w) => n + syllables(w), 0);
      const span = act ? (act.last - act.first) / speed : 0;
      measured.push({
        clipId: c.id,
        start,
        end,
        text: sp?.text,
        voice: sp?.voice,
        speed: sp?.speed,
        pronounce: sp?.pronounce,
        volume: c.volume,
        compressed: !!c.compressor,
        wps: act && span > 0.3 ? round(words / span) : null,
        sps: act && span > 0.3 ? round(syll / span) : null,
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
    const levels = measured.map((m) => m.lufs).filter((x): x is number => x !== null).sort((a, b) => a - b);
    const median = levels.length ? levels[Math.floor(levels.length / 2)] : null;
    const out = measured.map((m) => {
      const fixes = verdict(m, levels.length > 1 ? median : null);
      return {
        voice_clip: m.clipId,
        start: round(m.start, 3),
        end: round(m.end, 3),
        ...(m.voice ? { voice: m.voice } : {}),
        ...(m.text ? { script: parseLine(m.text).written } : {}),
        heard: m.heard,
        match: m.words ? round(m.matched / m.words) : null,
        differences: m.differences.map((d, i) => ({ kind: d.kind, ...(d.script ? { script: d.script } : {}), ...(d.heard ? { heard: d.heard } : {}), at: m.diffAt[i] })),
        words_per_second: m.wps,
        syllables_per_second: m.sps,
        lead_silence: m.lead,
        tail_silence: m.tail,
        longest_pause: m.longestPause,
        loudness_lufs: m.lufs,
        true_peak_dbtp: m.truePeak,
        pitch: m.pitchHz ? { median_hz: m.pitchHz, range_st: m.rangeSt } : null,
        voice_above_music_lu: m.overMusic,
        verdict: fixes.length ? fixes.map((f) => f.problem).join("; ") : "ok",
        ...(fixes.length ? { fixes } : {}),
      };
    });
    const ok = out.filter((l) => l.verdict === "ok").length;
    const first = Math.min(...measured.map((m) => m.start + m.lead)), last = Math.max(...measured.map((m) => m.end - m.tail));
    const words = measured.reduce((n, m) => n + m.words, 0);
    return {
      lines: out,
      summary: {
        ok,
        to_fix: out.length - ok,
        // The script's pace with its pauses: 2.3-2.8 for narration, up to 3 for an ad.
        script_words_per_second: last > first ? round(words / (last - first)) : null,
        loudness_spread_lu: levels.length > 1 ? round(levels.at(-1)! - levels[0], 1) : 0,
        heard_with: TRANSCRIPT_MODEL.split("/").pop(),
      },
    };
  } finally {
    dismiss(tid);
  }
}
