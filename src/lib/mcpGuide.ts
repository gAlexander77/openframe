// What an AI model needs beside the tools themselves to make a video well:
// the catalog of names the tools accept, the tools grouped in the order a
// video gets made, which tools only read, worked examples, and playbooks
// (an ad, an epic edit, a social short) served as MCP prompts, resources
// and the help tool. Pure, so the reference in docs/MCP tools.md is
// generated from it and a test keeps the two in step (ADR-055).

import { ANIMATIONS, BLEND_MODES, EFFECTS, FILTERS, FONTS, TRANSITIONS } from "./catalog";
import { CAPTION_LOOKS } from "./captionLooks";
import { RATIOS } from "./canvas";
import type { JsonSchema } from "./commands";
import { EXPORT_PRESETS } from "./export";
import { MASK_SHAPES } from "./mask";
import { SFX } from "./sfx";
import { PRESETS as SPEED_PRESETS } from "./speed";
import { searchStickers, STICKER_CATEGORIES, STICKER_MOTIONS, STICKERS } from "./stickers";
import { TEXT_TEMPLATES } from "./templates";

export interface ToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

// ---- groups, in the order a video gets made ----------------------------------

export const TOOL_GROUPS: { name: string; blurb: string; tools: string[] }[] = [
  { name: "Start here", blurb: "Read before editing: the guide, the timeline and the names the tools accept.", tools: ["help", "describe_project", "list_catalog"] },
  { name: "Projects", blurb: "Work in a new project so the user's own stay untouched.", tools: ["list_projects", "open_project", "new_project", "set_project"] },
  { name: "Media", blurb: "Bring files in and keep the library tidy.", tools: ["import_media", "remove_media", "relink_media", "replace_clip", "edit_media_folder", "organize_media"] },
  {
    name: "Timeline",
    blurb: "Place, cut, move and arrange clips. batch runs many edits as one undo step.",
    tools: ["add_media_clip", "add_color_clip", "add_adjustment_clip", "add_track", "update_track", "delete_track", "split", "split_at_times", "trim_clip", "move_clip", "nudge_clips", "duplicate_clips", "delete_clips", "lift_range", "close_gaps", "cut_ranges", "split_scenes", "group_clips", "ungroup_clips", "set_clip_label", "freeze_frame", "detach_audio", "sync_to_clip", "create_compound_clip", "break_compound_clip", "edit_compound", "rename_compound", "batch", "undo", "redo", "seek"],
  },
  {
    name: "Music, beats and markers",
    blurb: "Read the music's structure, cut and hit on it, fit it to the picture; mark moments.",
    tools: ["analyze_music", "cut_to_beats", "add_beat_hits", "fit_music", "mark_beats", "add_marker", "add_markers", "update_marker", "delete_markers"],
  },
  {
    name: "Picture and motion",
    blurb: "Position, scale, crop, mask, key and animate pictures; keyframes for anything numeric.",
    tools: ["set_param", "add_keyframe", "move_keyframe", "set_keyframe_ease", "remove_keyframes", "frame_region", "frame_clips", "align_clips", "distribute_clips", "set_uniform_scale", "set_flip", "set_crop", "set_mask", "set_blend", "set_chroma_key", "set_canvas_fill", "set_background_removal", "remove_background", "set_animation", "add_cinematic_bars", "track_motion", "auto_reframe", "stabilize_clip"],
  },
  { name: "Speed", blurb: "Constant speed, ramps, reverse and smoother slow motion.", tools: ["set_speed", "set_speed_curve", "set_speed_ramp", "set_reverse", "set_preserve_pitch", "set_frame_blending"] },
  { name: "Text and captions", blurb: "Titles, templates, stickers, captions and the transcript.", tools: ["add_text", "set_text", "add_text_template", "apply_word_art", "add_sticker", "add_captions", "set_caption_look", "replace_caption_text", "get_transcript"] },
  { name: "Effects, transitions and color", blurb: "Effects stacks, transitions at cuts, looks and the color grade.", tools: ["add_effect", "edit_effects", "copy_effects", "apply_effect_preset", "paste_attributes", "set_transition", "set_filter", "auto_adjust", "set_hsl", "set_curve", "set_color_wheel", "apply_lut"] },
  {
    name: "Sound",
    blurb: "Voice, music, effects and the mix.",
    tools: ["add_voiceover", "text_to_speech", "add_sound_effect", "set_fades", "set_compressor", "set_channel_fill", "normalize_loudness", "duck_under_speech", "reduce_noise", "sync_audio", "remove_silences", "remove_filler_words"],
  },
  { name: "Check and deliver", blurb: "Look at the media and the result, check it against the rules, then export.", tools: ["preview_media", "preview_frames", "preview_motion", "preview_frame", "check_project", "export_video", "export_status"] },
];

