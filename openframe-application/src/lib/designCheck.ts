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

import { layerBox, VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { contrastFixes, endsByItself, hex, titleLook, type Backdrop, type PixelBox, type Tail, type TitleLook } from "./contrast";
import { paramAt } from "./keyframes";
import { textPad } from "./render/size";
import { lookReach } from "./textLook";
import { framesToSeconds, secondsToFrames } from "./time";
import { getAsset, mainTrack, projectDuration, sourceTimeAt } from "./project/ops";
import { gridStructure, sourceToTimeline } from "./analysis/musicMap";
import type { Clip, Id, Project, TextClip, Track, VisualClip } from "./project/types";
import { layerAt } from "./render/plan";

export interface Finding {
  rule: string;
  level: "error" | "warning" | "tip";
  message: string;
  /** What to call (or do) to fix it. */
  fix: string;
  clip_id?: Id;
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
}

/** The letters of a title (with their box or outline, not the raster's
 * empty margin for a shadow or glow) at timeline frame `f` (default its
 * middle), in canvas pixels. */
function letterBox(p: Project, c: TextClip, f = c.start + Math.floor(c.duration / 2)): { mid: number; box: PixelBox; opacity: number; scale: number } | null {
  const layer = layerAt(p, c as VisualClip, f);
  if (!layer) return null;
  const b = layerBox(p, c as VisualClip, layer);
  const reach = lookReach(c.style, p.height / 1080);
  const inset = Math.max(0, textPad(p, c) - Math.max(reach.box, reach.stroke + reach.stroke2)) * layer.scale;
  return { mid: f, box: { left: b.cx - b.hw + inset, right: b.cx + b.hw - inset, top: b.cy - b.hh + inset, bottom: b.cy + b.hh - inset }, opacity: layer.opacity, scale: layer.scale };
}

/** An outline, shadow or box gives a title its own contrast. */
const guarded = (c: TextClip) => (c.style.stroke?.width ?? 0) > 0 || !!c.style.shadow || !!c.style.background;

/** What a title draws around its letters, in words. */
const aroundOf = (c: TextClip) => [c.style.background && "box", (c.style.stroke?.width ?? 0) > 0 && "outline", c.style.shadow && "shadow", c.style.glow && "glow"].filter(Boolean) as string[];

const visibleTexts = (p: Project) => p.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((c): c is TextClip => c.type === "text" && !c.disabled)));

/** The moments a title is measured at: once its in-animation has played,
 * its middle, and before its out-animation, plus the quarters of a title
 * on screen over six seconds; each a timeline frame inside it. */
export function titleMoments(c: TextClip, fps: number): number[] {
  const last = c.start + Math.max(0, c.duration - 1);
  const lo = Math.min(last, c.start + (c.animIn?.duration ?? 0)), hi = Math.max(lo, last - (c.animOut?.duration ?? 0));
  const shares = hi - lo > 6 * fps ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
  return [...new Set(shares.map((k) => Math.round(lo + (hi - lo) * k)))];
}

/** A title the app measures: the frames to render (titles off) with its
 * letters' box at each, in canvas pixels, its look, and the fixes to try
 * on the same pixels. */
export interface ContrastTarget {
  clipId: Id;
  samples: { frame: number; box: PixelBox }[];
  look: TitleLook;
  fixes: { say: string; look: TitleLook }[];
}

/**
 * The titles whose contrast the app measures for check_project: every
 * visible title, outlined, shadowed and boxed ones too (their look is
 * measured with what it draws around the letters), at titleMoments, the
 * earliest first, at most `limit`; then up to `captions` captions spread
 * over the video, one moment each. `skipped` counts the titles left out.
 */
