// A voiceover take's captions a few words at a time (add_voiceover and
// retake_voiceover caption_words, ADR-115): the take heard by Whisper on
// this machine (as review_voiceover hears it), its words timed and fitted
// to the take's own sound (lib/captionWords.ts), then cut into chunks.

import { decodeMono } from "../engine/analyze";
import { transcribePcm } from "../engine/transcribe";
import { dips, speechActivity } from "../lib/analysis/speech";
import type { Caption, Word } from "../lib/captions";
import { chunkCaptions, markBreaks, overLimit, voiceWordTimes } from "../lib/captionWords";
import type { Asset } from "../lib/project/types";
import { parseLine } from "../lib/voiceScript";
import { TRANSCRIPT_MODEL } from "./transcript";

const RATE = 16000;

/**
 * The captions of one take, `max` words at a time, in seconds from the
 * take's start: `caption` is what they show, `script` what was read (its
 * pause marks are pauses too, when the caption shows the script's words).
 * When Whisper cannot run (offline on first use), the words are timed by
 * their letters between the voice's pauses, and heard is false.
 */
export async function takeChunks(asset: Asset, caption: string, script: string, max: number, signal: AbortSignal): Promise<{ chunks: Caption[]; heard: boolean }> {
  const pcm = await decodeMono(asset, 0, asset.duration, RATE, undefined, signal);
  let words: Word[] = [];
  let heard = true;
  try {
    words = await transcribePcm(pcm, 0, { model: TRANSCRIPT_MODEL, language: null }, () => undefined, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    heard = false;
  }
  const act = speechActivity(pcm, RATE);
  if (!act) return { chunks: [{ start: 0, end: asset.duration, text: caption }], heard };
  const marks = caption === parseLine(script).written ? markBreaks(script) : undefined;
  const timed = voiceWordTimes(caption, words, { first: act.first, last: act.last, dips: dips(pcm, RATE) }, { marks });
  return { chunks: chunkCaptions(timed, max, asset.duration), heard };
}

/** A note for each caption holding more than `max` words, and why. */
export function overLimitNotes(chunks: Caption[], max: number): string[] {
  return overLimit(chunks, max).map((c) => `"${c.text}" holds ${c.words?.length ?? c.text.split(/\s+/).length} words: they are spoken in ${(c.end - c.start).toFixed(2)} s, too quickly to show ${max} at a time without a caption that flashes by (under 0.3 s).`);
}

/** What an answer says about captions made a few words at a time. */
export function chunkNote(max: number, heard: boolean): string {
  return `Captions ${max === 1 ? "one word" : `up to ${max} words`} at a time, each word timed to the voice: ${heard ? "heard by Whisper" : "Whisper could not run, so by its letters"} between the voice's own start and pauses.`;
}