/** A tool's group; new tools land in "More" until they are filed. */
export const groupOf = (name: string) => TOOL_GROUPS.find((g) => g.tools.includes(name))?.name ?? "More";

/** Tools that only read: clients may run them without asking. */
const READ_ONLY = new Set(["help", "describe_project", "list_catalog", "list_projects", "preview_frame", "preview_frames", "preview_motion", "preview_media", "check_project", "export_status", "get_transcript", "seek"]);
/** Tools that remove things (all are still undoable, but say so). */
const DESTRUCTIVE = new Set(["delete_clips", "delete_track", "delete_markers", "remove_media", "cut_ranges", "lift_range", "remove_silences", "remove_filler_words", "close_gaps"]);
/** Tools that reach outside the project: files on disk, downloads. */
const OPEN_WORLD = new Set(["import_media", "export_video", "remove_background", "text_to_speech", "add_voiceover", "remove_filler_words", "get_transcript"]);

const title = (name: string) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** MCP's tool title and behavior hints (spec 2025-06-18). */
export function annotations(name: string) {
  return {
    title: title(name),
    readOnlyHint: READ_ONLY.has(name),
    destructiveHint: DESTRUCTIVE.has(name),
    openWorldHint: OPEN_WORLD.has(name),
  };
}

// ---- worked examples ----------------------------------------------------------

/** One realistic call per tool that is easy to get wrong; tests check each
 * against its schema. Ids are placeholders an agent replaces. */
export const EXAMPLES: Record<string, Record<string, unknown>> = {
  help: { topic: "ad" },
  list_catalog: { section: "effects" },
  new_project: { name: "Spring sale ad" },
  set_project: { width: 1080, height: 1920, fps: "30" },
  import_media: { files: [{ src: "C:/Footage/product.mp4" }, { src: "C:/Music/track.mp3" }] },
  add_media_clip: { asset_id: "a_123", start: 0, duration: 3.5, in: 12 },
  add_text: { text: "50% OFF", start: 1, duration: 2.5, y: -0.1, style: { size: 160, bold: true, color: "#ffffff", font: "Arial Black", stroke: { color: "#000000", width: 8 } } },
  set_text: { clip_id: "c_123", style: { background: { color: "#000000b3", padding: 18, radius: 12 } } },
  set_animation: { clip_id: "c_123", slot: "in", type: "pop", duration: 0.4 },
  add_text_template: { name: "lowerThird", start: 2, texts: ["Jordan Lee", "Head of Design"] },
  set_param: { clip_ids: ["c_123"], path: "transform.scale", value: 1.2 },
  add_keyframe: { clip_id: "c_123", path: "transform.scale", at: 0, value: 1, ease: "easeInOut" },
  frame_region: { clip_id: "c_123", region: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 }, to_region: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, from: 0, to: 3 },
  set_transition: { clip_id: "c_123", type: "dissolve", duration: 0.5 },
  add_effect: { clip_id: "c_123", type: "glow", params: { amount: 60, threshold: 55 } },
  set_filter: { clip_id: "c_123", type: "teal", intensity: 0.8 },
  set_speed_curve: { clip_id: "c_123", preset: "hero" },
  set_blend: { clip_ids: ["c_123"], mode: "screen" },
  set_canvas_fill: { clip_ids: ["c_123"], fill: "blur", amount: 60 },
  set_fades: { clip_ids: ["c_123"], fade_in: 1, fade_out: 2 },
  mark_beats: { clip_id: "c_123", every: 1 },
  analyze_music: { clip_id: "c_3", markers: ["beats", "bars", "drop"] },
  cut_to_beats: { media: [{ asset_id: "a_1", in: 2 }, { asset_id: "a_2" }, { asset_id: "a_1", in: 9, beats: 4 }], grid: "beats", pattern: [4, 4, 2, 2, 1, 1] },
  add_beat_hits: { effects: ["flash", "zoom"], marker_label: "Drop" },
  set_speed_ramp: { clip_id: "c_7", at: 8.4, moment: "slow" },
  fit_music: { clip_id: "c_3", drop_at: 8.4, end: "bar", fade_out: 1.5 },
  add_cinematic_bars: { ratio: 2.39, animate_in: 0.6 },
  add_sound_effect: { name: "whoosh", start: 3.9 },
  add_voiceover: { lines: [{ text: "Meet the lightest bottle we have ever made." }, { text: "Cold for 24 hours." }], voice: "af_heart" },
  duck_under_speech: { clip_id: "c_music", depth: 12 },
  set_caption_look: { look: "pop" },
  auto_reframe: { clip_id: "c_123", ratio: "9:16" },
  preview_frames: { times: [0.5, 2, 4, 6, 8, 10, 12, 14] },
  preview_motion: { start: 7.5, end: 9.5, fps: 10 },
  preview_media: { asset_id: "a_123", count: 12 },
  check_project: { kind: "ad" },
  export_video: { name: "spring-sale-16x9", resolution: "1080p", quality: "higher", loudness: -14 },
  batch: { commands: [{ command: "set_animation", args: { clip_id: "c_1", slot: "in", type: "rise", duration: 0.5 } }, { command: "set_animation", args: { clip_id: "c_1", slot: "out", type: "fade", duration: 0.3 } }] },
};

