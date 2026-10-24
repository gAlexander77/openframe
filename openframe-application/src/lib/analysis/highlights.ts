import type { ShotLog } from "../shotlog";
import type { Word } from "../captions";
import { chatCue, type ChatMessage } from "../chatReplay";
import { fft } from "./beats";
import { LoudnessMeter } from "./loudness";

/** Long files trade fine scene timing for a bounded reading. Audio and
 * supplied times still cover the full file when scene sampling runs out. */
export const sceneSampling = (seconds: number) => ({ interval_seconds: seconds > 20 * 60 ? 4 : 1 });
export const SCENE_BUDGET_SECONDS = 75;

/** Scene sample times coarse to fine, each pass ascending (about 32 samples
 * first, then the midpoints, down to `interval`): a reading its budget cuts
 * short still spans the whole file evenly instead of only its start, which
 * gave early moments a scene bonus late ones never got. */
export function scenePasses(seconds: number, interval: number): number[][] {
  let top = 0;
  while (interval * 2 ** (top + 1) * 32 <= seconds) top++;
  const passes: number[][] = [];
  for (let level = top; level >= 0; level--) {
    const step = interval * 2 ** level, pass: number[] = [];
    // The first pass takes every multiple of its step; later ones only the new odd multiples.
    for (let t = level === top ? 0 : step; t < seconds; t += level === top ? step : 2 * step) pass.push(t);
    passes.push(pass);
  }
  return passes;
}

export const HIGHLIGHT_STEP = 0.5;
export const HIGHLIGHT_WEIGHTS = { audio: 0.5, speech: 0.1, chat: 0.25, scenes: 0.05, picture: 0.25, times: 0.8, keywords: 0.3 };
export type HighlightWeights = typeof HIGHLIGHT_WEIGHTS;
export interface HighlightFeature { time: number; loudness: number; momentary: number; speech: number; vocal: number }
export interface Highlight { rank: number; start: number; end: number; peak: number; score: number; reasons: string[]; snippet?: string; title?: string }
export interface HighlightOptions {
  count?: number; min_length?: number; max_length?: number; lead_in?: number; lead_out?: number; min_gap?: number;
  times?: number[]; keywords?: string[]; weights?: Partial<HighlightWeights>;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const lufs = (power: number) => Math.max(-70, -0.691 + 10 * Math.log10(Math.max(1e-12, power)));

/** 16 kHz mono in arbitrary chunks. Only 100 ms features survive each push. */
export class HighlightAudio {
  private meter = new LoudnessMeter(16000, 1);
  private block = new Float32Array(1600);
  private used = 0;
  private voice: number[] = [];
  private vocal: number[] = [];
  private envelope: number[] = [];
  private previous = new Float64Array(256);
  private re = new Float64Array(512);
  private im = new Float64Array(512);
  push(pcm: Float32Array) {
    for (let offset = 0; offset < pcm.length;) {
      const n = Math.min(this.block.length - this.used, pcm.length - offset);
      this.block.set(pcm.subarray(offset, offset + n), this.used);
      this.used += n; offset += n;
      if (this.used === this.block.length) { this.flush(); this.used = 0; }
    }
  }
  private flush() {
    this.meter.push([this.block], this.block.length);
    let speech = 0;
    const envelope: number[] = [];
    for (let k = 0; k < 5; k++) {
      let power = 0, crossings = 0;
      for (let j = k * 320; j < (k + 1) * 320; j++) {
        power += this.block[j] ** 2;
        if (j && (this.block[j] >= 0) !== (this.block[j - 1] >= 0)) crossings++;
      }
      envelope.push(Math.sqrt(power / 320));
      if (power / 320 > 1e-6 && crossings > 3 && crossings < 200) speech++;
    }
    for (let i = 0; i < 512; i++) this.re[i] = this.block[i + 544] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 511));
    this.im.fill(0); fft(this.re, this.im);
    let band = 0, total = 0, flux = 0;
    for (let i = 1; i < 256; i++) {
      const energy = this.re[i] ** 2 + this.im[i] ** 2;
      total += energy;
      if (i * 16000 / 512 >= 300 && i * 16000 / 512 <= 3000) band += energy;
      flux += Math.max(0, Math.sqrt(energy) - this.previous[i]);
      this.previous[i] = Math.sqrt(energy);
    }
    this.voice.push(speech / 5);
    // ponytail: band energy, 4-8 Hz envelope modulation and spectral flux
    // suggest vocal excitement, not laughter recognition. Music and game
    // effects can match; a trained local event classifier is the upgrade.
    this.envelope.push(...envelope);
    if (this.envelope.length > 25) this.envelope.splice(0, this.envelope.length - 25);
    const avg = mean(this.envelope);
    let modulation = 0;
    for (const hz of [4, 6, 8]) {
      let re = 0, im = 0;
      this.envelope.forEach((v, i) => { re += (v - avg) * Math.cos(2 * Math.PI * hz * i / 50); im += (v - avg) * Math.sin(2 * Math.PI * hz * i / 50); });
      modulation = Math.max(modulation, Math.hypot(re, im) / (this.envelope.length * avg + 1e-9));
    }
    this.vocal.push(clamp(band / (total + 1e-9) * modulation * flux / (Math.sqrt(total) + 1e-9)));
  }
  finish(): HighlightFeature[] {
    if (this.used) { this.block.fill(0, this.used); this.flush(); this.used = 0; }
    const powers = this.meter.steps;
    const out: HighlightFeature[] = [];
    for (let k = 0; k < powers.length; k += 5) {
      out.push({ time: k / 10 + 0.25, loudness: lufs(mean(powers.slice(Math.max(0, k - 12), k + 18))), momentary: lufs(mean(powers.slice(Math.max(0, k), k + 4))), speech: mean(this.voice.slice(k, k + 5)), vocal: mean(this.vocal.slice(k, k + 5)) });
    }
    return out;
  }
}

