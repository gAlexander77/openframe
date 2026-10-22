import { FADE_CURVES } from "./types";
import { cleanMask } from "../mask";
import { normalizePlaybackProxy } from "../proxyPolicy";
import { cleanRuns } from "../textRuns";
// Factories for every project object, and `normalizeProject`, the trust
// boundary for project JSON. Whatever comes in — a file saved by an older
// version, a hand-written agent script with half the fields missing — leaves
// as a complete, valid Project or as an error naming what is wrong.

import { normalizeBrand } from "../brandKit";
import { effectDefaults } from "../catalog";
import { cleanCompressor } from "../compressor";
import { cleanSoundFx, FX_KEYS, VOICE_PRESETS } from "../soundFx";
import { cleanGrade } from "../grade";
import { cleanPoints } from "../speed";
import { cleanShape } from "../shapes";
import { cleanShadow } from "../shadow";
import { cleanBorder } from "../border";
import { cleanWeight } from "../textLook";
import { keyColor } from "../textAnim";
import { cleanTrackMatte, dropDanglingMattes } from "../trackMatte";
import { cleanWiggle } from "../wiggle";
import { secondsToFrames, type Rational } from "../time";
import type {
  Adjust,
  AdjustmentClip,
  Asset,
  AudioClip,
  Clip,
  ColorClip,
  Compound,
  CompoundClip,
  Crop,
  ImageClip,
  LutFile,
  Marker,
  MusicGrid,
  MusicPart,
  Project,
  Sound,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  TrackRole,
  Transform,
  VideoClip,
  Visual,
} from "./types";

/** Every stem an audio track can be (Track.role). */
export const TRACK_ROLES: TrackRole[] = ["dialog", "music", "effects", "ambience"];

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
};

export const DEFAULT_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export const DEFAULT_ADJUST: Adjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  hue: 0,
  fade: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
};

export const DEFAULT_SOUND: Sound = {
  volume: 1,
  pan: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: "Inter",
  size: 96,
  color: "#ffffff",
  bold: true,
  italic: false,
  underline: false,
  align: "center",
  lineHeight: 1.2,
  letterSpacing: 0,
  stroke: { color: "#000000", width: 0 },
  maxWidth: 0.9,
};

function visual(): Visual {
  return {
    transform: { ...DEFAULT_TRANSFORM },
    opacity: 1,
    blend: "normal",
    crop: { ...DEFAULT_CROP },
    adjust: { ...DEFAULT_ADJUST },
    effects: [],
  };
}

/** Image clips default to the length CapCut gives them. */
export const DEFAULT_STILL_SECONDS = 5;
// ponytail: module state, as setTextMeasure is: the viewer's preference
// (src/state/prefs.ts) without threading it through every caller.
let stillSeconds = DEFAULT_STILL_SECONDS;
export const setStillSeconds = (s: number) => void (stillSeconds = s);

export function createTrack(kind: TrackKind, name: string, main = false): Track {
  return {
    id: uid("t"),
    kind,
    name,
    ...(main ? { main: true } : {}),
    clips: [],
    muted: false,
    hidden: false,
    locked: false,
    volume: 1,
  };
}

export interface ProjectInit {
  name?: string;
  width?: number;
  height?: number;
  fps?: Rational;
}

