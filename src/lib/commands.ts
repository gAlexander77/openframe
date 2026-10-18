// The command registry: every edit an agent can make, by name, with a JSON
// Schema for its arguments (ADR-006). One surface serves the in-app AI
// AI assistant (as LLM tool definitions), the automation API, recipes/pipelines,
// and a future MCP server, which only has to list these and forward calls.
//
// Times in command arguments are SECONDS (what people and LLMs think in);
// they snap to the nearest project frame. The project JSON itself stores
// frames (ADR-004) — describeProject reports both.

import { applyCaptionLook, CAPTION_LOOKS } from "./captionLooks";
import { FPS_PRESETS, frameAt, framesToSeconds, secondsToFrames } from "./time";
import {
  clipForAsset,
  createAdjustmentClip,
  createColorClip,
  createMarker,
  createTextClip,
  createTrack,
  uid,
} from "./project/defaults";
import * as ops from "./project/ops";
import type { Adjust, Clip, ClipLabel, Crop, Ease, Effect, Grade, HslBand, Id, Mask, Project, TextStyle, Track, Transform, WheelName } from "./project/types";
import { ANIMATIONS, BLEND_MODES, CLIP_LABELS, EFFECTS, FILTERS, TRANSITIONS, effectDefaults } from "./catalog";
import { copyEffectStack, editEffects, EFFECT_ACTIONS, pasteEffectStack, type EffectAction } from "./effectStack";
import { upsertKey } from "./keyframes";
import { CURVE_MAX, CURVE_MIN, PRESETS, cleanPoints } from "./speed";
import { cleanCurve, CURVE_CHANNELS, isIdentityCurve, type CurveChannel } from "./curves";
import { HSL_BANDS, hueToPuck, puckToBalance, WHEELS } from "./grade";
import { EASE_IDS, easeById, liveRefs, removeKeys, retimeKey, setEase, setValues, type KeyRef } from "./keyframeEdit";
import { replaceText, type Caption } from "./captions";
import { cutRanges, splitAtSourceTimes, type SourceRange } from "./project/cut";
import { breakCompound, breakProblem, compoundProblem, compoundView, createCompound, withCompoundView } from "./project/compound";
import { addStickerClip, findSticker, searchStickers, STICKER_MOTIONS } from "./stickers";
import { addTemplate, findTemplate, TEXT_TEMPLATES, wordArtStyle } from "./templates";
import { deleteMarkers, updateMarker } from "./markers";
import { relinkAsset } from "./project/relink";
import { closeAllGaps, closeGap, nudgeClips } from "./project/gaps";
import { replaceClip } from "./project/replace";
import { syncClip, syncProblem } from "./project/sync";
import { groupClips, regroupCopies, ungroupClips } from "./project/groups";
import { editFolder, organizeMedia, removeMedia, unusedMedia } from "./project/mediaOrganization";
import { applyEffectPreset } from "./effectPresets";
import { ATTRIBUTE_GROUPS, copyAttributes, pasteAttributes, type AttributeGroup } from "./attributes";
import { cleanCompressor, COMPRESSOR_PRESETS, compressorPreset, type CompressorPreset } from "./compressor";
import { alignClips, ALIGNS, distributeClips, frameClips, frameRegion, pictureAspect, type Align, type Axis, type Frame, type Region } from "./align";
import { MASK_SHAPES, newMask, type MaskShape } from "./mask";
import { cropClips, cropToRatio, CROP_RATIOS, MIN_CROP, validCrop, type CropRatio } from "./crop";
import { addBeatHits, addCinematicBars, cutToBeats, EpicError, fitMusic, HIT_KINDS, isEffectTrack, MAX_FLASHES_PER_SECOND, setSpeedRamp, type BeatHits, type CinematicBars, type CutToBeats, type FitMusic, type HitKind, type SpeedRamp } from "./epic";

export type JsonSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: (string | number)[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  additionalProperties?: boolean;
};

export interface Command {
  name: string;
  description: string;
  input: JsonSchema;
  run(p: Project, args: Record<string, unknown>): Project;
}

export class CommandError extends Error {}

/** Run an epic-edit op, reporting its problems as command errors. */
function epic(fn: () => Project): Project {
  try {
    return fn();
  } catch (e) {
    throw e instanceof EpicError ? new CommandError(e.message) : e;
  }
}

// ---- schema helpers ------------------------------------------------------------

const S = {
  str: (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra }),
  num: (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "number", description, ...extra }),
  bool: (description: string): JsonSchema => ({ type: "boolean", description }),
  ids: (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = [], description?: string): JsonSchema => ({
    type: "object",
    ...(description ? { description } : {}),
    properties,
    required,
    additionalProperties: false,
  }),
};

/** Validate arguments against the subset of JSON Schema the registry uses.
 * Returns the problems, empty when valid. This is the trust boundary for
 * anything an agent sends. */