// ---- the catalog --------------------------------------------------------------

const labels = <T extends { label: string }>(r: Record<string, T>) => Object.entries(r).map(([id, d]) => ({ id, label: d.label }));

/** The common set_param / add_keyframe paths, in the values they store. */
export const PARAM_PATHS: { path: string; range: string; meaning: string }[] = [
  { path: "transform.x", range: "-0.5..0.5 (and past)", meaning: "Horizontal offset of the picture's center from the canvas center, in canvas widths" },
  { path: "transform.y", range: "-0.5..0.5 (and past)", meaning: "Vertical offset, in canvas heights; positive is down (0.35 sits near the bottom)" },
  { path: "transform.scale", range: "0.01..5", meaning: "1 fits the picture inside the canvas; text is drawn at its style size at 1" },
  { path: "transform.rotation", range: "degrees", meaning: "Clockwise" },
  { path: "opacity", range: "0..1", meaning: "0 invisible" },
  { path: "volume", range: "0..4", meaning: "Gain: 1 is 0 dB, 0.5 about -6 dB, 0 silent" },
  { path: "pan", range: "-1..1", meaning: "Left to right" },
  { path: "adjust.exposure", range: "-100..100", meaning: "Also contrast, saturation, temperature, tint, highlights, shadows, whites, blacks, vibrance, sharpen" },
  { path: "adjust.lut.intensity", range: "0..1", meaning: "Strength of an applied LUT" },
  { path: "mask.x / mask.y / mask.width / mask.height / mask.feather", range: "fractions", meaning: "Animate a mask set with set_mask" },
  { path: "effects.<index>.<param>", range: "per effect", meaning: "An effect's parameter, e.g. effects.0.amount (list_catalog section effects has each one's range)" },
];

/**
 * Everything the tools accept by name, in one place. With no section, a
 * compact index of every section; a section in detail; `query` searches
 * stickers (there are many).
 */