export function createProject(init: ProjectInit = {}): Project {
  const now = Date.now();
  return {
    schema: 1,
    id: uid("p"),
    name: init.name ?? "Untitled project",
    width: init.width ?? 1920,
    height: init.height ?? 1080,
    fps: init.fps ?? { num: 30, den: 1 },
    // A size given up front is a choice (a Home preset).
    ...(init.width || init.height ? { canvasFixed: true } : {}),
    sampleRate: 48000,
    background: "#000000",
    assets: [],
    tracks: [createTrack("video", "Main", true)],
    markers: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** A clip for an asset at `start`, as long as the source allows. */
export function clipForAsset(asset: Asset, start: number, fps: Rational): Clip {
  const full = Math.max(1, secondsToFrames(asset.duration, fps));
  if (asset.kind === "image") {
    const clip: ImageClip = {
      id: uid("c"),
      type: "image",
      assetId: asset.id,
      start,
      duration: asset.animated ? full : secondsToFrames(stillSeconds, fps),
      ...visual(),
    };
    return clip;
  }
  if (asset.kind === "audio") {
    const clip: AudioClip = {
      id: uid("c"),
      type: "audio",
      assetId: asset.id,
      start,
      // A sound's last fraction of a frame is its tail (a shutter's ring,
      // a pop's decay): its clip runs to the frame that holds its end. The
      // nearest frame cut 0.25 s to 0.233 at 30 fps (ADR-113).
      duration: Math.max(1, Math.ceil((asset.duration * fps.num) / fps.den - 1e-6)),
      in: 0,
      speed: 1,
      ...DEFAULT_SOUND,
    };
    return clip;
  }
  const clip: VideoClip = {
    id: uid("c"),
    type: "video",
    assetId: asset.id,
    start,
    duration: full,
    in: 0,
    speed: 1,
    ...visual(),
    ...DEFAULT_SOUND,
    muted: !asset.hasAudio,
  };
  return clip;
}

export function createTextClip(
  text: string,
  start: number,
  duration: number,
  style: Partial<TextStyle> = {},
): TextClip {
  return {
    id: uid("c"),
    type: "text",
    text,
    start,
    duration,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
    ...visual(),
  };
}

export function createColorClip(color: string, start: number, duration: number): ColorClip {
  return { id: uid("c"), type: "color", color, start, duration, ...visual() };
}

export function createAdjustmentClip(start: number, duration: number): AdjustmentClip {
  return {
    id: uid("c"),
    type: "adjustment",
    start,
    duration,
    opacity: 1,
    adjust: { ...DEFAULT_ADJUST },
    effects: [],
  };
}

/** A clip playing compound `compoundId` from its start, at 1x. */
export function createCompoundClip(compoundId: string, start: number, duration: number): CompoundClip {
  return { id: uid("c"), type: "compound", compoundId, start, duration, in: 0, speed: 1, ...visual(), ...DEFAULT_SOUND };
}

export function createMarker(frame: number, label = "", color = "#3be0f0"): Marker {
  return { id: uid("m"), frame, label, color };
}

// ---- normalize -------------------------------------------------------------

export class ProjectError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const VISUAL_TYPES = new Set(["video", "image", "text", "color", "compound"]);

/** Set an optional field, or remove it when its cleaned value is absent. */
function optional(c: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) delete c[key];
  else c[key] = value;
}
const CLIP_TYPES = new Set(["video", "audio", "image", "text", "color", "adjustment", "compound"]);

/** Effects as saved, each parameter it was saved without at its default:
 * one added later (a glow's radius, ADR-117) keeps the look it had. */
const cleanEffects = (raw: unknown) =>
  Array.isArray(raw) ? raw.map((e) => (isObj(e) && typeof e.type === "string" && isObj(e.params) ? { ...e, params: { ...effectDefaults(e.type), ...e.params } } : e)) : [];

/** Basic sliders defaulted, grade parts cleaned, the LUT reference checked. */
function normalizeAdjust(raw: unknown, where: string, lutIds: Set<string>) {
  const a = cleanGrade({ ...DEFAULT_ADJUST, ...(isObj(raw) ? raw : {}) }) as unknown as Visual["adjust"];
  if (a.lut && !lutIds.has(a.lut.id)) throw new ProjectError(`${where}: lut ${a.lut.id} is not in luts`);
  return a;
}

function normalizeClip(raw: unknown, where: string, lutIds: Set<string>): Clip {
  if (!isObj(raw)) throw new ProjectError(`${where}: clip must be an object`);
  const type = raw.type;
  if (typeof type !== "string" || !CLIP_TYPES.has(type)) {
    throw new ProjectError(`${where}: unknown clip type ${JSON.stringify(type)}`);
  }
  const c = { ...raw } as Record<string, unknown>;
  c.id = typeof c.id === "string" && c.id ? c.id : uid("c");
  c.start = Math.max(0, Math.round(num(c.start, 0)));
  c.duration = Math.max(1, Math.round(num(c.duration, 1)));
  if (VISUAL_TYPES.has(type)) {
    const base = visual();
    c.transform = { ...base.transform, ...(isObj(c.transform) ? c.transform : {}) };
    const crop = { ...base.crop, ...(isObj(c.crop) ? c.crop : {}) };
    if (crop.feather !== undefined) {
      if (typeof crop.feather === "number" && Number.isFinite(crop.feather) && crop.feather >= 0) crop.feather = Math.min(1080, crop.feather);
      else delete crop.feather;
    }
    c.crop = crop;
    c.adjust = normalizeAdjust(c.adjust, where, lutIds);
    c.opacity = num(c.opacity, 1);
    c.blend = typeof c.blend === "string" ? c.blend : "normal";
    c.effects = cleanEffects(c.effects);
    // Graphics (ADR-056 to ADR-059, ADR-062): optional, and a malformed one is
    // dropped rather than refused, so the clip still plays.
    optional(c, "trackMatte", cleanTrackMatte(c.trackMatte));
    const mb = isObj(c.motionBlur) ? num(c.motionBlur.shutter, 180) : 0;
    optional(c, "motionBlur", mb > 0 ? { shutter: Math.min(720, mb) } : undefined);
    optional(c, "edge", c.edge === "mirror" || c.edge === "repeat" ? c.edge : undefined);
    optional(c, "wiggle", cleanWiggle(c.wiggle));
    optional(c, "shadow", cleanShadow(c.shadow));
    optional(c, "border", cleanBorder(c.border));
  }
  if (VISUAL_TYPES.has(type) || type === "adjustment") optional(c, "mask", cleanMask(c.mask));
  if (type === "adjustment") {
    c.adjust = normalizeAdjust(c.adjust, where, lutIds);
    c.opacity = num(c.opacity, 1);
    c.effects = cleanEffects(c.effects);
  }
  if (type === "video" || type === "audio" || type === "compound") {
    for (const [k, v] of Object.entries(DEFAULT_SOUND)) {
      if (typeof c[k] !== typeof v) c[k] = v;
    }
    c.in = Math.max(0, num(c.in, 0));
    c.speed = num(c.speed, 1) > 0 ? num(c.speed, 1) : 1;
    // Optional retiming fields: absent means off, so files written before
    // they existed load unchanged.
    const raw = isObj(c.speedCurve) && Array.isArray(c.speedCurve.points) ? c.speedCurve : null;
    const points = raw && cleanPoints((raw.points as unknown[]).filter(isObj).map((p) => ({ f: Number(p.f), speed: Number(p.speed) })), (p) => p.f);
    if (raw && points) c.speedCurve = { ...(typeof raw.preset === "string" ? { preset: raw.preset } : {}), points };
    else delete c.speedCurve;
    for (const k of ["reverse", "changePitch"]) if (c[k] !== true) delete c[k];
    const comp = cleanCompressor(c.compressor);
    if (comp) c.compressor = comp;
    else delete c.compressor;
    // Sound design (ADR-060): each effect in range, or dropped.
    cleanSoundFx(c);
    for (const k of ["fadeInCurve", "fadeOutCurve", "crossfadeCurve"]) if (typeof c[k] !== "string" || !Object.hasOwn(FADE_CURVES, c[k] as string)) delete c[k];
    if (typeof c.pitch === "number" && Number.isFinite(c.pitch)) c.pitch = Math.max(-12, Math.min(12, c.pitch));
    else delete c.pitch;
    if (typeof c.voice !== "string" || !Object.hasOwn(VOICE_PRESETS, c.voice)) delete c.voice;
    if (c.mono !== true) delete c.mono;
    if (isObj(c.keyframes)) c.keyframes = Object.fromEntries(Object.entries(c.keyframes).filter(([path]) => path !== "pitch" && !path.startsWith("saturation.") && !path.startsWith("ringMod.")));
  }
  // Remove BG (ADR-033): a reference to a matte file, or nothing. A broken
  // one is dropped, not refused: the clip still plays, with its background.
  const cut = c.cutout;
  if (type === "video" && isObj(cut) && typeof cut.src === "string" && cut.src && Number.isFinite(cut.from) && Number.isFinite(cut.to) && (cut.to as number) > (cut.from as number)) {
    c.cutout = { enabled: cut.enabled !== false, src: cut.src, from: cut.from, to: cut.to, model: typeof cut.model === "string" ? cut.model : "" };
  } else delete c.cutout;
  if (type === "compound") {
    if (typeof c.compoundId !== "string") throw new ProjectError(`${where}: missing compoundId`);
    // Not supported on compound clips yet (ADR-037): dropped, not refused,
    // so a file that has them still opens.
    for (const k of ["speedCurve", "reverse", "freeze", "pitch", "voice", "mono", ...FX_KEYS]) delete c[k];
  }
  if (type === "video" || type === "audio" || type === "image") {
    if (typeof c.assetId !== "string") throw new ProjectError(`${where}: missing assetId`);
  }
  if (type === "text") {
    c.text = typeof c.text === "string" ? c.text : "";
    const style = { ...DEFAULT_TEXT_STYLE, ...(isObj(c.style) ? c.style : {}) } as Record<string, unknown>;
    // A weight out of range or not a number is dropped: bold decides then.
    optional(style, "weight", cleanWeight(style.weight));
    const runs = cleanRuns(style.runs, (c.text as string).length);
    optional(style, "runs", runs.length ? runs : undefined);
    // A color set as a key's number (0xRRGGBB, ADR-071) is stored as CSS.
    if (typeof style.color === "number") style.color = keyColor(style.color);
    else if (typeof style.color !== "string") style.color = DEFAULT_TEXT_STYLE.color;
    c.style = style;
  }
  if (type === "color") {
    c.color = typeof c.color === "string" ? c.color : "#000000";
    optional(c, "shape", cleanShape(c.shape));
  }
  return c as unknown as Clip;
}

/**
 * Turn untrusted JSON into a valid Project: fill every missing field with its
 * default, sort clips, and reject what cannot be repaired (unknown clip types,
 * clips on the wrong kind of track, overlaps, references to missing assets).
 */
export function normalizeProject(raw: unknown): Project {
  if (!isObj(raw)) throw new ProjectError("project must be a JSON object");
  const base = createProject();
  const fps = isObj(raw.fps)
    ? { num: num(raw.fps.num, 30), den: num(raw.fps.den, 1) }
    : typeof raw.fps === "number"
      ? { num: raw.fps, den: 1 }
      : base.fps;
  const assets: Asset[] = (Array.isArray(raw.assets) ? raw.assets : []).map((a, i) => {
    if (!isObj(a) || typeof a.src !== "string") {
      throw new ProjectError(`assets[${i}]: needs at least a "src"`);
    }
    const kind = a.kind === "audio" || a.kind === "image" ? a.kind : "video";
    const { musicGrid: rawGrid, playbackProxy: rawProxy, ...rest } = a;
    const playbackProxy = normalizePlaybackProxy(rawProxy);
    const musicGrid = normalizeMusicGrid(rawGrid);
    return {
      ...rest,
      id: typeof a.id === "string" ? a.id : uid("a"),
      kind,
      name: typeof a.name === "string" ? a.name : a.src.split(/[\\/]/).pop()!,
      src: a.src,
      duration: num(a.duration, 0),
      ...(a.animated === true ? { animated: true } : {}),
      hasVideo: typeof a.hasVideo === "boolean" ? a.hasVideo : kind !== "audio",
      hasAudio: typeof a.hasAudio === "boolean" ? a.hasAudio : kind !== "image",
      ...(musicGrid ? { musicGrid } : {}),
      ...(playbackProxy ? { playbackProxy } : {}),
    } as Asset;
  });
  const assetIds = new Set(assets.map((a) => a.id));
  const mediaFolders: string[] = [];
  for (const name of [...(Array.isArray(raw.mediaFolders) ? raw.mediaFolders : []), ...assets.map((a) => a.folder)]) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) continue;
    if (!mediaFolders.some((f) => f.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) mediaFolders.push(name.trim());
  }
  for (const a of assets) {
    a.folder = typeof a.folder === "string" ? mediaFolders.find((f) => f.toLocaleLowerCase() === a.folder!.trim().toLocaleLowerCase()) : undefined;
    a.favorite = a.favorite === true ? true : undefined;
  }
  const luts: LutFile[] = (Array.isArray(raw.luts) ? raw.luts : []).map((l, i) => {
    if (!isObj(l) || typeof l.src !== "string") throw new ProjectError(`luts[${i}]: needs at least a "src"`);
    return {
      id: typeof l.id === "string" ? l.id : uid("lut"),
      name: typeof l.name === "string" ? l.name : l.src.split(/[\\/]/).pop()!,
      src: l.src,
      kind: l.kind === "1d" ? "1d" : "3d",
      size: Math.max(2, Math.round(num(l.size, 33))),
    };
  });
  const lutIds = new Set(luts.map((l) => l.id));
  const rawCompounds = Array.isArray(raw.compounds) ? raw.compounds : [];
  const compoundIds = new Set(rawCompounds.map((k) => (isObj(k) ? k.id : undefined)));
  const timeline = (rawTracks: unknown[], at: string) => normalizeTracks(rawTracks, at, assetIds, lutIds, compoundIds);
  const tracks = timeline(Array.isArray(raw.tracks) ? raw.tracks : base.tracks, "tracks");
  const compounds: Compound[] = rawCompounds.map((k, i) => {
    if (!isObj(k) || typeof k.id !== "string") throw new ProjectError(`compounds[${i}]: needs an "id"`);
    return {
      id: k.id,
      name: typeof k.name === "string" ? k.name : `Compound clip ${i + 1}`,
      tracks: timeline(Array.isArray(k.tracks) ? k.tracks : [], `compounds[${i}].tracks`),
      markers: normalizeMarkers(k.markers),
    };
  });
  // A compound that plays itself, even through others, would never finish
  // rendering.
  const byId = new Map(compounds.map((k) => [k.id, k]));
  const cyclic = (id: string, path: string[]): boolean =>
    path.includes(id) || byId.get(id)!.tracks.some((t) => t.clips.some((c) => c.type === "compound" && cyclic(c.compoundId, [...path, id])));
  for (const k of compounds) if (cyclic(k.id, [])) throw new ProjectError(`compounds: ${k.id} contains itself`);
  const markers = normalizeMarkers(raw.markers);
  const brand = normalizeBrand(raw.brand, assetIds);
  return {
    schema: 1,
    id: typeof raw.id === "string" ? raw.id : base.id,
    name: typeof raw.name === "string" ? raw.name : base.name,
    width: Math.max(16, Math.round(num(raw.width, base.width))),
    height: Math.max(16, Math.round(num(raw.height, base.height))),
    fps,
    sampleRate: num(raw.sampleRate, base.sampleRate),
    ...(raw.masterVolume !== undefined ? { masterVolume: Math.max(0, Math.min(4, num(raw.masterVolume, 1))) } : {}),
    background: typeof raw.background === "string" ? raw.background : base.background,
    ...(raw.canvasFixed === true ? { canvasFixed: true } : {}),
    assets,
    ...(mediaFolders.length ? { mediaFolders } : {}),
    tracks,
    markers,
    ...(luts.length ? { luts } : {}),
    ...(compounds.length ? { compounds } : {}),
    ...(brand ? { brand } : {}),
    createdAt: num(raw.createdAt, base.createdAt),
    updatedAt: num(raw.updatedAt, base.updatedAt),
  };
}