export function validate(value: unknown, schema: JsonSchema, path = "args"): string[] {
  const errs: string[] = [];
  const t = schema.type;
  if (t === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${path} must be an object`];
    const o = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (o[r] === undefined) errs.push(`${path}.${r} is required`);
    for (const [k, v] of Object.entries(o)) {
      const sub = schema.properties?.[k];
      if (!sub) {
        if (schema.additionalProperties === false) errs.push(`${path}.${k} is not a known argument`);
        continue;
      }
      if (v !== undefined) errs.push(...validate(v, sub, `${path}.${k}`));
    }
    return errs;
  }
  if (t === "array") {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    value.forEach((v, i) => schema.items && errs.push(...validate(v, schema.items, `${path}[${i}]`)));
    return errs;
  }
  if (t === "number" || t === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a number`];
    if (t === "integer" && !Number.isInteger(value)) errs.push(`${path} must be an integer`);
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path} must be <= ${schema.maximum}`);
  } else if (t === "string" && typeof value !== "string") errs.push(`${path} must be a string`);
  else if (t === "boolean" && typeof value !== "boolean") errs.push(`${path} must be true or false`);
  if (schema.enum && !schema.enum.includes(value as string | number)) {
    errs.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  return errs;
}

// ---- helpers for runners ---------------------------------------------------------

const f = (p: Project, seconds: unknown) => secondsToFrames(Number(seconds), p.fps);

function clipOrThrow(p: Project, id: unknown) {
  const loc = ops.findClip(p, String(id));
  if (!loc) throw new CommandError(`no clip with id ${id}`);
  return loc;
}

function trackOrThrow(p: Project, id: unknown): Track {
  const t = ops.findTrack(p, String(id));
  if (!t) throw new CommandError(`no track with id ${id}`);
  return t;
}

/** The track a new clip should land on: the one asked for, else the first
 * of the right kind with room, else a new track. */
function landingTrack(p: Project, clip: Clip, trackId?: unknown): [Project, Id] {
  if (trackId !== undefined) return [p, trackOrThrow(p, trackId).id];
  const kind = clip.type === "audio" ? "audio" : "video";
  const media = clip.type === "video" || clip.type === "image";
  const main = ops.mainTrack(p);
  if (media && ops.rangeFree(main, clip.start, clip.duration)) return [p, main.id];
  // Tracks of adjustment layers (beat hits, bars, grades) take only more of them.
  const free = p.tracks.find((t) => t.kind === kind && !t.main && !t.locked && (clip.type === "adjustment" || !isEffectTrack(t)) && ops.rangeFree(t, clip.start, clip.duration));
  if (free) return [p, free.id];
  const fresh = createTrack(kind, kind === "audio" ? "Audio" : "Overlay");
  return [ops.addTrack(p, fresh), fresh.id];
}

export const TEXT_STYLE_SCHEMA = S.obj({
  font: S.str("Font family"),
  size: S.num("Pixels at 1080p canvas height", { minimum: 4 }),
  color: S.str("CSS color"),
  bold: S.bool("Bold"),
  italic: S.bool("Italic"),
  align: S.str("Alignment", { enum: ["left", "center", "right"] }),
  highlight: S.str("Captions: color of the word being spoken; an empty string turns it off"),
  case: S.str("Letter case as shown (the text is kept): none, upper, lower or title", { enum: ["none", "upper", "lower", "title"] }),
  // Readable over busy footage: a box behind, an outline, a drop shadow.
  // Sizes are pixels at 1080p; an empty color removes the part.
  background: S.obj({ color: S.str("CSS color, e.g. rgba(0,0,0,0.6)"), padding: S.num("Pixels", { minimum: 0 }), radius: S.num("Corner radius, pixels", { minimum: 0 }) }, ["color"], "A box behind the text, so it reads over busy footage; an empty color removes it"),
  stroke: S.obj({ color: S.str("CSS color"), width: S.num("Pixels", { minimum: 0 }) }, ["color"], "An outline around the letters (6-10 for titles over footage); width 0 or an empty color removes it"),
  shadow: S.obj({ color: S.str("CSS color"), blur: S.num("Pixels", { minimum: 0 }), x: S.num("Pixels"), y: S.num("Pixels") }, ["color"], "A drop shadow; an empty color removes it"),
}, [], "The text's look; fields left out keep their value (or the default look for new text)");

const REGION_SCHEMA = S.obj(
  {
    x: S.num("Left edge, a fraction of the picture's width", { minimum: 0, maximum: 1 }),
    y: S.num("Top edge, a fraction of its height", { minimum: 0, maximum: 1 }),
    w: S.num("Width, a fraction of the picture's width", { minimum: 0.01, maximum: 1 }),
    h: S.num("Height, a fraction of its height", { minimum: 0.01, maximum: 1 }),
  },
  ["x", "y", "w", "h"],
);

function regionOf(v: unknown): Region {
  const r = v as Region;
  if (r.x + r.w > 1.0001 || r.y + r.h > 1.0001) throw new CommandError("a region must lie inside the picture: x + w and y + h at most 1");
  return r;
}

/** A style from an agent: the box parts get defaults, and an empty color
 * removes one, as an empty highlight does. */
function styleFrom(base: Partial<TextStyle>, given: Partial<TextStyle>): Partial<TextStyle> {
  const s: Partial<TextStyle> = { ...base, ...given };
  // An agent may send only a color; the rest keeps its size or a default.
  const g = given as { background?: object; stroke?: object; shadow?: object };
  if (g.background) s.background = { padding: 16, radius: 8, ...base.background, ...g.background } as TextStyle["background"];
  if (g.stroke) s.stroke = { width: 4, ...base.stroke, ...g.stroke } as TextStyle["stroke"];
  if (g.shadow) s.shadow = { blur: 8, x: 0, y: 3, ...base.shadow, ...g.shadow } as TextStyle["shadow"];
  for (const k of ["background", "stroke", "shadow"] as const) if (s[k]?.color === "") delete s[k];
  if (s.highlight === "") delete s.highlight;
  if ((s.case as string) === "none") delete s.case;
  return s;
}

// ---- the registry ------------------------------------------------------------------

export const COMMANDS: Command[] = [
  {
    name: "paste_attributes",
    description: "Copy selected groups from a source clip to targets. Replaces those settings/keyframes; effects append by default. Keeps timing/source offsets and respects locks.",
    input: S.obj({ source_clip_id: S.str("Source clip"), clip_ids: S.ids("Target clips"), groups: { type: "array", items: S.str("Group", { enum: [...ATTRIBUTE_GROUPS] }), description: `Which attributes to paste: ${ATTRIBUTE_GROUPS.join(", ")}` }, replace_effects: S.bool("Replace target effect stacks") }, ["source_clip_id", "clip_ids", "groups"]),
    run: (p, a) => pasteAttributes(p, a.clip_ids as string[], copyAttributes(p, String(a.source_clip_id)), a.groups as AttributeGroup[], a.replace_effects === true),
  },
  {
    name: "apply_effect_preset",
    description: "Append a serialized effect preset (id, name, stack with effects/keyframes/fps) to visual clips. Validates catalog parameters, remaps effect IDs and converts animation timing.",
    input: S.obj({ clip_ids: S.ids("Target clips"), preset_json: S.str("Effect preset JSON") }, ["clip_ids", "preset_json"]),
    run: (p, a) => applyEffectPreset(p, a.clip_ids as string[], JSON.parse(String(a.preset_json))),
  },
  {
    name: "edit_media_folder",
    description: "Create, rename or delete a virtual media folder. Deleting unfiles its media; source files and clips are preserved.",
    input: S.obj({ action: S.str("Operation", { enum: ["create", "rename", "delete"] }), name: S.str("Folder name"), new_name: S.str("New name for rename") }, ["action", "name"]),
    run: (p, a) => editFolder(p, a.action as "create" | "rename" | "delete", String(a.name), a.new_name as string | undefined),
  },
  {
    name: "organize_media",
    description: "Set virtual folder membership and/or favorite status for imported assets. An empty folder name unfiles media; does not move source files.",
    input: S.obj({ asset_ids: S.ids("Assets"), folder: S.str("Existing folder, or empty to unfile"), favorite: S.bool("Favorite status") }, ["asset_ids"]),
    run: (p, a) => organizeMedia(p, a.asset_ids as string[], { ...(typeof a.folder === "string" ? { folder: a.folder } : {}), ...(typeof a.favorite === "boolean" ? { favorite: a.favorite } : {}) }),
  },
  {
    name: "remove_media",
    description: "Remove imported media from the project; the files on disk stay. Media a clip uses is refused unless remove_clips=true, which deletes those clips too. unused=true removes every file no clip uses.",
    input: S.obj({ asset_ids: S.ids("Assets"), unused: S.bool("Remove all media no clip uses"), remove_clips: S.bool("Also delete the clips that use it") }),
    run: (p, a) => {
      const ids = a.unused === true ? unusedMedia(p) : ((a.asset_ids as string[] | undefined) ?? []);
      if (!ids.length) throw new CommandError(a.unused === true ? "No media is unused." : "Name the media to remove.");
      return removeMedia(p, ids, a.remove_clips === true);
    },
  },
  {
    name: "relink_media",
    description: "Relink every use of an asset to another imported asset's source. Preserves edits and identity; requires compatible streams and duration. Undoable.",
    input: S.obj({ asset_id: S.str("Original asset"), replacement_asset_id: S.str("Imported replacement asset") }, ["asset_id", "replacement_asset_id"]),
    run: (p, a) => {
      const replacement = p.assets.find((asset) => asset.id === a.replacement_asset_id);
      if (!replacement) throw new CommandError("Import the replacement first.");
      return relinkAsset(p, String(a.asset_id), replacement);
    },
  },
  {
    name: "set_project",
    description: "Change project settings: name, canvas size (pixels), frame rate, background color.",
    input: S.obj({
      name: S.str("Project name"),
      width: { type: "integer", minimum: 16, maximum: 8192, description: "Canvas width in pixels" },
      height: { type: "integer", minimum: 16, maximum: 8192, description: "Canvas height in pixels" },
      background: S.str("CSS hex color behind all layers"),
      fps: S.str("Frame rate; clips keep their times", { enum: FPS_PRESETS.map((f) => f.label) }),
    }),
    run: (p, a) => {
      const rate = a.fps === undefined ? undefined : FPS_PRESETS.find((f) => f.label === String(a.fps));
      if (a.fps !== undefined && !rate) throw new CommandError(`fps must be one of ${FPS_PRESETS.map((f) => f.label).join(", ")}`);
      const q = {
        ...p,
        ...(a.name !== undefined ? { name: String(a.name) } : {}),
        ...(a.width !== undefined ? { width: Number(a.width), canvasFixed: true } : {}),
        ...(a.height !== undefined ? { height: Number(a.height), canvasFixed: true } : {}),
        ...(a.background !== undefined ? { background: String(a.background) } : {}),
      };
      return rate ? ops.setFps(q, rate.fps) : q;
    },
  },
  {
    name: "add_track",
    description: "Add an empty video (visual) or audio track. Video tracks stack above existing ones; audio tracks go at the bottom.",
    input: S.obj({ kind: S.str("Track kind", { enum: ["video", "audio"] }), name: S.str("Track name") }, ["kind"]),
    run: (p, a) => ops.addTrack(p, createTrack(a.kind === "audio" ? "audio" : "video", String(a.name ?? (a.kind === "audio" ? "Audio" : "Overlay")))),
  },
  {
    name: "update_track",
    description: "Mute, solo, hide, lock, rename, resize, or set the volume or pan of a track.",
    input: S.obj(
      {
        track_id: S.str("Track id"),
        name: S.str("New name"),
        muted: S.bool("Mute the track's sound"),
        hidden: S.bool("Hide the track's picture"),
        locked: S.bool("Prevent edits"),
        volume: S.num("Linear gain, 1 = unchanged", { minimum: 0, maximum: 4 }),
        pan: S.num("-1 left .. 1 right, added to each clip's pan", { minimum: -1, maximum: 1 }),
        solo: S.bool("While any track is soloed, only soloed tracks sound"),
        height: S.str("Row height on the timeline", { enum: ["small", "normal", "large"] }),
      },
      ["track_id"],
    ),
    run: (p, a) => {
      const { track_id, height, ...patch } = a;
      trackOrThrow(p, track_id);
      // "normal" clears the field (undefined is dropped when saved).
      return ops.updateTrack(p, String(track_id), { ...patch, ...(height ? { height: height === "normal" ? undefined : height } : {}) } as Partial<Track>);
    },
  },
  {
    name: "delete_track",
    description: "Remove a track and its clips. The main track stays.",
    input: S.obj({ track_id: S.str("Track id") }, ["track_id"]),
    run: (p, a) => {
      const t = trackOrThrow(p, a.track_id);
      if (t.main) throw new CommandError("the main track cannot be deleted");
      if (t.locked) throw new CommandError("the track is locked");
      return { ...p, tracks: p.tracks.filter((x) => x.id !== t.id) };
    },
  },
  {
    name: "add_media_clip",
    description: "Place an imported asset (video, audio or image) on the timeline. Omit track_id to let the editor choose (main track if free, otherwise an overlay/audio track).",
    input: S.obj(
      {
        asset_id: S.str("Asset id from list_assets"),
        start: S.num("Timeline position in seconds", { minimum: 0 }),
        duration: S.num("Length in seconds; defaults to the whole source (5 s for images)", { minimum: 0.001 }),
        in: S.num("Seconds into the source where the clip begins", { minimum: 0 }),
        track_id: S.str("Track id"),
        mode: S.str("overwrite replaces what is under the clip; insert pushes later clips right", { enum: ["overwrite", "insert"] }),
      },
      ["asset_id", "start"],
    ),
    run: (p, a) => {
      const asset = ops.getAsset(p, String(a.asset_id));
      if (!asset) throw new CommandError(`no asset with id ${a.asset_id}`);
      let clip = clipForAsset(asset, f(p, a.start), p.fps);
      if (a.in !== undefined && "in" in clip) clip = { ...clip, in: Number(a.in) } as Clip;
      const room = ops.roomRight(p, { ...clip, duration: 0 } as Clip);
      const wanted = a.duration !== undefined ? Math.max(1, f(p, a.duration)) : clip.duration;
      clip = { ...clip, duration: Math.max(1, Math.min(wanted, room === Infinity ? wanted : room)) } as Clip;
      const [q, trackId] = landingTrack(p, clip, a.track_id);
      return ops.addClip(q, trackId, clip, a.mode === "insert" ? "insert" : "overwrite");
    },
  },
  {
    name: "add_text",
    description: "Add a text (title) clip. Position x/y are offsets from the canvas center as fractions of its width/height (y=0.35 is near the bottom).",
    input: S.obj(
      {
        text: S.str("The words to show; \\n for line breaks"),
        start: S.num("Seconds", { minimum: 0 }),
        duration: S.num("Seconds", { minimum: 0.001 }),
        x: S.num("Horizontal offset, -0.5..0.5"),
        y: S.num("Vertical offset, -0.5..0.5"),
        style: TEXT_STYLE_SCHEMA,
        track_id: S.str("Track id"),
      },
      ["text", "start", "duration"],
    ),
    run: (p, a) => {
      let clip: Clip = createTextClip(String(a.text), f(p, a.start), Math.max(1, f(p, a.duration)), styleFrom({}, (a.style ?? {}) as Partial<TextStyle>));
      clip = { ...clip, transform: { ...clip.transform, x: Number(a.x ?? 0), y: Number(a.y ?? 0) } };
      const [q, trackId] = landingTrack(p, clip, a.track_id);
      return ops.addClip(q, trackId, clip);
    },
  },
  {
    name: "add_color_clip",
    description: "Add a solid color layer (backgrounds, flashes, title cards).",
    input: S.obj({ color: S.str("CSS color"), start: S.num("Seconds", { minimum: 0 }), duration: S.num("Seconds", { minimum: 0.001 }), track_id: S.str("Track id") }, ["color", "start", "duration"]),
    run: (p, a) => {
      const clip = createColorClip(String(a.color), f(p, a.start), Math.max(1, f(p, a.duration)));
      const [q, trackId] = landingTrack(p, clip, a.track_id);
      return ops.addClip(q, trackId, clip);
    },
  },
  {
    name: "add_adjustment_clip",
    description: "Add an adjustment layer: its color settings, filter and effects apply to every layer below it for its duration.",
    input: S.obj({ start: S.num("Seconds", { minimum: 0 }), duration: S.num("Seconds", { minimum: 0.001 }), track_id: S.str("Track id") }, ["start", "duration"]),
    run: (p, a) => {
      const clip = createAdjustmentClip(f(p, a.start), Math.max(1, f(p, a.duration)));
      const [q, trackId] = landingTrack(p, clip, a.track_id);
      return ops.addClip(q, trackId, clip);
    },
  },
  {
    name: "split",
    description: "Cut clips at a time. Without clip_ids, cuts every clip under that time on unlocked tracks.",
    input: S.obj({ at: S.num("Seconds", { minimum: 0 }), clip_ids: S.ids("Only these clips") }, ["at"]),
    run: (p, a) => ops.splitAt(p, f(p, a.at), a.clip_ids as Id[] | undefined),
  },
  {
    name: "delete_clips",
    description: "Remove clips. ripple=true closes the gaps they leave on their tracks.",
    input: S.obj({ clip_ids: S.ids("Clips to remove"), ripple: S.bool("Close the gaps") }, ["clip_ids"]),
    run: (p, a) => ops.deleteClips(p, a.clip_ids as Id[], a.ripple === true),
  },
  {
    name: "move_clip",
    description: "Move a clip to a time and (optionally) another track of the same kind. Overwrites whatever is under its new position.",
    input: S.obj({ clip_id: S.str("Clip id"), start: S.num("Seconds", { minimum: 0 }), track_id: S.str("Destination track id") }, ["clip_id", "start"]),
    run: (p, a) => {
      const loc = clipOrThrow(p, a.clip_id);
      return ops.moveClip(p, loc.clip.id, String(a.track_id ?? loc.track.id), f(p, a.start));
    },
  },
  {
    name: "trim_clip",
    description: "Move a clip's start or end edge to a time. Limited by the source media and neighbors; ripple=true shifts later clips instead of stopping at them.",
    input: S.obj({ clip_id: S.str("Clip id"), edge: S.str("Which edge", { enum: ["start", "end"] }), to: S.num("Seconds", { minimum: 0 }), ripple: S.bool("Shift later clips") }, ["clip_id", "edge", "to"]),
    run: (p, a) => ops.trimClip(p, clipOrThrow(p, a.clip_id).clip.id, a.edge === "start" ? "start" : "end", f(p, a.to), a.ripple === true),
  },
  {
    name: "set_speed",
    description: "Constant speed for a video or audio clip (2 = twice as fast, 0.5 = slow motion). The clip's length changes; later clips on its track move with it.",
    input: S.obj({ clip_id: S.str("Clip id"), speed: S.num("Multiplier", { minimum: 0.05, maximum: 100 }) }, ["clip_id", "speed"]),
    run: (p, a) => ops.setSpeed(p, clipOrThrow(p, a.clip_id).clip.id, Number(a.speed)),
  },
  {
    name: "set_compressor",
    description:
      "Even out a clip's sound with a compressor after its EQ (CapCut's Enhance voice, Premiere's Dynamics): preset voice (speech; the usual choice), gentle, strong, or off. threshold (dBFS), ratio, knee (dB), attack and release (seconds) and makeup (dB) adjust it. normalize_loudness measures through it, and export loudness reaches its target with far less limiting.",
    input: S.obj(
      {
        clip_ids: S.ids("Video or audio clips"),
        preset: S.str("Starting point", { enum: ["voice", "gentle", "strong", "off"] }),
        threshold: S.num("dBFS where compression starts", { minimum: -60, maximum: 0 }),
        ratio: S.num("dB in over the threshold per dB out", { minimum: 1, maximum: 20 }),
        knee: S.num("Soft knee, dB", { minimum: 0, maximum: 40 }),
        attack: S.num("Seconds", { minimum: 0, maximum: 1 }),
        release: S.num("Seconds", { minimum: 0, maximum: 1 }),
        makeup: S.num("Extra dB after the compressor's own makeup gain (presets: 0)", { minimum: 0, maximum: 24 }),
      },
      ["clip_ids"],
    ),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      const given = Object.fromEntries((["threshold", "ratio", "knee", "attack", "release", "makeup"] as const).filter((k) => a[k] !== undefined).map((k) => [k, Number(a[k])]));
      return ids.reduce(
        (q, id) =>
          ops.updateClip(q, id, (c) => {
            if (c.type !== "video" && c.type !== "audio") throw new CommandError(`${c.type} clips have no sound to compress`);
            if (a.preset === "off") {
              const { compressor: _, ...rest } = c;
              return rest as Clip;
            }
            const base = a.preset ? COMPRESSOR_PRESETS[a.preset as CompressorPreset] : (c.compressor ?? COMPRESSOR_PRESETS.voice);
            return { ...c, compressor: cleanCompressor({ ...base, ...given })! };
          }),
        p,
      );
    },
  },
  {
    name: "set_channel_fill",
    description: "Play one channel of a video's or audio clip's sound on both sides (Premiere's Fill Left / Fill Right), e.g. a lav mic recorded on one channel. both = as recorded.",
    input: S.obj({ clip_ids: S.ids("Video or audio clips"), fill: S.str("Which channel fills both", { enum: ["both", "left", "right"] }) }, ["clip_ids", "fill"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return ids.reduce(
        (q, id) =>
          ops.updateClip(q, id, (c) => {
            if (c.type !== "video" && c.type !== "audio") return c;
            if (a.fill === "left" || a.fill === "right") return { ...c, fill: a.fill };
            const { fill: _, ...rest } = c;
            return rest as Clip;
          }),
        p,
      );
    },
  },
  {
    name: "set_frame_blending",
    description: "Frame blending (Premiere's): a slowed video clip, or one whose source rate differs from the project's, mixes neighboring source frames instead of repeating them, so slow motion looks smoother.",
    input: S.obj({ clip_ids: S.ids("Video clips"), on: S.bool("Blend frames") }, ["clip_ids", "on"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return ids.reduce(
        (q, id) =>
          ops.updateClip(q, id, (c) => {
            if (c.type !== "video") return c;
            if (a.on) return { ...c, frameBlend: true };
            const { frameBlend: _, ...rest } = c;
            return rest as Clip;
          }),
        p,
      );
    },
  },
  {
    name: "set_param",
    description: "Set a numeric clip parameter by path, e.g. opacity (0..1), volume (1 = 0 dB), transform.x / transform.y (canvas fractions from center), transform.scale (1 = fit; the horizontal scale when not uniform), transform.scaleY (vertical scale; setting it makes the scale non-uniform), transform.rotation (degrees), adjust.exposure / adjust.contrast / adjust.saturation / adjust.temperature (-100..100), grade values such as adjust.hsl.red.saturation, adjust.wheels.gain.y (-100..100) and adjust.lut.intensity (0..1). If the path has keyframes, sets a keyframe at `at` instead. Sound fades are frames here; set_fades takes seconds.",
    input: S.obj({ clip_ids: S.ids("Clips"), path: S.str("Parameter path"), value: S.num("New value"), at: S.num("Timeline seconds, for keyframed paths") }, ["clip_ids", "path", "value"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      const loc = ops.findClip(p, ids[0])!;
      const rel = a.at !== undefined ? f(p, a.at) - loc.clip.start : undefined;
      return ops.setParam(p, ids, String(a.path), Number(a.value), rel);
    },
  },
  {
    name: "set_clip_label",
    description: "Color-label clips (Premiere's Label): the timeline paints them with it. \"none\" removes the label.",
    input: S.obj({ clip_ids: S.ids("Clips to label"), label: S.str("A label color, or none", { enum: [...Object.keys(CLIP_LABELS), "none"] }) }, ["clip_ids", "label"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      const label = a.label === "none" ? null : (a.label as ClipLabel);
      if (label !== null && !(label in CLIP_LABELS)) throw new CommandError(`unknown label ${String(a.label)}`);
      return ids.reduce((q, id) => ops.updateClip(q, id, (c) => {
        if (label) return { ...c, labelColor: label } as Clip;
        const { labelColor: _, ...rest } = c;
        return rest as Clip;
      }), p);
    },
  },
  {
    name: "group_clips",
    description: "Group two or more clips so they select, move, copy and delete together (Premiere's Group). They keep their tracks and settings.",
    input: S.obj({ clip_ids: S.ids("Clips, two or more") }, ["clip_ids"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      if (new Set(ids).size < 2) throw new CommandError("a group needs two or more clips");
      return groupClips(p, ids);
    },
  },
  {
    name: "ungroup_clips",
    description: "Break up the groups the given clips belong to.",
    input: S.obj({ clip_ids: S.ids("Clips") }, ["clip_ids"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return ungroupClips(p, ids);
    },
  },
  {
    name: "replace_clip",
    description: "Put another media file of the project in a clip's place (CapCut's Replace): the clip keeps its start, length (shorter only if the new source runs out), transform, effects, animations and sound settings, and plays the new source from its start.",
    input: S.obj({ clip_id: S.str("Video, image or audio clip"), asset_id: S.str("Media in the project") }, ["clip_id", "asset_id"]),
    run: (p, a) => {
      const c = clipOrThrow(p, a.clip_id).clip;
      const asset = p.assets.find((x) => x.id === a.asset_id);
      if (!asset) throw new CommandError(`no media with id ${a.asset_id}`);
      try {
        return replaceClip(p, c.id, asset);
      } catch (e) {
        throw new CommandError((e as Error).message);
      }
    },
  },
  {
    name: "nudge_clips",
    description: "Move clips by whole frames on their tracks (negative is earlier). Nothing moves when a clip would pass the start, cover another clip or sits on a locked track.",
    input: S.obj({ clip_ids: S.ids("Clips"), frames: S.num("Frames to move", { minimum: -100000, maximum: 100000 }) }, ["clip_ids", "frames"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return nudgeClips(p, ids, Math.round(Number(a.frames)));
    },
  },
  {
    name: "lift_range",
    description: "Take a timeline range out of every unlocked track (Premiere's Lift and Extract): clips crossing its edges are cut; ripple=false leaves a gap, ripple=true closes it.",
    input: S.obj({ start: S.num("Seconds", { minimum: 0 }), end: S.num("Seconds", { minimum: 0 }), ripple: S.bool("Close the gap (Extract)") }, ["start", "end"]),
    run: (p, a) => ops.liftRange(p, f(p, a.start), f(p, a.end), a.ripple === true),
  },
  {
    name: "close_gaps",
    description: "Close empty space on a track by rippling later clips left: the gap at `at` seconds, or every gap (packing the track from 0) when `at` is left out.",
    input: S.obj({ track_id: S.str("Track id"), at: S.num("Timeline seconds inside the gap") }, ["track_id"]),
    run: (p, a) => {
      const t = trackOrThrow(p, a.track_id);
      return a.at === undefined ? closeAllGaps(p, t.id) : closeGap(p, t.id, f(p, a.at));
    },
  },
  {
    name: "set_flip",
    description: "Mirror pictures: horizontal flips left-right, vertical flips upside down. A direction left out keeps its state.",
    input: S.obj({ clip_ids: S.ids("Visual clips"), horizontal: S.bool("Flipped left-right"), vertical: S.bool("Flipped upside down") }, ["clip_ids"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return ops.setFlip(p, ids, { horizontal: a.horizontal as boolean | undefined, vertical: a.vertical as boolean | undefined });
    },
  },
  {
    name: "set_blend",
    description: "How a picture mixes with what is under it (the inspector's Blend). screen or add for light leaks, flares and glows shot on black; multiply for textures and paper on white; overlay or softLight for grain and grunge. normal undoes it.",
    input: S.obj({ clip_ids: S.ids("Visual clips"), mode: S.str("Blend mode", { enum: BLEND_MODES.map(([m]) => m) }) }, ["clip_ids", "mode"]),
    run: (p, a) =>
      (a.clip_ids as Id[]).reduce((q, id) => {
        const { clip } = clipOrThrow(q, id);
        if (!("blend" in clip)) throw new CommandError(`${clip.type} clips have no blend mode`);
        return ops.updateClip(q, id, (c) => ({ ...c, blend: a.mode }) as Clip);
      }, p),
  },
  {
    name: "set_chroma_key",
    description: "Key out a color (green or blue screen) so what is below shows through, as CapCut's Chroma key. color is the backdrop's color (#00b140 is studio green); similarity 0..1 (default 0.4) is how close a pixel must be to vanish, smoothness 0..1 (default 0.1) softens edges, spill 0..1 (default 0.5) takes the green cast off the subject. enabled=false turns it off and keeps the settings.",
    input: S.obj(
      {
        clip_ids: S.ids("Video or image clips"),
        color: S.str("Key color, CSS hex"),
        similarity: S.num("0..1", { minimum: 0, maximum: 1 }),
        smoothness: S.num("0..1", { minimum: 0, maximum: 1 }),
        spill: S.num("0..1", { minimum: 0, maximum: 1 }),
        enabled: S.bool("Keying on (default true)"),
      },
      ["clip_ids"],
    ),
    run: (p, a) =>
      (a.clip_ids as Id[]).reduce((q, id) => {
        const { clip } = clipOrThrow(q, id);
        if (clip.type !== "video" && clip.type !== "image") throw new CommandError("Only video and image clips can be keyed");
        const was = clip.chromaKey ?? { enabled: true, color: "#00b140", similarity: 0.4, smoothness: 0.1, spill: 0.5 };
        const num = (k: "similarity" | "smoothness" | "spill") => (a[k] === undefined ? was[k] : Math.max(0, Math.min(1, Number(a[k]))));
        const key = { enabled: a.enabled !== false, color: String(a.color ?? was.color), similarity: num("similarity"), smoothness: num("smoothness"), spill: num("spill") };
        return ops.updateClip(q, id, (c) => ({ ...c, chromaKey: key }) as Clip);
      }, p),
  },
  {
    name: "set_canvas_fill",
    description: "What fills the canvas around a picture that does not cover it (CapCut's Canvas): blur (the clip itself, scaled to cover and blurred; amount 0..100, default 50), color (a solid color), or none. The usual fix for horizontal footage on a vertical canvas without cropping it.",
    input: S.obj(
      {
        clip_ids: S.ids("Video or image clips"),
        fill: S.str("Kind of fill", { enum: ["blur", "color", "none"] }),
        amount: S.num("Blur strength 0..100", { minimum: 0, maximum: 100 }),
        color: S.str("Fill color, CSS hex"),
      },
      ["clip_ids", "fill"],
    ),
    run: (p, a) =>
      (a.clip_ids as Id[]).reduce((q, id) => {
        const { clip } = clipOrThrow(q, id);
        if (clip.type !== "video" && clip.type !== "image") throw new CommandError("Only video and image clips have a canvas fill");
        return ops.updateClip(q, id, (c) => {
          const { canvas: _, ...rest } = c as Clip & { canvas?: unknown };
          if (a.fill === "none") return rest as Clip;
          const canvas = a.fill === "color" ? { type: "color", color: String(a.color ?? "#000000") } : { type: "blur", amount: Math.max(0, Math.min(100, Number(a.amount ?? 50))) };
          return { ...rest, canvas } as Clip;
        });
      }, p),
  },
  {
    name: "set_fades",
    description: "Fade a clip's sound in and out, in SECONDS (a music bed: fade_in 1, fade_out 2). Works on audio clips and on video clips' own sound; a value left out keeps its fade, 0 removes it. Each fade is at most half the clip. Pictures fade with set_animation (slot in or out, type fade).",
    input: S.obj({ clip_ids: S.ids("Audio or video clips"), fade_in: S.num("Seconds", { minimum: 0 }), fade_out: S.num("Seconds", { minimum: 0 }) }, ["clip_ids"]),
    run: (p, a) =>
      (a.clip_ids as Id[]).reduce((q, id) => {
        const { clip } = clipOrThrow(q, id);
        if (!("fadeIn" in clip)) throw new CommandError(`${clip.type} clips have no sound to fade; use set_animation with type fade for pictures`);
        const cap = (v: unknown) => Math.min(Math.floor(clip.duration / 2), Math.max(0, f(q, Number(v))));
        return ops.updateClip(q, id, (c) => ({ ...c, ...(a.fade_in !== undefined ? { fadeIn: cap(a.fade_in) } : {}), ...(a.fade_out !== undefined ? { fadeOut: cap(a.fade_out) } : {}) }) as Clip);
      }, p),
  },
  {
    name: "duplicate_clips",
    description: "Copy clips with everything on them (effects, keyframes, animations, style), the earliest copy starting at `at` seconds (default: right after the last of them ends), each on its own clip's track or a new track above where that is taken. Answers with the copies. The way to repeat a styled title or a lower third.",
    input: S.obj({ clip_ids: S.ids("Clips to copy"), at: S.num("Seconds where the earliest copy starts", { minimum: 0 }) }, ["clip_ids"]),
    run: (p, a) => {
      const found = (a.clip_ids as Id[]).map((id) => clipOrThrow(p, id));
      const origin = Math.min(...found.map((x) => x.clip.start));
      const at = a.at === undefined ? Math.max(...found.map((x) => x.clip.start + x.clip.duration)) : f(p, a.at);
      const copies = regroupCopies(found.map((x) => x.clip));
      return copies.reduce((q, c, i) => ops.placeClip(q, found[i].track.id, { ...c, id: uid("c"), start: at + c.start - origin } as Clip, { collision: "newTrack" }), p);
    },
  },
  {
    name: "set_crop",
    description: `Crop pictures, as CapCut's Crop does. left, top, right and bottom are fractions of the source trimmed from each edge (0 keeps the edge; each pair must leave at least ${MIN_CROP * 100}% of the picture); edges left out keep their value. Or give ratio instead for the largest centered crop of that shape on each clip's source (original: uncropped). The crop is cut from the source before flips, scale and rotation, and the part kept stays where it was.`,
    input: S.obj(
      {
        clip_ids: S.ids("Visual clips"),
        left: S.num("Fraction trimmed from the source's left", { minimum: 0, maximum: 1 - MIN_CROP }),
        top: S.num("Fraction trimmed from the top", { minimum: 0, maximum: 1 - MIN_CROP }),
        right: S.num("Fraction trimmed from the right", { minimum: 0, maximum: 1 - MIN_CROP }),
        bottom: S.num("Fraction trimmed from the bottom", { minimum: 0, maximum: 1 - MIN_CROP }),
        ratio: S.str("Crop to this shape, centered", { enum: CROP_RATIOS.filter((r) => r !== "free") }),
      },
      ["clip_ids"],
    ),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      const edges = Object.fromEntries((["left", "top", "right", "bottom"] as const).filter((k) => a[k] !== undefined).map((k) => [k, Number(a[k])])) as Partial<Crop>;
      for (const id of ids) {
        const { clip } = clipOrThrow(p, id);
        if (!("crop" in clip)) throw new CommandError(`${clip.type} clips have no picture to crop`);
        if (a.ratio === undefined && !validCrop({ ...clip.crop, ...edges })) throw new CommandError(`the crop on ${id} must leave at least ${MIN_CROP * 100}% of the picture each way`);
      }
      if (a.ratio !== undefined) {
        if (Object.keys(edges).length) throw new CommandError("give either edges or a ratio, not both");
        return cropToRatio(p, ids, a.ratio as CropRatio);
      }
      return cropClips(p, ids, edges);
    },
  },
  {
    name: "set_mask",
    description: "CapCut's mask on pictures: shape linear (keeps above a line), mirror (a band), circle, rectangle, heart or star; none removes it. x and y move its center from the picture's center, width and height size it, all as fractions of the visible picture's width and height; rotation in degrees turns it; feather 0..1 softens the edge; radius 0..1 rounds a rectangle's corners; invert keeps the outside. A new mask starts centered at 0.6 of the picture (hearts and stars square). Values left out keep theirs; animated values get a keyframe at `at`.",
    input: S.obj(
      {
        clip_ids: S.ids("Visual clips"),
        shape: S.str("Mask shape", { enum: ["none", ...MASK_SHAPES] }),
        x: S.num("Center offset, fraction of the picture's width", { minimum: -1, maximum: 1 }),
        y: S.num("Center offset, fraction of the picture's height", { minimum: -1, maximum: 1 }),
        width: S.num("Fraction of the picture's width", { minimum: 0.01, maximum: 2 }),
        height: S.num("Fraction of the picture's height", { minimum: 0.01, maximum: 2 }),
        rotation: S.num("Degrees, clockwise", { minimum: -360, maximum: 360 }),
        feather: S.num("Edge softness", { minimum: 0, maximum: 1 }),
        radius: S.num("Rectangle corner roundness", { minimum: 0, maximum: 1 }),
        invert: S.bool("Keep the outside instead"),
        at: S.num("Timeline seconds, for animated values"),
      },
      ["clip_ids"],
    ),
    run: (p, a) => {
      for (const id of a.clip_ids as Id[]) {
        const { clip } = clipOrThrow(p, id);
        if (clip.type === "audio" || clip.type === "adjustment") throw new CommandError(`${clip.type} clips have no picture to mask`);
        if (a.shape === "none") {
          p = ops.updateClip(p, clip.id, (c) => {
            const { mask: _, ...rest } = c as Clip & { mask?: unknown };
            return rest as Clip;
          });
          continue;
        }
        const now = (clip as { mask?: Mask }).mask;
        if (!now && a.shape === undefined) throw new CommandError(`clip ${id} has no mask yet: give a shape`);
        const shape = (a.shape as MaskShape | undefined) ?? now!.shape;
        let mask: Mask = now ? { ...now, shape } : newMask(shape, pictureAspect(p, clip, clip.start));
        if (a.invert !== undefined) mask = { ...mask, invert: a.invert === true };
        p = ops.updateClip(p, clip.id, (c) => ({ ...c, mask }) as Clip);
        const rel = a.at !== undefined ? f(p, a.at) - clip.start : undefined;
        for (const k of ["x", "y", "width", "height", "rotation", "feather", "radius"] as const) {
          if (a[k] !== undefined) p = ops.setParam(p, [clip.id], `mask.${k}`, Number(a[k]), rel);
        }
      }
      return p;
    },
  },
  {
    name: "set_uniform_scale",
    description: "CapCut's Uniform scale switch. false: the vertical scale (transform.scaleY) separates from transform.scale, starting equal; true: it goes and the picture takes transform.scale.",
    input: S.obj({ clip_ids: S.ids("Visual clips"), uniform: S.bool("Scale both directions together") }, ["clip_ids", "uniform"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return ops.setUniformScale(p, ids, a.uniform === true);
    },
  },
  {
    name: "align_clips",
    description: "Align pictures on the canvas, as CapCut's Transform align row does: one clip against the canvas edge or center, several against their combined bounds. left, center and right move horizontally; top, middle and bottom vertically. Animated positions get a keyframe at `at` (default: each clip's first frame).",
    input: S.obj(
      {
        clip_ids: S.ids("Visual clips"),
        align: S.str("Where to align", { enum: ALIGNS }),
        at: S.num("Timeline seconds, for animated positions"),
        margin: S.num("One clip: stop this far inside the canvas edge, a fraction of its size (0.05 is the title-safe inset), so titles of any width share one left edge", { minimum: 0, maximum: 0.4 }),
      },
      ["clip_ids", "align"],
    ),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return alignClips(p, ids, a.align as Align, a.at === undefined ? -Infinity : f(p, a.at), Number(a.margin ?? 0));
    },
  },
  {
    name: "frame_clips",
    description: "Frame pictures on the canvas, centered: fit shows the whole picture, fill covers the canvas and crops the overflow, stretch covers it exactly, ignoring proportions.",
    input: S.obj({ clip_ids: S.ids("Visual clips"), mode: S.str("How to frame", { enum: ["fit", "fill", "stretch"] }), at: S.num("Timeline seconds, for animated scale") }, ["clip_ids", "mode"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return frameClips(p, ids, a.mode as Frame, a.at === undefined ? -Infinity : f(p, a.at));
    },
  },
  {
    name: "distribute_clips",
    description: "Space three or more pictures evenly on the canvas: the outermost two stay, the rest move so the gaps between neighbors are equal.",
    input: S.obj({ clip_ids: S.ids("Visual clips, three or more"), axis: S.str("Direction", { enum: ["horizontal", "vertical"] }), at: S.num("Timeline seconds, for animated positions") }, ["clip_ids", "axis"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      if (ids.length < 3) throw new CommandError("distribute needs three or more clips");
      return distributeClips(p, ids, a.axis as Axis, a.at === undefined ? -Infinity : f(p, a.at));
    },
  },
  {
    name: "add_keyframe",
    description: "Animate a parameter: add a keyframe at a timeline time. Two or more keyframes on a path interpolate between them.",
    input: S.obj(
      {
        clip_id: S.str("Clip id"),
        path: S.str("Parameter path (see set_param)"),
        at: S.num("Timeline seconds"),
        value: S.num("Value at that time"),
        ease: S.str("Curve toward the next keyframe", { enum: ["linear", "hold", "easeIn", "easeOut", "easeInOut"] }),
      },
      ["clip_id", "path", "at", "value"],
    ),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      const key = { f: f(p, a.at) - clip.start, v: Number(a.value), ...(a.ease ? { ease: a.ease as "linear" } : {}) };
      return ops.updateClip(p, clip.id, (c) => ({ ...c, keyframes: { ...c.keyframes, [String(a.path)]: upsertKey(c.keyframes?.[String(a.path)], key) } }));
    },
  },
  {
    name: "set_transition",
    description: "Put a transition on the cut after a clip (the next clip must touch it). type 'none' removes it.",
    input: S.obj({ clip_id: S.str("The clip before the cut"), type: S.str("Transition", { enum: [...Object.keys(TRANSITIONS), "none"] }), duration: S.num("Seconds", { minimum: 0.05 }) }, ["clip_id", "type"]),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      if (a.type === "none") return ops.setTransition(p, clip.id, null);
      return ops.setTransition(p, clip.id, { type: String(a.type), duration: f(p, a.duration ?? 0.5) });
    },
  },
  {
    name: "add_effect",
    description: "Add a video effect to a visual or adjustment clip. params override the effect's defaults. Keep the strobe flash (flash) at 3 flashes a second or slower: faster flashing can trigger seizures (WCAG 2.3.1).",
    input: S.obj({ clip_id: S.str("Clip id"), type: S.str("Effect", { enum: Object.keys(EFFECTS) }), params: { type: "object", description: "Effect parameters" } }, ["clip_id", "type"]),
    run: (p, a) => {
      const { clip, track } = clipOrThrow(p, a.clip_id);
      if (!("effects" in clip)) throw new CommandError(`${clip.type} clips take no video effects`);
      if (track.locked) throw new CommandError("Unlock the track before editing effects");
      const fx: Effect = { id: uid("fx"), type: String(a.type), enabled: true, params: { ...effectDefaults(String(a.type)), ...(a.params ?? {}) as Record<string, number> } };
      return ops.updateClip(p, clip.id, (c) => ({ ...c, effects: [...(c as { effects: Effect[] }).effects, fx] }) as Clip);
    },
  },
  {
    name: "edit_effects",
    description: "Manage a clip's effect stack. Move/reset/remove need effect_id; enable/disable without it affects all effects. Clear removes the entire stack. Reset/remove/clear also remove the affected effect keyframes; other settings stay unchanged.",
    input: S.obj({ clip_id: S.str("Clip id"), action: S.str("Stack action", { enum: [...EFFECT_ACTIONS] }), effect_id: S.str("Effect id from effectStack in describeProject") }, ["clip_id", "action"]),
    run: (p, a) => editEffects(p, String(a.clip_id), a.action as EffectAction, a.effect_id as string | undefined),
  },
  {
    name: "copy_effects",
    description: "Append a source clip's effect stack and effect keyframes to target clips. Each copy gets fresh effect IDs; existing effects, grading, transforms and clip timing stay intact. Animation keeps clip-relative timing, including keys beyond a shorter target's end. Locked or nonvisual targets are rejected.",
    input: S.obj({ source_clip_id: S.str("Clip whose effects to reuse"), clip_ids: S.ids("Target visual or adjustment clip IDs") }, ["source_clip_id", "clip_ids"]),
    run: (p, a) => pasteEffectStack(p, a.clip_ids as string[], copyEffectStack(p, String(a.source_clip_id))),
  },
  {
    name: "set_filter",
    description: "Apply a color look (filter) to a visual or adjustment clip at an intensity 0..1. type 'none' removes it.",
    input: S.obj({ clip_id: S.str("Clip id"), type: S.str("Filter (look)", { enum: [...Object.keys(FILTERS), "none"] }), intensity: S.num("0..1", { minimum: 0, maximum: 1 }) }, ["clip_id", "type"]),
    run: (p, a) =>
      ops.updateClip(p, clipOrThrow(p, a.clip_id).clip.id, (c) => {
        if (!("adjust" in c)) throw new CommandError(`${c.type} clips take no filter`);
        if (a.type === "none") {
          const { filter: _drop, ...rest } = c as Clip & { filter?: unknown };
          return rest as Clip;
        }
        return { ...c, filter: { type: String(a.type), intensity: Number(a.intensity ?? 1) } } as Clip;
      }),
  },
  {
    name: "set_text",
    description: "Change a text clip's words and/or style.",
    input: S.obj({ clip_id: S.str("Text clip id"), text: S.str("New words"), style: TEXT_STYLE_SCHEMA }, ["clip_id"]),
    run: (p, a) =>
      ops.updateClip(p, clipOrThrow(p, a.clip_id).clip.id, (c) => {
        if (c.type !== "text") throw new CommandError("not a text clip");
        const style = styleFrom(c.style, (a.style ?? {}) as Partial<TextStyle>) as TextStyle;
        return { ...c, ...(a.text !== undefined ? { text: String(a.text) } : {}), style };
      }),
  },
  {
    name: "set_animation",
    description: "Set a clip's intro (in), outro (out) or looping (loop) animation, e.g. fadeIn, zoomIn, slideUp. type 'none' clears it.",
    input: S.obj({ clip_id: S.str("Clip id"), slot: S.str("Which animation", { enum: ["in", "out", "loop"] }), type: S.str("Animation", { enum: [...Object.keys(ANIMATIONS), "none"] }), duration: S.num("Seconds", { minimum: 0.05 }) }, ["clip_id", "slot", "type"]),
    run: (p, a) => {
      const key = a.slot === "in" ? "animIn" : a.slot === "out" ? "animOut" : "animLoop";
      return ops.updateClip(p, clipOrThrow(p, a.clip_id).clip.id, (c) => {
        if (!("transform" in c)) throw new CommandError(`${c.type} clips do not animate`);
        const next = { ...c } as Record<string, unknown>;
        if (a.type === "none") delete next[key];
        else next[key] = { type: String(a.type), duration: Math.max(1, f(p, a.duration ?? 0.5)) };
        return next as unknown as Clip;
      });
    },
  },
  {
    name: "detach_audio",
    description: "Move a video clip's sound to its own audio clip (for J/L cuts or separate audio edits).",
    input: S.obj({ clip_id: S.str("Video clip id") }, ["clip_id"]),
    run: (p, a) => ops.detachAudio(p, clipOrThrow(p, a.clip_id).clip.id),
  },
  {
    name: "sync_to_clip",
    description:
      "Move a clip (a separately recorded sound) into sync with another (the camera clip of the same take), given where their sources line up: source second t of to_clip_id plays with source second t + offset of clip_id. Exact to the sample: the in-point takes up what a whole frame cannot; sound that would fall before 0 is trimmed off its head; a taken spot puts it on a new track. mute_reference sets to_clip_id's volume to 0. sync_audio finds the offset by waveform.",
    input: S.obj(
      {
        clip_id: S.str("The clip to move: usually an audio clip"),
        to_clip_id: S.str("The clip it syncs to: usually the camera's video"),
        offset: S.num("Seconds: clip_id's source time minus to_clip_id's for the same moment"),
        mute_reference: S.bool("Silence to_clip_id's own sound (default false)"),
      },
      ["clip_id", "to_clip_id", "offset"],
    ),
    run: (p, a) => {
      const problem = syncProblem(p, String(a.clip_id), String(a.to_clip_id));
      if (problem) throw new CommandError(problem);
      return syncClip(p, String(a.clip_id), String(a.to_clip_id), Number(a.offset), a.mute_reference === true);
    },
  },
  {
    name: "freeze_frame",
    description: "Insert a still of the frame at a time inside a video clip, pushing the rest of the track right.",
    input: S.obj({ clip_id: S.str("Video clip id"), at: S.num("Timeline seconds"), duration: S.num("Seconds to hold", { minimum: 0.04 }) }, ["clip_id", "at"]),
    run: (p, a) => ops.freezeFrame(p, clipOrThrow(p, a.clip_id).clip.id, f(p, a.at), Math.max(1, f(p, a.duration ?? 3))),
  },
  {
    name: "add_marker",
    description: "Drop a marker at a time (chapters, beats, notes).",
    input: S.obj({ at: S.num("Seconds", { minimum: 0 }), label: S.str("Text"), color: S.str("CSS color") }, ["at"]),
    run: (p, a) => ops.addMarker(p, createMarker(f(p, a.at), String(a.label ?? ""), a.color ? String(a.color) : undefined)),
  },
  {
    name: "update_marker",
    description: "Edit a timeline marker's position, label or color without moving clips. Times are seconds.",
    input: S.obj({ marker_id: S.str("Marker id"), at: S.num("Timeline seconds", { minimum: 0 }), label: S.str("Text"), color: S.str("CSS color") }, ["marker_id"]),
    run: (p, a) => updateMarker(p, String(a.marker_id), {
      ...(a.at !== undefined ? { frame: f(p, a.at) } : {}),
      ...(a.label !== undefined ? { label: String(a.label) } : {}),
      ...(a.color !== undefined ? { color: String(a.color) } : {}),
    }),
  },
  {
    name: "delete_markers",
    description: "Delete the specified timeline markers together. Unknown ids reject the whole edit.",
    input: S.obj({ marker_ids: S.ids("Marker ids") }, ["marker_ids"]),
    run: (p, a) => deleteMarkers(p, a.marker_ids as Id[]),
  },
  {
    name: "replace_caption_text",
    description: "Find and replace in every caption's text (CapCut's caption Find and replace), e.g. to fix a name speech recognition misspelled. Any case unless match_case; whole_word skips matches inside longer words.",
    input: S.obj({ find: S.str("Text to find"), replace: S.str("Replacement (may be empty)"), match_case: S.bool("Match case"), whole_word: S.bool("Whole words only") }, ["find", "replace"]),
    run: (p, a) => {
      const o = { matchCase: a.match_case === true, wholeWord: a.whole_word === true };
      return {
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.type !== "text" || !c.caption) return c;
            const [text, n] = replaceText(c.text, String(a.find), String(a.replace), o);
            return n ? { ...c, text } : c;
          }),
        })),
      };
    },
  },
  {
    name: "set_caption_look",
    description: "Give every caption one of the built-in looks (CapCut's caption templates): classic, yellow (bold yellow capitals), boxed, pop (capitals with the spoken word highlighted), neon or minimal. Sets the whole caption style and its height; words and timings stay.",
    input: S.obj({ look: S.str("Look", { enum: Object.keys(CAPTION_LOOKS) }) }, ["look"]),
    run: (p, a) => {
      if (!p.tracks.some((t) => t.clips.some((c) => c.type === "text" && c.caption))) throw new CommandError("There are no captions yet: add_captions, or generate them in the Captions tab, first");
      return applyCaptionLook(p, String(a.look));
    },
  },
  {
    name: "add_captions",
    description: "Add captions (subtitles) as caption text clips on a Captions track. Times are timeline seconds. replace=true removes existing captions first. Captions export as SRT/VTT and restyle together.",
    input: S.obj(
      {
        captions: {
          type: "array",
          description: "The captions, in order",
          items: S.obj({ start: S.num("Seconds", { minimum: 0 }), end: S.num("Seconds", { minimum: 0 }), text: S.str("Words shown"), words: { type: "array", items: { type: "number" }, description: "Seconds each word of text starts, for the spoken-word highlight" } }, ["start", "end", "text"]),
        },
        style: TEXT_STYLE_SCHEMA,
        y: S.num("Vertical offset from center as a canvas fraction; 0.36 sits near the bottom"),
        replace: S.bool("Remove existing captions first"),
      },
      ["captions"],
    ),
    run: (p, a) => addCaptions(p, a.captions as Caption[], styleFrom({}, (a.style ?? {}) as Partial<TextStyle>), a.y === undefined ? undefined : Number(a.y), a.replace === true),
  },
  {
    name: "cut_ranges",
    description:
      "Remove parts of a video or audio clip. Ranges are SOURCE seconds (seconds into the clip's media file, the way silence detection and transcripts report them; describeProject lists each media clip's in/out), so one list stays valid however the clip is cut. ripple (default true) closes the gaps; a detached audio clip lined up with it is cut too. The primitive behind silence and filler removal.",
    input: S.obj(
      {
        clip_id: S.str("Video or audio clip id"),
        ranges: {
          type: "array",
          description: "Source ranges to remove; overlaps merge, parts outside the clip are ignored",
          items: S.obj({ start: S.num("Source seconds", { minimum: 0 }), end: S.num("Source seconds", { minimum: 0 }) }, ["start", "end"]),
        },
        ripple: S.bool("Close the gaps (default true)"),
      },
      ["clip_id", "ranges"],
    ),
    run: (p, a) => {
      const { clip, track } = clipOrThrow(p, a.clip_id);
      if (!ops.isTimed(clip) || clip.freeze) throw new CommandError(`${clip.type} clips have no source to cut`);
      if (track.locked) throw new CommandError(`track ${track.name} is locked`);
      return cutRanges(p, clip.id, a.ranges as SourceRange[], a.ripple !== false).project;
    },
  },
  {
    name: "split_at_times",
    description:
      "Split a video or audio clip at several SOURCE times (seconds into its media file, the way scene detection reports them). Times on or outside the clip's edges are ignored; a detached audio clip lined up with it splits too. For a cut at a timeline time use split.",
    input: S.obj({ clip_id: S.str("Video or audio clip id"), times: { type: "array", items: { type: "number", minimum: 0 }, description: "Source seconds" } }, ["clip_id", "times"]),
    run: (p, a) => {
      const { clip, track } = clipOrThrow(p, a.clip_id);
      if (!ops.isTimed(clip) || clip.freeze) throw new CommandError(`${clip.type} clips have no source to split by`);
      if (track.locked) throw new CommandError(`track ${track.name} is locked`);
      return splitAtSourceTimes(p, clip.id, a.times as number[]);
    },
  },
  {
    name: "add_markers",
    description: "Drop several markers at once at TIMELINE seconds (beats, scene cuts, chapters). A time that already has a marker with the same label is skipped, so running a detector twice does not double its markers.",
    input: S.obj(
      {
        times: { type: "array", items: { type: "number", minimum: 0 }, description: "Timeline seconds" },
        label: S.str("Text for every marker"),
        color: S.str("CSS color"),
      },
      ["times"],
    ),
    run: (p, a) => {
      const label = String(a.label ?? "");
      const taken = new Set(p.markers.filter((m) => m.label === label).map((m) => m.frame));
      const fresh = [...new Set((a.times as number[]).map((t) => f(p, t)))].filter((fr) => !taken.has(fr));
      if (!fresh.length) return p;
      const added = fresh.map((fr) => createMarker(fr, label, a.color ? String(a.color) : undefined));
      return { ...p, markers: [...p.markers, ...added].sort((x, y) => x.frame - y.frame) };
    },
  },
  // ---- epic edits (lib/epic.ts): music-synced montages in a few calls ----
  {
    name: "cut_to_beats",
    description:
      "Cut a montage to the music in one call: lay shots end to end on the main track so every cut lands on the beat grid. The grid is the Beat markers (mark_beats or analyze_music), Bar or Phrase markers (grid bars or phrases, from analyze_music with markers [\"bars\"] or [\"phrases\"]), or beats: your own timeline seconds. Each shot lasts `every` grid steps (default 2 beats, or 1 bar or phrase), or the steps in `pattern` in turn ([4, 4, 2, 2, 1, 1] speeds up), or its own `beats`. The first shot starts at `start`; when no grid point is there, the first one after it counts as beat one, so an intro stays inside the first shot. A shot reads its media from `in` (default: where the last shot of the same file ended, so one long clip gives many different shots), slid back inside the file if it would run past the end; media too short for its slot ends on an earlier grid point. Stops when the shots or the grid run out, or at `end`; clips already there are overwritten. Video shots are muted (mute false keeps their sound). Example: {\"media\": [{\"asset_id\": \"a_1\"}, {\"asset_id\": \"a_2\", \"in\": 3}, {\"asset_id\": \"a_1\", \"beats\": 4}], \"pattern\": [2, 2, 1, 1]}.",
    input: S.obj(
      {
        media: {
          type: "array",
          description: "The shots in order; the same asset may appear many times",
          items: S.obj(
            {
              asset_id: S.str("Video or picture asset id (import_media)"),
              in: S.num("Source seconds the shot starts at (default: where this media's previous shot ended, else 0)", { minimum: 0 }),
              beats: { type: "integer", minimum: 1, description: "Grid steps this shot lasts, overriding pattern and every" },
            },
            ["asset_id"],
          ),
        },
        grid: S.str("Which markers make the grid: beats (Beat, default), bars or downbeats (Bar: each bar's first beat), phrases (Phrase: every 4 bars)", { enum: ["beats", "bars", "downbeats", "phrases"] }),
        beats: { type: "array", items: { type: "number", minimum: 0 }, description: "The grid as timeline seconds instead of markers, e.g. analyze_music's downbeats" },
        marker_label: S.str("Use the markers with this label as the grid instead"),
        every: { type: "integer", minimum: 1, maximum: 64, description: "Grid steps per shot (default 2 for beats, 1 for bars or phrases)" },
        pattern: { type: "array", items: { type: "integer", minimum: 1, maximum: 64 }, description: "Grid steps per shot, cycling: [4, 4, 2, 2, 1, 1]" },
        start: S.num("Timeline seconds the first shot starts (default 0)", { minimum: 0 }),
        end: S.num("Timeline seconds to stop by: no cut after it", { minimum: 0 }),
        track_id: S.str("A video track instead of the main track"),
        mute: S.bool("Mute the shots' own sound (default true: the music carries a montage)"),
      },
      ["media"],
    ),
    run: (p, a) => epic(() => cutToBeats(p, a as unknown as CutToBeats)),
  },
  {
    name: "add_beat_hits",
    description: `Punch up beats with short hits: flash (blown out to white), zoom (a zoom punch), shake (camera shake), rgb_split, glow or zoom_blur, several at once as one layer (["flash", "zoom"]). Each hit is an adjustment layer on a Hits track above the footage (below bars and titles), at its peak on the beat and easing out over \`duration\` (default ${HIT_KINDS.flash.seconds} to ${HIT_KINDS.shake.seconds} s by effect), keyframed, so preview and export match. Times: \`times\` (timeline seconds), the main track's cuts (at_cuts true), or the Beat markers (or marker_label's, e.g. Bar or Drop), between from and to, thinned to every Nth. intensity 0..1 (default 1, strong). Photosensitivity: flashes keep to at most ${MAX_FLASHES_PER_SECOND} in any second (WCAG 2.3.1); a beat that would break that gets its other effects without the flash, or nothing. Example: {"effects": ["zoom", "rgb_split"], "marker_label": "Bar"}.`,
    input: S.obj({
      effect: S.str("One hit", { enum: Object.keys(HIT_KINDS) }),
      effects: { type: "array", items: S.str("Hit", { enum: Object.keys(HIT_KINDS) }), description: "Several hits on each beat, as one layer" },
      times: { type: "array", items: { type: "number", minimum: 0 }, description: "Timeline seconds of the hits" },
      at_cuts: S.bool("Hit every cut of the main track instead"),
      marker_label: S.str("Hit the markers with this label (default Beat)"),
      every: { type: "integer", minimum: 1, maximum: 64, description: "Only every Nth time, from the first (default 1)" },
      from: S.num("Timeline seconds: no hit before", { minimum: 0 }),
      to: S.num("Timeline seconds: no hit at or after", { minimum: 0 }),
      duration: S.num("Seconds each hit lasts", { minimum: 0.04, maximum: 2 }),
      intensity: S.num("0..1, default 1", { minimum: 0, maximum: 1 }),
    }),
    run: (p, a) => {
      const kinds = [...(a.effect !== undefined ? [a.effect] : []), ...((a.effects as string[] | undefined) ?? [])] as HitKind[];
      return epic(() => addBeatHits(p, { ...(a as object), effects: kinds } as BeatHits));
    },
  },
  {
    name: "add_cinematic_bars",
    description:
      "Cinematic bars: letterbox the picture to a wide ratio, 2.39 (scope, default), 2.35, 2 or 1.85 (pillarboxed when the canvas is already wider), on any canvas shape. An adjustment layer with the letterbox effect on a Bars track above the footage and hits, below titles, from start (default 0) to end (default the picture's end); animate_in and animate_out slide the bars in and out over that many seconds. Calling it again over the same time replaces the bars. Example: {\"ratio\": 2.39, \"start\": 4.0, \"animate_in\": 0.4}.",
    input: S.obj({
      ratio: S.num("Width over height of the picture left between the bars (default 2.39)", { minimum: 1, maximum: 4 }),
      start: S.num("Timeline seconds (default 0)", { minimum: 0 }),
      end: S.num("Timeline seconds (default the end of the picture)", { minimum: 0 }),
      animate_in: S.num("Seconds the bars take to slide in (default 0: there at once)", { minimum: 0, maximum: 10 }),
      animate_out: S.num("Seconds they take to slide out at the end (default 0)", { minimum: 0, maximum: 10 }),
    }),
    run: (p, a) => epic(() => addCinematicBars(p, a as CinematicBars)),
  },
  {
    name: "set_speed_ramp",
    description: `Velocity edit: ramp a video clip's speed so its slow-motion moment (moment slow, default) or its fast moment (fast) lands exactly on a beat at \`at\` (timeline seconds; default the Beat marker nearest the clip's middle). The clip keeps its start and length, so cuts made on the beat stay there; the ramp reads more or less of the media instead (the in-point moves earlier when the file would run out). Without a preset: speed ${CURVE_MIN}..${CURVE_MAX} at the moment (default 0.3 slow, 3 fast), base elsewhere (default 2 slow, 1 fast), easing over \`ease\` seconds (default 0.12) into the beat and holding \`hold\` seconds (default 0.25). Or preset (montage, hero, bullet, jumpCut, flashIn, flashOut): its slowest (or fastest) point is moved onto the beat. set_speed_curve ramps a whole clip without aligning it. Example: {"clip_id": "c_5", "at": 3.75}.`,
    input: S.obj(
      {
        clip_id: S.str("Video or audio clip id"),
        at: S.num("Timeline seconds of the beat, inside the clip", { minimum: 0 }),
        moment: S.str("Which moment lands on the beat", { enum: ["slow", "fast"] }),
        speed: S.num("Speed at the moment", { minimum: CURVE_MIN, maximum: CURVE_MAX }),
        base: S.num("Speed before and after it", { minimum: CURVE_MIN, maximum: CURVE_MAX }),
        hold: S.num("Seconds the moment holds after the beat", { minimum: 0, maximum: 10 }),
        ease: S.num("Seconds the speed takes to change into and out of the moment", { minimum: 0.02, maximum: 5 }),
        preset: S.str("A ready-made ramp to align instead", { enum: Object.keys(PRESETS).filter((k) => k !== "custom") }),
      },
      ["clip_id"],
    ),
    run: (p, a) => epic(() => setSpeedRamp(p, a as unknown as SpeedRamp)),
  },
  {
    name: "fit_music",
    description:
      "Fit a music clip to the cut. With drop_at, first slide the music so its drop plays at drop_at (timeline seconds): drop is where the drop plays now (analyze_music's drop; default the Drop marker on the clip), anything that would fall before 0 is cut off, and its Beat, Bar, Phrase and section markers move with it. Then end it with the picture (end video, default), on the last Beat or Bar marker before the picture ends (end beat or bar), or at end_at, fading out over fade_out seconds (default 1). trim_picture cuts the picture there too, so both stop together. Align the drop before cut_to_beats: the cuts follow the markers. Example: {\"clip_id\": \"c_2\", \"drop_at\": 4.0, \"end\": \"bar\", \"fade_out\": 1.5}.",
    input: S.obj(
      {
        clip_id: S.str("The music clip (audio, or a video's sound)"),
        drop_at: S.num("Timeline seconds the drop should land on", { minimum: 0 }),
        drop: S.num("Timeline seconds where the drop plays now (default the Drop marker on the clip)", { minimum: 0 }),
        end: S.str("Where the music ends: video (the picture's end, default), beat or bar (the last Beat or Bar marker before it)", { enum: ["video", "beat", "bar"] }),
        end_at: S.num("Timeline seconds to end at instead", { minimum: 0 }),
        fade_out: S.num("Seconds of fade-out (default 1)", { minimum: 0, maximum: 30 }),
        fade_in: S.num("Seconds of fade-in (default unchanged)", { minimum: 0, maximum: 30 }),
        trim_picture: S.bool("Also cut the picture (every video track) at the music's end"),
      },
      ["clip_id"],
    ),
    run: (p, a) => epic(() => fitMusic(p, a as unknown as FitMusic)),
  },
  {
    name: "move_keyframe",
    description: "Retime a keyframe and/or change its value. at is the keyframe's current timeline time, to the new one (seconds). It stays inside the clip and replaces a keyframe already at its new time on that path.",
    input: S.obj(
      {
        clip_id: S.str("Clip id"),
        path: S.str("Parameter path (see set_param)"),
        at: S.num("Timeline seconds of the keyframe now"),
        to: S.num("Timeline seconds to move it to"),
        value: S.num("New value"),
      },
      ["clip_id", "path", "at"],
    ),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      if (a.to === undefined && a.value === undefined) throw new CommandError("give to, value or both");
      const path = String(a.path);
      const ref = { path, f: f(p, a.at) - clip.start };
      if (!liveRefs(clip.keyframes, [ref]).length) throw new CommandError(`no ${path} keyframe at ${a.at}s on clip ${clip.id}`);
      let keys = clip.keyframes!;
      let at = ref;
      if (a.to !== undefined) ({ keys, refs: [at] } = retimeKey(keys, ref, f(p, a.to) - clip.start, clip.duration));
      if (a.value !== undefined) keys = setValues(keys, [at], () => Number(a.value));
      return ops.updateClip(p, clip.id, (c) => ({ ...c, keyframes: keys }));
    },
  },
  {
    name: "set_keyframe_ease",
    description: `Shape the curve leaving keyframes toward the next one. ease is a preset (${EASE_IDS.join(", ")}); bezier [x1, y1, x2, y2] is a CSS cubic-bezier (x in 0..1, y may overshoot) and overrides it. Without path, applies to every parameter keyed at that time; without at, to every keyframe on the path(s).`,
    input: S.obj(
      {
        clip_id: S.str("Clip id"),
        path: S.str("Parameter path; omit for all keyed parameters"),
        at: S.num("Timeline seconds of the keyframe; omit for all keyframes"),
        ease: S.str("Preset name", { enum: EASE_IDS }),
        bezier: { type: "array", items: { type: "number" }, description: "[x1, y1, x2, y2]" },
      },
      ["clip_id"],
    ),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      let e: Ease | undefined = a.ease !== undefined ? easeById(String(a.ease)) : undefined;
      if (a.bezier !== undefined) {
        const b = a.bezier as number[];
        if (b.length !== 4 || b[0] < 0 || b[0] > 1 || b[2] < 0 || b[2] > 1) throw new CommandError("bezier must be [x1, y1, x2, y2] with x1 and x2 in 0..1");
        e = [b[0], b[1], b[2], b[3]];
      }
      if (!e) throw new CommandError("give ease or bezier");
      const refs = keyRefs(p, clip, a.path, a.at === undefined ? undefined : [Number(a.at)]);
      return ops.updateClip(p, clip.id, (c) => ({ ...c, keyframes: setEase(c.keyframes!, refs, e) }));
    },
  },
  {
    name: "remove_keyframes",
    description: "Remove keyframes from a clip. at lists timeline times in seconds (omit for every time); path limits it to one parameter (omit for all). A parameter left with no keyframes goes back to its static value.",
    input: S.obj(
      {
        clip_id: S.str("Clip id"),
        path: S.str("Parameter path; omit for all keyed parameters"),
        at: { type: "array", items: { type: "number" }, description: "Timeline seconds of the keyframes to remove" },
      },
      ["clip_id"],
    ),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      const refs = keyRefs(p, clip, a.path, a.at as number[] | undefined);
      return ops.updateClip(p, clip.id, (c) => ({ ...c, keyframes: removeKeys(c.keyframes, refs) }));
    },
  },
  // ---- color grade (ADR-020): static values; animate with add_keyframe on the paths named ----
  {
    name: "set_hsl",
    description: "Adjust one of CapCut's eight HSL color ranges on a visual or adjustment clip; only pixels of that color change. hue turns the range up to 30° toward its neighbors, saturation -100 makes it gray, lightness darkens or lightens it; each -100..100, omitted values stay. band 'all' sets every range. reset=true zeroes the band(s) first. Animate with add_keyframe on adjust.hsl.<band>.hue|saturation|lightness.",
    input: S.obj(
      {
        clip_id: S.str("Visual or adjustment clip id"),
        band: S.str("Color range", { enum: [...HSL_BANDS, "all"] }),
        hue: S.num("-100..100", { minimum: -100, maximum: 100 }),
        saturation: S.num("-100..100", { minimum: -100, maximum: 100 }),
        lightness: S.num("-100..100", { minimum: -100, maximum: 100 }),
        reset: S.bool("Zero the band(s) before applying the values given"),
      },
      ["clip_id", "band"],
    ),
    run: (p, a) =>
      editGrade(p, a.clip_id, (adj) => {
        const hsl = { ...adj.hsl };
        for (const band of a.band === "all" ? HSL_BANDS : [a.band as HslBand]) {
          const cur = a.reset ? { hue: 0, saturation: 0, lightness: 0 } : { hue: 0, saturation: 0, lightness: 0, ...hsl[band] };
          const next = { hue: Number(a.hue ?? cur.hue), saturation: Number(a.saturation ?? cur.saturation), lightness: Number(a.lightness ?? cur.lightness) };
          if (next.hue || next.saturation || next.lightness) hsl[band] = next;
          else delete hsl[band];
        }
        return withPart(adj, "hsl", Object.keys(hsl).length ? hsl : undefined);
      }),
  },
  {
    name: "set_curve",
    description: "Set a tone curve on a visual or adjustment clip. channel luma maps R, G and B alike (Lumetri's white curve); r, g, b are per channel. points are [input, output] pairs in 0..1, joined by a monotone cubic that never overshoots; include [0,0] and [1,1] to pin the ends. Omit points or pass [] to reset the channel. Gentle S-curve: [[0,0],[0.25,0.2],[0.75,0.8],[1,1]].",
    input: S.obj(
      {
        clip_id: S.str("Visual or adjustment clip id"),
        channel: S.str("Which curve", { enum: [...CURVE_CHANNELS] }),
        points: { type: "array", description: "[input, output] pairs, each 0..1", items: { type: "array", items: { type: "number", minimum: 0, maximum: 1 } } },
      },
      ["clip_id", "channel"],
    ),
    run: (p, a) => {
      const raw = (a.points ?? []) as number[][];
      if (raw.some((pt) => pt.length !== 2)) throw new CommandError("each point is [input, output]");
      const pts = cleanCurve(raw);
      if (raw.length && !pts) throw new CommandError("a curve needs at least two points with different inputs");
      return editGrade(p, a.clip_id, (adj) => {
        const curves = { ...adj.curves };
        const ch = a.channel as CurveChannel;
        if (!pts || isIdentityCurve(pts)) delete curves[ch];
        else curves[ch] = pts;
        return withPart(adj, "curves", Object.keys(curves).length ? curves : undefined);
      });
    },
  },
  {
    name: "set_color_wheel",
    description: "Resolve-style color wheels on a visual or adjustment clip: lift (shadows; white stays put), gamma (midtones), gain (highlights; black stays put), offset (everything). y is the wheel's luminance ring; r/g/b its color balance; each -100..100. Or give hue (degrees: 0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta) and amount (0..100) to push the balance toward a color, e.g. lift hue 200 amount 12 for teal shadows. reset=true returns the wheel to neutral first. Animate with add_keyframe on adjust.wheels.<wheel>.r|g|b|y.",
    input: S.obj(
      {
        clip_id: S.str("Visual or adjustment clip id"),
        wheel: S.str("Which wheel", { enum: [...WHEELS] }),
        r: S.num("Red balance, -100..100", { minimum: -100, maximum: 100 }),
        g: S.num("Green balance, -100..100", { minimum: -100, maximum: 100 }),
        b: S.num("Blue balance, -100..100", { minimum: -100, maximum: 100 }),
        y: S.num("Luminance, -100..100", { minimum: -100, maximum: 100 }),
        hue: S.num("Push the balance toward this hue, degrees", { minimum: 0, maximum: 360 }),
        amount: S.num("How far toward hue, 0..100 (default 20)", { minimum: 0, maximum: 100 }),
        reset: S.bool("Neutral before applying the values given"),
      },
      ["clip_id", "wheel"],
    ),
    run: (p, a) =>
      editGrade(p, a.clip_id, (adj) => {
        const name = a.wheel as WheelName;
        const w = a.reset ? { r: 0, g: 0, b: 0, y: 0 } : { r: 0, g: 0, b: 0, y: 0, ...adj.wheels?.[name] };
        if (a.hue !== undefined || a.amount !== undefined) {
          const bal = puckToBalance(...hueToPuck(Number(a.hue ?? 0), Number(a.amount ?? 20)));
          Object.assign(w, { r: +bal.r.toFixed(2), g: +bal.g.toFixed(2), b: +bal.b.toFixed(2) });
        }
        for (const k of ["r", "g", "b", "y"] as const) if (a[k] !== undefined) w[k] = Number(a[k]);
        const wheels = { ...adj.wheels };
        if (w.r || w.g || w.b || w.y) wheels[name] = w;
        else delete wheels[name];
        return withPart(adj, "wheels", Object.keys(wheels).length ? wheels : undefined);
      }),
  },
  {
    name: "set_background_removal",
    description:
      "Turn Remove background on or off for video clips that already have a background matte (the person stays, everything behind them becomes see-through, so lower tracks show). The remove_background tool (window.videoEditor.ai.removeBackground) makes the matte on this machine; turning it off keeps the matte, so turning it back on is instant.",
    input: S.obj({ clip_ids: S.ids("Video clips"), enabled: S.bool("On or off") }, ["clip_ids", "enabled"]),
    run: (p, a) =>
      (a.clip_ids as Id[]).reduce((q, id) => {
        const c = clipOrThrow(q, id).clip;
        if (c.type !== "video") throw new CommandError(`clip ${id} is a ${c.type} clip; Remove background works on video clips`);
        if (!c.cutout) throw new CommandError(`clip ${id} has no background matte yet; make one with the remove_background tool (window.videoEditor.ai.removeBackground)`);
        return ops.setCutout(q, id, { ...c.cutout, enabled: a.enabled === true });
      }, p),
  },
  {
    name: "apply_lut",
    description: "Apply a .cube LUT to a visual or adjustment clip, mixed in at intensity 0..1 (default 1). lut_id is from the project's luts (describeProject lists them; files are imported with window.videoEditor.importLuts or by dropping a .cube on the app). lut_id 'none' removes it. Animate with add_keyframe on adjust.lut.intensity.",
    input: S.obj({ clip_id: S.str("Visual or adjustment clip id"), lut_id: S.str("LUT id, or 'none'"), intensity: S.num("0..1", { minimum: 0, maximum: 1 }) }, ["clip_id", "lut_id"]),
    run: (p, a) => {
      if (a.lut_id !== "none" && !p.luts?.some((l) => l.id === a.lut_id)) throw new CommandError(`no LUT with id ${a.lut_id}; import the .cube first`);
      return editGrade(p, a.clip_id, (adj) =>
        withPart(adj, "lut", a.lut_id === "none" ? undefined : { id: String(a.lut_id), intensity: Number(a.intensity ?? (adj.lut?.id === a.lut_id ? adj.lut!.intensity : 1)) }),
      );
    },
  },
  {
    name: "add_sticker",
    description:
      "Add a sticker from the built-in library (emoji, or drawn arrows, circles, underlines, bubbles, badges) as an image overlay above everything at that time. name is a sticker id, label or the emoji itself: 'fire', 'thumbs-up', 'curved-arrow-red', 'circle-yellow', 'subscribe', '🎉'. window.videoEditor.stickers() lists them; window.videoEditor.exec draws the sticker's image before placing it.",
    input: S.obj(
      {
        name: S.str("Sticker id, label or emoji"),
        start: S.num("Seconds", { minimum: 0 }),
        duration: S.num("Seconds; default 3", { minimum: 0.04 }),
        x: S.num("Horizontal offset from center, -0.5..0.5"),
        y: S.num("Vertical offset from center, -0.5..0.5"),
        scale: S.num("1 = fit the canvas; default 0.3", { minimum: 0.01 }),
        motion: S.str("Entrance and loop animation", { enum: Object.keys(STICKER_MOTIONS) }),
      },
      ["name", "start"],
    ),
    run: (p, a) => {
      const s = findSticker(String(a.name));
      if (!s) {
        const near = searchStickers(String(a.name)).slice(0, 8).map((x) => x.id);
        throw new CommandError(`no sticker named ${a.name}${near.length ? `; close: ${near.join(", ")}` : ""}`);
      }
      // The picture is media the engine draws (ADR-006: that lives one layer
      // up); automation adds the asset in the same undo step, then runs this.
      const asset = p.assets.find((x) => x.sticker === s.id);
      if (!asset) throw new CommandError(`sticker ${s.id} has no image in this project yet: run add_sticker through window.videoEditor.exec, which draws it first`);
      const num = (v: unknown) => (v === undefined ? undefined : Number(v));
      return addStickerClip(p, asset, {
        start: f(p, a.start),
        duration: a.duration === undefined ? undefined : Math.max(1, f(p, a.duration)),
        motion: a.motion === undefined ? undefined : String(a.motion),
        x: num(a.x),
        y: num(a.y),
        scale: num(a.scale),
      }).project;
    },
  },
  {
    name: "add_text_template",
    description: `Add a text template: a title design of text and box layers with in/out/loop animations, stacked above everything at that time. Templates: ${Object.entries(TEXT_TEMPLATES)
      .filter(([, t]) => t.category === "Templates")
      .map(([k]) => k)
      .join(", ")}. Word art (one styled text): ${Object.entries(TEXT_TEMPLATES)
      .filter(([, t]) => t.category === "Word art")
      .map(([k]) => k)
      .join(", ")}. texts replaces the template's words, text layers in order (bottom first).`,
    input: S.obj({ name: S.str("Template key or label"), start: S.num("Seconds", { minimum: 0 }), texts: { type: "array", items: { type: "string" }, description: "Words for the text layers, in order" } }, ["name", "start"]),
    run: (p, a) => {
      const hit = findTemplate(String(a.name));
      if (!hit) throw new CommandError(`no text template named ${a.name}`);
      const texts = (a.texts ?? []) as string[];
      let i = 0;
      const t = { ...hit[1], layers: hit[1].layers.map((l) => (l.text !== undefined && i < texts.length ? { ...l, text: texts[i++] } : l)) };
      return addTemplate(p, t, f(p, a.start)).project;
    },
  },
  {
    name: "apply_word_art",
    description: "Restyle text clips with a word-art look (fill, stroke, shadow, box), keeping their words, size and position. name is a Word art key from add_text_template.",
    input: S.obj({ clip_ids: S.ids("Text clips"), name: S.str("Word art key or label") }, ["clip_ids", "name"]),
    run: (p, a) => {
      const hit = findTemplate(String(a.name));
      if (!hit || hit[1].category !== "Word art") throw new CommandError(`no word art named ${a.name}`);
      for (const id of a.clip_ids as Id[]) {
        p = ops.updateClip(p, clipOrThrow(p, id).clip.id, (c) => {
          if (c.type !== "text") throw new CommandError(`${id} is not a text clip`);
          return { ...c, style: wordArtStyle(c.style, hit[1]) };
        });
      }
      return p;
    },
  },
  {
    name: "set_speed_curve",
    description:
      "Ramp a video or audio clip's speed (CapCut's Curve speed): a preset, or points over the clip with t from 0 (its start) to 1 (its end) and speed 0.1..10. The rate changes smoothly (exponentially) between points. The clip keeps its source range, so its length becomes source length / mean speed and later clips on its track move. preset 'none' returns to the constant speed.",
    input: S.obj(
      {
        clip_id: S.str("Video or audio clip id"),
        preset: S.str("A ready-made ramp", { enum: ["none", ...Object.keys(PRESETS)] }),
        points: {
          type: "array",
          description: "Speed points across the clip; used when no preset is given",
          items: S.obj({ t: S.num("0 = clip start, 1 = clip end", { minimum: 0, maximum: 1 }), speed: S.num("Rate there", { minimum: CURVE_MIN, maximum: CURVE_MAX }) }, ["t", "speed"]),
        },
      },
      ["clip_id"],
    ),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      if (!ops.isTimed(clip)) throw new CommandError(`${clip.type} clips have no speed`);
      if (clip.type === "compound" && a.preset !== "none") throw new CommandError("compound clips take a constant speed only; ramp the clips inside with edit_compound");
      if (a.preset === "none") return ops.setSpeedCurve(p, clip.id, null);
      if (a.preset !== undefined) return ops.setSpeedCurve(p, clip.id, PRESETS[String(a.preset)].points, String(a.preset));
      const pts = cleanPoints((a.points ?? []) as { t: number; speed: number }[], (x) => x.t);
      if (!pts) throw new CommandError("give a preset or at least one point");
      // Pin the ends so the curve covers the whole clip, holding the end speeds.
      const norm = [...(pts[0].t > 0 ? [{ t: 0, speed: pts[0].speed }] : []), ...pts, ...(pts[pts.length - 1].t < 1 ? [{ t: 1, speed: pts[pts.length - 1].speed }] : [])];
      return ops.setSpeedCurve(p, clip.id, norm, "custom");
    },
  },
  {
    name: "set_reverse",
    description: "Play a video or audio clip backward (reverse=true) or forward again. The clip keeps its length and source range; its sound reverses too.",
    input: S.obj({ clip_id: S.str("Video or audio clip id"), reverse: S.bool("Backward") }, ["clip_id", "reverse"]),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      if (!ops.isTimed(clip)) throw new CommandError(`${clip.type} clips cannot play backward`);
      if (clip.freeze) throw new CommandError("a freeze frame has no direction");
      if (clip.type === "compound") throw new CommandError("compound clips cannot play backward yet; reverse the clips inside with edit_compound");
      return ops.setReverse(p, clip.id, a.reverse === true);
    },
  },
  {
    name: "set_preserve_pitch",
    description: "Keep a sped-up or slowed-down clip's pitch natural (preserve=true, the default) or let it rise and fall with the speed like tape (preserve=false, CapCut's Change pitch).",
    input: S.obj({ clip_id: S.str("Video or audio clip id"), preserve: S.bool("Keep the original pitch") }, ["clip_id", "preserve"]),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      if (!ops.isTimed(clip)) throw new CommandError(`${clip.type} clips have no sound`);
      return ops.setChangePitch(p, [clip.id], a.preserve !== true);
    },
  },
  {
    name: "create_compound_clip",
    description:
      "Put clips into one compound clip (CapCut's Create compound clip, Premiere's Nest), on the lowest of their video tracks, spanning them all. The clips move into a nested timeline (describeProject lists it under compounds) at the same times relative to each other; the compound clip then plays it like a video clip plays a file, and its own transform, opacity, blend, color, effects, speed and volume act on the whole. Needs a clip on a video track, and nothing else on that track inside the span.",
    input: S.obj({ clip_ids: S.ids("Clips to put inside, on any tracks"), name: S.str("Name shown on the clip (default Compound clip N)") }, ["clip_ids"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      const problem = compoundProblem(p, ids);
      if (problem) throw new CommandError(problem);
      return createCompound(p, ids, a.name === undefined ? undefined : String(a.name)).project;
    },
  },
  {
    name: "break_compound_clip",
    description:
      "Break a compound clip apart (Resolve's Decompose in place, CapCut's Undo compound clip): the clips inside go back on this timeline at the frames the compound clip showed them, trimmed to what it showed, on its track and the tracks above. The compound clip's own settings go with it. Needs speed 1.",
    input: S.obj({ clip_id: S.str("Compound clip id") }, ["clip_id"]),
    run: (p, a) => {
      const { clip } = clipOrThrow(p, a.clip_id);
      const problem = breakProblem(p, clip.id);
      if (problem) throw new CommandError(problem);
      return breakCompound(p, clip.id);
    },
  },
  {
    name: "edit_compound",
    description:
      "Run another command inside a compound's nested timeline (compound_id from compounds in describeProject, not the compound clip's id). Clip and track ids, and times, are the nested timeline's own. Every compound clip that plays it shows the change.",
    input: S.obj(
      {
        compound_id: S.str("Compound id"),
        command: S.str("Command to run inside, e.g. move_clip or set_param"),
        args: { type: "object", description: "That command's arguments" },
      },
      ["compound_id", "command"],
    ),
    run: (p, a) => {
      const id = String(a.compound_id);
      if (!ops.findCompound(p, id)) throw new CommandError(`no compound with id ${id}`);
      const view = compoundView(p, id);
      const inside = runCommand(view, String(a.command), a.args ?? {});
      if (inside === view) return p;
      const out = withCompoundView(p, id, inside);
      if (out === p) throw new CommandError("a compound clip cannot contain itself");
      return out;
    },
  },
  {
    name: "rename_compound",
    description: "Rename a compound; every compound clip that plays it shows the new name.",
    input: S.obj({ compound_id: S.str("Compound id"), name: S.str("New name") }, ["compound_id", "name"]),
    run: (p, a) => {
      const id = String(a.compound_id);
      if (!ops.findCompound(p, id)) throw new CommandError(`no compound with id ${id}`);
      return { ...p, compounds: p.compounds!.map((k) => (k.id === id ? { ...k, name: String(a.name) } : k)) };
    },
  },
  {
    name: "frame_region",
    description:
      "Show one part of a video or picture full screen, as a zoom on a screen recording does: region is a rectangle in fractions of the source picture (x, y its top-left corner; {x:0.5,y:0,w:0.5,h:1} is the right half). fill (default) covers the canvas, fit shows all of the region. The picture slides back where it would leave an empty band. With to_region, it moves from the one to the other between from and to (default the whole clip), easing in and out. Replaces the clip's scale and position keyframes.",
    input: S.obj(
      {
        clip_id: S.str("Video or image clip id"),
        region: { ...REGION_SCHEMA, description: "The part of the picture to show (or to start from when to_region is given): fractions, x and y its top-left corner" },
        to_region: { ...REGION_SCHEMA, description: "Where the move ends: the part of the picture shown at `to`" },
        mode: S.str("How the region meets the canvas", { enum: ["fill", "fit"] }),
        from: S.num("Timeline seconds the move starts; default the clip's start"),
        to: S.num("Timeline seconds the move ends; default the clip's end"),
      },
      ["clip_id", "region"],
    ),
    run: (p, a) => {
      const { clip, track } = clipOrThrow(p, a.clip_id);
      if (clip.type !== "video" && clip.type !== "image") throw new CommandError(`${clip.type} clips have no picture to frame`);
      if (track.locked) throw new CommandError(`track ${track.name} is locked`);
      const mode = a.mode === "fit" ? "fit" : "fill";
      const rel = (s: unknown, fallback: number) => (s === undefined ? fallback : Math.max(0, Math.min(clip.duration - 1, f(p, s) - clip.start)));
      const from = rel(a.from, 0), to = rel(a.to, clip.duration - 1);
      if (a.to_region && to <= from) throw new CommandError("to must come after from, inside the clip");
      return frameRegion(p, clip.id, regionOf(a.region), a.to_region ? { region: regionOf(a.to_region), from, to } : undefined, mode);
    },
  },
  {
    name: "batch",
    description:
      "Run several commands in order as one edit (one undo step), all or nothing: set_animation on many clips, a run of add_keyframe, a whole title sequence. Each step sees what the steps before it did; a failing step names its number and nothing changes.",
    input: S.obj(
      {
        commands: {
          type: "array",
          description: "The steps, in order",
          items: S.obj({ command: S.str("Command name, e.g. set_animation"), args: { type: "object", description: "That command's arguments" } }, ["command"]),
        },
      },
      ["commands"],
    ),
    run: (p, a) =>
      (a.commands as { command: string; args?: unknown }[]).reduce((q, step, i) => {
        // add_sticker draws its picture outside the registry first.
        if (step.command === "batch" || step.command === "add_sticker") throw new CommandError(`step ${i + 1}: ${step.command} cannot run inside a batch`);
        try {
          return runCommand(q, step.command, step.args ?? {});
        } catch (e) {
          throw new CommandError(`step ${i + 1} (${step.command}): ${e instanceof Error ? e.message : e}`);
        }
      }, p),
  },
];

