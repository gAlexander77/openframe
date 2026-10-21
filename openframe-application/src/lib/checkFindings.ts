// check_project's findings (lib/designCheck.ts) as a person reads them in
// the library's Check tab (ADR-111). The check is the agent's, run on the
// same measurements; only the words change. An agent's finding names a
// tool ("set_text style.size 49 or more"); a person needs the control
// ("Raise Size in the Text tab to 49 or more"). The numbers a person needs
// are read back from the agent's message, which the tests here hold to the
// check's own output: a rule whose wording changes falls back to its plain
// message rather than to a wrong number.

import type { CheckKind, Finding } from "./designCheck";
import { findClip } from "./project/ops";
import type { Clip, Id, Project, Track } from "./project/types";

export type CheckGroup = "text" | "timing" | "sound";

export const CHECK_GROUPS: { id: CheckGroup; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "timing", label: "Timing" },
  { id: "sound", label: "Sound" },
];

/** What is being made: the agent tool's kinds, named for a person. */
export const CHECK_KINDS: { id: CheckKind; label: string; hint: string }[] = [
  { id: "any", label: "General video", hint: "Text, timing and sound rules for any video." },
  { id: "ad", label: "Ad", hint: "Also asks for an end card with the brand and a call to action." },
  { id: "social_short", label: "Social short", hint: "Text sized for a phone, clear of TikTok, Reels and Shorts buttons." },
  { id: "epic_edit", label: "Cut to music", hint: "Also checks that the cuts land on the beat." },
];

export interface PersonFinding {
  /** Stable within one check: the rule and its place in the list. */
  key: string;
  rule: string;
  group: CheckGroup;
  level: Finding["level"];
  /** What is wrong, in plain words. */
  title: string;
  /** What to do about it, in the app's own controls. */
  action: string;
  /** The measurement behind it, when there is one worth reading. */
  detail?: string;
  /** The clip to select: a title inside a compound clip selects the
   * compound clip, which is what the timeline shows. */
  clipId?: Id;
  /** Timeline seconds to put the playhead at. */
  at?: number;
  /** The inspector tab that holds the fix, opened with the clip. */
  tab?: "text" | "video" | "audio" | "effects";
}

const GROUP: Record<string, CheckGroup> = {
  text_outside_title_safe: "text",
  text_under_app_buttons: "text",
  text_too_small: "text",
  text_too_short: "text",
  caption_too_fast: "text",
  text_low_contrast: "text",
  text_contrast_risk: "text",
  too_many_fonts: "text",
  title_hidden_by_subject: "text",
  no_end_card: "timing",
  flashes_too_fast: "timing",
  gap_on_main_track: "timing",
  cuts_off_beat: "timing",
  no_beat_grid: "timing",
  no_sound: "sound",
  music_ends_abruptly: "sound",
  sound_cut_off: "sound",
  click_at_join: "sound",
  sound_cut_at_join: "sound",
};

/** A rule this file does not know yet (one added to the check later) goes
 * by its name. */
const groupOf = (rule: string): CheckGroup =>
  GROUP[rule] ?? (/sound|music|audio|voice|loud|click|join/.test(rule) ? "sound" : /text|title|caption|font/.test(rule) ? "text" : "timing");

/** A clip anywhere in the document, inside compound clips too. */
function clipAnywhere(p: Project, id: Id | undefined): Clip | undefined {
  if (!id) return undefined;
  const top = findClip(p, id)?.clip;
  if (top) return top;
  for (const k of p.compounds ?? []) for (const t of k.tracks as Track[]) for (const c of t.clips) if (c.id === id) return c;
  return undefined;
}

/** How the panel names a clip: a title by its words, a caption as one, a
 * sound by its name. */
function nameOf(p: Project, c: Clip | undefined): string {
  if (!c) return "A clip";
  if (c.type === "text") {
    if (c.caption) return "A caption";
    const words = c.text.replace(/\s+/g, " ").trim();
    return words ? `“${words.length > 32 ? `${words.slice(0, 31)}…` : words}”` : "A title";
  }
  if (c.name) return `“${c.name}”`;
  if ("assetId" in c) {
    const a = p.assets.find((x) => x.id === c.assetId);
    if (a) return `“${a.name}”`;
  }
  return c.type === "audio" ? "A sound" : "A clip";
}

const num = (s: string, re: RegExp, i = 1): string | undefined => re.exec(s)?.[i];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[], and = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);
/** A contrast ratio as a person reads it: one decimal. */
const ratioOf = (r: string) => String(+(+r).toFixed(1));

/** Where two sounds meet, named: one song cut in two is "the two pieces of"
 * it. */
const meeting = (name: string, next: string) => (name === next ? `the two pieces of ${name} meet` : `${name} meets ${next}`);

