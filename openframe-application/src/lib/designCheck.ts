// A design check an AI model (or a person) runs before exporting: the
// playbook's rules measured on the project, so a model learns what to fix
// instead of being trusted to remember them (ADR-055's complement). Each
// finding names the rule, the clip and time, and the tool that fixes it.
// Rules and their sources: docs/research/Pro workflows 2026-10-18.md.
// What needs rendering or decoding the app measures first and passes in
// (ADR-068, ADR-097): every title's contrast with the picture behind it at
// a few moments of its life, its box, shadow and outline counted, and each
// music clip's last second. Without measurements (tests, a title past the
// cap, a surface that cannot render), text without an outline, shadow or
// box over footage is flagged as a risk instead, and the answer says why.
// Loudness is left to measure_loudness and export.

import { captionReading } from "./captions";
import { layerBox, TITLE_SAFE, titleZone, VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { contrastFixes, endsByItself, hex, titleLook, type Backdrop, type PixelBox, type Tail, type TitleLook, type UnevenFade } from "./contrast";
import { ANIMATIONS } from "./catalog";
import { paramAt } from "./keyframes";
import { textPad } from "./render/size";
import { lookReach } from "./textLook";
import { frameAt, framesToSeconds, secondsToFrames } from "./time";
import { findCompound, getAsset, mainTrack, projectDuration, sourceTimeAt } from "./project/ops";
import { gridStructure, sourceToTimeline } from "./analysis/musicMap";
import { CLICK_DB, DIP_DB, TAIL_DB, type EdgeReport } from "./analysis/edges";
import { continues, wholeSoundEffect } from "./audio";
import { crossfadeJoin } from "./crossfadeJoin";
import { calloutsOffFrame } from "./versionCallouts";
import type { Clip, CompoundClip, Id, Project, TextClip, Track, VisualClip } from "./project/types";
import { layerAt, type Layer } from "./render/plan";

export interface Finding {
  rule: string;
  level: "error" | "warning" | "tip";
  message: string;
  /** What to call (or do) to fix it. */
  fix: string;
  clip_id?: Id;
  /** Every clip a finding about several names (a line of captions; the
   * same finding on many clips, grouped), clip_id the first. */
  clip_ids?: Id[];
  /** A title inside a compound clip: the compound clip that shows it
   * (clip_id is the title's own id on the compound's timeline). */
  compound_clip_id?: Id;
  /** Timeline seconds. */
  at?: number;
}

export type CheckKind = "ad" | "epic_edit" | "social_short" | "any";

/** A title's contrast as the app measured it: the lowest of its moments. */
export interface MeasuredContrast extends Backdrop {
  /** The timeline frame of that moment. */
  frame: number;
  /** The fixes tried on the same pixels, with what each measures there. */
  fixes?: { say: string; ratio: number }[];
}

/** What the app measured before the check (automation.ts), by clip id. */
export interface Measured {
  /** Each title's contrast with the rendered picture behind it. */
  contrast?: Record<Id, MeasuredContrast>;
  /** The moments rendered for it. */
  moments?: number;
  /** Why contrast was not measured, or not for every title. */
  contrastNote?: string;
  /** Each long music clip's level at its very end and just before. */
  tails?: Record<Id, Tail>;
  /** Titles that fade unevenly (contrast.ts unevenFade), measured at the
   * middle of each fade, with the fixes that fade as one there. */
  fades?: Record<Id, UnevenFade & { frame: number; fixes: string[] }>;
  /** Titles their subject hides (lib/behind.ts hiddenNote): past its
   * limit, with what to say. */
  hidden?: { clipId: Id; frame: number; message: string; fix: string }[];
  /** Each join of audio clips (joinTargets) as preview_audio's edges judge
   * it, heard on its own track (ADR-119). */
  joins?: EdgeReport[];
  /** Why not every join was measured. */
  joinsNote?: string;
}

/** The letters of a title (with their box or outline, not the raster's
 * empty margin for a shadow or glow) at frame `f` of its own timeline, in
 * canvas pixels. `room`: pixels more on every side (the outline a version
 * leaves room for). */
function letterBox(p: Project, c: TextClip, f: number, room = 0): { box: PixelBox; opacity: number; scale: number } | null {
  const layer = layerAt(p, c as VisualClip, f);
  if (!layer) return null;
  const b = layerBox(p, c as VisualClip, layer);
  const reach = lookReach(c.style, p.height / 1080);
  const inset = (Math.max(0, textPad(p, c) - Math.max(reach.box, reach.stroke + reach.stroke2)) - room) * layer.scale;
  return { box: { left: b.cx - b.hw + inset, right: b.cx + b.hw - inset, top: b.cy - b.hh + inset, bottom: b.cy + b.hh - inset }, opacity: layer.opacity, scale: layer.scale };
}

/**
 * A title as the viewer sees it: on the project's timeline, or inside the
 * compound clips that show it (an end card built as a compound), each
 * appearance once. The Northbound test's end card was a compound: the
 * check found no end card, missed its second font and never measured its
 * contrast.
 */
export interface SeenText {
  c: TextClip;
  /** One per appearance: the title's id, or the compound clips that show
   * it and its id ("c_card/c_head"). */
  key: string;
  /** The compound clips it is seen through, outermost first. */
  via: CompoundClip[];
  /** The project's track it is drawn on (the outermost compound clip's). */
  track: Track;
  /** Where it shows on the project's timeline, frames. */
  start: number;
  duration: number;
}

/** Every title shown: on visible tracks, enabled, and inside enabled
 * compound clips on visible tracks, at their times on the project's
 * timeline (a compound clip's in point and speed applied). */
export function seenTexts(p: Project): SeenText[] {
  const fps = p.fps.num / p.fps.den;
  const out: SeenText[] = [];
  // toTop: a frame of this timeline as a frame of the project's; [lo, hi)
  // the project frames where this timeline shows.
  const walk = (tracks: Track[], toTop: (f: number) => number, lo: number, hi: number, via: CompoundClip[], root: Track | null, depth: number) => {
    for (const t of tracks) {
      if (t.hidden || t.kind !== "video") continue;
      for (const c of t.clips) {
        if (c.disabled) continue;
        const from = Math.max(lo, Math.round(toTop(c.start))), to = Math.min(hi, Math.round(toTop(c.start + c.duration)));
        if (to <= from) continue;
        if (c.type === "text") out.push({ c, key: [...via.map((v) => v.id), c.id].join("/"), via, track: root ?? t, start: from, duration: to - from });
        else if (c.type === "compound" && depth < 6) {
          const k = findCompound(p, c.compoundId);
          if (!k) continue;
          const speed = c.speed || 1;
          // Inner frame i plays at this timeline's c.start + (i / fps - in) * fps / speed.
          walk(k.tracks, (i) => toTop(c.start + (i / fps - c.in) * (fps / speed)), from, to, [...via, c], root ?? t, depth + 1);
        }
      }
    }
  };
  walk(p.tracks, (f) => f, 0, Infinity, [], null, 0);
  return out;
}

/** A box seen through a compound clip's layer: its inner timeline is a
 * canvas-sized picture, placed, scaled, turned and flipped as the layer
 * says. */
function throughLayer(p: Project, layer: Layer, b: PixelBox): PixelBox {
  const W = p.width, H = p.height;
  const s = layer.scale * (layer.flipX ? -1 : 1), sv = (layer.scaleY ?? layer.scale) * (layer.flipY ? -1 : 1);
  const rad = (layer.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = W / 2 + layer.x * W, cy = H / 2 + layer.y * H;
  const pts = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].map(([x, y]) => {
    const dx = (x - W / 2) * s, dy = (y - H / 2) * sv;
    return [cx + cos * dx - sin * dy, cy + sin * dx + cos * dy];
  });
  return { left: Math.min(...pts.map((q) => q[0])), right: Math.max(...pts.map((q) => q[0])), top: Math.min(...pts.map((q) => q[1])), bottom: Math.max(...pts.map((q) => q[1])) };
}

/** A seen title's letters at project frame `f` (default the middle of its
 * time on screen), in the project's canvas pixels, through the compound
 * clips that show it: with its opacity and the scale it is drawn at. The
 * box check_project judges, and the one versions keep inside the zone
 * (`room`: an outline's reach more on every side). */
export function seenLetters(p: Project, s: SeenText, f = s.start + Math.floor(s.duration / 2), room = 0): { box: PixelBox; opacity: number; scale: number; mid: number } | null {
  const layers: Layer[] = [];
  let at = f;
  let view: Project = p;
  for (const v of s.via) {
    const l = layerAt(view, v, at);
    const k = findCompound(p, v.compoundId);
    if (!l || !k) return null;
    layers.push(l);
    at = Math.max(0, frameAt(sourceTimeAt(v, at, p.fps), p.fps));
    view = { ...p, tracks: k.tracks };
  }
  const g = letterBox(view, s.c, at, room);
  if (!g) return null;
  let { box, opacity, scale } = g;
  for (const l of layers.reverse()) {
    box = throughLayer(p, l, box);
    opacity *= l.opacity;
    scale *= Math.min(Math.abs(l.scale), Math.abs(l.scaleY ?? l.scale));
  }
  return { box, opacity, scale, mid: f };
}

/** An outline, shadow or box gives a title its own contrast. */
const guarded = (c: TextClip) => (c.style.stroke?.width ?? 0) > 0 || !!c.style.shadow || !!c.style.background;

/** What a title draws around its letters, in words. */
const aroundOf = (c: TextClip) => [c.style.background && "box", (c.style.stroke?.width ?? 0) > 0 && "outline", c.style.shadow && "shadow", c.style.glow && "glow"].filter(Boolean) as string[];

/** The moments a title is measured at: once its in-animation has played,
 * its middle, and before its out-animation, plus the quarters of a title
 * on screen over six seconds; each a timeline frame inside it. */
export function titleMoments(c: TextClip, fps: number): number[] {
  const last = c.start + Math.max(0, c.duration - 1);
  const lo = Math.min(last, c.start + (c.animIn?.duration ?? 0)), hi = Math.max(lo, last - (c.animOut?.duration ?? 0));
  const shares = hi - lo > 6 * fps ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
  return [...new Set(shares.map((k) => Math.round(lo + (hi - lo) * k)))];
}

/** The middles of a title's in and out animations that fade it (fade,
 * zoom, pop, rise...: a whole-layer animation from or to no opacity),
 * each a timeline frame, when the fade lasts two frames or more. Measured
 * there, a title's backdrop is the one it fades over (ADR-118). */
export function fadeMoments(c: TextClip): number[] {
  // Played by each letter or word, it is drawn by the rasterizer, not faded whole.
  const fades = (a?: TextClip["animIn"]) => !!a && !a.unit && (ANIMATIONS[a.type]?.from?.opacity ?? 1) < 1 && !ANIMATIONS[a.type]?.text && a.duration >= 2;
  const last = c.start + c.duration - 1;
  return [...new Set([...(fades(c.animIn) ? [c.start + (c.animIn!.duration >> 1)] : []), ...(fades(c.animOut) ? [last - (c.animOut!.duration >> 1)] : [])].filter((f) => f >= c.start && f <= last))];
}

/** At most this many fade middles are rendered for one check. */
const FADE_FRAMES = 16;

/** A title the app measures: the frames to render (titles off) with its
 * letters' box at each, in canvas pixels, its look, and the fixes to try
 * on the same pixels. `clipId` is the appearance's key (SeenText.key): a
 * title inside a compound clip is measured where the compound shows it. */
export interface ContrastTarget {
  clipId: Id;
  samples: { frame: number; box: PixelBox }[];
  /** The middles of its fades (fadeMoments), judged for evenness. */
  fades?: { frame: number; box: PixelBox }[];
  look: TitleLook;
  fixes: { say: string; look: TitleLook }[];
}

/**
 * The titles whose contrast the app measures for check_project: every
 * visible title, outlined, shadowed and boxed ones too (their look is
 * measured with what it draws around the letters), inside compound clips
 * too, at titleMoments, the earliest first, at most `limit`; then up to
 * `captions` captions spread over the video, one moment each. `skipped`
 * counts the titles left out.
 */
export function contrastTargets(p: Project, limit = 40, captions = 12): { targets: ContrastTarget[]; skipped: number } {
  const all = seenTexts(p).sort((a, b) => a.start - b.start);
  const titles = all.filter((s) => !s.c.caption), caps = all.filter((s) => s.c.caption);
  const every = Math.max(1, Math.ceil(caps.length / captions));
  const chosen = [...titles.slice(0, limit), ...caps.filter((_, i) => i % every === 0).slice(0, captions)];
  const targets: ContrastTarget[] = [];
  let fadeFrames = 0;
  for (const s of chosen) {
    const frames = s.c.caption ? [s.start + Math.floor(s.duration / 2)] : titleMoments({ ...s.c, start: s.start, duration: s.duration }, p.fps.num / p.fps.den);
    const samples: ContrastTarget["samples"] = [];
    let opacity = 0;
    for (const f of frames) {
      const g = seenLetters(p, s, f);
      if (!g || g.opacity <= 0.01) continue;
      samples.push({ frame: f, box: g.box });
      opacity = Math.max(opacity, g.opacity);
    }
    if (!samples.length) continue;
    // Its fades' middles, the earliest titles' first, a bounded number.
    const fades: ContrastTarget["samples"] = [];
    for (const f of s.c.caption ? [] : fadeMoments({ ...s.c, start: s.start, duration: s.duration })) {
      const g = fadeFrames < FADE_FRAMES ? seenLetters(p, s, f) : null;
      if (!g) continue;
      fades.push({ frame: f, box: g.box });
      fadeFrames++;
    }
    targets.push({ clipId: s.key, samples, ...(fades.length ? { fades } : {}), look: titleLook(s.c.style, opacity), fixes: contrastFixes(s.c.style).map((x) => ({ say: x.say, look: titleLook(x.style, opacity) })) });
  }
  return { targets, skipped: Math.max(0, titles.length - limit) };
}

/** The project with every title off, inside compound clips too: the
 * picture a title's contrast is measured against. */
export function withoutTitles(p: Project): Project {
  const off = (tracks: Track[]) => tracks.map((t) => (t.clips.some((c) => c.type === "text") ? { ...t, clips: t.clips.map((c) => (c.type === "text" ? { ...c, disabled: true } : c)) } : t));
  return { ...p, tracks: off(p.tracks), ...(p.compounds ? { compounds: p.compounds.map((k) => ({ ...k, tracks: off(k.tracks) })) } : {}) };
}

/** Audio clips with no fade of their own (set_fades or volume keys) whose
 * sound may stop dead: one that ends with the video, or one that cuts its
 * file off before the end with nothing after it on its track (a song or a
 * bed trimmed mid-phrase, a line cut mid-word). Their sound's last seconds
 * decide. Source seconds, `from` up to the clip's end. */
export function tailTargets(p: Project): { clipId: Id; assetId: Id; from: number; to: number }[] {
  const total = projectDuration(p);
  const second = secondsToFrames(1, p.fps);
  const length = new Map(p.assets.map((a) => [a.id, a.duration]));
  return p.tracks.flatMap((t) =>
    t.muted
      ? []
      : t.clips.flatMap((c) => {
          // Match preview_audio: a fade under 50 ms can still cut an audible tail.
          if (c.type !== "audio" || c.muted || c.disabled || c.reverse || framesToSeconds(c.fadeOut, p.fps) >= 0.05) return [];
          const last = c.start + c.duration, to = sourceTimeAt(c, last, p.fps);
          // Before the end: only where the file sounds on past the cut and
          // nothing on the track carries on from it.
          if (last < total - 1 && (to >= (length.get(c.assetId) ?? 0) - 0.05 || t.clips.some((o) => o !== c && Math.abs(o.start - last) <= 1))) return [];
          // Volume keys that bring the end 18 dB under two seconds before fade it.
          const end = paramAt(c, "volume", c.duration - 1), body = paramAt(c, "volume", Math.max(0, c.duration - 2 * second));
          if (body > 0 && end / body <= 0.126) return [];
          return [{ clipId: c.id, assetId: c.assetId, from: Math.max(c.in, to - 4), to }];
        }),
  );
}

/** The joins of audio clips the check listens to (ADR-119): on each
 * top-level audio track that plays, where an audio clip ends and the next
 * starts, both sounding. A split that plays on in the same file (lib/audio
 * continues) is clean by construction and left out. Timeline seconds. */
export function joinTargets(p: Project): { trackId: Id; at: number; clips: [Id, Id] }[] {
  const out: { trackId: Id; at: number; clips: [Id, Id] }[] = [];
  for (const t of p.tracks) {
    if (t.kind !== "audio" || t.muted) continue;
    const clips = t.clips.filter((c) => c.type === "audio" && !c.disabled && !c.muted).sort((a, b) => a.start - b.start);
    clips.forEach((a, i) => {
      const b = clips[i + 1];
      if (b && a.start + a.duration === b.start && !continues(a, b, p.fps) && !(wholeSoundEffect(p, a) && wholeSoundEffect(p, b))) out.push({ trackId: t.id, at: +framesToSeconds(b.start, p.fps).toFixed(3), clips: [a.id, b.id] });
    });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** What fixes a join that clicks or cuts a sound off: a crossfade, or what
 * to change first where none fits (crossfadeJoin's rules). */
function joinFix(p: Project, a: Id, b: Id, seconds: number, heard?: EdgeReport): string {
  // A join into silence, or one with the crossfade already: move it (ADR-125).
  if (heard?.fix?.tool === "roll_edit") return `roll_edit clip_id ${a} to ${heard.fix.args.to} (a bar ${Number(heard.fix.args.to) > heard.at ? "later" : "earlier"}), where both files sound`;
  if (heard?.silent_before !== undefined) return `roll_edit the join (clip_id ${a}) to a bar line where ${b}'s file sounds before its in-point (set_music_grid gives the bars)`;
  const j = crossfadeJoin(p, a);
  if (j?.why && /own speed/.test(j.why)) return `set_fades fade_out ${seconds} on ${a} and fade_in ${seconds} on ${b} (a crossfade needs both at their own speed)`;
  if (j?.why && /very start of its file/.test(j.why)) return `trim_clip the start of ${b} later (it starts at its file's start, so nothing can rise before the cut), then set_crossfade clip_id ${a} seconds ${seconds}`;
  if (j && j.plays >= seconds - 1e-3) return `roll_edit the join (clip_id ${a}) where both files sound: a ${j.plays} s crossfade is already set`;
  return `set_crossfade clip_id ${a} seconds ${seconds}`;
}

/** The visual track with the most shots (video, picture and compound
 * clips): where the cuts are, the main track on a tie. A designed film
 * often keeps its cuts on an overlay above a background. */
function cutTrack(p: Project): Track {
  const main = mainTrack(p);
  const shots = (t: Track) => t.clips.filter((c) => c.type === "video" || c.type === "image" || c.type === "compound").length;
  return p.tracks.filter((t) => t.kind === "video" && !t.hidden).reduce((best, t) => (shots(t) > shots(best) ? t : best), main);
}

/**
 * The shots as the viewer sees them, across every visible track: the runs
 * of the frontmost picture that fills most of the frame (a video, picture
 * or compound clip covering 60% of it or more, nearly opaque), each from
 * the cut that brings it to the next. An edit that cuts between two tracks
 * (A and B rolls, cutaways over an interview) has its cuts here and not on
 * any one track. With `solids`, a color card that covers the frame (an end
 * card's ground) is seen too, for what is visible rather than what is cut.
 */
export function seenShots(p: Project, solids = false): { start: number; duration: number; clipId: Id }[] {
  const tracks = p.tracks.filter((t) => t.kind === "video" && !t.hidden);
  const counts = (c: Clip): c is VisualClip => (c.type === "video" || c.type === "image" || c.type === "compound" || (solids && c.type === "color")) && !c.disabled;
  const clips = tracks.flatMap((t) => t.clips.filter(counts));
  const bounds = [...new Set(clips.flatMap((c) => [c.start, c.start + c.duration]))].sort((a, b) => a - b);
  const area = p.width * p.height;
  const covers = (c: VisualClip, f: number) => {
    const l = layerAt(p, c, f);
    if (!l || l.opacity < 0.9) return false;
    const b = layerBox(p, c, l);
    const w = Math.max(0, Math.min(p.width, b.cx + b.hw) - Math.max(0, b.cx - b.hw)), h = Math.max(0, Math.min(p.height, b.cy + b.hh) - Math.max(0, b.cy - b.hh));
    return w * h >= 0.6 * area;
  };
  const runs: { start: number; duration: number; clipId: Id }[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const f = bounds[i], mid = Math.floor((f + bounds[i + 1] - 1) / 2);
    // tracks[0] is the top: the first track with a covering clip is seen,
    // judged in the middle of the stretch (a card fading in covers by then).
    let seen: VisualClip | undefined;
    for (const t of tracks) {
      seen = t.clips.find((c): c is VisualClip => counts(c) && c.start <= f && f < c.start + c.duration && covers(c, mid));
      if (seen) break;
    }
    if (!seen) continue;
    const last = runs.at(-1);
    if (last && last.clipId === seen.id && last.start + last.duration === f) last.duration = bounds[i + 1] - last.start;
    else runs.push({ start: f, duration: bounds[i + 1] - f, clipId: seen.id });
  }
  return runs;
}

/**
 * Does a clip hide everything below it at frame f: footage or a solid card
 * (not a shape) drawn plainly over the whole frame, opaque, unmasked,
 * unkeyed and upright? Pictures and compounds may be transparent, so they
 * never count.
 */
function hidesBelow(p: Project, c: Clip, f: number): boolean {
  if (c.disabled || !(c.type === "video" || (c.type === "color" && !c.shape))) return false;
  if ((c.blend ?? "normal") !== "normal" || c.mask || c.chromaKey || c.trackMatte || (c.type === "video" && c.cutout)) return false;
  const l = layerAt(p, c, f);
  if (!l || l.opacity < 0.99 || Math.abs(l.rotation % 360) > 0.01) return false;
  const b = layerBox(p, c, l);
  return b.cx - b.hw <= 1 && b.cx + b.hw >= p.width - 1 && b.cy - b.hh <= 1 && b.cy + b.hh >= p.height - 1;
}

/**
 * Shots with the cuts nobody sees taken out: a cut at frame f under a clip
 * on a higher visible track that hides the whole frame on both sides of f
 * (a black breath laid over a filler shot) joins its two shots into one.
 * check_project counted those and flagged them off the beat (ADR-102).
 */
export function shownCuts<T extends { start: number; duration: number; trackIndex: number }>(p: Project, shots: T[]): T[] {
  const out: T[] = [];
  for (const s of shots) {
    const last = out.at(-1);
    const f = s.start;
    const hidden = last && last.start + last.duration === f && p.tracks.some((t, i) => i < Math.min(s.trackIndex, last.trackIndex) && t.kind === "video" && !t.hidden && t.clips.some((c) => c.start < f && f < c.start + c.duration && hidesBelow(p, c, f - 1) && hidesBelow(p, c, f)));
    if (hidden) out[out.length - 1] = { ...last, duration: last.duration + s.duration };
    else out.push(s);
  }
  return out;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** A caption read as part of a line: at most this many words... */
const CHUNK_WORDS = 3;
/** ...following the caption before it on its track within this many seconds. */
const CHUNK_GAP = 0.3;
/** A chunk up for less than this flashes by, however its line reads (the
 * one-word auto captions hold each word at least this long). */
const CHUNK_MIN = 0.25;

export interface CaptionShown {
  id: Id;
  track: Id;
  /** Seconds. */
  start: number;
  end: number;
  text: string;
}

/**
 * Captions shown a few words at a time (word-by-word, CapCut's pop
 * captions, add_voiceover's caption_words): runs of two or more captions of
 * at most three words, each following the one before on its track within
 * 0.3 s. Such a run is read as the line it makes, so its reading speed is
 * the line's characters over the run's seconds, not each chunk's; a chunk
 * still flashes by under 0.25 s. The film test's 25 warnings were chunks
 * up 0.3-0.6 s of lines that read at 9-14 characters a second (ADR-115).
 */
export function captionRuns(caps: CaptionShown[]): CaptionShown[][] {
  const out: CaptionShown[][] = [];
  const sorted = [...caps].sort((a, b) => a.track.localeCompare(b.track) || a.start - b.start);
  let run: CaptionShown[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run);
    run = [];
  };
  for (const c of sorted) {
    const prev = run.at(-1);
    const chunk = words(c.text) <= CHUNK_WORDS;
    if (prev && (!chunk || prev.track !== c.track || c.start - prev.end > CHUNK_GAP + 1e-6)) flush();
    if (chunk) run.push(c);
  }
  flush();
  return out;
}

const shownChars = (text: string) => text.replace(/\s+/g, " ").trim().length;

/** A side of a tall frame the apps draw over (VERTICAL_SAFE). */
type Zone = "bottom" | "right" | "top" | "left";
/** A box in fractions of the frame from its center (x right, y down). */
type Box = { left: number; right: number; top: number; bottom: number };
/** The edges titles keep within, fractions from the center (top and left negative). */
type Edges = { top: number; bottom: number; left: number; right: number };

const r3 = (v: number) => +v.toFixed(3);
const down2 = (v: number) => Math.floor(v * 100 + 1e-6) / 100;

/**
 * One fix for every caption that reaches into the same zones of a tall
 * frame (ADR-124): set_caption_look moves and sizes them all, so it names
 * the value that clears the worst of them. Out at a side: centered between
 * the rails and, when wider than the column, narrowed (maxWidth); out at
 * the bottom or top: moved up or down; too big for the room: smaller. The
 * fourth film test's x overflow was told "captions sit at y 0.05".
 */
function captionZoneFix(kinds: Zone[], list: { c: TextClip; box: Box }[], z: Edges): string {
  const call: string[] = [], why: string[] = [];
  let factor = 1;
  const cw = z.right - z.left, zh = z.bottom - z.top;
  if (kinds.includes("left") || kinds.includes("right")) {
    call.push(`x ${r3((z.left + z.right) / 2)}`);
    why.push(`between the side rails (x ${r3(z.left)}..${r3(z.right)})`);
    const widest = Math.max(...list.map(({ box }) => box.right - box.left));
    if (widest > cw - 0.004) {
      const w = down2(Math.min(...list.map(({ c, box }) => c.style.maxWidth - (box.right - box.left - cw) - 0.01)));
      if (w >= 0.2) call.push(`maxWidth ${w}`);
      else factor = Math.min(factor, (cw - 0.01) / widest);
    }
  }
  const up = kinds.includes("bottom"), down = kinds.includes("top");
  if (up || down) {
    const tallest = Math.max(...list.map(({ box }) => box.bottom - box.top));
    const y = up ? Math.min(...list.map(({ c, box }) => c.transform.y - (box.bottom - z.bottom) - 0.005)) : Math.max(...list.map(({ c, box }) => c.transform.y + (z.top - box.top) + 0.005));
    // Every caption moves to it: each must still fit the other way.
    const fits = up !== down && tallest < zh && list.every(({ c, box }) => (up ? box.top + (y - c.transform.y) >= z.top : box.bottom + (y - c.transform.y) <= z.bottom));
    if (fits) {
      call.push(`y ${r3(y)}`);
      why.push(up ? `above the apps' captions and buttons (y under ${r3(z.bottom)})` : `below their tabs (y over ${r3(z.top)})`);
    } else factor = Math.min(factor, (zh - 0.01) / tallest);
  }
  const size = Math.floor(Math.min(...list.map(({ c }) => c.style.size)) * factor);
  const smaller = factor < 1 ? `set_caption_look size ${size} or less: the captions are too ${kinds.some((k) => k === "left" || k === "right") && !call.some((x) => x.startsWith("maxWidth")) ? "wide" : "tall"} for the room the apps leave` : "";
  if (!call.length) return smaller;
  return `set_caption_look ${call.join(" ")} (every caption, ${why.join(" and ")})${smaller ? `, and ${smaller}` : ", or a smaller size"}`;
}

/**
 * A title's fix for the zones of a tall frame it reaches into (ADR-124):
 * the move that brings its box inside, or a narrower wrap or a smaller
 * size when it is wider or taller than the room. A keyed or nested title
 * is told where its box must stay instead, with the way to move.
 */
function titleZoneFix(c: TextClip, kinds: Zone[], box: Box, z: Edges, nested: boolean): string {
  const t = c.transform;
  const xs = kinds.includes("left") || kinds.includes("right"), ys = kinds.includes("top") || kinds.includes("bottom");
  const dirs = [kinds.includes("bottom") && "up", kinds.includes("top") && "down", kinds.includes("right") && "left", kinds.includes("left") && "right"].filter(Boolean).join(" and ");
  const within = `so its box stays within x ${r3(z.left)}..${r3(z.right)} and y ${r3(z.top)}..${r3(z.bottom)}`;
  if (nested || c.keyframes?.["transform.x"] || c.keyframes?.["transform.y"]) return `move it ${dirs} ${within}, or make it smaller`;
  const cw = z.right - z.left, zh = z.bottom - z.top, bw = box.right - box.left, bh = box.bottom - box.top;
  const out: string[] = [];
  if (xs) {
    if (bw <= cw - 0.004) out.push(`set_param transform.x ${r3(t.x + (box.right > z.right ? z.right - box.right - 0.003 : z.left - box.left + 0.003))}`);
    else {
      const w = down2(c.style.maxWidth - (bw - cw) - 0.01);
      out.push(w >= 0.2 && c.text.trim().includes(" ") ? `set_text style.maxWidth ${w} and set_param transform.x ${r3((z.left + z.right) / 2)} (a narrower wrap, centered between the rails)` : `set_text style.size ${Math.floor((c.style.size * (cw - 0.01)) / bw)} or less and set_param transform.x ${r3((z.left + z.right) / 2)}`);
    }
  }
  if (ys) {
    if (bh <= zh - 0.004 && !(kinds.includes("top") && kinds.includes("bottom"))) out.push(`set_param transform.y ${r3(t.y + (box.bottom > z.bottom ? z.bottom - box.bottom - 0.003 : z.top - box.top + 0.003))}`);
    else out.push(`set_text style.size ${Math.floor((c.style.size * (zh - 0.01)) / bh)} or less`);
  }
  return `${out.join(", and ")} (${within})${c.group ? ", its group's other parts by the same amount" : ""}`;
}

export function checkProject(p: Project, kind: CheckKind = "any", measured: Measured = {}) {
  const out: Finding[] = [];
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const add = (f: Finding) => out.push(f);
  const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
  // Every title the viewer sees, inside compound clips too (an end card
  // built as a compound), placed and timed through them.
  const texts = seenTexts(p);
  const vertical = p.height > p.width;
  // style.size is pixels at a 1080-tall canvas, scaled with the height, so
  // size / 1080 is the letters' share of the frame's height. The floor is
  // a share of the short side (a phone shows every shape at its width),
  // stricter for social: a tall frame, or a short for the apps (ADR-097).
  const social = vertical || kind === "social_short";
  const minSize = minTextSize(p.width, p.height, social);
  const pct = (size: number) => +((100 * size) / 1080).toFixed(1);
  const frac = (v: number) => +v.toFixed(3);
  const smallCaptions: { id: Id; at: number; size: number; need: number; why: string }[] = [];
  // Canvas fractions from the center, as transform.x / y use them.
  const z = { safe: 0.5 - TITLE_SAFE, top: VERTICAL_SAFE.top - 0.5, bottom: 0.5 - VERTICAL_SAFE.bottom, left: VERTICAL_SAFE.left - 0.5, right: 0.5 - VERTICAL_SAFE.right };
  // Captions shown a few words at a time are read as the line they make.
  const runs = captionRuns(texts.filter((s) => s.c.caption).map((s) => ({ id: s.c.id, track: s.track.id, start: framesToSeconds(s.start, p.fps), end: framesToSeconds(s.start + s.duration, p.fps), text: s.c.text })));
  const inRun = new Set(runs.flatMap((r) => r.map((c) => c.id)));
  const fracBox = (b: PixelBox): Box => ({ left: frac(b.left / p.width - 0.5), right: frac(b.right / p.width - 0.5), top: frac(b.top / p.height - 0.5), bottom: frac(b.bottom / p.height - 0.5) });
  // The apps' zones a box reaches into, and one fix for every caption that
  // reaches into the same ones (ADR-124): the captions move and size together.
  const zonesOf = (b: Box): Zone[] => (vertical ? (["bottom", "right", "top", "left"] as const).filter((k) => (k === "bottom" ? b.bottom > z.bottom + 0.001 : k === "right" ? b.right > z.right + 0.001 : k === "top" ? b.top < z.top - 0.001 : b.left < z.left - 0.001)) : []);
  const captionFixes = new Map<string, string>();
  if (vertical) {
    const byZones = new Map<string, { c: TextClip; box: Box }[]>();
    for (const s of texts) {
      if (!s.c.caption || s.via.length) continue;
      const g = seenLetters(p, s);
      const box = g && fracBox(g.box);
      const kinds = box ? zonesOf(box) : [];
      if (kinds.length) byZones.set(kinds.join("+"), [...(byZones.get(kinds.join("+")) ?? []), { c: s.c, box: box! }]);
    }
    for (const [key, list] of byZones) captionFixes.set(key, captionZoneFix(key.split("+") as Zone[], list, z));
  }

  for (const s of texts) {
    const { c, track } = s;
    const g = seenLetters(p, s);
    if (!g) continue;
    const { mid } = g;
    // A title inside a compound clip: named with the compound clip, and
    // fixed inside it (edit_compound) or by moving the compound clip.
    const outer = s.via[0], inner = s.via.at(-1);
    const where0 = outer ? { clip_id: c.id, compound_clip_id: outer.id } : { clip_id: c.id };
    const inside = (fix: string) => (inner ? `edit_compound compound_id "${inner.compoundId}" running, on clip_id "${c.id}": ${fix}` : fix);
    const box = fracBox(g.box);
    const where = `its box runs x ${box.left}..${box.right}, y ${box.top}..${box.bottom} (fractions from the center)`;
    const name = c.caption ? "A caption" : `"${c.text.slice(0, 24)}"${outer ? ` (in compound clip ${outer.id})` : ""}`;
    const place = (fix: string) => (outer ? `set_param transform.x/y or transform.scale on the compound clip ${outer.id}, or ${inside(fix)}` : fix);
    const out = [box.left < -z.safe - 0.001 && `left of ${-z.safe}`, box.right > z.safe + 0.001 && `right of ${z.safe}`, box.top < -z.safe - 0.001 && `above ${-z.safe}`, box.bottom > z.safe + 0.001 && `below ${z.safe}`].filter(Boolean);
    if (out.length) add({ rule: "text_outside_title_safe", level: "warning", ...where0, at: sec(mid), message: `${name} reaches outside the 90% title-safe area (${out.join(", ")}): ${where}`, fix: place("align_clips with margin 0.05, or set_param transform.x/y and a smaller style.size") });
    const kinds = zonesOf(box);
    const said: Record<Zone, string> = { bottom: `the bottom 35% (below y ${frac(z.bottom)}): captions, names, the description`, right: `the right 19% (right of x ${frac(z.right)}): like, comment, share`, top: `the top 14% (above y ${frac(z.top)}): the tabs and search`, left: `the left 11% (left of x ${frac(z.left)})` };
    if (kinds.length) {
      // A fix for the zones this one reaches (ADR-124): an x overflow is not
      // cured by a y, and alike findings group by it.
      const fix = c.caption && !outer ? captionFixes.get(kinds.join("+"))! : place(titleZoneFix(c, kinds, box, z, !!outer));
      add({ rule: "text_under_app_buttons", level: "warning", ...where0, at: sec(mid), message: `${name} reaches into ${kinds.map((k) => said[k]).join("; and ")}, where TikTok, Reels and Shorts draw over the video; ${where}`, fix });
    }
    // Drawn at its own scale and every compound clip's that shows it.
    const size = c.style.size * g.scale;
    if (size < minSize - 0.5) {
      const need = Math.ceil((minSize * c.style.size) / size);
      const why = `on a ${p.width}x${p.height}${social ? " social" : ""} frame, letters under ${pct(minSize)}% of its height (size ${Math.ceil(minSize)}: ${social ? 5 : 4.5}% of the short side, which a phone shows about 6.5 cm wide) are hard to read on a phone`;
      if (c.caption) smallCaptions.push({ id: c.id, at: sec(s.start), size, need, why });
      else add({ rule: "text_too_small", level: "warning", ...where0, at: sec(s.start), message: `${name} is ${pct(size)}% of the frame's height (size ${Math.round(size)}${outer ? " as its compound clip draws it" : ""}); ${why}`, fix: outer ? `transform.scale on the compound clip ${outer.id} up by ${+(minSize / size).toFixed(2)} times, or ${inside(`set_text style.size ${need} or more`)}` : `set_text style.size ${need} or more (wrap it with style.maxWidth if it grows too wide)` });
    }
    const seconds = framesToSeconds(s.duration, p.fps);
    if (c.caption && inRun.has(c.id)) {
      if (seconds < CHUNK_MIN) add({ rule: "caption_too_fast", level: "warning", ...where0, at: sec(s.start), message: `A caption of a line shown a few words at a time flashes by: "${c.text}" for ${seconds.toFixed(2)} s (each chunk at least ${CHUNK_MIN} s)`, fix: "join it to the chunk before or after (fewer, longer chunks), or trim_clip it longer" });
    } else if (c.caption) {
      const { cps, met } = captionReading({ start: 0, end: seconds, text: c.text });
      if (!met) add({ rule: "caption_too_fast", level: "warning", ...where0, at: sec(s.start), message: `A caption shows ${cps.toFixed(0)} characters a second for ${seconds.toFixed(2)} s (keep under 20 a second, at least 0.83 s)`, fix: "fewer words per caption, or a longer caption (trim_clip)" });
    } else {
      // A countdown digit or a one-word hit reads at a glance.
      const need = c.text.trim().length <= 3 ? 0.4 : Math.max(1.5, 0.4 * words(c.text));
      if (seconds + 1e-6 < need) add({ rule: "text_too_short", level: "warning", ...where0, at: sec(s.start), message: `${name} is on screen ${seconds.toFixed(1)} s; it needs about ${need.toFixed(1)} s to be read twice`, fix: inside("trim_clip its end later, or fewer words") });
    }
    const m = measured.contrast?.[s.key];
    if (m) {
      // Measured on the rendered frame behind the letters, with the box,
      // shadow and outline the title draws (WCAG 2.x: 3:1 for large type,
      // 4.5:1 to read easily).
      if (m.ratio < 4.5) {
        const parts = aroundOf(c);
        const tried = (m.fixes ?? []).filter((x) => x.ratio > m.ratio).sort((a, b) => b.ratio - a.ratio);
        add({
          rule: "text_low_contrast",
          level: m.ratio < 3 ? "warning" : "tip",
          ...where0,
          at: sec(m.frame),
          message: `${name} measures ${m.ratio}:1 against the picture behind it at ${sec(m.frame)} s (backdrop ${hex(m.backdrop)}${parts.length ? `, with its ${parts.join(" and ")}` : ""}); ${m.ratio < 3 ? "under 3:1 it is hard to read" : "titles read easily from 4.5:1"} (WCAG)`,
          fix: inside(tried.length ? `set_text ${tried.map((x) => `${x.say} (measures ${x.ratio}:1 there)`).join(", or ")}; or move it over a calmer part of the picture` : "set_text style.background, style.stroke or a color further from the picture's"),
        });
      }
      // Halfway through a fade, part of it gone while the rest is still
      // seen; a title already hard to read is named for that instead.
      const fade = m.ratio >= 3 ? measured.fades?.[s.key] : undefined;
      if (fade)
        add({
          rule: "title_fades_unevenly",
          level: "tip",
          ...where0,
          at: sec(fade.frame),
          message: `${name} fades unevenly at ${sec(fade.frame)} s: at ${Math.round(fade.opacity * 100)}% of its opacity the part of it over ${hex(fade.backdrop)} is gone (${fade.faint}:1) while the rest is still seen (${fade.body}:1), so for a few frames it reads with letters missing`,
          fix: inside(`${fade.fixes.length ? `set_text ${fade.fixes.join(", or ")} (it then fades as one there), or ` : ""}end it with a cut or a slide instead of a fade (set_animation out), or move it off the bright part`),
        });
    } else if (!c.caption && !guarded(c)) {
      // Not measured: footage below the text (tracks[0] is the top) that no
      // opaque solid, such as an end card's background, covers between them.
      const level = (x: (typeof all)[number]["t"]) => p.tracks.indexOf(x);
      const during = (o: { start: number; duration: number }) => o.start < s.start + s.duration && s.start < o.start + o.duration;
      const solidAbove = (fi: number) => all.some(({ c: o, t }) => o.type === "color" && !("shape" in o && o.shape) && o.opacity >= 0.99 && !t.hidden && during(o) && level(t) > level(track) && level(t) < fi);
      const overFootage = all.some(({ c: o, t }) => !t.hidden && (o.type === "video" || o.type === "image") && during(o) && level(t) > level(track) && !solidAbove(level(t)));
      if (overFootage) add({ rule: "text_contrast_risk", level: "tip", ...where0, at: sec(s.start), message: `${name} has no outline, shadow or box over footage; it may not read over bright or busy shots`, fix: inside("set_text style.stroke, style.shadow or style.background") });
    }
  }

  // A title behind its subject that the subject hides (text_behind_subject
  // on a shape the subject now fills), as rendered.
  for (const h of measured.hidden ?? []) add({ rule: "title_hidden_by_subject", level: "warning", clip_id: h.clipId, at: sec(h.frame), message: h.message, fix: h.fix });

  for (const run of runs) {
    const seconds = run.at(-1)!.end - run[0].start;
    const cps = shownChars(run.map((c) => c.text).join(" ")) / Math.max(seconds, 1e-3);
    if (cps > 20) add({ rule: "caption_too_fast", level: "warning", clip_id: run[0].id, clip_ids: run.map((c) => c.id), at: +run[0].start.toFixed(2), message: `${run.length} captions shown a few words at a time read ${cps.toFixed(0)} characters a second over ${seconds.toFixed(2)} s, ${+run[0].start.toFixed(2)}-${+run.at(-1)!.end.toFixed(2)} s (keep a line under 20 a second)`, fix: "fewer words, or the captions held longer (trim_clip), or the voice read slower (retake_voiceover words_per_second)" });
  }

  // Titles drawn over each other, or over the captions (ADR-121).
  out.push(...textOverlaps(p, texts));

  // Callouts that ride their footage off the frame (ADR-125), measured as
  // export_versions measures them in a version (ADR-122).
  for (const k of calloutsOffFrame(p)) {
    const ids = k.clip_ids.join(" and ");
    const early = k.leaves > k.start;
    add({
      rule: "callout_off_frame",
      level: "warning",
      clip_id: k.clip_ids[0],
      clip_ids: k.clip_ids,
      at: sec(k.worst),
      message: `${k.what} (${ids}) runs off the frame: ${Math.round(k.share * 100)}% of it is outside at ${sec(k.worst)} s${early ? `, leaving from ${sec(k.leaves)} s` : ""}`,
      fix: early ? `trim_clip the end of ${ids} to ${sec(k.leaves)} s, or frame_region the shot so what it points at stays in the frame` : "frame_region the shot so what it points at is in the frame, or point at a part that is",
    });
  }

  if (smallCaptions.length) {
    const [first] = smallCaptions, need = Math.max(...smallCaptions.map((x) => x.need));
    add({ rule: "text_too_small", level: "warning", clip_id: first.id, at: first.at, message: `${smallCaptions.length === 1 ? "A caption is" : `${smallCaptions.length} captions are`} ${pct(first.size)}% of the frame's height (size ${Math.round(first.size)}); ${first.why}`, fix: `set_text clip_ids (the captions) style.size ${need} or more` });
  }

  const fonts = [...new Set(texts.map(({ c }) => c.style.font))];
  if (fonts.length > 2) add({ rule: "too_many_fonts", level: "warning", message: `${fonts.length} font families (${fonts.join(", ")}); professional work uses at most two`, fix: "set_text style.font to one display face for headlines and one sans for the rest" });

  // Photosensitivity: at most three flashes in any second (WCAG 2.3.1).
  for (const { c } of all) {
    for (const e of "effects" in c ? c.effects : []) {
      if (e.type === "flash" && e.enabled !== false && (e.params.rate ?? 0) > 3)
        add({ rule: "flashes_too_fast", level: "error", clip_id: c.id, at: sec(c.start), message: `A strobe flashes ${e.params.rate} times a second; more than 3 can trigger seizures (WCAG 2.3.1, broadcast and UK ad rules)`, fix: "edit the effect's rate to 3 or less (set_param effects.<index>.rate)" });
    }
  }
  const flashStarts = all.filter(({ c }) => "effects" in c && c.effects.some((e) => e.type === "flash" && e.enabled !== false) && c.duration <= p.fps.num / p.fps.den).map(({ c }) => c.start).sort((a, b) => a - b);
  const second = Math.round(p.fps.num / p.fps.den);
  for (let i = 0; i + 3 < flashStarts.length; i++)
    if (flashStarts[i + 3] - flashStarts[i] < second) {
      add({ rule: "flashes_too_fast", level: "error", at: sec(flashStarts[i]), message: "Four or more flash hits within one second", fix: "keep flash hits at least a third of a second apart, or use another hit (zoom, shake)" });
      break;
    }

  // Black: the main track should start at 0 and run without holes.
  const main = mainTrack(p).clips.slice().sort((a, b) => a.start - b.start);
  let end = 0;
  for (const c of main) {
    if (c.start > end) add({ rule: "gap_on_main_track", level: "error", at: sec(end), message: `${sec(c.start - end)} s of black on the main track at ${sec(end)} s`, fix: "close_gaps on the main track, or fill it (add_media_clip)" });
    end = Math.max(end, c.start + c.duration);
  }
  // The shots: the visual track with the most of them (on a designed film
  // an overlay above a background, not the main track), or the cuts of the
  // frontmost full picture across tracks when those are more (A and B
  // rolls, cutaways over an interview).
  const shotTrack = cutTrack(p);
  const level = (id: Id) => p.tracks.findIndex((t) => t.clips.some((c) => c.id === id));
  const onTrack = shownCuts(p, shotTrack.clips.filter((c) => c.type === "video" || c.type === "image" || c.type === "compound" || shotTrack.main).sort((a, b) => a.start - b.start).map((c) => ({ start: c.start, duration: c.duration, trackIndex: p.tracks.indexOf(shotTrack) })));
  const seen = shownCuts(p, seenShots(p).map((s) => ({ ...s, trackIndex: level(s.clipId) })));
  const across = seen.length > onTrack.length;
  const cuts: { start: number; duration: number }[] = across ? seen : onTrack;
  const cutsWhere = across ? "the picture (across tracks)" : shotTrack.main ? "the main track" : `track ${shotTrack.name}`;

  const total = projectDuration(p);
  const sound = all.filter(({ c, t }) => (c.type === "audio" || (c.type === "video" && !c.muted)) && !t.muted);
  if (!sound.length) add({ rule: "no_sound", level: kind === "any" ? "tip" : "warning", message: "The video has no sound", fix: "music (import_media, add_media_clip on an audio track), add_voiceover, add_sound_effect" });
  for (const { clipId } of tailTargets(p)) {
    const t = measured.tails?.[clipId];
    if (t && endsByItself(t)) continue;
    const c = all.find((x) => x.c.id === clipId)!.c as Clip;
    const last = c.start + c.duration, long = framesToSeconds(c.duration, p.fps) > 5;
    // Unmeasured (a test, an unreadable file), only a long clip is suspect.
    if (!t && !long) continue;
    const heard = t?.lastSecond ? `its last second runs ${t.lastSecond.join(", ")} dBFS by quarters and ends at ${t.endDb}, against ${t.bodyDb} dBFS before` : t ? `its very end is at ${t.endDb} dBFS against ${t.bodyDb} dBFS before` : "";
    if (last >= total - 1) add({ rule: "music_ends_abruptly", level: "tip", clip_id: clipId, at: sec(last), message: t ? `${long ? "A long audio clip" : "An audio clip"} stops at the very end while still playing: ${heard}` : "A long audio clip stops at the very end without a fade (its sound was not measured)", fix: "set_fades fade_out 1.5" });
    // Cut off before the end, with the picture going on: heard as a fault.
    else add({ rule: "sound_cut_off", level: "warning", clip_id: clipId, at: sec(last), message: t ? `An audio clip is cut off at ${sec(last)} s while still sounding, with ${"fadeOut" in c && c.fadeOut ? "no effective fade" : "no fade"}, and the video goes on: ${heard}` : `A long audio clip stops at ${sec(last)} s without a fade, its file running on (its sound was not measured)`, fix: "set_fades fade_out 0.3 (a song or a bed: 1.5), or trim_clip its end to where the sound pauses" });
  }

  // Joins of audio clips, measured on each one's track (ADR-119): a hole or
  // a click at the cut, or a sound cut off while it still rings.
  for (const j of measured.joins ?? []) {
    if (j.kind !== "join" || j.clips.length < 2) continue;
    const [a, b] = j.clips;
    const where = `where ${a} meets ${b} at ${+j.at.toFixed(2)} s`;
    const hole = j.dip_db !== undefined && j.dip_db <= DIP_DB, click = j.click_db !== undefined && j.click_db >= CLICK_DB;
    if (hole || click)
      add({
        rule: "click_at_join",
        level: "warning",
        clip_id: a,
        clip_ids: [a, b],
        at: +j.at.toFixed(2),
        message: hole && j.dip_db! <= -40 && j.silent_before === undefined ? `Silence for a few milliseconds ${where} (dip_db ${j.dip_db}), heard as a dropout` : hole && j.silent_before !== undefined ? `A ${-j.dip_db!} dB hole ${where} (dip_db): ${b}'s file is silent for ${j.silent_before} s just before its in-point (silent_before), so a crossfade into it fades into silence` : hole ? `A ${-j.dip_db!} dB hole for a few milliseconds ${where} (dip_db), heard as a tick` : `A click ${where}: a sample step ${j.click_db} dB steeper than any around it (click_db)`,
        fix: joinFix(p, a, b, 0.03, j),
      });
    if (j.tail_cut_db !== undefined && j.tail_cut_db >= TAIL_DB)
      add({ rule: "sound_cut_at_join", level: "warning", clip_id: a, clip_ids: [a, b], at: +j.at.toFixed(2), message: `${a}'s sound is cut off ${where} while it still rings ${j.tail_cut_db} dB over what follows (tail_cut_db)`, fix: joinFix(p, a, b, 0.25, j) });
  }

  if (kind === "ad" && !texts.some((s) => s.start + s.duration >= total - 1 && !s.c.caption))
    add({ rule: "no_end_card", level: "warning", message: "No title in the last seconds: an ad ends on the brand and a call to action", fix: "add_ad_element end_card over the last 2-3 s" });

  if (kind === "epic_edit") {
    // Any of analyze_music's grids counts: a cut on a bar or phrase is on a
    // beat. So does a song's given grid (set_music_grid), where its clips play it.
    const beats = [...p.markers.filter((m) => ["Beat", "Bar", "Phrase", "Drop"].includes(m.label ?? "")).map((m) => m.frame), ...givenBeats(p)];
    if (!beats.length) add({ rule: "no_beat_grid", level: "warning", message: "No beat markers: an epic edit is cut to the music", fix: "analyze_music with markers beats, bars and drop on the music clip" });
    else {
      // Half-beats count: velocity edits cut on the "and" too.
      const sorted = [...new Set(beats)].sort((x, y) => x - y);
      const grid = [...sorted, ...sorted.slice(1).map((b, i) => (b + sorted[i]) / 2)];
      const off = cuts.slice(1).filter((c) => !grid.some((b) => Math.abs(b - c.start) <= 1));
      if (off.length) add({ rule: "cuts_off_beat", level: "warning", at: sec(off[0].start), message: `${off.length} of ${cuts.length - 1} cuts on ${cutsWhere} miss a beat (or half-beat) by more than a frame: first at ${sec(off[0].start)} s`, fix: "move_clip or trim_clip so each cut starts on a beat marker, or cut_to_beats" });
    }
  }

  const shots = cuts.length;
  const span = cuts.reduce((n, c) => n + c.duration, 0);
  const count = (level: Finding["level"]) => out.filter((f) => f.level === level).length;
  const errors = count("error"), warnings = count("warning"), tips = count("tip");
  // Contrast as measured, lowest first: the evidence behind the findings.
  // Keyed by appearance: a title in a compound clip is "c_card/c_head".
  const rated = Object.entries(measured.contrast ?? {})
    .map(([key, m]) => ({ clip_id: key.split("/").pop()!, ...(key.includes("/") ? { compound_clip_id: key.split("/")[0] } : {}), ratio: m.ratio, at: sec(m.frame) }))
    .sort((a, b) => a.ratio - b.ratio);
  const notMeasured = !texts.length ? undefined : measured.contrast ? measured.contrastNote : (measured.contrastNote ?? "not measured on the picture (titles over footage without an outline, shadow or box are tips instead)");
  return {
    ok: errors === 0,
    verdict: verdictOf(errors, warnings, tips),
    summary: {
      duration: sec(total),
      shots,
      ...(across ? { shots_on: "the picture, across tracks" } : shotTrack.main ? {} : { shots_on: shotTrack.name }),
      average_shot: shots ? +(framesToSeconds(span, p.fps) / shots).toFixed(2) : 0,
      titles: texts.filter(({ c }) => !c.caption).length,
      captions: texts.filter(({ c }) => c.caption).length,
      fonts,
      errors,
      warnings,
      tips,
    },
    findings: out,
    ...(measured.contrast ? { contrast: { measured: `${rated.length} titles at ${measured.moments ?? rated.length} moments on the rendered picture, with each one's box, shadow and outline; 4.5:1 reads easily, under 3:1 is a warning`, lowest: rated.slice(0, 12) } } : {}),
    not_checked: `Loudness: measure_loudness (or export with loudness) before delivering.${notMeasured ? ` Contrast: ${notMeasured}; look with preview_frames.` : ""}${measured.joinsNote ? ` Joins: ${measured.joinsNote}; preview_audio's edges measure the rest.` : ""}`,
  };
}

/**
 * Text drawn over text (ADR-121): two titles, or a title and a caption, on
 * screen at once whose letters' boxes (with their own box or outline)
 * cross by more than a few pixels, judged once both have played their in
 * and before either's out (one passing another as it animates in or out is
 * not read there). The third film
 * test's lower third sat on its voiceover's captions and the check passed
 * it, its contrast being fine. A title over captions is one finding naming
 * every caption it crosses, with the move that clears them. Parts of one
 * group (a template) or of one compound clip are laid out together and not
 * judged against each other, nor a line's chunks; an ad element's parts,
 * laid out apart, are (ADR-125: an end card's headline enlarged by hand
 * ran into its button).
 */
function textOverlaps(p: Project, texts: SeenText[]): Finding[] {
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const frac = (v: number) => +v.toFixed(3);
  const tol = (4 * p.height) / 1080;
  const settled = (s: SeenText): [number, number] => [s.start + (s.via.length ? 0 : (s.c.animIn?.duration ?? 0)), s.start + s.duration - 1 - (s.via.length ? 0 : (s.c.animOut?.duration ?? 0))];
  type Hit = { s: SeenText; box: PixelBox; at: number; w: number; h: number };
  const over = new Map<string, { s: SeenText; box: PixelBox; hits: Hit[] }>();
  const pairs: { a: SeenText; b: Hit }[] = [];
  for (const [i, a] of texts.entries()) {
    for (const b of texts.slice(i + 1)) {
      if (a.c.caption && b.c.caption && a.track === b.track) continue;
      // An ad element's parts (named after it) are laid out apart, so they
      // are judged: a headline made larger by hand ran into its button.
      const element = !!a.c.name && a.c.name === b.c.name;
      if ((a.c.group && a.c.group === b.c.group && !element) || (a.via.length && a.via[0].id === b.via[0]?.id)) continue;
      // Only while both rest: a title rising in past a caption is not read there.
      const [a0, a1] = settled(a), [b0, b1] = settled(b);
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (hi < lo) continue;
      const f = Math.round((lo + hi) / 2);
      const ga = seenLetters(p, a, f), gb = seenLetters(p, b, f);
      if (!ga || !gb || ga.opacity < 0.05 || gb.opacity < 0.05) continue;
      const w = Math.min(ga.box.right, gb.box.right) - Math.max(ga.box.left, gb.box.left), h = Math.min(ga.box.bottom, gb.box.bottom) - Math.max(ga.box.top, gb.box.top);
      if (w <= tol || h <= tol) continue;
      // A title over captions: one finding for the title, every caption in it.
      const [title, cap, tb, cb] = a.c.caption && !b.c.caption ? [b, a, gb.box, ga.box] : [a, b, ga.box, gb.box];
      if (!title.c.caption && cap.c.caption) {
        const o = over.get(title.key) ?? { s: title, box: tb, hits: [] };
        o.hits.push({ s: cap, box: cb, at: f, w, h });
        over.set(title.key, o);
      } else pairs.push({ a, b: { s: b, box: gb.box, at: f, w, h } });
    }
  }
  const name = (s: SeenText) => (s.c.caption ? `the caption "${s.c.text.slice(0, 24)}"` : `"${s.c.text.slice(0, 24)}"`);
  const out: Finding[] = [];
  for (const { s, box, hits } of over.values()) {
    const caps = { top: Math.min(...hits.map((x) => x.box.top)), bottom: Math.max(...hits.map((x) => x.box.bottom)) };
    const gap = 0.02 * p.height;
    // Clear of them by the shorter move that stays inside the title-safe
    // area, the title's group (a lower third's name and role) as one.
    const mates = s.c.group ? texts.filter((x) => x.c.group === s.c.group && x !== s).flatMap((x) => seenLetters(p, x, Math.min(x.start + x.duration - 1, Math.max(x.start, hits[0].at)))?.box ?? []) : [];
    const span = { top: Math.min(box.top, ...mates.map((b) => b.top)), bottom: Math.max(box.bottom, ...mates.map((b) => b.bottom)) };
    const lift = caps.top - gap - span.bottom, drop = caps.bottom + gap - span.top;
    // Inside the zone titles keep to: on a tall frame clear of the apps'
    // tabs and buttons too (ADR-124: the fourth film test's step label was
    // told to move up into the top 14%).
    const zone = titleZone(p);
    const inZone = (top: number, bottom: number) => top >= zone.top * p.height - 0.5 && bottom <= (1 - zone.bottom) * p.height + 0.5;
    const fits = (d: number) => inZone(span.top + d, span.bottom + d);
    const up = fits(lift) && (!fits(drop) || -lift <= drop);
    const dy = up ? lift : drop;
    const t = "transform" in s.c ? s.c.transform : undefined;
    const keyed = !!s.c.keyframes?.["transform.y"] || s.via.length > 0;
    const move = fits(dy) ? `move it ${up ? "up" : "down"} ${frac(Math.abs(dy) / p.height)} of the frame's height${t && !keyed ? ` (set_param transform.y ${frac(t.y + dy / p.height)}${s.c.group ? ", and its group's other parts by the same amount" : ""})` : ""}` : "";
    // Or the captions move the other way, by set_caption_look y, while
    // they stay inside the zone themselves.
    const capY = hits[0].s.c.transform.y;
    const capDown = span.bottom + gap - caps.top, capUp = span.top - gap - caps.bottom;
    const capMoves = [capDown, capUp].filter((d) => inZone(caps.top + d, caps.bottom + d)).sort((a, b) => Math.abs(a) - Math.abs(b));
    const capMove = capMoves.length && !hits[0].s.via.length ? `move the captions ${capMoves[0] > 0 ? "down" : "up"} (set_caption_look y ${frac(capY + capMoves[0] / p.height)})` : "";
    const first = hits[0];
    out.push({
      rule: "text_overlaps_text",
      level: "warning",
      clip_id: s.c.id,
      clip_ids: [s.c.id, ...hits.map((x) => x.s.c.id)],
      ...(s.via.length ? { compound_clip_id: s.via[0].id } : {}),
      at: sec(first.at),
      message: `${name(s)} is drawn across ${hits.length === 1 ? name(first.s) : `${hits.length} captions`} (${sec(Math.min(...hits.map((x) => x.s.start)))}-${sec(Math.max(...hits.map((x) => x.s.start + x.s.duration)))} s; at ${sec(first.at)} s their boxes share ${Math.round(first.w)} x ${Math.round(first.h)} px): both are hard to read`,
      fix: [move, capMove].filter(Boolean).join(", or ") || `there is no room for both inside the frame's ${p.height > p.width ? "zone clear of the apps (y " + frac(zone.top - 0.5) + ".." + frac(0.5 - zone.bottom) + ")" : "title-safe area"}: make it or the captions smaller (set_text style.size, set_caption_look size), or show it before or after them (trim_clip)`,
    });
  }
  for (const { a, b } of pairs)
    out.push({
      rule: "text_overlaps_text",
      level: "warning",
      clip_id: a.c.id,
      clip_ids: [a.c.id, b.s.c.id],
      at: sec(b.at),
      message: `${name(a)} and ${name(b.s)} are drawn across each other at ${sec(b.at)} s (their boxes share ${Math.round(b.w)} x ${Math.round(b.h)} px): both are hard to read`,
      fix: "move one of them (set_param transform.x/y, align_clips), or show them one after the other (trim_clip)",
    });
  return out;
}

/** What `ok` means, said with the counts: ok is no errors (black, flashes
 * that can cause seizures); warnings still want fixing before delivery,
 * tips are worth a look. Codex read ok: true beside a warning as passing. */
function verdictOf(errors: number, warnings: number, tips: number): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  if (errors) return `Not ok: ${n(errors, "error")} to fix before export${warnings ? `, and ${n(warnings, "warning")}` : ""}. ok is false only for errors.`;
  if (warnings) return `ok means no errors; ${n(warnings, "warning")} still to fix before delivering${tips ? `, and ${n(tips, "tip")} to consider` : ""}.`;
  if (tips) return `ok: no errors or warnings; ${n(tips, "tip")} to consider.`;
  return "ok: nothing found.";
}

/** The beats of every song given a grid (set_music_grid), as timeline
 * frames where its clips play them: the grid an epic edit is cut to, with
 * no markers needed. */
export function givenBeats(p: Project): number[] {
  const out: number[] = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      if (c.type !== "audio" && c.type !== "video") continue;
      const a = getAsset(p, c.assetId);
      if (!a?.musicGrid) continue;
      const map = sourceToTimeline(c, p.fps);
      for (const b of gridStructure(a.musicGrid, a.duration).beats) {
        const f = map.frame(b);
        if (f !== null) out.push(f);
      }
    }
  }
  return out;
}