/** The keyframes a command names: on `path` (or every path) at the given
 * timeline seconds (or every time). Throws when that is none at all. */
function keyRefs(p: Project, clip: Clip, path: unknown, at: number[] | undefined): KeyRef[] {
  const map = clip.keyframes ?? {};
  const paths = path === undefined ? Object.keys(map) : [String(path)];
  const frames = at && new Set(at.map((s) => f(p, s) - clip.start));
  const refs = paths.flatMap((pt) => (map[pt] ?? []).filter((k) => !frames || frames.has(k.f)).map((k) => ({ path: pt, f: k.f })));
  if (!refs.length) throw new CommandError(`no matching keyframes on clip ${clip.id}`);
  return refs;
}

type Graded = Adjust & Grade;

/** Edit a clip's adjust (its grade) or refuse clips that have none. */
function editGrade(p: Project, clipId: unknown, fn: (a: Graded) => Graded): Project {
  return ops.updateClip(p, clipOrThrow(p, clipId).clip.id, (c) => {
    if (!("adjust" in c)) throw new CommandError(`${c.type} clips take no color grade`);
    return { ...c, adjust: fn(c.adjust) } as Clip;
  });
}

/** Set or remove one optional part of a grade. */
function withPart<K extends keyof Grade>(a: Graded, key: K, value: Grade[K] | undefined): Graded {
  const next = { ...a, [key]: value };
  if (value === undefined) delete next[key];
  return next;
}