/** What fixes a join, in the app's controls: the clip menu's crossfade, or
 * what to change first where none fits (designCheck joinFix). */
function joinAction(fix: string, name: string, next: string, longer: boolean): string {
  if (/^set_fades/.test(fix)) return `Give ${name} a short Fade out and ${next} a short Fade in (Audio tab): a crossfade needs both clips at their own speed.`;
  const menu = `right-click ${name} and choose Crossfade into next clip`;
  if (/^trim_clip/.test(fix)) return `Trim the start of ${next} a little later so its sound can rise before the cut, then add a crossfade from the clip menu (${menu}).`;
  return longer ? `Add a crossfade from the clip menu (${menu}) and lengthen it to about 0.25 s in the Audio tab, or cut where the sound pauses.` : `Add a crossfade from the clip menu: ${menu}.`;
}

/** The words for one finding. `inCompound`: a title drawn by a compound
 * clip. `next`: the second clip a finding names (the clip after a join). */
function words(f: Finding, name: string, inCompound: boolean, caption: boolean, next = "the next clip"): Pick<PersonFinding, "title" | "action" | "detail"> {
  const m = f.message, x = f.fix;
  const openIt = "or double-click the compound clip and change the title inside it";
  switch (f.rule) {
    case "text_outside_title_safe": {
      const edges = [...(num(m, /title-safe area \(([^)]*)\)/) ?? "").matchAll(/(left|right|above|below)/g)].map((e) => ({ left: "left", right: "right", above: "top", below: "bottom" })[e[1] as "left"]);
      return {
        title: `${name} runs outside the title-safe area`,
        detail: edges.length ? `It crosses the safe area's ${list(edges)} ${edges.length === 1 ? "edge" : "edges"}, where a TV or a phone can cut it off.` : undefined,
        action: inCompound
          ? `Move or scale the compound clip inward (Video tab), ${openIt}.`
          : caption
            ? "Move the captions inward (Text tab, Transform) or lower their Size, then Apply to all captions."
            : "Move the title inside the safe area (drag it on the viewer, or Align under Transform in the Text tab), or lower its Size. The viewer's Safe margins guide shows the area.",
      };
    }
    case "text_under_app_buttons": {
      const zones = [...m.matchAll(/the (bottom|right|top|left) (\d+)%/g)].map((z) => `the ${z[1]} ${z[2]}%`);
      return {
        title: `${name} sits under the apps' buttons`,
        detail: zones.length ? `On TikTok, Reels and Shorts, ${list(zones)} of the frame ${zones.length === 1 ? "is" : "are"} covered by captions, names and buttons.` : undefined,
        action: caption
          ? "Raise the captions above the bottom third (Text tab, Transform, Position Y), then Apply to all captions."
          : inCompound
            ? `Move the compound clip into the clear column (Video tab), ${openIt}.`
            : "Move it up and in, or make it smaller. The viewer's TikTok, Reels, Shorts guide shows the clear column.",
      };
    }
    case "text_too_small": {
      const share = num(m, /([\d.]+)% of the frame's height/);
      const need = num(x, /style\.size (\d+) or more/);
      const times = num(x, /up by ([\d.]+) times/);
      const many = num(m, /^(\d+) captions are/);
      return {
        title: many ? `${many} captions are too small to read on a phone` : `${name} is too small to read on a phone`,
        detail: share ? `Its letters are ${share}% of the frame's height; a phone shows the frame only a few centimeters wide.` : undefined,
        action: inCompound
          ? `Scale the compound clip up${times ? ` by ${times} times` : ""} (Video tab, Scale), ${openIt}${need ? ` and set its Size to ${need} or more` : ""}.`
          : f.clip_id && caption
            ? `Raise Size in the Text tab${need ? ` to ${need} or more` : ""}, then Apply to all captions.`
            : `Raise Size in the Text tab${need ? ` to ${need} or more` : ""}; break the line if it grows too wide.`,
      };
    }
    case "text_too_short": {
      const shown = num(m, /on screen ([\d.]+) s/), need = num(m, /needs about ([\d.]+) s/);
      return {
        title: `${name} goes by too fast to read`,
        detail: shown && need ? `It is on screen ${shown} s; reading it twice takes about ${need} s.` : undefined,
        action: "Drag its end later on the timeline, or use fewer words.",
      };
    }
    case "caption_too_fast": {
      const cps = num(m, /shows (\d+) characters a second/), secs = num(m, /a second for ([\d.]+) s/);
      return {
        title: "A caption goes by too fast to read",
        detail: cps && secs ? `It shows ${cps} characters a second for ${secs} s. Keep under 20 a second, and on screen at least 0.83 s.` : undefined,
        action: "Split its words over two captions, or drag its end later.",
      };
    }
    case "text_low_contrast": {
      const ratio = num(m, /measures ([\d.]+):1/);
      // The fixes the check tried on the same pixels, best first: "or".
      const tried = [...x.matchAll(/style\.(background|stroke) \{[^}]*\} \(measures ([\d.]+):1 there\)/g)].map((t) => `${t[1] === "background" ? "a Background box" : "a Stroke outline"} (${ratioOf(t[2])}:1 there)`);
      const weak = f.level === "tip";
      return {
        title: weak ? `${name} could stand out more from the picture` : `${name} is hard to read against the picture`,
        detail: ratio ? `Its contrast with the picture behind it measures ${ratioOf(ratio)}:1; titles read easily from 4.5:1${weak ? "" : ", and under 3:1 they are hard to read"}.` : undefined,
        action: `${tried.length ? `Give it ${list(tried, "or")} in the Text tab` : "Give it a Background box or a Stroke outline in the Text tab"}, or move it over a calmer part of the picture.${inCompound ? " Double-click the compound clip to change the title inside it." : ""}`,
      };
    }
    case "text_contrast_risk":
      return {
        title: `${name} has no outline, shadow or box over footage`,
        detail: "It may not read over bright or busy shots. Its contrast was not measured on the picture.",
        action: "Turn on Stroke, Shadow or Background in the Text tab.",
      };
    case "too_many_fonts": {
      const n = num(m, /^(\d+) font families/), fonts = num(m, /font families \((.*)\);/);
      return {
        title: `${n ? `${n} fonts` : "Too many fonts"} in one video`,
        detail: fonts ? `${fonts}. Professional work keeps to two.` : undefined,
        action: "Use one display font for headlines and one plain font for the rest (Text tab, Font).",
      };
    }
    case "title_hidden_by_subject": {
      const share = num(m, /is (\d+)% hidden/);
      return {
        title: `${name} is hidden behind the subject`,
        detail: share ? `The subject covers ${share}% of its letters; past that its words no longer read.` : undefined,
        action: "Move the title to where the subject is not, make it larger, or bring it in front of the subject.",
      };
    }
    case "flashes_too_fast": {
      const rate = num(m, /flashes ([\d.]+) times a second/);
      return rate
        ? { title: "A strobe flashes too fast", detail: `It flashes ${rate} times a second. More than 3 can trigger seizures.`, action: "Lower the Strobe flash effect's Rate to 3 or less (Effects tab)." }
        : { title: "Flashes come too fast", detail: "Four or more flash hits fall within one second. More than 3 a second can trigger seizures.", action: "Keep flash hits at least a third of a second apart, or use another hit (a zoom or a shake)." };
    }
    case "gap_on_main_track": {
      const secs = num(m, /^([\d.]+) s of black/);
      return {
        title: "Black gap on the main track",
        detail: secs ? `${secs} s of black where nothing plays.` : undefined,
        action: "Right-click the gap on the main track and choose Close gap, or fill it with a clip.",
      };
    }
    case "cuts_off_beat": {
      const off = num(m, /^(\d+) of (\d+) cuts/), all = num(m, /^(\d+) of (\d+) cuts/, 2);
      return {
        title: "Cuts miss the beat",
        detail: off && all ? `${off} of ${all} cuts miss a beat (or half a beat) by more than a frame. This goes to the first.` : undefined,
        action: "Trim or move the shots so each cut lands on a beat marker. Snapping catches the markers.",
      };
    }
    case "no_beat_grid":
      return { title: "No beat markers", detail: "A video cut to music is cut on its beats.", action: "Select the music clip and run Beat markers in AI tools." };
    case "no_end_card":
      return { title: "No end card", detail: "An ad ends on the brand and a call to action, in its last seconds.", action: "Add a title over the last 2 to 3 seconds (Text tab), with the brand and what to do next." };
    case "no_sound":
      return { title: "The video has no sound", action: "Add music or a sound effect from the Audio tab, or record a voiceover." };
    case "music_ends_abruptly":
      return {
        title: `${name} stops dead at the end`,
        detail: "It is still playing when the video ends, with no fade.",
        action: "Fade it out: drag the fade handle at the clip's end, or set Fade out in the Audio tab (about 1.5 s).",
      };
    case "sound_cut_off":
      return {
        title: `${name} is cut off mid-sound`,
        detail: "It stops while still sounding, with no fade, and the video goes on.",
        action: "Give it a short Fade out in the Audio tab (0.3 s; a song or a bed 1.5 s), or trim its end to where the sound pauses.",
      };
    case "click_at_join": {
      const dip = num(m, /A ([\d.]+) dB hole/), click = num(m, /a sample step ([\d.]+) dB steeper/), silent = /^Silence/.test(m);
      const kind = silent ? "A dropout" : dip ? "A tick" : "A click";
      return {
        title: `${kind} where ${meeting(name, next)}`,
        detail: silent ? "The sound stops for a few milliseconds at the cut." : dip ? `For a few milliseconds at the cut the sound drops ${dip} dB.` : click ? `The sound jumps ${click} dB more sharply at the cut than anywhere around it.` : undefined,
        action: joinAction(x, name, next, false),
      };
    }
    case "sound_cut_at_join": {
      const rings = num(m, /still rings ([\d.]+) dB/);
      return {
        title: `${name} is cut off where ${next} starts`,
        detail: rings ? `It still rings ${rings} dB over what plays after the cut, and stops dead.` : undefined,
        action: joinAction(x, name, next, true),
      };
    }
    default:
      // A rule added to the check since: its own words, which name tools.
      return { title: f.message, action: "" };
  }
}