/** Three-minute surrounding median; sorted sliding window, O(n * 360),
 * independent of PCM length. A sustained loud section becomes its baseline. */
export function rollingBaseline(values: number[]): number[] {
  const sorted: number[] = [], out: number[] = [];
  const pos = (v: number) => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m] < v) lo = m + 1; else hi = m; } return lo; };
  let left = 0, right = 0;
  for (let i = 0; i < values.length; i++) {
    while (right < Math.min(values.length, i + 181)) { const v = values[right++]; sorted.splice(pos(v), 0, v); }
    while (left < Math.max(0, i - 180)) { const v = values[left++]; sorted.splice(pos(v), 1); }
    out.push(sorted[Math.floor(sorted.length / 2)] ?? 0);
  }
  return out;
}

/** Prefer a nearby pause without violating the required length or excluding the peak. */
export function highlightWindow(peak: number, from: number, to: number, duration: number, pauses: number[], options: HighlightOptions = {}): { start: number; end: number } {
  const min = Math.min(duration, options.min_length ?? 15), max = Math.min(duration, options.max_length ?? 60);
  let start = Math.max(0, from - (options.lead_in ?? 4)), end = Math.min(duration, to + (options.lead_out ?? 3));
  if (end - start < min) { start = Math.max(0, start - (min - end + start) / 2); end = Math.min(duration, start + min); start = Math.max(0, end - min); }
  if (end - start > max) { start = Math.max(0, peak - max / 2); end = Math.min(duration, start + max); start = Math.max(0, end - max); }
  const nearest = (edge: number, valid: (p: number) => boolean) => pauses.filter(p => Math.abs(p - edge) <= 4 && valid(p)).sort((a, b) => Math.abs(a - edge) - Math.abs(b - edge))[0] ?? edge;
  start = nearest(start, p => p >= 0 && p <= peak && end - p >= min && end - p <= max);
  end = nearest(end, p => p <= duration && p >= peak && p - start >= min && p - start <= max);
  return { start, end };
}

/** Picture is supporting evidence: at most half the audio weight. Keep
 * OCR/crowd/motion changes small so a clock or a cut cannot dominate. */
export function pictureSignals(log: ShotLog) {
  const motions = log.moments.map(m => m.measured.motion).sort((a, b) => a - b);
  const median = motions[Math.floor(motions.length / 2)] ?? 0;
  const event = /\b(?:cheer|celebrat|applaud|clap|laugh|scream|jump|hug|shock|surpris|crash|explod|explos|fall|fell|excit|euphori|intens|tense)\w*|\brais\w* (?:\w+ ){0,2}arms\b|\b(?:wins?|winning|won|losers?|lose|losing|lost)\b|\bhigh[ -]fiv\w*/i;
  return log.moments.map((m, i) => {
    const d = m.described, previous = log.moments[i - 1]?.described;
    const action = d && event.test(`${d.action} ${d.mood}`) ? 0.7 : 0;
    const text = d && d.on_screen_text.length && JSON.stringify(d.on_screen_text) !== JSON.stringify(previous?.on_screen_text ?? []) ? 0.1 : 0;
    const people = d && previous && d.people !== previous.people ? 0.1 : 0;
    const motion = m.measured.motion > median * 2 && m.measured.motion > median + 0.05 ? clamp((m.measured.motion - median) / Math.max(0.1, median)) * 0.1 : 0;
    const evidence = [action ? d?.action || d?.mood : "", text ? "on-screen text changed" : "", people ? "number of people changed" : "", motion ? "motion above the file median" : ""].filter(Boolean);
    return { start: m.start, end: m.end, score: action + text + people + motion, reason: evidence.length ? `picture: ${evidence.join("; ")} (shot log)` : "" };
  });
}