export const COMMAND_INDEX = new Map(COMMANDS.map((c) => [c.name, c]));

/** Run one command with validation. Throws CommandError with every problem. */
export function runCommand(p: Project, name: string, args: unknown = {}): Project {
  const cmd = COMMAND_INDEX.get(name);
  if (!cmd) throw new CommandError(`unknown command ${name}`);
  const errs = validate(args, cmd.input);
  if (errs.length) throw new CommandError(errs.join("; "));
  return cmd.run(p, args as Record<string, unknown>);
}

/** A compact, LLM-readable view of the timeline: seconds, ids, what is where. */
export function describeProject(p: Project) {
  const s = (frames: number) => +framesToSeconds(frames, p.fps).toFixed(3);
  return {
    name: p.name,
    canvas: { width: p.width, height: p.height },
    fps: +(p.fps.num / p.fps.den).toFixed(3),
    duration: s(ops.projectDuration(p)),
    assets: p.assets.map((a) => ({ id: a.id, kind: a.kind, name: a.name, duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio })),
    tracks: p.tracks.map(track),
    markers: p.markers.map((m) => ({ id: m.id, frame: m.frame, at: s(m.frame), label: m.label, color: m.color })),
    ...(p.luts?.length ? { luts: p.luts.map((l) => ({ id: l.id, name: l.name, kind: l.kind, size: l.size })) } : {}),
    // Nested timelines, described like the project's (times their own).
    ...(p.compounds?.length
      ? { compounds: p.compounds.map((k) => ({ id: k.id, name: k.name, duration: s(ops.timelineEnd(k.tracks)), tracks: k.tracks.map(track), ...(k.markers.length ? { markers: k.markers.map((m) => ({ id: m.id, at: s(m.frame), label: m.label })) } : {}) })) }
      : {}),
  };
  function track(t: Track) {
    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      ...(t.main ? { main: true } : {}),
      ...(t.muted ? { muted: true } : {}),
      ...(t.hidden ? { hidden: true } : {}),
      ...(t.locked ? { locked: true } : {}),
      ...(t.solo ? { solo: true } : {}),
      ...(t.volume !== 1 ? { volume: +t.volume.toFixed(4) } : {}),
      ...(t.pan ? { pan: t.pan } : {}),
      clips: t.clips.map((c) => ({
        id: c.id,
        type: c.type,
        start: s(c.start),
        end: s(c.start + c.duration),
        ...("assetId" in c ? { asset: c.assetId } : {}),
        ...("in" in c ? { in: +c.in.toFixed(3), out: +ops.sourceTimeAt(c, c.start + c.duration, p.fps).toFixed(3), speed: c.speedCurve ? undefined : c.speed, speed_curve: c.speedCurve ? (c.speedCurve.preset ?? "custom") : undefined } : {}),
        ...("reverse" in c && c.reverse ? { reverse: true } : {}),
        ...("changePitch" in c && c.changePitch ? { change_pitch: true } : {}),
        ...(c.type === "text" ? { text: c.text } : {}),
        ...(c.type === "compound" ? { compound: c.compoundId } : {}),
        ...("volume" in c && c.volume !== 1 ? { volume: +c.volume.toFixed(4) } : {}),
        ...("fadeIn" in c && c.fadeIn ? { fade_in: s(c.fadeIn) } : {}),
        ...("fadeOut" in c && c.fadeOut ? { fade_out: s(c.fadeOut) } : {}),
        ...("transitionOut" in c && c.transitionOut ? { transition: c.transitionOut.type } : {}),
        ...("effects" in c && c.effects.length ? { effects: c.effects.map((e) => e.type), effectStack: c.effects.map(({ id, type, enabled }) => ({ id, type, enabled })) } : {}),
        ...("adjust" in c ? gradeSummary(c.adjust) : {}),
        ...(c.type === "video" && c.cutout ? { removeBackground: c.cutout.enabled } : {}),
        // What else departs from the defaults, so an agent can check its work.
        ...(c.labelColor ? { label: c.labelColor } : {}),
        ...("pan" in c && c.pan ? { pan: c.pan } : {}),
        ...("fill" in c && c.fill ? { fill: c.fill } : {}),
        ...("eq" in c && c.eq ? { eq: c.eq } : {}),
        ...("compressor" in c && c.compressor ? { compressor: compressorPreset(c.compressor) } : {}),
        ...(c.type === "video" && c.frameBlend ? { frame_blend: true } : {}),
        ...("blend" in c && c.blend !== "normal" ? { blend: c.blend } : {}),
        ...((c.type === "video" || c.type === "image") && c.chromaKey?.enabled ? { chroma_key: c.chromaKey.color } : {}),
        ...((c.type === "video" || c.type === "image") && c.canvas ? { canvas_fill: c.canvas.type } : {}),
        ...(c.type === "text" && c.style.case ? { case: c.style.case } : {}),
        ...(c.type === "text" ? { size: c.style.size, color: c.style.color, ...(c.style.background ? { box: c.style.background.color } : {}) } : {}),
        ...("transform" in c ? placement(c.transform) : {}),
        ...("opacity" in c && c.opacity !== 1 ? { opacity: +c.opacity.toFixed(3) } : {}),
        ...("animIn" in c && (c.animIn || c.animOut || c.animLoop)
          ? { animation: { ...(c.animIn ? { in: c.animIn.type } : {}), ...(c.animOut ? { out: c.animOut.type } : {}), ...(c.animLoop ? { loop: c.animLoop.type } : {}) } }
          : {}),
        ...(c.keyframes && Object.values(c.keyframes).some((k) => k.length) ? { keyframed: Object.keys(c.keyframes).filter((k) => c.keyframes![k].length) } : {}),
      })),
    };
  }
}

