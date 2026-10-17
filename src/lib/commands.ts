// The command registry: every edit an agent can make, by name, with a JSON
// Schema for its arguments (ADR-006). One surface serves the in-app AI
// copilot (as LLM tool definitions), the automation API, recipes/pipelines,
// and a future MCP server, which only has to list these and forward calls.
//
// Times in command arguments are SECONDS (what people and LLMs think in);
// they snap to the nearest project frame. The project JSON itself stores
// frames (ADR-004) — describeProject reports both.

import { frameAt, framesToSeconds, secondsToFrames } from "./time";
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
import type { Adjust, Clip, Crop, Ease, Effect, Grade, HslBand, Id, Mask, Project, TextStyle, Track, WheelName } from "./project/types";
import { ANIMATIONS, EFFECTS, FILTERS, TRANSITIONS, effectDefaults } from "./catalog";
import { copyEffectStack, editEffects, EFFECT_ACTIONS, pasteEffectStack, type EffectAction } from "./effectStack";
import { upsertKey } from "./keyframes";
import { CURVE_MAX, CURVE_MIN, PRESETS, cleanPoints } from "./speed";
import { cleanCurve, CURVE_CHANNELS, isIdentityCurve, type CurveChannel } from "./curves";
import { HSL_BANDS, hueToPuck, puckToBalance, WHEELS } from "./grade";
import { EASE_IDS, easeById, liveRefs, removeKeys, retimeKey, setEase, setValues, type KeyRef } from "./keyframeEdit";
import type { Caption } from "./captions";
import { cutRanges, splitAtSourceTimes, type SourceRange } from "./project/cut";
import { addStickerClip, findSticker, searchStickers, STICKER_MOTIONS } from "./stickers";
import { addTemplate, findTemplate, TEXT_TEMPLATES, wordArtStyle } from "./templates";
import { deleteMarkers, updateMarker } from "./markers";
import { relinkAsset } from "./project/relink";
import { closeAllGaps, closeGap, nudgeClips } from "./project/gaps";
import { replaceClip } from "./project/replace";
import { groupClips, ungroupClips } from "./project/groups";
import { editFolder, organizeMedia } from "./project/mediaOrganization";
import { applyEffectPreset } from "./effectPresets";
import { ATTRIBUTE_GROUPS, copyAttributes, pasteAttributes, type AttributeGroup } from "./attributes";
import { alignClips, ALIGNS, distributeClips, frameClips, pictureAspect, type Align, type Axis, type Frame } from "./align";
import { MASK_SHAPES, newMask, type MaskShape } from "./mask";
import { cropClips, cropToRatio, CROP_RATIOS, MIN_CROP, validCrop, type CropRatio } from "./crop";

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

// ---- schema helpers ------------------------------------------------------------

const S = {
  str: (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "string", description, ...extra }),
  num: (description: string, extra: Partial<JsonSchema> = {}): JsonSchema => ({ type: "number", description, ...extra }),
  bool: (description: string): JsonSchema => ({ type: "boolean", description }),
  ids: (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description }),
  obj: (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
    type: "object",
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
  const free = p.tracks.find((t) => t.kind === kind && !t.main && !t.locked && ops.rangeFree(t, clip.start, clip.duration));
  if (free) return [p, free.id];
  const fresh = createTrack(kind, kind === "audio" ? "Audio" : "Overlay");
  return [ops.addTrack(p, fresh), fresh.id];
}

const TEXT_STYLE_SCHEMA = S.obj({
  font: S.str("Font family"),
  size: S.num("Pixels at 1080p canvas height", { minimum: 4 }),
  color: S.str("CSS color"),
  bold: S.bool("Bold"),
  italic: S.bool("Italic"),
  align: S.str("Alignment", { enum: ["left", "center", "right"] }),
});

// ---- the registry ------------------------------------------------------------------