/** Where a finding's fix is in the inspector, once its clip is selected. */
function tabOf(rule: string, inCompound: boolean): PersonFinding["tab"] {
  if (/^text_(outside_title_safe|under_app_buttons|too_small)$/.test(rule)) return inCompound ? "video" : "text";
  if (/^(text_low_contrast|text_contrast_risk|title_hidden_by_subject)$/.test(rule)) return inCompound ? undefined : "text";
  if (rule === "flashes_too_fast") return "effects";
  if (rule === "sound_cut_off" || rule === "music_ends_abruptly" || rule === "click_at_join" || rule === "sound_cut_at_join") return "audio";
  return undefined;
}

/** The findings of one check, as the Check tab shows them, in the check's
 * order (text first, as it judges them). `p`: the project it checked. */
export function personFindings(p: Project, findings: Finding[], duration = 0): PersonFinding[] {
  return findings.map((f, i) => {
    const c = clipAnywhere(p, f.clip_id);
    const caption = c?.type === "text" && !!c.caption;
    const inCompound = !!f.compound_clip_id;
    const second = f.clip_ids?.[1] && f.clip_ids[1] !== f.clip_id ? nameOf(p, clipAnywhere(p, f.clip_ids[1])) : undefined;
    const w = words(f, nameOf(p, c), inCompound, caption, second);
    // An end card goes in the last seconds: that is where to look.
    const at = f.at ?? (f.rule === "no_end_card" && duration > 0 ? Math.max(0, duration - 2.5) : undefined);
    const select = f.compound_clip_id ?? f.clip_id;
    const selectable = !!select && !!findClip(p, select);
    const tab = selectable ? tabOf(f.rule, inCompound) : undefined;
    return {
      key: `${f.rule}:${i}`,
      rule: f.rule,
      group: groupOf(f.rule),
      level: f.level,
      ...w,
      ...(selectable ? { clipId: select } : {}),
      ...(at !== undefined ? { at } : {}),
      ...(tab ? { tab } : {}),
    };
  });
}