/** Where a picture sits, when not centered at its fitted size, for
 * describeProject: the values at rest (keyframed paths say so apart). */
function placement(t: Transform) {
  const r = (v: number) => +v.toFixed(4);
  const out = {
    ...(t.x ? { x: r(t.x) } : {}),
    ...(t.y ? { y: r(t.y) } : {}),
    ...(t.scale !== 1 ? { scale: r(t.scale) } : {}),
    ...(t.scaleY !== undefined ? { scale_y: r(t.scaleY) } : {}),
    ...(t.rotation ? { rotation: r(t.rotation) } : {}),
  };
  return Object.keys(out).length ? { transform: out } : {};
}

/** Which grade parts a clip uses, for describeProject. */
function gradeSummary(a: Graded) {
  const parts = (["hsl", "curves", "wheels"] as const).filter((k) => a[k]);
  // The Basic sliders that are not at zero (exposure, temperature...).
  const basic = Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === "number" && v !== 0));
  return {
    ...(Object.keys(basic).length ? { adjust: basic } : {}),
    ...(parts.length ? { grade: parts } : {}),
    ...(a.lut ? { lut: { id: a.lut.id, intensity: a.lut.intensity } } : {}),
  };
}

/** Frame <-> second helpers re-exported for automation callers. */
export const toFrame = (p: Project, seconds: number) => frameAt(seconds, p.fps);

