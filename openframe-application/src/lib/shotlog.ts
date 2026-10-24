import type { Word } from "./captions";

export interface Measures {
  duration: number; width: number; height: number; frame_rate: number;
  scene: number[]; step: number; luma: number[]; motion: number[]; dx: number[]; dy: number[];
  rgb: [number, number, number][]; audio_step: number; audio_db: number[];
}
export const SHOT_SIZES = ["extreme_wide", "wide", "medium", "close_up", "extreme_close_up", "screen", "graphic"] as const;
export const CAMERAS = ["static", "pan", "tilt", "zoom_in", "zoom_out", "handheld", "tracking", "unknown"] as const;
export interface Description {
  shot_size: typeof SHOT_SIZES[number]; camera: typeof CAMERAS[number]; people: number;
  on_screen_text: string[]; action: string; mood: string; description: string;
}
export interface Moment {
  start: number; end: number; shot: number; frames: number[];
  measured: { motion: number; luma: number; loudness_db: number; pan: "left" | "right" | "up" | "down" | null; rgb: [number, number, number] };
  described?: Description;
}
export interface ShotLog {
  version: 1; has_audio?: boolean; duration: number; model: string; measured_at: string; interval: number;
  shots: { start: number; end: number }[]; moments: Moment[]; silences: [number, number][]; complete: boolean;
}
export interface Range { start: number; end: number }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const median = (xs: number[]) => { const a = [...xs].sort((a, b) => a - b); return a.length ? a[Math.floor(a.length / 2)] : 0; };

/** A local peak must clear both the absolute floor and its local activity. */
export function cutsFrom(m: Measures): number[] {
  if (!(m.frame_rate > 0)) return [];
  const radius = Math.max(1, Math.round(m.frame_rate / 2));
  const candidates: { v: number; i: number }[] = [];
  m.scene.forEach((v, i) => { if (i > 0 && i / m.frame_rate < m.duration && v > 0.35 && v > 3 * median(m.scene.slice(Math.max(0, i - radius), i + radius + 1))) candidates.push({ v, i }); });
  const kept: typeof candidates = [];
  for (const c of candidates.sort((a, b) => b.v - a.v)) if (!kept.some(k => Math.abs(k.i - c.i) / m.frame_rate < 0.4)) kept.push(c);
  return kept.sort((a, b) => a.i - b.i).map(c => c.i / m.frame_rate);
}
export function silencesFrom(m: Measures): [number, number][] {
  if (!m.audio_db.length || !(m.audio_step > 0)) return [];
  const sorted = [...m.audio_db].sort((a, b) => a - b);
  const threshold = Math.max(-45, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] - 25);
  const result: [number, number][] = [];
  let start: number | undefined;
  for (let i = 0; i <= m.audio_db.length; i++) {
    if (i < m.audio_db.length && m.audio_db[i] < threshold) start ??= i * m.audio_step;
    else if (start !== undefined) {
      const end = Math.min(m.duration, i * m.audio_step);
      if (end - start >= 0.25 - 1e-9) result.push([start, end]);
      start = undefined;
    }
  }
  return result;
}
export function planMoments(duration: number, cuts: number[], interval = 8): Moment[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(interval) || interval <= 0) return [];
  const edges = [0, ...[...new Set(cuts.filter(t => Number.isFinite(t) && t > 0 && t < duration))].sort((a, b) => a - b), duration];
  const moments: Moment[] = [];
  for (let shot = 0; shot < edges.length - 1; shot++) {
    const lo = edges[shot], length = edges[shot + 1] - lo, count = Math.ceil(length / interval);
    for (let i = 0; i < count; i++) {
      const start = lo + length * i / count, end = lo + length * (i + 1) / count;
      moments.push({ start, end, shot, frames: (end - start < 2 ? [0.5] : [0.15, 0.5, 0.85]).map(f => start + (end - start) * f), measured: { motion: 0, luma: 0, loudness_db: -90, pan: null, rgb: [0, 0, 0] } });
    }
  }
  return moments;
}
/** Every pass spans the file, including its last partial group. */
export function describeOrder(moments: readonly Moment[]): number[] {
  const order: number[] = [];
  for (const [step, offset] of [[8, 0], [8, 4], [4, 2], [2, 1]]) for (let i = offset; i < moments.length; i += step) order.push(i);
  return order;
}
export function measureMoment(moment: Moment, m: Measures): Moment["measured"] {
  const average = (values: number[], step: number, fallback = 0) => {
    const xs = values.slice(Math.floor(moment.start / step), Math.max(Math.floor(moment.start / step) + 1, Math.ceil(moment.end / step)));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  };
  const dx = average(m.dx, m.step), dy = average(m.dy, m.step);
  const colors = m.rgb.slice(Math.floor(moment.start / m.step), Math.max(Math.floor(moment.start / m.step) + 1, Math.ceil(moment.end / m.step)));
  return { motion: average(m.motion, m.step), luma: average(m.luma, m.step), loudness_db: average(m.audio_db, m.audio_step, -90),
    pan: Math.max(Math.abs(dx), Math.abs(dy)) < 0.01 ? null : Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up",
    rgb: [0, 1, 2].map(i => Math.round(colors.length ? colors.reduce((sum, c) => sum + c[i], 0) / colors.length : 0)) as [number, number, number] };
}
const shortString = (maxLength: number) => ({ type: "string", maxLength });
export const MOMENT_SCHEMA = {
  type: "object", properties: {
    shot_size: { type: "string", enum: SHOT_SIZES, maxLength: 16 }, camera: { type: "string", enum: CAMERAS, maxLength: 12 }, people: { type: "integer", minimum: 0 },
    on_screen_text: { type: "array", maxItems: 6, items: shortString(60) }, action: shortString(160), mood: shortString(40), description: shortString(320),
  }, required: ["shot_size", "camera", "people", "on_screen_text", "action", "mood", "description"], additionalProperties: false,
};
export function momentPrompt(moment: Pick<Moment, "frames">): string {
  return `These are ${moment.frames.length} frames from one moment of a video, in time order, at ${moment.frames.map(t => `${t.toFixed(2)} s`).join(", ")}. Describe what is happening for a video editor deciding what to clip. Be concrete and brief: action is what changes across the frames in one sentence; description is at most two sentences. Name only what you can see. on_screen_text contains only letters and numbers you can read, copied exactly; logos and objects belong in description, not on_screen_text.`;
}
/** Reject prose about objects, while keeping short labels, mixed-case names,
 * uppercase captions and numeric readouts. This is a conservative OCR guard. */
