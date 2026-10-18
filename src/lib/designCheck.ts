// A design check an AI model (or a person) runs before exporting: the
// playbook's rules measured on the project, so a model learns what to fix
// instead of being trusted to remember them (ADR-055's complement). Each
// finding names the rule, the clip and time, and the tool that fixes it.
// Rules and their sources: docs/research/Pro workflows 2026-10-18.md.
// ponytail: geometry and timing only. Contrast against the actual picture
// and loudness need rendering; text without an outline, shadow or box over
// footage is flagged as a risk instead, and loudness is left to export.

import { layerBox, VERTICAL_SAFE } from "./align";
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
/** Text below this size (pixels at a 1080-pixel-tall frame) is hard to read. */
const MIN_TEXT = 40;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function checkProject(p: Project, kind: CheckKind = "any") {
  const out: Finding[] = [];
  const sec = (f: number) => +framesToSeconds(f, p.fps).toFixed(2);
  const add = (f: Finding) => out.push(f);
  const all = p.tracks.flatMap((t) => t.clips.map((c) => ({ c, t })));
  const texts = all.filter((x): x is { c: TextClip; t: (typeof all)[number]["t"] } => x.c.type === "text" && !x.t.hidden);
  const vertical = p.height > p.width;

  for (const { c } of texts) {
    const mid = c.start + Math.floor(c.duration / 2);
    const layer = layerAt(p, c as VisualClip, mid);
    if (!layer) continue;
    const b = layerBox(p, c as VisualClip, layer);
    const [l, r, t, btm] = [b.cx - b.hw, b.cx + b.hw, b.cy - b.hh, b.cy + b.hh];
    const name = c.caption ? "A caption" : `"${c.text.slice(0, 24)}"`;
    if (l < p.width * TITLE_SAFE - 1 || r > p.width * (1 - TITLE_SAFE) + 1 || t < p.height * TITLE_SAFE - 1 || btm > p.height * (1 - TITLE_SAFE) + 1)
      add({ rule: "text_outside_title_safe", level: "warning", clip_id: c.id, at: sec(mid), message: `${name} reaches outside the 90% title-safe area`, fix: "align_clips with margin 0.05, or set_param transform.x/y and a smaller style.size" });
    if (vertical && !c.caption && (btm > p.height * (1 - VERTICAL_SAFE.bottom) || r > p.width * (1 - VERTICAL_SAFE.right) || t < p.height * VERTICAL_SAFE.top))
      add({ rule: "text_under_app_buttons", level: "warning", clip_id: c.id, at: sec(mid), message: `${name} sits where TikTok, Reels or Shorts draw their buttons and captions`, fix: "move it into the middle of the frame (transform.y between -0.36 and 0.15, transform.x left of 0.31)" });
    const size = c.style.size * layer.scale;
    if (size < MIN_TEXT) add({ rule: "text_too_small", level: "warning", clip_id: c.id, at: sec(c.start), message: `${name} is ${Math.round(size)} px tall at 1080p; under ${MIN_TEXT} is hard to read on a phone`, fix: "set_text style.size larger" });
    const seconds = framesToSeconds(c.duration, p.fps);
    if (c.caption) {
      const cps = c.text.replace(/\s+/g, " ").trim().length / Math.max(seconds, 1e-3);
      if (cps > 20 || seconds < 5 / 6) add({ rule: "caption_too_fast", level: "warning", clip_id: c.id, at: sec(c.start), message: `A caption shows ${cps.toFixed(0)} characters a second for ${seconds.toFixed(2)} s (keep under 20 a second, at least 0.83 s)`, fix: "fewer words per caption, or a longer caption (trim_clip)" });
    } else {
      const need = Math.max(1.5, 0.4 * words(c.text));
      if (seconds + 1e-6 < need) add({ rule: "text_too_short", level: "warning", clip_id: c.id, at: sec(c.start), message: `${name} is on screen ${seconds.toFixed(1)} s; it needs about ${need.toFixed(1)} s to be read twice`, fix: "trim_clip its end later, or fewer words" });
      const style = c.style;
      const guarded = (style.stroke?.width ?? 0) > 0 || !!style.shadow || !!style.background;
      const overFootage = all.some(({ c: o, t }) => o !== c && !t.hidden && (o.type === "video" || o.type === "image") && o.start < c.start + c.duration && c.start < o.start + o.duration);
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
    add({ rule: "no_end_card", level: "warning", message: "No title in the last seconds: an ad ends on the brand and a call to action", fix: "add_text or add_text_template endCard over the last 2-3 s" });

  if (kind === "epic_edit") {
    const beats = p.markers.filter((m) => m.label === "Beat").map((m) => m.frame);
    if (!beats.length) add({ rule: "no_beat_grid", level: "warning", message: "No beat markers: an epic edit is cut to the music", fix: "mark_beats on the music clip" });
    else {
      const off = main.slice(1).filter((c) => !beats.some((b) => Math.abs(b - c.start) <= 1));
      if (off.length) add({ rule: "cuts_off_beat", level: "warning", at: sec(off[0].start), message: `${off.length} of ${main.length - 1} cuts on the main track miss a beat by more than a frame`, fix: "move_clip or trim_clip so each cut starts on a beat marker" });
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
