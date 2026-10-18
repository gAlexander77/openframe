// A design check an AI model (or a person) runs before exporting: the
// playbook's rules measured on the project, so a model learns what to fix
// instead of being trusted to remember them (ADR-055's complement). Each
// finding names the rule, the clip and time, and the tool that fixes it.
// Rules and their sources: docs/research/Pro workflows 2026-10-18.md.
// ponytail: geometry and timing only. Contrast against the actual picture
// and loudness need rendering; text without an outline, shadow or box over
// footage is flagged as a risk instead, and loudness is left to export.

import { layerBox, VERTICAL_SAFE } from "./align";
import { textPad } from "./render/size";
import { lookReach } from "./textLook";
import { framesToSeconds } from "./time";
import { mainTrack, projectDuration } from "./project/ops";
import type { Id, Project, TextClip, VisualClip } from "./project/types";
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

/** The 90% title-safe inset (SMPTE ST 2046-1), a fraction of each side. */
const TITLE_SAFE = 0.05;
/** Text shorter than this many pixels, on a frame whose short side is 1080,
 * is hard to read on a phone. */
const MIN_TEXT = 40;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function checkProject(p: Project, kind: CheckKind = "any") {
  const out: Finding[] = [];
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const add = (f: Finding) => out.push(f);
  const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
  const texts = all.filter((x): x is { c: TextClip; t: (typeof all)[number]["t"] } => x.c.type === "text" && !x.t.hidden);
  const vertical = p.height > p.width;
  // style.size is pixels at a 1080-tall canvas, scaled with the height; the
  // floor scales with the short side, so 9:16 text can be smaller in size.
  const minSize = (MIN_TEXT * Math.min(p.width, p.height)) / p.height;
  const frac = (v: number) => +v.toFixed(3);
  // Canvas fractions from the center, as transform.x / y use them.
  const z = { safe: 0.5 - TITLE_SAFE, top: VERTICAL_SAFE.top - 0.5, bottom: 0.5 - VERTICAL_SAFE.bottom, left: VERTICAL_SAFE.left - 0.5, right: 0.5 - VERTICAL_SAFE.right };

  for (const { c, t: track } of texts) {
    const mid = c.start + Math.floor(c.duration / 2);
    const layer = layerAt(p, c as VisualClip, mid);
    if (!layer) continue;
    const b = layerBox(p, c as VisualClip, layer);
    // The letters (with their box or outline), not the raster's empty margin
    // for a shadow or glow to spread into.
    const reach = lookReach(c.style, p.height / 1080);
    const inset = Math.max(0, textPad(p, c) - Math.max(reach.box, reach.stroke + reach.stroke2)) * layer.scale;
    const box = { left: frac((b.cx - b.hw + inset) / p.width - 0.5), right: frac((b.cx + b.hw - inset) / p.width - 0.5), top: frac((b.cy - b.hh + inset) / p.height - 0.5), bottom: frac((b.cy + b.hh - inset) / p.height - 0.5) };
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
      const style = c.style;
      const guarded = (style.stroke?.width ?? 0) > 0 || !!style.shadow || !!style.background;
      // Footage below the text (tracks[0] is the top) that no opaque solid,
      // such as an end card's background, covers between them.
      const level = (x: (typeof all)[number]["t"]) => p.tracks.indexOf(x);
      const during = (o: { start: number; duration: number }) => o.start < c.start + c.duration && c.start < o.start + o.duration;
      const solidAbove = (fi: number) => all.some(({ c: o, t }) => o.type === "color" && !("shape" in o && o.shape) && o.opacity >= 0.99 && !t.hidden && during(o) && level(t) > level(track) && level(t) < fi);
      const overFootage = all.some(({ c: o, t }) => !t.hidden && (o.type === "video" || o.type === "image") && during(o) && level(t) > level(track) && !solidAbove(level(t)));
      if (!guarded && overFootage) add({ rule: "text_contrast_risk", level: "tip", clip_id: c.id, at: sec(c.start), message: `${name} has no outline, shadow or box over footage; it may not read over bright or busy shots`, fix: "set_text style.stroke, style.shadow or style.background" });
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

  const total = projectDuration(p);
  const sound = all.filter(({ c, t }) => (c.type === "audio" || (c.type === "video" && !c.muted)) && !t.muted);
  if (!sound.length) add({ rule: "no_sound", level: kind === "any" ? "tip" : "warning", message: "The video has no sound", fix: "music (import_media, add_media_clip on an audio track), add_voiceover, add_sound_effect" });
  for (const { c } of all) {
    if (c.type === "audio" && c.start + c.duration >= total - 1 && framesToSeconds(c.duration, p.fps) > 5 && !c.fadeOut)
      add({ rule: "music_ends_abruptly", level: "tip", clip_id: c.id, at: sec(c.start + c.duration), message: "A long audio clip stops at the very end without a fade", fix: "set_fades fade_out 1.5" });
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
      const off = main.slice(1).filter((c) => !grid.some((b) => Math.abs(b - c.start) <= 1));
      if (off.length) add({ rule: "cuts_off_beat", level: "warning", at: sec(off[0].start), message: `${off.length} of ${main.length - 1} cuts on the main track miss a beat (or half-beat) by more than a frame: first at ${sec(off[0].start)} s`, fix: "move_clip or trim_clip so each cut starts on a beat marker, or cut_to_beats" });
    }
  }

  const shots = main.length;
  return {
    ok: !out.some((f) => f.level === "error"),
    summary: {
      duration: sec(total),
      shots,
      average_shot: shots ? +(framesToSeconds(end, p.fps) / shots).toFixed(2) : 0,
      titles: texts.filter(({ c }) => !c.caption).length,
      captions: texts.filter(({ c }) => c.caption).length,
      fonts,
      errors: out.filter((f) => f.level === "error").length,
      warnings: out.filter((f) => f.level === "warning").length,
    },
    findings: out,
    not_checked: "Contrast against the actual picture and loudness: look with preview_frames, and export with loudness (or measure it) before delivering.",
  };
}