export function fullCatalog(section?: string, query?: string): unknown {
  const all: Record<string, unknown> = {
    effects: Object.entries(EFFECTS).map(([id, d]) => ({ id, label: d.label, category: d.category, params: d.params })),
    transitions: Object.entries(TRANSITIONS).map(([id, d]) => ({ id, label: d.label, category: d.category })),
    animations: {
      in_out: Object.entries(ANIMATIONS).filter(([, d]) => d.from).map(([id, d]) => ({ id, label: d.label })),
      loop: Object.entries(ANIMATIONS).filter(([, d]) => d.loop).map(([id, d]) => ({ id, label: d.label })),
    },
    filters: Object.entries(FILTERS).map(([id, d]) => ({ id, label: d.label, category: d.category })),
    text_templates: Object.entries(TEXT_TEMPLATES).map(([id, t]) => ({ id, label: t.label, category: t.category, seconds: t.seconds, texts: t.layers.filter((l) => l.text !== undefined).length })),
    caption_looks: labels(CAPTION_LOOKS),
    speed_presets: labels(SPEED_PRESETS),
    sound_effects: Object.entries(SFX).map(([id, s]) => ({ id, label: s.label, seconds: s.seconds })),
    blend_modes: BLEND_MODES.map(([id, label]) => ({ id, label })),
    mask_shapes: MASK_SHAPES,
    fonts: { builtin: FONTS, note: "Any font installed on the user's computer works by its family name too." },
    canvas_ratios: RATIOS.map((r) => r.label),
    export_presets: EXPORT_PRESETS.map((x) => ({ id: x.id, label: x.label, ...x.settings })),
    sticker_motions: Object.keys(STICKER_MOTIONS),
    stickers: { count: STICKERS.length, categories: STICKER_CATEGORIES, note: "Search with list_catalog section stickers and a query (fire, arrow, subscribe...)." },
    param_paths: PARAM_PATHS,
  };
  if (section === "stickers") return searchStickers(query ?? "").slice(0, 60).map((s) => ({ id: s.id, label: s.label, category: s.category }));
  if (section) {
    if (!(section in all)) throw new Error(`No catalog section ${section}; there are ${Object.keys(all).join(", ")}`);
    return all[section];
  }
  // The index: names only, so it stays small; a section has the details.
  const names = (v: unknown): unknown => (Array.isArray(v) ? v.map((x) => (typeof x === "object" && x && "id" in x ? (x as { id: string }).id : x)) : v);
  return {
    sections: Object.keys(all),
    ...Object.fromEntries(Object.entries(all).map(([k, v]) => [k, k === "effects" || k === "param_paths" ? names(v) : typeof v === "object" && v && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, names(b)])) : names(v)])),
    note: "list_catalog with a section (effects, param_paths...) gives the details: effect parameter ranges, labels, durations.",
  };
}

// ---- playbooks ------------------------------------------------------------------

/** Rules of thumb that make a video look made by a professional. */
export const DESIGN = `Design rules (apply them unless the user asks otherwise; sources in docs/research/Pro workflows 2026-10-18.md):
- Hook: the product or the most striking image in the first 1-2 s; the proposition in the first 3 s, the hook within 6 s, the brand within 5 s (TikTok's and YouTube's creative guides).
- Pacing: ad shots average under 2 s (social ads 1-3 s, brand spots 2-5 s); epic edits cut on the beat, every 2-4 beats in a build and every beat after the drop.
- Words: one idea per title, 2-6 words for a headline, on screen long enough to read twice (about 0.4 s per word, 1.5 s at least); lower thirds 3-6 s; captions at most 20 characters a second, two lines.
- Type: at most two font families (a bold display face for headlines, a clean sans for the rest); headlines 8-12% of the frame height (size 90-160 at 1080p), nothing under size 40; inside the 90% title-safe area (align_clips margin 0.05); on 9:16 clear of the bottom 35% and the right 19%, where the apps' buttons sit (the viewer's TikTok, Reels, Shorts guide).
- Contrast: text over footage gets an outline, a shadow or a box (style.stroke, style.shadow, style.background); aim for 4.5:1 against what is behind it.
- Color: one grade over every shot (set_filter or apply_lut on an adjustment clip over everything), so the piece reads as one film.
- Motion: titles get an in and an out animation; push slowly into stills (frame_region); do not move everything at once; whip transitions follow the direction of motion.
- Flashes: never more than three flashes in any one second (WCAG 2.3.1; UK ad rules test for it).
- Sound: voice first, music ducked 10-15 dB under it (duck_under_speech), a whoosh on fast transitions, an impact on reveals with a riser whose peak lands on it, a beat of silence before the biggest hit; fade the music out over 1-2 s (set_fades).
- Loudness: online -14 LUFS with true peak at most -1 dBTP; EU broadcast -23 LUFS / -1 dBTP (EBU R128); US broadcast -24 LKFS / -2 dBTP (ATSC A/85).
- End: logo, product, one call to action and where to go, held 2-3 s.
- Check: preview_frames across the whole piece, preview_motion around cuts and moves, check_project for the rules above; fix, check again, then export.`;