function literalText(s: string) {
  const words = s.match(/[\p{L}\p{N}]+/gu) ?? [];
  const lowercase = words.filter(w => /^[a-z]+$/.test(w)).length;
  return !!s.trim() && !(words.length > 3 && !/\d/.test(s) && lowercase >= 3);
}
export function parseMoment(text: string): Description | undefined {
  try {
    const d = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    if (!d || !["action", "mood", "description", "shot_size", "camera"].every(k => typeof d[k] === "string") || !Number.isFinite(d.people) || !Array.isArray(d.on_screen_text) || d.on_screen_text.some((s: unknown) => typeof s !== "string")) return;
    return { shot_size: SHOT_SIZES.includes(d.shot_size) ? d.shot_size : "medium", camera: CAMERAS.includes(d.camera) ? d.camera : "unknown", people: clamp(Math.round(d.people), 0, 10000), on_screen_text: d.on_screen_text.filter(literalText).slice(0, 6).map((s: string) => s.trim().slice(0, 60)), action: d.action.trim().slice(0, 160), mood: d.mood.trim().slice(0, 40), description: d.description.trim().slice(0, 320) };
  } catch { return; }
}
export const shotTime = (t: number) => `${Math.floor(t / 60).toString().padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
export type ScreenplayOptions = { from?: number; to?: number; words?: Word[]; detail?: "full" | "brief" };
export function screenplay(log: ShotLog, options: ScreenplayOptions = {}): string {
  return screenplayBlocks(log, options).map(b => b.text).join("\n");
}
/** The screenplay in blocks that each start at a source time, so a long
 * reading can be paged. Brief: one line per moment, and a run of moments
 * in one shot that read alike (a stream's fixed layout) folded into one. */
export function screenplayBlocks(log: ShotLog, { from = 0, to = log.duration, words, detail = "full" }: ScreenplayOptions = {}): { at: number; text: string }[] {
  if (detail === "brief") return briefBlocks(log, from, to);
  return fullLines(log, from, to, words);
}
const words4 = (s: string) => new Set(tokens(s));
function alike(a: string, b: string) {
  const x = words4(a), y = words4(b);
  const both = [...x].filter(w => y.has(w)).length;
  return both / Math.max(1, new Set([...x, ...y]).size) >= 0.5;
}
function briefBlocks(log: ShotLog, from: number, to: number) {
  const blocks: { at: number; text: string; end: number; shot: number; key: string; count: number; head: string; moments: Moment[] }[] = [];
  for (const m of log.moments.filter(m => m.end > from && m.start < to)) {
    const d = m.described, start = Math.max(from, m.start), end = Math.min(to, m.end);
    const cut = m.start >= from && m.start > 0 && log.shots.some(s => s.start === m.start) ? "CUT " : "";
    const sound = log.has_audio === false ? "no audio" : m.measured.loudness_db <= -45 ? "quiet" : m.measured.loudness_db >= -24 ? "loud" : "";
    const text = d ? `${d.shot_size.toUpperCase()} ${d.camera}: ${d.action}${d.on_screen_text.length ? ` On screen: ${d.on_screen_text.slice(0, 2).map(s => JSON.stringify(s)).join(", ")}.` : ""}${sound ? ` [${sound}]` : ""}` : `not described yet${sound ? ` [${sound}]` : ""}`;
    const last = blocks.at(-1);
    if (last && !cut && d && last.shot === m.shot && last.key === `${d.shot_size}|${d.camera}` && alike(last.head, `${d.action} ${d.description}`)) {
      last.end = end; last.count++; last.moments.push(m);
      last.text = `${shotTime(last.at)}-${shotTime(end)}  ${last.text.slice(last.text.indexOf("  ") + 2).replace(/ \(alike ×\d+\)$/, "")} (alike ×${last.count})`;
      continue;
    }
    blocks.push({ moments: [m], at: start, end, shot: m.shot, key: d ? `${d.shot_size}|${d.camera}` : "", count: 1, head: d ? `${d.action} ${d.description}` : "", text: `${shotTime(start)}-${shotTime(end)}  ${cut}${text}` });
  }
  return blocks;
}
/** Share exactly the brief screenplay's grouping with the panel. */
export function momentGroups(log: ShotLog) {
  return briefBlocks(log, 0, log.duration).map(b => ({ start: b.at, end: b.end, moments: b.moments }));
}
/** At most `maxChars` of blocks; `next` is where the following page starts. */
export function pageBlocks(blocks: { at: number; text: string }[], maxChars: number): { text: string; next?: number } {
  let size = 0, n = 0;
  while (n < blocks.length && (n === 0 || size + blocks[n].text.length + 1 <= maxChars)) size += blocks[n++].text.length + 1;
  return { text: blocks.slice(0, n).map(b => b.text).join("\n"), ...(n < blocks.length ? { next: blocks[n].at } : {}) };
}
function fullLines(log: ShotLog, from: number, to: number, words?: Word[]) {
  const lines: { at: number; text: string }[] = [];
  const events = [...log.moments.filter(m => m.end > from && m.start < to).map(m => ({ at: m.start, moment: m })), ...log.shots.slice(1).filter(s => s.start >= from && s.start < to).map(s => ({ at: s.start, moment: undefined }))].sort((a, b) => a.at - b.at || Number(!!a.moment) - Number(!!b.moment));
  for (const { at, moment: m } of events) {
    if (!m) { lines.push({ at, text: `${shotTime(at)}          CUT` }); continue; }
    const d = m.described, sound = log.has_audio === false ? "no audio" : m.measured.loudness_db <= -45 ? "quiet" : m.measured.loudness_db >= -24 ? "loud" : "moderate";
    const pauses = log.silences.filter(([s, e]) => e > Math.max(from, m.start) && s < Math.min(to, m.end));
    const block = [`${shotTime(Math.max(from, m.start))}-${shotTime(Math.min(to, m.end))}  ${d ? `${d.shot_size.toUpperCase()}, ${d.camera}. ${d.action} (${d.mood}) ${d.description}` : `not described yet. Motion ${m.measured.motion.toFixed(2)}, luma ${m.measured.luma.toFixed(2)}, pan ${m.measured.pan ?? "none"}`}`];
    block.push(`                 ${d?.on_screen_text.length ? `On screen: ${d.on_screen_text.map(s => JSON.stringify(s)).join(", ")}. ` : ""}Sound: ${log.has_audio === false ? "no audio" : `${sound} (${Math.round(m.measured.loudness_db)} dB), ${pauses.length ? `silence ${pauses.map(([s, e]) => `${shotTime(s)}-${shotTime(e)}`).join(", ")}` : "no silence"}`}.`);
    const speech = (log.has_audio === false ? undefined : words)?.filter(w => w.end > Math.max(from, m.start) && w.start < Math.min(to, m.end)).map(w => w.text).join(" ");
    if (speech) block.push(`                 Speech: ${JSON.stringify(speech)}`);
    lines.push({ at: Math.max(from, m.start), text: block.join("\n") });
  }
  return lines;
}
const stem = (s: string) => s.toLowerCase().replace(/(?:ing|ed|es|s)$/u, "").replace(/(.)\1$/u, "$1").replace(/e$/u, "");
const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
const synonyms = [
  "cheer celebrate applaud clap excited euphoric", "laugh smile grin", "land touchdown landing",
  "talk speak say speech", "crowd audience people group", "run sprint", "car vehicle",
  "screen monitor display", "text sign caption title graphic",
].map(tokens);
export function findMoments(logs: { asset: string; log: ShotLog }[], query: string, limit = 10) {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
  const wanted = [...new Set(tokens(query))];
  if (!wanted.length) return [];
  return logs.flatMap(({ asset, log }) => log.moments.flatMap(m => {
    const d = m.described;
    if (!d) return [];
    const fields = [[d.on_screen_text.join(" "), 4], [d.action, 3], [d.description, 1], [d.mood, 1]] as const;
    const all = fields.map(([s]) => s).join(" ").toLowerCase();
    if (phrases.some(p => !all.includes(p))) return [];
    let score = 0;
    const matched = new Set<string>();
    for (const [text, weight] of fields) for (const w of new Set(tokens(text))) {
      const direct = wanted.includes(w);
      const related = !direct && wanted.some(q => synonyms.some(group => group.includes(q) && group.includes(w)));
      if (direct || related) { score += weight * (direct ? 1 : 0.5); matched.add(w); }
    }
    return score ? [{ asset, start: m.start, end: m.end, score, matched_words: [...matched] }] : [];
  })).sort((a, b) => b.score - a.score || a.asset.localeCompare(b.asset) || a.start - b.start).slice(0, limit);
}
export function editPoints(log: ShotLog, range: Range, { window = 2, words: suppliedWords = [] }: { window?: number; words?: Word[] } = {}) {
  const words = log.has_audio === false ? [] : suppliedWords;
  // An Out never lands at or before its In: a cut just after the In would empty the range.
  const shortest = Math.min(0.5, (range.end - range.start) / 2);
  const choose = (edge: "in" | "out", after = -Infinity) => {
    const target = edge === "in" ? range.start : range.end;
    const allowed = (time: number) => edge === "in" ? time <= range.end - shortest : time >= after + shortest;
    const candidates: { time: number; reasons: string[]; score: number }[] = [];
    const add = (time: number, reason: string, weight: number) => {
      if (time < 0 || time > log.duration || !allowed(time) || Math.abs(time - target) > window + 1e-9 || words.some(w => time > w.start + 1e-6 && time < w.end - 1e-6)) return;
      const old = candidates.find(c => Math.abs(c.time - time) < 1e-6);
      if (old) { old.reasons.push(reason); old.score += weight; }
      else candidates.push({ time, reasons: [reason], score: weight - Math.abs(time - target) / Math.max(window, 0.001) });
    };
    // Exclusive Outs land at the boundary: the last included picture is before it.
    for (const s of log.shots.slice(1)) add(s.start, `shot cut at ${shotTime(s.start)}${edge === "out" ? " (exclusive Out, before the new shot)" : ""}`, 4);
    for (const [s, e] of log.has_audio === false ? [] : log.silences) add(edge === "in" ? e : s, `${(e - s).toFixed(1)} s of silence`, 3);
    for (let i = 1; i < log.moments.length; i++) if (log.moments[i - 1].measured.motion > 0.15 && log.moments[i].measured.motion < 0.05) add(log.moments[i].start, "end of an action (motion drops)", 2);
    for (const w of words) add(edge === "in" ? w.start : w.end, edge === "out" && /[.!?]["')]*$/.test(w.text) ? "after a sentence" : "word boundary", edge === "out" && /[.!?]["')]*$/.test(w.text) ? 4 : 1);
    const crossing = words.find(w => target > w.start && target < w.end);
    add(crossing ? edge === "in" ? crossing.start : crossing.end : target, crossing ? "outside the spoken word" : "requested boundary", 0);
    candidates.sort((a, b) => b.score - a.score || Math.abs(a.time - target) - Math.abs(b.time - target));
    const points = candidates.slice(0, 3).map(({ time, reasons }) => ({ time, reasons }));
    return { best: points[0] ?? null, alternatives: points.slice(1) };
  };
  const start = choose("in");
  return { in: start, out: choose("out", start.best?.time ?? range.start) };
}
export function joinAdvice(logA: ShotLog, rangeA: Range, logB: ShotLog, rangeB: Range) {
  const a = logA.moments.find(m => m.start < rangeA.end && m.end >= rangeA.end), b = logB.moments.find(m => m.start <= rangeB.start && m.end > rangeB.start);
  const advice: { kind: string; reason: string; tools: { name: string; arguments: Record<string, unknown> }[] }[] = [];
  const transition = (type: string) => ({ name: "set_transition", arguments: { clip_id: "<A clip id>", type, duration: 0.3 } });
  if (!a || !b) return [{ kind: "hard_cut", reason: "No measured boundary evidence; preview the join first", tools: [transition("none")] }];
  const same = logA === logB && a.shot === b.shot;
  const close = a.described && b.described && a.described.shot_size === b.described.shot_size && a.described.camera === b.described.camera && Math.hypot(...a.measured.rgb.map((c, i) => c - b.measured.rgb[i])) < 45;
  if (same || close) advice.push({ kind: "jump_cut", reason: "Jump-cut risk: similar framing. Punch in B to 110–120% of its current scale, insert a cutaway, or use a short dissolve. set_param value 1.15 assumes fit scale 1; multiply B's current scale by 1.15 otherwise", tools: [{ name: "set_param", arguments: { clip_ids: ["<B clip id>"], path: "transform.scale", value: 1.15 } }, transition("dissolve")] });
  if (Math.abs(a.measured.luma - b.measured.luma) > 0.35) advice.push({ kind: "brightness", reason: "Large brightness change; try a dip to black or a dissolve", tools: [transition("dipBlack"), transition("dissolve")] });
  if (a.measured.pan && a.measured.pan === b.measured.pan) advice.push({ kind: "match_motion", reason: `Match the ${a.measured.pan} motion with a hard cut on the move`, tools: [transition("none")] });
  const silent = (log: ShotLog, time: number) => log.silences.some(([s, e]) => time >= s && time < e);
  if (logA.has_audio !== false && a.measured.loudness_db > -45 && !silent(logA, Math.max(0, rangeA.end - 0.001))) advice.push({ kind: "L_cut", reason: "A's sound is still running: detach its audio, then extend its end about 0.5 s under B, if source handles allow", tools: [{ name: "detach_audio", arguments: { clip_id: "<A clip id>" } }, { name: "trim_clip", arguments: { clip_id: "<detached A audio id>", edge: "end", to: "<timeline cut seconds + 0.5>", ripple: false } }] });
  if (logB.has_audio !== false && b.measured.loudness_db > -45 && !silent(logB, rangeB.start)) advice.push({ kind: "J_cut", reason: "B's sound begins with its picture: if speech should lead it, detach audio and extend its start about 0.5 s before the picture; verify speech and source handles", tools: [{ name: "detach_audio", arguments: { clip_id: "<B clip id>" } }, { name: "trim_clip", arguments: { clip_id: "<detached B audio id>", edge: "start", to: "<timeline cut seconds - 0.5>", ripple: false } }] });
  if (!advice.length) advice.push({ kind: "hard_cut", reason: "No framing, brightness or sound warning; use a hard cut", tools: [transition("none")] });
  return advice;
}

/** Saved logs are outside the document, but still cross a disk trust boundary. */
export function parseShotLog(text: string): ShotLog | undefined {
  try {
    const l = JSON.parse(text) as ShotLog;
    const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    const span = (s: Range) => !!s && num(s.start) && num(s.end) && s.start >= 0 && s.end > s.start && s.end <= l.duration;
    if ((l.has_audio !== undefined && typeof l.has_audio !== "boolean") || l.version !== 1 || !num(l.duration) || l.duration <= 0 || !num(l.interval) || l.interval <= 0 || typeof l.model !== "string" || typeof l.measured_at !== "string" || typeof l.complete !== "boolean" || !Array.isArray(l.shots) || !l.shots.length || !l.shots.every(span) || !Array.isArray(l.moments) || !l.moments.length || !Array.isArray(l.silences)) return;
    if (l.shots[0].start !== 0 || l.shots.at(-1)!.end !== l.duration || l.shots.some((s, i) => i > 0 && s.start !== l.shots[i - 1].end)) return;
    for (const [i, m] of l.moments.entries()) {
      if (!span(m) || (i === 0 ? m.start !== 0 : m.start !== l.moments[i - 1].end) || !Number.isInteger(m.shot) || !l.shots[m.shot] || m.start < l.shots[m.shot].start || m.end > l.shots[m.shot].end || !Array.isArray(m.frames) || m.frames.length < 1 || m.frames.length > 3 || !m.frames.every(t => num(t) && t >= m.start && t < m.end)) return;
      const v = m.measured;
      if (!v || ![v.motion, v.luma, v.loudness_db].every(num) || v.motion < 0 || v.motion > 1 || v.luma < 0 || v.luma > 1 || v.loudness_db < -90 || v.loudness_db > 0 || ![null, "left", "right", "up", "down"].includes(v.pan) || !Array.isArray(v.rgb) || v.rgb.length !== 3 || !v.rgb.every(c => num(c) && c >= 0 && c <= 255)) return;
      if (m.described) { const parsed = parseMoment(JSON.stringify(m.described)); if (!parsed) return; m.described = parsed; }
    }
    if (l.moments.at(-1)!.end !== l.duration || !l.silences.every(s => Array.isArray(s) && s.length === 2 && num(s[0]) && num(s[1]) && s[0] >= 0 && s[1] > s[0] && s[1] <= l.duration)) return;
    l.complete = l.moments.every(m => !!m.described);
    return l;
  } catch { return; }
}


/** Two native requests can run together. Stop admission on cancel/error,
 * drain both workers before saving or starting another run of this source. */
export async function describePending(moments: Moment[], signal: AbortSignal, describe: (m: Moment) => Promise<Description | undefined>, finished: (done: number) => Promise<void>) {
  const order = describeOrder(moments).filter(i => !moments[i].described);
  let next = 0, done = moments.filter(m => m.described).length, failed = false;
  const worker = async () => {
    try {
      while (!signal.aborted && !failed && next < order.length) {
        const m = moments[order[next++]];
        m.described = await describe(m);
        if (m.described) { done++; await finished(done); }
      }
    } catch (e) { failed = true; throw e; }
  };
  const results = await Promise.allSettled([worker(), worker()]);
  const error = results.find(r => r.status === "rejected");
  if (error?.status === "rejected") throw error.reason;
  signal.throwIfAborted();
}