export function contrastTargets(p: Project, limit = 40, captions = 12): { targets: ContrastTarget[]; skipped: number } {
  const all = visibleTexts(p).sort((a, b) => a.start - b.start);
  const titles = all.filter((c) => !c.caption), caps = all.filter((c) => c.caption);
  const every = Math.max(1, Math.ceil(caps.length / captions));
  const chosen = [...titles.slice(0, limit), ...caps.filter((_, i) => i % every === 0).slice(0, captions)];
  const targets: ContrastTarget[] = [];
  for (const c of chosen) {
    const frames = c.caption ? [c.start + Math.floor(c.duration / 2)] : titleMoments(c, p.fps.num / p.fps.den);
    const samples: ContrastTarget["samples"] = [];
    let opacity = 0;
    for (const f of frames) {
      const g = letterBox(p, c, f);
      if (!g || g.opacity <= 0.01) continue;
      samples.push({ frame: f, box: g.box });
      opacity = Math.max(opacity, g.opacity);
    }
    if (!samples.length) continue;
    targets.push({ clipId: c.id, samples, look: titleLook(c.style, opacity), fixes: contrastFixes(c.style).map((x) => ({ say: x.say, look: titleLook(x.style, opacity) })) });
  }
  return { targets, skipped: Math.max(0, titles.length - limit) };
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
          if (c.type !== "audio" || c.muted || c.disabled || c.reverse || c.fadeOut) return [];
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

/** The 90% title-safe inset (SMPTE ST 2046-1), a fraction of each side. */
const TITLE_SAFE = 0.05;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function checkProject(p: Project, kind: CheckKind = "any", measured: Measured = {}) {
  const out: Finding[] = [];
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const add = (f: Finding) => out.push(f);
  const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
  const texts = all.filter((x): x is { c: TextClip; t: (typeof all)[number]["t"] } => x.c.type === "text" && !x.t.hidden && !x.c.disabled);
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

  for (const { c, t: track } of texts) {
    const g = letterBox(p, c);
    if (!g) continue;
    const { mid } = g;
    const layer = layerAt(p, c as VisualClip, mid)!;
    const box = { left: frac(g.box.left / p.width - 0.5), right: frac(g.box.right / p.width - 0.5), top: frac(g.box.top / p.height - 0.5), bottom: frac(g.box.bottom / p.height - 0.5) };
    const where = `its box runs x ${box.left}..${box.right}, y ${box.top}..${box.bottom} (fractions from the center)`;
    const name = c.caption ? "A caption" : `"${c.text.slice(0, 24)}"`;
    const out = [box.left < -z.safe - 0.001 && `left of ${-z.safe}`, box.right > z.safe + 0.001 && `right of ${z.safe}`, box.top < -z.safe - 0.001 && `above ${-z.safe}`, box.bottom > z.safe + 0.001 && `below ${z.safe}`].filter(Boolean);
    if (out.length) add({ rule: "text_outside_title_safe", level: "warning", clip_id: c.id, at: sec(mid), message: `${name} reaches outside the 90% title-safe area (${out.join(", ")}): ${where}`, fix: "align_clips with margin 0.05, or set_param transform.x/y and a smaller style.size" });
    const zones = vertical ? [box.bottom > z.bottom + 0.001 && `the bottom 35% (below y ${frac(z.bottom)}): captions, names, the description`, box.right > z.right + 0.001 && `the right 19% (right of x ${frac(z.right)}): like, comment, share`, box.top < z.top - 0.001 && `the top 14% (above y ${frac(z.top)}): the tabs and search`, box.left < z.left - 0.001 && `the left 11% (left of x ${frac(z.left)})`].filter(Boolean) : [];
    if (zones.length) add({ rule: "text_under_app_buttons", level: "warning", clip_id: c.id, at: sec(mid), message: `${name} reaches into ${zones.join("; and ")}, where TikTok, Reels and Shorts draw over the video; ${where}`, fix: c.caption ? "captions on a tall canvas sit at y 0.05 (add_captions y, set_param transform.y)" : `move it so its box stays within x ${frac(z.left)}..${frac(z.right)} and y ${frac(z.top)}..${frac(z.bottom)}, or make it smaller` });
    const size = c.style.size * layer.scale;
    if (size < minSize - 0.5) {
      const need = Math.ceil(minSize / layer.scale);
      const why = `on a ${p.width}x${p.height}${social ? " social" : ""} frame, letters under ${pct(minSize)}% of its height (size ${Math.ceil(minSize)}: ${social ? 5 : 4.5}% of the short side, which a phone shows about 6.5 cm wide) are hard to read on a phone`;
      if (c.caption) smallCaptions.push({ id: c.id, at: sec(c.start), size, need, why });
      else add({ rule: "text_too_small", level: "warning", clip_id: c.id, at: sec(c.start), message: `${name} is ${pct(size)}% of the frame's height (size ${Math.round(size)}); ${why}`, fix: `set_text style.size ${need} or more (wrap it with style.maxWidth if it grows too wide)` });
    }
    const seconds = framesToSeconds(c.duration, p.fps);
    if (c.caption) {
      const cps = c.text.replace(/\s+/g, " ").trim().length / Math.max(seconds, 1e-3);
      if (cps > 20 || seconds < 5 / 6) add({ rule: "caption_too_fast", level: "warning", clip_id: c.id, at: sec(c.start), message: `A caption shows ${cps.toFixed(0)} characters a second for ${seconds.toFixed(2)} s (keep under 20 a second, at least 0.83 s)`, fix: "fewer words per caption, or a longer caption (trim_clip)" });
    } else {
      // A countdown digit or a one-word hit reads at a glance.
      const need = c.text.trim().length <= 3 ? 0.4 : Math.max(1.5, 0.4 * words(c.text));
      if (seconds + 1e-6 < need) add({ rule: "text_too_short", level: "warning", clip_id: c.id, at: sec(c.start), message: `${name} is on screen ${seconds.toFixed(1)} s; it needs about ${need.toFixed(1)} s to be read twice`, fix: "trim_clip its end later, or fewer words" });
    }
    const m = measured.contrast?.[c.id];
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
          clip_id: c.id,
          at: sec(m.frame),
          message: `${name} measures ${m.ratio}:1 against the picture behind it at ${sec(m.frame)} s (backdrop ${hex(m.backdrop)}${parts.length ? `, with its ${parts.join(" and ")}` : ""}); ${m.ratio < 3 ? "under 3:1 it is hard to read" : "titles read easily from 4.5:1"} (WCAG)`,
          fix: tried.length ? `set_text ${tried.map((x) => `${x.say} (measures ${x.ratio}:1 there)`).join(", or ")}; or move it over a calmer part of the picture` : "set_text style.background, style.stroke or a color further from the picture's",
        });
      }
    } else if (!c.caption && !guarded(c)) {
      // Not measured: footage below the text (tracks[0] is the top) that no
      // opaque solid, such as an end card's background, covers between them.
      const level = (x: (typeof all)[number]["t"]) => p.tracks.indexOf(x);
      const during = (o: { start: number; duration: number }) => o.start < c.start + c.duration && c.start < o.start + o.duration;
      const solidAbove = (fi: number) => all.some(({ c: o, t }) => o.type === "color" && !("shape" in o && o.shape) && o.opacity >= 0.99 && !t.hidden && during(o) && level(t) > level(track) && level(t) < fi);
      const overFootage = all.some(({ c: o, t }) => !t.hidden && (o.type === "video" || o.type === "image") && during(o) && level(t) > level(track) && !solidAbove(level(t)));
      if (overFootage) add({ rule: "text_contrast_risk", level: "tip", clip_id: c.id, at: sec(c.start), message: `${name} has no outline, shadow or box over footage; it may not read over bright or busy shots`, fix: "set_text style.stroke, style.shadow or style.background" });
    }
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
    else add({ rule: "sound_cut_off", level: "warning", clip_id: clipId, at: sec(last), message: t ? `An audio clip is cut off at ${sec(last)} s while still sounding, with no fade, and the video goes on: ${heard}` : `A long audio clip stops at ${sec(last)} s without a fade, its file running on (its sound was not measured)`, fix: "set_fades fade_out 0.3 (a song or a bed: 1.5), or trim_clip its end to where the sound pauses" });
  }

  if (kind === "ad" && !texts.some(({ c }) => c.start + c.duration >= total - 1 && !c.caption))
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
  const rated = Object.entries(measured.contrast ?? {})
    .map(([id, m]) => ({ clip_id: id, ratio: m.ratio, at: sec(m.frame) }))
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
    not_checked: `Loudness: measure_loudness (or export with loudness) before delivering.${notMeasured ? ` Contrast: ${notMeasured}; look with preview_frames.` : ""}`,
  };
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