export const PLAYBOOKS: Record<string, { title: string; text: string }> = {
  ad: {
    title: "A professional ad",
    text: `Making an ad (15, 30 or 60 s) with these tools:
1. new_project with a name; set_project for the shape: 1920x1080 for YouTube and TV, 1080x1920 for Reels, TikTok and Shorts, 1080x1080 or 1080x1350 for feeds.
2. import_media: product shots, b-roll, the logo (PNG with transparency), music. describe_project for asset ids and durations; preview_media to see what is in each video.
3. Script in beats: hook (0-3 s), problem or desire, the product, proof (features, numbers, a demo), offer, call to action. Write the voice lines short.
4. add_voiceover with the script: the voice and captions are placed at their real lengths and it answers where each line landed; cut the picture to the voice.
5. Picture: add_media_clip a shot under each line; frame_region for slow push-ins on stills and product details; set_canvas_fill blur when footage does not fill the frame; set_speed for slow motion on hero shots.
6. Words: a headline per idea with add_text (see Design rules), set_animation in and out; add_text_template for lower thirds and badges; set_caption_look for the captions (pop or boxed read well on social).
7. Look: one grade for all shots (an adjustment layer with set_filter or apply_lut over everything), set_transition dissolve or a fast cut between shots.
8. Sound: music with add_media_clip on an audio track, duck_under_speech under the voice, set_fades out at the end, add_sound_effect on reveals, normalize_loudness on the voice.
9. End card: logo, product, the offer and the call to action (Shop now, the URL) on a clean background, held 2-3 s.
10. preview_frames across the whole ad and check_project with kind ad; fix what they find (text cut off, too small, low in contrast, no end card); then export_video (loudness -14). For other shapes, set_project to the new size and auto_reframe the shots, check again, export again.

${DESIGN}`,
  },
  epic_edit: {
    title: "An epic edit",
    text: `Making an epic edit (a hype video, montage or music-synced velocity edit):
1. new_project; import_media the clips and one strong track (a clear beat and a drop).
2. Put the music on an audio track first and analyze_music it with markers beats, bars and drop: it answers the tempo, beats, bars, phrases, named sections (intro, build, drop, breakdown, outro) and the drop, in timeline seconds. Cut on downbeats and at phrase starts.
3. fit_music drop_at to slide the music so its drop lands where the edit's climax should be (often 25-40% in for a short edit).
4. preview_media each clip to find its best moments, then cut_to_beats with the shots in order (each with its in point): one call lays them end to end on the main track, every cut on the grid. Shape it to the music: intro (wide shots, bars, the title; pattern 4s), build (cuts every 2 beats), drop (every beat), breakdown (slow motion, a freeze with the title), final drop, logo. Run cut_to_beats per section with start and end, or one pattern for all.
5. Speed: velocity edits run fast between beats and slow on the hit: set_speed_ramp lands a clip's slow (or fast) moment on a beat without moving its cuts.
6. Hits: add_beat_hits flash, zoom, shake, rgb_split, glow or zoom_blur on the drop (marker_label Drop), on bars, or at_cuts; it keeps flashes to 3 a second. Transitions whipLeft, whipRight, zoomPunch or spinBlur at a few cuts, in the direction of the motion.
7. Look: one grade over everything (filter teal or a LUT on an adjustment clip), grain, and add_cinematic_bars (2.39) for a film feel.
8. Titles: big, short, bold words (one display face, size 160-240) with pop or zoomIn; text behind the subject (remove_background on a copy above the title) for the hero shot.
9. Sound design: add_sound_effect rise or reverseCymbal with end_at on the drop (it peaks there), impact, braam or subDrop on the drop's beat, whoosh on whip transitions; then fit_music end bar (or video) with fade_out to end the music cleanly.
10. preview_motion around the drop and other key cuts (the beats are listed beside the frames), check_project with kind epic_edit (cuts on the beat, no more than 3 flashes a second, no black), then export_video (loudness -14).

${DESIGN}`,
  },
  social_short: {
    title: "A short for TikTok, Reels or Shorts",
    text: `Making a vertical short from a talking-head clip or screen recording:
1. new_project; set_project 1080x1920; import_media.
2. add_media_clip the clip; remove_silences and remove_filler_words tighten the talk.
3. auto_reframe the clip to 9:16 (or frame_region onto the speaker or the part of the screen that matters); set_canvas_fill blur for anything that does not fill the frame.
4. Captions: the Captions tab's generator or add_captions with word times, then set_caption_look pop; keep them in the middle third, clear of the apps' buttons.
5. Hook title in the first second (add_text, size 120-160, with a box or outline), a few stickers or sound effects on punchlines (add_sticker, add_sound_effect).
6. Music low under the voice (duck_under_speech), set_fades, normalize_loudness.
7. preview_frames, then export_video with the social preset sizes (1080p).

${DESIGN}`,
  },
};