/** One timeline's tracks (the project's, or a compound's): clips checked
 * against their tracks, assets, compounds and each other; one main track. */
function normalizeTracks(rawTracks: unknown[], at: string, assetIds: Set<string>, lutIds: Set<string>, compoundIds: Set<unknown>): Track[] {
  const tracks: Track[] = rawTracks.map((t, ti) => {
    if (!isObj(t)) throw new ProjectError(`${at}[${ti}] must be an object`);
    const kind: TrackKind = t.kind === "audio" ? "audio" : "video";
    const clips = (Array.isArray(t.clips) ? t.clips : [])
      .map((c, ci) => normalizeClip(c, `${at}[${ti}].clips[${ci}]`, lutIds))
      .sort((a, b) => a.start - b.start);
    clips.forEach((c, ci) => {
      const where = `${at}[${ti}].clips[${ci}]`;
      if ((c.type === "audio") !== (kind === "audio")) {
        throw new ProjectError(`${where}: a ${c.type} clip cannot sit on a ${kind} track`);
      }
      if ("assetId" in c && !assetIds.has(c.assetId)) {
        throw new ProjectError(`${where}: assetId ${c.assetId} is not in assets`);
      }
      if (c.type === "compound" && !compoundIds.has(c.compoundId)) {
        throw new ProjectError(`${where}: compoundId ${c.compoundId} is not in compounds`);
      }
      const prev = clips[ci - 1];
      if (prev && prev.start + prev.duration > c.start) {
        throw new ProjectError(`${where}: overlaps the clip before it`);
      }
    });
    return {
      id: typeof t.id === "string" ? t.id : uid("t"),
      kind,
      name: typeof t.name === "string" ? t.name : kind === "audio" ? "Audio" : "Video",
      ...(t.main === true ? { main: true } : {}),
      clips,
      muted: t.muted === true,
      hidden: t.hidden === true,
      locked: t.locked === true,
      volume: num(t.volume, 1),
      ...(t.pan !== undefined ? { pan: Math.max(-1, Math.min(1, num(t.pan, 0))) } : {}),
      ...(t.solo !== undefined ? { solo: t.solo === true } : {}),
      height: t.height === "small" || t.height === "large" ? t.height : undefined,
      color: typeof t.color === "string" && ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"].includes(t.color) ? t.color as Track["color"] : undefined,
      ...(kind === "audio" && typeof t.role === "string" && (TRACK_ROLES as string[]).includes(t.role) ? { role: t.role as TrackRole } : {}),
    };
  });
  if (!tracks.some((t) => t.main)) {
    const firstVideo = [...tracks].reverse().find((t) => t.kind === "video");
    if (firstVideo) firstVideo.main = true;
    else tracks.unshift(createTrack("video", "Main", true));
  }
  return dropDanglingMattes(tracks);
}