export function findHighlights(features: HighlightFeature[], duration: number, options: HighlightOptions = {}, chat?: ChatMessage[], cuts?: number[], bounds: [number, number] = [0, duration], shotLog?: ShotLog): Highlight[] {
  const n = Math.ceil(duration / HIGHLIGHT_STEP);
  const weights = { ...HIGHLIGHT_WEIGHTS, ...options.weights };
  const loud = rollingBaseline(features.map(f => f.loudness));
  const counts = Array<number>(n).fill(0), cues = Array<number>(n).fill(0);
  for (const m of chat ?? []) { const k = Math.floor(m.time / HIGHLIGHT_STEP); if (k < n) { counts[k]++; cues[k] += chatCue(m.text); } }
  // A three-second rate reduces sensitivity to a replay's timestamp rounding.
  const rates = counts.map((_, i) => counts.slice(Math.max(0, i - 2), i + 4).reduce((s, x) => s + x, 0) / 3);
  const base = rollingBaseline(rates);
  const cutBins = Array<number>(n).fill(0);
  for (const t of cuts ?? []) if (t >= 0 && t < duration) cutBins[Math.floor(t / HIGHLIGHT_STEP)]++;
  const cutPrefix = [0]; cutBins.forEach(x => cutPrefix.push(cutPrefix.at(-1)! + x));
  const pictures = shotLog ? pictureSignals(shotLog) : [];
  let pictureIndex = 0;
  const rows = Array.from({ length: n }, (_, i) => {
    const f = features[i], time = f?.time ?? i * HIGHLIGHT_STEP + 0.25;
    while (pictureIndex < pictures.length && pictures[pictureIndex].end <= time) pictureIndex++;
    const picture = pictures[pictureIndex]?.start <= time ? pictures[pictureIndex] : undefined;
    const rise = f ? Math.max(f.loudness, f.momentary) - loud[i] : 0;
    const spread = f ? Math.max(0, f.momentary - f.loudness) : 0;
    const shortRise = f ? f.loudness - loud[i] : 0;
    const audio = clamp((shortRise - 5) / 12) * 0.65 + clamp((rise - 5) / 12) * 0.25 + clamp(spread / 12) * 0.05 + (f?.vocal ?? 0) * 0.05;
    const ratio = rates[i] / Math.max(0.1, base[i]);
    const chatRise = Math.log1p(Math.max(0, ratio - 1.5));
    const chatScore = chatRise / (chatRise + 3) * 0.8 + clamp(cues.slice(Math.max(0, i - 2), i + 4).reduce((s, x) => s + x, 0) / 8) * 0.2;
    const given = options.times?.find(t => Math.abs(time - t) <= 1);
    const cpm = (cutPrefix[Math.min(n, i + 30)] - cutPrefix[Math.max(0, i - 30)]) * 2;
    let score = (picture?.score ?? 0) * weights.picture + audio * weights.audio + (f?.speech ?? 0) * weights.speech + (chat ? chatScore * weights.chat : 0) + (cuts ? clamp(cpm / 30) * weights.scenes : 0) + (given !== undefined ? weights.times : 0);
    const denominator = (features.length ? weights.audio + weights.speech : 0) + (chat ? weights.chat : 0) + (cuts ? weights.scenes : 0) + (shotLog ? weights.picture : 0);
    score = clamp(score / Math.max(denominator, 0.01));
    const reasons: string[] = [];
    if (rise >= 6) reasons.push(`loudness +${rise.toFixed(1)} LU over the 3-minute baseline`);
    if (f && f.vocal > 0.2) reasons.push(`vocal excitement ${(f.vocal * 100).toFixed(0)}% (heuristic)`);
    if (chat && ratio >= 2) reasons.push(`chat ${ratio.toFixed(1)}x busier (${Math.round(rates[i] * 60)} messages/min)`);
    else if (chat && chatScore >= 0.15) reasons.push(`chat emotes/clip requests (${Math.round(rates[i] * 60)} messages/min)`);
    if (cuts && cpm >= 6) reasons.push(`${cpm.toFixed(0)} scene changes/min`);
    if (f && reasons.length && f.speech >= 0.2) reasons.push(`speech ${(f.speech * 100).toFixed(0)}% of window`);
    if (picture?.reason && weights.picture > 0) reasons.push(picture.reason);
    if (given !== undefined) reasons.push(`viewer clip at ${new Date(given * 1000).toISOString().slice(11, 19)}`);
    return { time, score, reasons };
  });
  const pauses = features.filter(f => f.speech < 0.2).map(f => f.time);
  const picked: Highlight[] = [];
  for (const row of [...rows].sort((a, b) => b.score - a.score || a.time - b.time)) {
    if (row.time < bounds[0] || row.time >= bounds[1] || !row.reasons.length || row.score <= 0 || picked.some(h => Math.abs(h.peak - row.time) < (options.min_gap ?? Math.max(20, options.min_length ?? 15)))) continue;
    const i = Math.floor(row.time / HIGHLIGHT_STEP);
    let a = i, b = i;
    while (a > 0 && rows[a - 1].score > row.score * 0.7 && i - a < 60) a--;
    while (b + 1 < n && rows[b + 1].score > row.score * 0.7 && b - i < 60) b++;
    const window = highlightWindow(row.time - bounds[0], Math.max(bounds[0], rows[a].time) - bounds[0], Math.min(bounds[1], rows[b].time + HIGHLIGHT_STEP) - bounds[0], bounds[1] - bounds[0], pauses.map(t => t - bounds[0]), options);
    picked.push({ rank: picked.length + 1, peak: Math.min(duration, row.time), score: row.score, reasons: row.reasons, start: window.start + bounds[0], end: window.end + bounds[0] });
    if (picked.length >= (options.count ?? 10)) break;
  }
  return picked;
}

