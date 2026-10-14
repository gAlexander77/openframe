// Factories for every project object, and `normalizeProject`, the trust
// boundary for project JSON. Whatever comes in — a file saved by an older
// version, a hand-written agent script with half the fields missing — leaves
// as a complete, valid Project or as an error naming what is wrong.

import { cleanGrade } from "../grade";
import { cleanPoints } from "../speed";
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
  Project,
  Sound,
  TextClip,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  VideoClip,
  Visual,
} from "./types";

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

/** Image and text clips default to the length CapCut gives them. */
export const DEFAULT_STILL_SECONDS = 5;

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
      duration: secondsToFrames(DEFAULT_STILL_SECONDS, fps),
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
      duration: full,
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
const CLIP_TYPES = new Set(["video", "audio", "image", "text", "color", "adjustment", "compound"]);

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
    c.crop = { ...base.crop, ...(isObj(c.crop) ? c.crop : {}) };
    c.adjust = normalizeAdjust(c.adjust, where, lutIds);
    c.opacity = num(c.opacity, 1);
    c.blend = typeof c.blend === "string" ? c.blend : "normal";
    c.effects = Array.isArray(c.effects) ? c.effects : [];
  }
  if (type === "adjustment") {
    c.adjust = normalizeAdjust(c.adjust, where, lutIds);
    c.opacity = num(c.opacity, 1);
    c.effects = Array.isArray(c.effects) ? c.effects : [];
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
  }
  if (type === "compound") {
    if (typeof c.compoundId !== "string") throw new ProjectError(`${where}: missing compoundId`);
    // Not supported on compound clips yet (ADR-037): dropped, not refused,
    // so a file that has them still opens.
    for (const k of ["speedCurve", "reverse", "freeze"]) delete c[k];
  }
  if (type === "video" || type === "audio" || type === "image") {
    if (typeof c.assetId !== "string") throw new ProjectError(`${where}: missing assetId`);
  }
  if (type === "text") {
    c.text = typeof c.text === "string" ? c.text : "";
    c.style = { ...DEFAULT_TEXT_STYLE, ...(isObj(c.style) ? c.style : {}) };
  }
  if (type === "color") c.color = typeof c.color === "string" ? c.color : "#000000";
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
    return {
      ...a,
      id: typeof a.id === "string" ? a.id : uid("a"),
      kind,
      name: typeof a.name === "string" ? a.name : a.src.split(/[\\/]/).pop()!,
      src: a.src,
      duration: num(a.duration, 0),
      hasVideo: typeof a.hasVideo === "boolean" ? a.hasVideo : kind !== "audio",
      hasAudio: typeof a.hasAudio === "boolean" ? a.hasAudio : kind !== "image",
    } as Asset;
  });
  const assetIds = new Set(assets.map((a) => a.id));
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
  return {
    schema: 1,
    id: typeof raw.id === "string" ? raw.id : base.id,
    name: typeof raw.name === "string" ? raw.name : base.name,
    width: Math.max(16, Math.round(num(raw.width, base.width))),
    height: Math.max(16, Math.round(num(raw.height, base.height))),
    fps,
    sampleRate: num(raw.sampleRate, base.sampleRate),
    background: typeof raw.background === "string" ? raw.background : base.background,
    assets,
    tracks,
    markers,
    ...(luts.length ? { luts } : {}),
    ...(compounds.length ? { compounds } : {}),
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
    };
  });
  if (!tracks.some((t) => t.main)) {
    const firstVideo = [...tracks].reverse().find((t) => t.kind === "video");
    if (firstVideo) firstVideo.main = true;
    else tracks.unshift(createTrack("video", "Main", true));
  }
  return tracks;
}

function normalizeMarkers(raw: unknown): Marker[] {
  return (Array.isArray(raw) ? raw : []).filter(isObj).map((m) => ({
    id: typeof m.id === "string" ? m.id : uid("m"),
    frame: Math.max(0, Math.round(num(m.frame, 0))),
    label: typeof m.label === "string" ? m.label : "",
    color: typeof m.color === "string" ? m.color : "#3be0f0",
  }));
}