function normalizeMarkers(raw: unknown): Marker[] {
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((m) => ({
    id: typeof m.id === "string" ? m.id : uid("m"),
    frame: Math.max(0, Math.round(num(m.frame, 0))),
    label: typeof m.label === "string" ? m.label : "",
    color: typeof m.color === "string" ? m.color : "#3be0f0",
    ...(Number.isSafeInteger(m.duration) && (m.duration as number) >= 0 ? { duration: m.duration as number } : {}),
    ...(typeof m.chapter === "boolean" ? { chapter: m.chapter } : {}),
    ...(isObj(m.follows) && typeof m.follows.clip === "string" && Number.isFinite(m.follows.at) && (m.follows.at as number) >= 0 ? { follows: { clip: m.follows.clip, at: m.follows.at as number } } : {}),
  }));
}

const MUSIC_PARTS: MusicPart[] = ["intro", "verse", "build", "drop", "breakdown", "outro"];

/** A song's grid as saved, or nothing when it does not hold up. */
function normalizeMusicGrid(raw: unknown): MusicGrid | undefined {
  if (!isObj(raw) || !(num(raw.bpm, 0) >= 40 && num(raw.bpm, 0) <= 240) || !(num(raw.firstDownbeat, -1) >= 0)) return undefined;
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .filter((x): x is Record<string, unknown> => isObj(x) && num(x.at, -1) >= 0 && MUSIC_PARTS.includes(x.label as MusicPart))
    .map((x) => ({ at: num(x.at, 0), label: x.label as MusicPart }))
    .sort((a, b) => a.at - b.at);
  return { bpm: num(raw.bpm, 120), firstDownbeat: num(raw.firstDownbeat, 0), ...(sections.length ? { sections } : {}) };
}