/** Candidate-only Whisper refinement; quotes and titles never require a model. */
export function refineHighlight(h: Highlight, words: Word[], duration: number, options: HighlightOptions, bounds: [number, number] = [0, duration]): Highlight {
  const pauses: number[] = [];
  words.forEach((w, i) => { if (!i || w.start - words[i - 1].end > 0.3 || /[.!?]$/.test(words[i - 1].text)) pauses.push(w.start); if (/[.!?]$/.test(w.text)) pauses.push(w.end); });
  const local = highlightWindow(h.peak - bounds[0], h.start + (options.lead_in ?? 4) - bounds[0], h.end - (options.lead_out ?? 3) - bounds[0], bounds[1] - bounds[0], pauses.map(t => t - bounds[0]), options);
  const window = { start: local.start + bounds[0], end: local.end + bounds[0] };
  const snippet = words.filter(w => w.start >= window.start && w.end <= window.end).map(w => w.text.trim()).join(" ");
  const hits = [...new Set((options.keywords ?? []).map(k => k.trim()).filter(k => k && snippet.toLowerCase().includes(k.toLowerCase())))];
  const title = highlightTitle(snippet, hits);
  return { ...h, ...window, score: clamp(h.score + Math.min(1, hits.length) * (options.weights?.keywords ?? HIGHLIGHT_WEIGHTS.keywords)), reasons: [...h.reasons, ...hits.map(k => `said '${k}'`)], snippet, title };
}

/** Prefer a short complete quote; an unpunctuated ASR run still gets a
 * useful phrase, cut at a word boundary rather than in the middle of one. */
export function highlightTitle(snippet: string, keywords: string[] = []): string {
  const text = snippet.replace(/\s+/g, " ").trim();
  if (!text) return "Highlight";
  const sentences = text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) ?? [];
  const favored = (s: string) => s.includes("!") || keywords.some(k => k.trim() && s.toLowerCase().includes(k.trim().toLowerCase()));
  const shortest = (items: string[]) => [...items].sort((a, b) => a.length - b.length)[0];
  const short = sentences.filter(s => s.length <= 60);
  const complete = shortest(short.filter(favored)) ?? shortest(short);
  if (complete) return complete;
  const phrases = text.split(/[,;:\u2014]+/).map(s => s.trim()).filter(Boolean);
  const phrase = shortest(phrases.filter(favored)) ?? shortest(sentences.filter(favored)) ?? phrases[0] ?? text;
  if (phrase.length <= 60) return phrase;
  const cut = phrase.slice(0, 61).replace(/\s+\S*$/, "").replace(/[,;:]+$/, "").trim();
  return cut || phrase.slice(0, 60);
}