/** The topics help() answers, beside any tool's name. */
export const HELP_TOPICS = ["overview", "design", ...Object.keys(PLAYBOOKS), "catalog", "params"];

const typeOf = (s: JsonSchema): string =>
  s.enum ? s.enum.map((v) => JSON.stringify(v)).join(" | ") : s.type === "array" ? `${s.items ? typeOf(s.items) : "any"}[]` : s.type === "object" && s.properties ? `{ ${Object.keys(s.properties).join(", ")} }` : (s.type ?? "any");

/** A tool's parameters as a markdown table; the fields of object
 * parameters (style, region) and of array items (files[], lines[]) get
 * rows of their own, since that is where models guess wrong. */
export function paramTable(schema: JsonSchema): string {
  const rows: string[] = [];
  const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const walk = (s: JsonSchema, prefix: string, depth: number) => {
    for (const [k, p] of Object.entries(s.properties ?? {})) {
      const range = p.minimum !== undefined || p.maximum !== undefined ? ` (${p.minimum ?? ""}..${p.maximum ?? ""})` : "";
      rows.push(`| \`${prefix}${k}\` | ${cell(typeOf(p))} | ${(s.required ?? []).includes(k) ? "yes" : ""} | ${cell(p.description ?? "")}${range} |`);
      if (depth < 2 && p.type === "object" && p.properties) walk(p, `${prefix}${k}.`, depth + 1);
      if (depth < 2 && p.type === "array" && p.items?.type === "object" && p.items.properties) walk(p.items, `${prefix}${k}[].`, depth + 1);
    }
  };
  walk(schema, "", 0);
  return rows.length ? ["| Parameter | Type | Required | Meaning |", "|---|---|---|---|", ...rows].join("\n") : "No parameters.";
}

/** One tool, fully: what it does, its parameters and an example call. */
export function toolHelp(t: ToolInfo): string {
  const ex = EXAMPLES[t.name];
  return [`## ${t.name} (${groupOf(t.name)})`, "", t.description, "", paramTable(t.inputSchema), ...(ex ? ["", "Example:", "", "```json", JSON.stringify({ name: t.name, arguments: ex }), "```"] : [])].join("\n");
}

/** The help tool's answer for a topic or a tool's name. */
export function helpText(topic: string | undefined, tools: ToolInfo[], instructions: string): string {
  const t = (topic ?? "overview").trim();
  const tool = tools.find((x) => x.name === t);
  if (tool) return toolHelp(tool);
  if (t === "overview") {
    const groups = TOOL_GROUPS.map((g) => `- ${g.name}: ${g.blurb} ${g.tools.filter((n) => tools.some((x) => x.name === n)).join(", ")}`);
    const more = tools.filter((x) => groupOf(x.name) === "More").map((x) => x.name);
    return [instructions, "", "Tools by step:", ...groups, ...(more.length ? [`- More: ${more.join(", ")}`] : []), "", `Help topics: ${HELP_TOPICS.join(", ")}, or any tool's name for its parameters and an example.`].join("\n");
  }
  if (t === "design") return DESIGN;
  if (t === "catalog") return `list_catalog returns every name the tools accept. Sections: ${Object.keys(fullCatalog() as object).filter((k) => k !== "sections" && k !== "note").join(", ")}. Call it with a section for details (effect parameter ranges, template text counts) and with section "stickers" and a query to search stickers.`;
  if (t === "params") return ["set_param and add_keyframe paths:", ...PARAM_PATHS.map((x) => `- ${x.path} (${x.range}): ${x.meaning}`)].join("\n");
  const book = PLAYBOOKS[t];
  if (book) return book.text;
  const near = tools.filter((x) => x.name.includes(t) || t.includes(x.name)).map((x) => x.name);
  throw new Error(`No help topic ${t}. Topics: ${HELP_TOPICS.join(", ")}${near.length ? `; tools like it: ${near.join(", ")}` : ", or a tool's name"}.`);
}

// ---- MCP prompts ------------------------------------------------------------------