export const COMMANDS: Command[] = [
  {
    name: "paste_attributes",
    description: "Copy selected groups from a source clip to targets. Replaces those settings/keyframes; effects append by default. Keeps timing/source offsets and respects locks.",
    input: S.obj({ source_clip_id: S.str("Source clip"), clip_ids: S.ids("Target clips"), groups: { type: "array", items: S.str("Group", { enum: [...ATTRIBUTE_GROUPS] }) }, replace_effects: S.bool("Replace target effect stacks") }, ["source_clip_id", "clip_ids", "groups"]),
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
    }),
    run: (p, a) => ({
      ...p,
      ...(a.name !== undefined ? { name: String(a.name) } : {}),
      ...(a.width !== undefined ? { width: Number(a.width), canvasFixed: true } : {}),
      ...(a.height !== undefined ? { height: Number(a.height), canvasFixed: true } : {}),
      ...(a.background !== undefined ? { background: String(a.background) } : {}),
    }),
  },
  {
    name: "add_track",
    description: "Add an empty video (visual) or audio track. Video tracks stack above existing ones; audio tracks go at the bottom.",
    input: S.obj({ kind: S.str("Track kind", { enum: ["video", "audio"] }), name: S.str("Track name") }, ["kind"]),
    run: (p, a) => ops.addTrack(p, createTrack(a.kind === "audio" ? "audio" : "video", String(a.name ?? (a.kind === "audio" ? "Audio" : "Overlay")))),
  },
  {
    name: "update_track",
    description: "Mute, solo, hide, lock, rename, resize or set the volume of a track.",
    input: S.obj(
      {
        track_id: S.str("Track id"),
        name: S.str("New name"),
        muted: S.bool("Mute the track's sound"),
        hidden: S.bool("Hide the track's picture"),
        locked: S.bool("Prevent edits"),
        volume: S.num("Linear gain, 1 = unchanged", { minimum: 0, maximum: 4 }),
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
      let clip: Clip = createTextClip(String(a.text), f(p, a.start), Math.max(1, f(p, a.duration)), (a.style ?? {}) as Partial<TextStyle>);
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
    name: "set_param",
    description: "Set a numeric clip parameter by path, e.g. opacity (0..1), volume (1 = 0 dB), transform.x / transform.y (canvas fractions from center), transform.scale (1 = fit; the horizontal scale when not uniform), transform.scaleY (vertical scale; setting it makes the scale non-uniform), transform.rotation (degrees), adjust.exposure / adjust.contrast / adjust.saturation / adjust.temperature (-100..100), grade values such as adjust.hsl.red.saturation, adjust.wheels.gain.y (-100..100) and adjust.lut.intensity (0..1). If the path has keyframes, sets a keyframe at `at` instead.",
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
    input: S.obj({ clip_ids: S.ids("Visual clips"), align: S.str("Where to align", { enum: ALIGNS }), at: S.num("Timeline seconds, for animated positions") }, ["clip_ids", "align"]),
    run: (p, a) => {
      const ids = a.clip_ids as Id[];
      ids.forEach((id) => clipOrThrow(p, id));
      return alignClips(p, ids, a.align as Align, a.at === undefined ? -Infinity : f(p, a.at));
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
    description: "Add a video effect to a visual or adjustment clip. params override the effect's defaults.",
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
        return { ...c, ...(a.text !== undefined ? { text: String(a.text) } : {}), style: { ...c.style, ...((a.style ?? {}) as Partial<TextStyle>) } };
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
    name: "add_captions",
    description: "Add captions (subtitles) as caption text clips on a Captions track. Times are timeline seconds. replace=true removes existing captions first. Captions export as SRT/VTT and restyle together.",
    input: S.obj(
      {
        captions: {
          type: "array",
          description: "The captions, in order",
          items: S.obj({ start: S.num("Seconds", { minimum: 0 }), end: S.num("Seconds", { minimum: 0 }), text: S.str("Words shown") }, ["start", "end", "text"]),
        },
        style: TEXT_STYLE_SCHEMA,
        y: S.num("Vertical offset from center as a canvas fraction; 0.36 sits near the bottom"),
        replace: S.bool("Remove existing captions first"),
      },
      ["captions"],
    ),
    run: (p, a) => addCaptions(p, a.captions as Caption[], { ...((a.style ?? {}) as Partial<TextStyle>) }, a.y === undefined ? undefined : Number(a.y), a.replace === true),
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
    tracks: p.tracks.map((t) => ({
      id: t.id,
      kind: t.kind,
      name: t.name,
      ...(t.main ? { main: true } : {}),
      ...(t.muted ? { muted: true } : {}),
      ...(t.hidden ? { hidden: true } : {}),
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
        ...("volume" in c && c.volume !== 1 ? { volume: +c.volume.toFixed(4) } : {}),
        ...("transitionOut" in c && c.transitionOut ? { transition: c.transitionOut.type } : {}),
        ...("effects" in c && c.effects.length ? { effects: c.effects.map((e) => e.type), effectStack: c.effects.map(({ id, type, enabled }) => ({ id, type, enabled })) } : {}),
        ...("adjust" in c ? gradeSummary(c.adjust) : {}),
      })),
    })),
    markers: p.markers.map((m) => ({ id: m.id, frame: m.frame, at: s(m.frame), label: m.label, color: m.color })),
    ...(p.luts?.length ? { luts: p.luts.map((l) => ({ id: l.id, name: l.name, kind: l.kind, size: l.size })) } : {}),
  };
}

/** Which grade parts a clip uses, for describeProject. */
function gradeSummary(a: Graded) {
  const parts = (["hsl", "curves", "wheels"] as const).filter((k) => a[k]);
  return {
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
    let clip: Clip = { ...createTextClip(cap.text, start, end - start, { ...CAPTION_STYLE, ...style }), caption: true };
    clip = { ...clip, transform: { ...clip.transform, y } } as Clip;
    p = ops.addClip(p, track.id, clip);
  }
  return p;
}