/** The groups in order, each with its findings, errors first. */
export function groupFindings(list: PersonFinding[]): { id: CheckGroup; label: string; findings: PersonFinding[] }[] {
  const rank = { error: 0, warning: 1, tip: 2 } as const;
  return CHECK_GROUPS.map((g) => ({ ...g, findings: list.filter((f) => f.group === g.id).sort((a, b) => rank[a.level] - rank[b.level] || (a.at ?? 0) - (b.at ?? 0)) }));
}

/** The headline over a check: what the counts mean for exporting. */
export function checkHeadline(s: { errors: number; warnings: number; tips: number }): { tone: "ok" | "warning" | "error"; text: string } {
  if (s.errors) return { tone: "error", text: `${plural(s.errors, "error")} to fix before you export${s.warnings ? `, and ${plural(s.warnings, "warning")}` : ""}` };
  if (s.warnings) return { tone: "warning", text: `${plural(s.warnings, "warning")} to fix before you deliver${s.tips ? `, and ${plural(s.tips, "tip")}` : ""}` };
  if (s.tips) return { tone: "ok", text: `Ready to export, with ${plural(s.tips, "tip")} to consider` };
  return { tone: "ok", text: "Ready to export: nothing found" };
}

/** A short count for the export dialog: "2 warnings, 1 tip". */
export function checkCounts(s: { errors: number; warnings: number; tips: number }): string {
  const parts = [s.errors && plural(s.errors, "error"), s.warnings && plural(s.warnings, "warning"), s.tips && plural(s.tips, "tip")].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "Nothing found";
}

/** What the check leaves to other tools, said for a person. */
export function notChecked(report: { not_checked: string }): string[] {
  const out = ["Loudness is not part of the check: choose a Loudness target when you export, or run Normalize loudness in AI tools."];
  if (/Contrast:/.test(report.not_checked)) out.push("Some titles' contrast could not be measured on the picture; look at them on the viewer.");
  return out;
}