export const PROMPTS = [
  {
    name: "make_ad",
    title: "Make an ad",
    description: "Plan and edit a professional ad from the media given, following the ad playbook.",
    arguments: [
      { name: "product", description: "What is advertised, and the offer if any", required: true },
      { name: "length", description: "Seconds: 15, 30 or 60 (default 30)", required: false },
      { name: "shape", description: "16:9, 9:16, 1:1 or 4:5 (default 16:9)", required: false },
      { name: "media", description: "Paths of the footage, pictures, logo and music to use", required: false },
    ],
  },
  {
    name: "epic_edit",
    title: "Make an epic edit",
    description: "Cut a music-synced montage or hype edit from the clips and track given.",
    arguments: [
      { name: "theme", description: "What the edit is about (a trip, a team, a season...)", required: true },
      { name: "length", description: "Seconds (default 30)", required: false },
      { name: "media", description: "Paths of the clips and the music track", required: false },
    ],
  },
  {
    name: "social_short",
    title: "Make a vertical short",
    description: "Turn a talking-head clip or screen recording into a captioned 9:16 short.",
    arguments: [
      { name: "media", description: "Path of the clip, and music if any", required: true },
      { name: "length", description: "Target seconds (default 45)", required: false },
    ],
  },
];

/** prompts/get: the playbook with the user's details on top. */
export function promptMessages(name: string, args: Record<string, string>) {
  const p = PROMPTS.find((x) => x.name === name);
  if (!p) throw new Error(`unknown prompt ${name}`);
  const missing = p.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
  if (missing.length) throw new Error(`prompt ${name} needs ${missing.join(", ")}`);
  const book = PLAYBOOKS[name === "make_ad" ? "ad" : name];
  const given = p.arguments.filter((a) => args[a.name]).map((a) => `- ${a.name}: ${args[a.name]}`);
  const text = [`${p.description}`, "", "Details:", ...(given.length ? given : ["- (none given: ask for what is missing, or choose sensibly)"]), "", book.text].join("\n");
  return { description: p.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

// ---- the reference ------------------------------------------------------------

/** docs/MCP tools.md, generated: every tool by group with its parameters. */
export function toolReference(tools: ToolInfo[], instructions: string): string {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const groups = [...TOOL_GROUPS.map((g) => ({ ...g, list: g.tools.filter((n) => byName.has(n)) })), { name: "More", blurb: "Not filed in a group yet.", list: tools.filter((t) => groupOf(t.name) === "More").map((t) => t.name) }].filter((g) => g.list.length);
  return [
    "# MCP tools",
    "",
    "<!-- Generated from src/lib/mcpGuide.ts and the tool definitions by",
    "     `UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts`;",
    "     npm test fails when this file is out of date. Do not edit by hand. -->",
    "",
    `Every tool the editor offers an AI model over MCP, ${tools.length} in all, in the order a video gets made. How to connect is in [[Automation]]; the playbooks are in [[Agent playbook]]. Every edit is undoable; times are seconds; ids come from describe_project.`,
    "",
    "## What the server tells a model first",
    "",
    "```text",
    instructions,
    "```",
    "",
    "## Contents",
    "",
    ...groups.map((g) => `- **${g.name}**: ${g.list.map((n) => `\`${n}\``).join(", ")}`),
    "",
    ...groups.flatMap((g) => [`## ${g.name}`, "", g.blurb, "", ...g.list.flatMap((n) => [toolHelp(byName.get(n)!).replace(/^## (\S+) \([^)]*\)/, "### $1"), ""])]),
  ].join("\n");
}

/** docs/Agent playbook.md, generated: the playbooks and design rules the
 * help tool and the MCP prompts serve, for people wiring up a model. */
export function agentPlaybook(): string {
  return [
    "# Agent playbook",
    "",
    "<!-- Generated from src/lib/mcpGuide.ts by",
    "     `UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts`;",
    "     npm test fails when this file is out of date. Do not edit by hand. -->",
    "",
    "How an AI model should make a video with OpenFrame's MCP tools. A model gets the same text three ways: the `help` tool (topics `ad`, `epic_edit`, `social_short`, `design`), the MCP prompts `make_ad`, `epic_edit` and `social_short`, and the resources `guide://...`. Every tool is in [[MCP tools]]; connecting is in [[Automation]].",
    "",
    "## Design rules",
    "",
    DESIGN.replace(/^Design rules[^\n]*\n/, ""),
    "",
    ...Object.values(PLAYBOOKS).flatMap((b) => [`## ${b.title}`, "", b.text.split("\n\nDesign rules")[0], ""]),
    "## Prompts",
    "",
    ...PROMPTS.flatMap((p) => [`- \`${p.name}\`: ${p.description} Arguments: ${p.arguments.map((a) => `${a.name}${a.required ? " (required)" : ""}`).join(", ")}.`]),
    "",
  ].join("\n");
}
