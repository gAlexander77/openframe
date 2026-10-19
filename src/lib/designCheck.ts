// A design check an AI model (or a person) runs before exporting: the
// playbook's rules measured on the project, so a model learns what to fix
// instead of being trusted to remember them (ADR-055's complement). Each
// finding names the rule, the clip and time, and the tool that fixes it.
// Rules and their sources: docs/research/Pro workflows 2026-10-18.md.
// What needs rendering or decoding the app measures first and passes in
// (ADR-068): each title's contrast with the picture behind it, and each
// music clip's last moments. Without measurements (tests, a title past the
// cap), text without an outline, shadow or box over footage is flagged as
// a risk instead. Loudness is left to measure_loudness and export.

import { layerBox, VERTICAL_SAFE } from "./align";
import { minTextSize } from "./brandKit";
import { endsByItself, hex, type Backdrop, type PixelBox, type Tail } from "./contrast";
import { paramAt } from "./keyframes";
import { textPad } from "./render/size";
import { parseColor } from "./shapes";
import { lookReach } from "./textLook";
import { framesToSeconds, secondsToFrames } from "./time";
import { mainTrack, projectDuration, sourceTimeAt } from "./project/ops";
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

/** What the app measured before the check (automation.ts), by clip id. */
export interface Measured {
  /** Each title's contrast with the rendered picture behind it. */
  contrast?: Record<Id, Backdrop>;
  /** Each long music clip's level at its very end and just before. */
  tails?: Record<Id, Tail>;
}

/** The letters of a title (with their box or outline, not the raster's
 * empty margin for a shadow or glow) at its middle frame, in canvas pixels. */
function letterBox(p: Project, c: TextClip): { mid: number; box: PixelBox; opacity: number } | null {
  const mid = c.start + Math.floor(c.duration / 2);
  const layer = layerAt(p, c as VisualClip, mid);
  if (!layer) return null;
  const b = layerBox(p, c as VisualClip, layer);
  const reach = lookReach(c.style, p.height / 1080);
  const inset = Math.max(0, textPad(p, c) - Math.max(reach.box, reach.stroke + reach.stroke2)) * layer.scale;
  return { mid, box: { left: b.cx - b.hw + inset, right: b.cx + b.hw - inset, top: b.cy - b.hh + inset, bottom: b.cy + b.hh - inset }, opacity: layer.opacity };
}

/** An outline, shadow or box gives a title its own contrast. */
const guarded = (c: TextClip) => (c.style.stroke?.width ?? 0) > 0 || !!c.style.shadow || !!c.style.background;

const visibleTexts = (p: Project) => p.tracks.flatMap((t) => (t.hidden ? [] : t.clips.filter((c): c is TextClip => c.type === "text" && !c.disabled)));

/**
 * The titles whose contrast the app measures for check_project: those
 * without an outline, shadow or box, each with the frame to render (its
 * middle, where it is at rest), its letters' box in canvas pixels and its
 * colors (channels 0..1, alpha with the clip's opacity; a gradient's two
 * ends). At most `limit`, the earliest first.
 * ponytail: one frame each (the middle); a shot that turns bright later
 * is left to preview_frames.
 */
export function contrastTargets(p: Project, limit = 40): { clipId: Id; frame: number; box: PixelBox; colors: number[][] }[] {
  const out = [];
  for (const c of visibleTexts(p).sort((a, b) => a.start - b.start)) {
    if (guarded(c)) continue;
    const g = letterBox(p, c);
    if (!g || g.opacity <= 0) continue;
    const css = c.style.gradient ? [c.style.gradient.from, c.style.gradient.to] : [c.style.color];
    const colors = css.map(parseColor).filter((x) => !!x).map(([r, gr, b, a]) => [r, gr, b, a * g.opacity]);
    if (colors.length) out.push({ clipId: c.id, frame: g.mid, box: g.box, colors });
    if (out.length >= limit) break;
  }
  return out;
}

/** Long music clips that end with the video and have no fade of their own
 * (set_fades or volume keys): their sound's last seconds decide whether it
 * stops dead. Source seconds, `from` up to the clip's end. */