/** The look CapCut's auto captions start with: bold white, black outline,
 * low on the frame, narrower than titles so lines wrap early. */
export const CAPTION_STYLE: Partial<TextStyle> = { size: 64, bold: true, color: "#ffffff", stroke: { color: "#000000", width: 6 }, maxWidth: 0.84, lineHeight: 1.15 };

/** Place captions on one Captions track (created on top if needed). */
export function addCaptions(p: Project, caps: Caption[], style: Partial<TextStyle> = {}, y = 0.36, replace = false): Project {
  if (replace) {
    p = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !(c.type === "text" && c.caption)) })) };
    p = ops.pruneEmptyTracks(p);
  }
  let track = p.tracks.find((t) => t.kind === "video" && t.clips.length > 0 && t.clips.every((c) => c.type === "text" && c.caption));
  if (!track) {
    track = createTrack("video", "Captions");
    p = ops.addTrack(p, track, 0);
  }
  let lastEnd = 0;
  for (const cap of [...caps].sort((a, b) => a.start - b.start)) {
    const start = Math.max(secondsToFrames(cap.start, p.fps), lastEnd);
    const end = Math.max(start + 1, secondsToFrames(cap.end, p.fps));
    lastEnd = end;
    const text = createTextClip(cap.text, start, end - start, { ...CAPTION_STYLE, ...style });
    const clip: Clip = {
      ...text,
      caption: true,
      transform: { ...text.transform, y },
      ...(cap.words?.length ? { wordTimes: cap.words.map((s) => Math.max(0, secondsToFrames(s, p.fps) - start)) } : {}),
    };
    p = ops.addClip(p, track.id, clip);
  }
  return p;
}