export function tailTargets(p: Project): { clipId: Id; assetId: Id; from: number; to: number }[] {
  const total = projectDuration(p);
  const second = secondsToFrames(1, p.fps);
  return p.tracks.flatMap((t) =>
    t.muted
      ? []
      : t.clips.flatMap((c) => {
          if (c.type !== "audio" || c.muted || c.start + c.duration < total - 1 || framesToSeconds(c.duration, p.fps) <= 5 || c.fadeOut) return [];
          // Volume keys that bring the end 18 dB under two seconds before fade it.
          const end = paramAt(c, "volume", c.duration - 1), body = paramAt(c, "volume", Math.max(0, c.duration - 2 * second));
          if (body > 0 && end / body <= 0.126) return [];
          const to = sourceTimeAt(c, c.start + c.duration, p.fps);
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

/** The 90% title-safe inset (SMPTE ST 2046-1), a fraction of each side. */
const TITLE_SAFE = 0.05;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function checkProject(p: Project, kind: CheckKind = "any", measured: Measured = {}) {
  const out: Finding[] = [];
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const add = (f: Finding) => out.push(f);
  const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
  const texts = all.filter((x): x is { c: TextClip; t: (typeof all)[number]["t"] } => x.c.type === "text" && !x.t.hidden);
  const vertical = p.height > p.width;
  // style.size is pixels at a 1080-tall canvas, scaled with the height; the
  // floor scales with the short side, so 9:16 text can be smaller in size.
  const minSize = minTextSize(p.width, p.height);
  const frac = (v: number) => +v.toFixed(3);
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
    if (size < minSize - 0.5) add({ rule: "text_too_small", level: "warning", clip_id: c.id, at: sec(c.start), message: `${name} is size ${Math.round(size)}; on a ${p.width}x${p.height} canvas, under ${Math.round(minSize)} is hard to read on a phone`, fix: "set_text style.size larger" });
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
      // Measured on the rendered frame behind the letters (WCAG 2.x: 3:1 for
      // large type, 4.5:1 to read easily).
      if (m.ratio < 4.5)
        add({ rule: "text_low_contrast", level: m.ratio < 3 ? "warning" : "tip", clip_id: c.id, at: sec(mid), message: `${name} measures ${m.ratio}:1 against the picture behind it (${hex(m.backdrop)} at ${sec(mid)} s); ${m.ratio < 3 ? "under 3:1 it is hard to read" : "titles read easily from 4.5:1"} (WCAG)`, fix: "set_text style.stroke, style.shadow or style.background, or a color further from the picture's" });
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
  // The shots: the visual track with the most of them, which on a designed
  // film is an overlay above a background, not the main track.
  const shotTrack = cutTrack(p);
  const cuts = shotTrack.clips.filter((c) => c.type === "video" || c.type === "image" || c.type === "compound" || shotTrack.main).sort((a, b) => a.start - b.start);

  const total = projectDuration(p);
  const sound = all.filter(({ c, t }) => (c.type === "audio" || (c.type === "video" && !c.muted)) && !t.muted);
  if (!sound.length) add({ rule: "no_sound", level: kind === "any" ? "tip" : "warning", message: "The video has no sound", fix: "music (import_media, add_media_clip on an audio track), add_voiceover, add_sound_effect" });
  for (const { clipId } of tailTargets(p)) {
    const t = measured.tails?.[clipId];
    if (t && endsByItself(t)) continue;
    const c = all.find((x) => x.c.id === clipId)!.c as Clip;
    add({ rule: "music_ends_abruptly", level: "tip", clip_id: clipId, at: sec(c.start + c.duration), message: t ? `A long audio clip stops at the very end while still playing: its last quarter second is at ${t.endDb} dBFS against ${t.bodyDb} dBFS before` : "A long audio clip stops at the very end without a fade", fix: "set_fades fade_out 1.5" });
  }

  if (kind === "ad" && !texts.some(({ c }) => c.start + c.duration >= total - 1 && !c.caption))
    add({ rule: "no_end_card", level: "warning", message: "No title in the last seconds: an ad ends on the brand and a call to action", fix: "add_ad_element end_card over the last 2-3 s" });

  if (kind === "epic_edit") {
    // Any of analyze_music's grids counts: a cut on a bar or phrase is on a beat.
    const beats = p.markers.filter((m) => ["Beat", "Bar", "Phrase", "Drop"].includes(m.label ?? "")).map((m) => m.frame);
    if (!beats.length) add({ rule: "no_beat_grid", level: "warning", message: "No beat markers: an epic edit is cut to the music", fix: "analyze_music with markers beats, bars and drop on the music clip" });
    else {
      // Half-beats count: velocity edits cut on the "and" too.
      const sorted = [...new Set(beats)].sort((x, y) => x - y);
      const grid = [...sorted, ...sorted.slice(1).map((b, i) => (b + sorted[i]) / 2)];
      const off = cuts.slice(1).filter((c) => !grid.some((b) => Math.abs(b - c.start) <= 1));
      if (off.length) add({ rule: "cuts_off_beat", level: "warning", at: sec(off[0].start), message: `${off.length} of ${cuts.length - 1} cuts on ${shotTrack.main ? "the main track" : `track ${shotTrack.name}`} miss a beat (or half-beat) by more than a frame: first at ${sec(off[0].start)} s`, fix: "move_clip or trim_clip so each cut starts on a beat marker, or cut_to_beats" });
    }
  }

  const shots = cuts.length;
  const span = cuts.reduce((n, c) => n + c.duration, 0);
  return {
    ok: !out.some((f) => f.level === "error"),
    summary: {
      duration: sec(total),
      shots,
      ...(shotTrack.main ? {} : { shots_on: shotTrack.name }),
      average_shot: shots ? +(framesToSeconds(span, p.fps) / shots).toFixed(2) : 0,
      titles: texts.filter(({ c }) => !c.caption).length,
      captions: texts.filter(({ c }) => c.caption).length,
      fonts,
      errors: out.filter((f) => f.level === "error").length,
      warnings: out.filter((f) => f.level === "warning").length,
    },
    findings: out,
    not_checked: `Loudness: measure_loudness (or export with loudness) before delivering.${measured.contrast ? "" : " Contrast was not measured on the picture (titles over footage without an outline, shadow or box are tips): look with preview_frames."}`,
  };
}
