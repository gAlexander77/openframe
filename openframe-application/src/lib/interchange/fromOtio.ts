// OTIO's sequential Track clock excludes transitions: their handles straddle
// the cut without advancing it. All imported clocks snap once to project frames.
// ponytail: effects and retiming are reported, not interpreted; add tested
// per-schema adapters before reconstructing their playback behavior.
import { clipForAsset, createColorClip, createCompoundClip, createMarker, createProject, createTextClip, createTrack, normalizeProject, uid } from "../project/defaults";
import type { Asset, Clip, Marker, Project, Track } from "../project/types";
import { FPS_PRESETS, framesToSeconds, secondsToFrames, type Rational } from "../time";
import { TRANSITIONS } from "../catalog";

type J = Record<string, unknown>;
export interface TimelineImport { project: Project; warnings: string[] }
export const object = (x: unknown): J => x !== null && typeof x === "object" && !Array.isArray(x) ? x as J : {};
const list = (x: unknown): J[] => Array.isArray(x) ? x.map(object) : [];
const schema = (x: J) => String(x.OTIO_SCHEMA ?? "");
const text = (x: unknown, fallback = "") => typeof x === "string" ? x : fallback;

/** Decodes file URLs without treating a URL's escaped # or ? as separators. */
export function mediaPath(src: string): string {
  if (!/^file:\/\//i.test(src)) return src;
  const u = new URL(src);
  const path = decodeURIComponent(u.pathname);
  return u.hostname ? `//${u.hostname}${path}` : /^\/[a-z]:\//i.test(path) ? path.slice(1) : path;
}

export function fromOtio(input: unknown): TimelineImport {
  const root = object(typeof input === "string" ? JSON.parse(input) : input);
  if (schema(root) !== "Timeline.1" || schema(object(root.tracks)) !== "Stack.1") throw new Error("Expected an OTIO Timeline.1 with a Stack.1 of tracks.");
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const meta = object(object(root.metadata).video_editor);
  const findRate = (node: J, depth = 0): number => {
    if (depth > 64) throw new Error("OTIO nesting exceeds 64 levels.");
    const rate = Number(object(object(node.source_range).duration).rate);
    if (rate > 0 && Number.isFinite(rate)) return rate;
    for (const child of list(node.children)) { const r = findRate(child, depth + 1); if (r) return r; }
    return 0;
  };
  const rate = Number(object(root.global_start_time).rate) || findRate(object(root.tracks)) || 30;
  const savedFps = object(meta.fps);
  const fps: Rational = Number(savedFps.num) > 0 && Number(savedFps.den) > 0
    ? { num: Number(savedFps.num), den: Number(savedFps.den) }
    : FPS_PRESETS.find(x => Math.abs(x.fps.num / x.fps.den - rate) < 0.002)?.fps ?? { num: Math.round(rate * 1000), den: 1000 };
  const p = createProject({ name: text(root.name, "Imported timeline"), fps, width: Number(meta.width) || 1920, height: Number(meta.height) || 1080 });
  const seconds = (x: unknown): number => {
    const r = object(x);
    if (schema(r) !== "RationalTime.1" || !Number.isFinite(r.value) || !Number.isFinite(r.rate) || Number(r.rate) <= 0) throw new Error("Invalid OTIO RationalTime.1.");
    return Number(r.value) / Number(r.rate);
  };
  const frames = (x: unknown) => secondsToFrames(seconds(x), fps);
  const range = (node: J, depth = 0): { start: number; duration: number } => {
    if (depth > 64) throw new Error("OTIO nesting exceeds 64 levels.");
    if (!node.source_range) {
      if (["Stack.1", "Track.1"].includes(schema(node))) {
        const durations = list(node.children).filter(c => schema(c) !== "Transition.1").map(c => range(c, depth + 1).duration);
        return { start: 0, duration: schema(node) === "Stack.1" ? Math.max(0, ...durations) : durations.reduce((a, b) => a + b, 0) };
      }
      const refs = object(node.media_references);
      const ref = object(node.media_reference ?? refs[text(node.active_media_reference_key, "DEFAULT_MEDIA")]);
      if (ref.available_range) return range({ source_range: ref.available_range }, depth + 1);
    }
    const r = object(node.source_range);
    if (schema(r) !== "TimeRange.1") throw new Error(`${text(node.name, schema(node))}: missing TimeRange.1 source_range.`);
    const start = seconds(r.start_time), duration = frames(r.duration);
    if (start < 0 || duration < 0 || !Number.isSafeInteger(duration)) throw new Error("Invalid OTIO source range.");
    return { start, duration };
  };
  const markers = (node: J, offset = 0): Marker[] => list(node.markers).map(m => createMarker(Math.max(0, offset + frames(object(m.marked_range).start_time)), text(m.name), "#ef4444"));
  const checkEffects = (node: J) => { for (const e of list(node.effects)) warn(`Effect ${text(e.name, schema(e))} could not be mapped (including speed changes and ramps).`); };
  const used = new Map<string, { clip: Clip; track: Track }>();
  const compounds = new Map<string, string>();
  const tracks = (stack: J, depth: number, destMarkers: Marker[]): Track[] => {
    if (depth > 16) throw new Error("Timeline nesting exceeds 16 levels.");
    checkEffects(stack);
    destMarkers.push(...markers(stack));
    const result: Track[] = [];
    for (const node of list(stack.children)) {
      if (schema(node) !== "Track.1") { warn(`Unknown schema ${schema(node)} in stack; skipped.`); continue; }
      const own = object(object(node.metadata).openframe);
      if (own.companion === true) continue;
      const kind = node.kind === "Audio" ? "audio" : "video";
      const t = createTrack(kind, text(node.name, kind === "video" ? "Video" : "Audio"));
      if (own.main === true) t.main = true;
      t.hidden = kind === "video" && node.enabled === false;
      t.muted = kind === "audio" && node.enabled === false;
      checkEffects(node);
      let trackMarkers = markers(node);
      let legacyCompanion = false;
      let at = 0;
      for (const item of list(node.children)) {
        const s = schema(item);
        if (s === "Transition.1") {
          if (legacyCompanion && !t.clips.length) continue;
          const previous = t.clips.at(-1);
          const duration = frames(item.in_offset) + frames(item.out_offset);
          const saved = object(object(item.metadata).video_editor);
          const wanted = text(saved.type, text(item.transition_type));
          const type = TRANSITIONS[wanted] ? wanted : "dissolve";
          if (type !== wanted && wanted !== "SMPTE_Dissolve") warn(`Transition ${wanted} mapped to dissolve.`);
          if (previous && previous.type !== "audio") Object.assign(previous, { transitionOut: { type, duration: Math.max(1, duration) } });
          else warn("Transition without a picture clip before it was skipped.");
          continue;
        }
        if (!["Clip.1", "Clip.2", "Gap.1", "Stack.1"].includes(s)) { warn(`Unknown schema ${s}; skipped (its declared duration is kept as a gap).`); if (item.source_range) at += range(item).duration; continue; }
        const r = range(item);
        if (s === "Gap.1") { at += r.duration; continue; }
        if (r.duration === 0) { warn(`Zero-duration clip ${text(item.name)} was skipped.`); continue; }
        checkEffects(item);
        const saved = object(object(item.metadata).video_editor);
        if (saved.speedCurve || saved.reverse || saved.freeze) warn(`Retiming metadata on ${text(item.name, "clip")} (speed ramps, reverse or freeze) could not be mapped.`);
        for (const e of list(saved.effects)) warn(`OpenFrame effect ${text(e.type, "unknown")} could not be mapped.`);
        if (Object.keys(object(saved.keyframes)).length) warn(`Keyframes on ${text(item.name, "clip")} could not be mapped.`);
        // Older OpenFrame exports used duplicate clip IDs for companion sound.
        if (kind === "audio" && saved.type === "video" && text(saved.id) && used.has(text(saved.id))) {
          const original = used.get(text(saved.id))!;
          if (original.clip.type === "video") {
            const assetId = original.clip.assetId;
            const asset = p.assets.find(a => a.id === assetId);
            if (asset) asset.hasAudio = true;
            original.clip.muted = saved.muted === true;
            original.track.muted = node.enabled === false;
          }
          legacyCompanion = true;
          at += r.duration;
          continue;
        }
        let c: Clip;
        if (s === "Stack.1") {
          const own = object(object(item.metadata).openframe);
          const key = text(own.compoundRef, text(saved.compoundId));
          let id = key ? compounds.get(key) : undefined;
          if (!id) {
            const nestedMarkers: Marker[] = [];
            const nested = tracks(item, depth + 1, nestedMarkers);
            id = uid("compound");
            (p.compounds ??= []).push({ id, name: text(own.compoundName, text(item.name, "Compound")), tracks: nested, markers: nestedMarkers });
            if (key) compounds.set(key, id);
          }
          c = { ...createCompoundClip(id, at, r.duration), in: r.start };
        } else {
          const refs = object(item.media_references);
          const ref = object(item.media_reference ?? refs[text(item.active_media_reference_key, "DEFAULT_MEDIA")]);
          const refSchema = schema(ref);
          if (refSchema === "GeneratorReference.1" && (ref.generator_kind === "text" || ref.generator_kind === "color")) {
            const params = object(ref.parameters);
            c = ref.generator_kind === "text" ? createTextClip(text(params.text, text(saved.text)), at, r.duration) : createColorClip(text(params.color, text(saved.color, "#000000")), at, r.duration);
          } else {
            if (refSchema && !["ExternalReference.1", "MissingReference.1"].includes(refSchema)) warn(`Media schema ${refSchema} could not be mapped; kept as missing media.`);
            let src = text(ref.target_url);
            try { src = mediaPath(src); } catch { warn(`Invalid media URL ${src}; relink this media.`); }
            if (!src) { src = `missing:${uid("media")}`; warn(`Missing media: ${text(item.name, "Untitled clip")}; relink it in Media.`); }
            const refMeta = object(object(ref.metadata).openframe);
            const image = refMeta.kind === "image" || /\.(png|jpe?g|webp|gif|bmp|avif)(?:[?#]|$)/i.test(src);
            let asset = p.assets.find(a => a.src === src);
            const available = object(ref.available_range);
            const sourceIn = Math.max(0, r.start - (available.start_time ? seconds(available.start_time) : 0));
            const length = available.duration ? seconds(available.duration) : r.start + framesToSeconds(r.duration, fps);
            if (!asset) {
              asset = { id: uid("a"), src, name: text(refMeta.name, text(ref.name, src.split(/[\\/]/).at(-1) || text(item.name, "Missing media"))), kind: kind === "audio" ? "audio" : image ? "image" : "video", duration: Math.max(length, sourceIn + framesToSeconds(r.duration, fps)), hasVideo: kind !== "audio", hasAudio: kind === "audio" || refMeta.hasAudio === true };
              p.assets.push(asset);
            } else asset.duration = Math.max(asset.duration, length, sourceIn + framesToSeconds(r.duration, fps));
            if (kind === "audio") asset.hasAudio = true;
            if (kind === "video" && asset.kind === "audio") { asset.kind = image ? "image" : "video"; asset.hasVideo = true; }
            const use: Asset = kind === "audio" ? { ...asset, kind: "audio" } : asset;
            c = clipForAsset(use, at, fps);
            if ("in" in c) c.in = sourceIn;
            if (c.type === "video") c.muted = refMeta.hasAudio === true ? saved.muted === true : true; // External OTIO audio tracks own the sound.
          }
        }
        c.duration = Math.max(1, r.duration);
        if ("volume" in c && typeof saved.volume === "number" && Number.isFinite(saved.volume)) c.volume = Math.max(0, Math.min(4, saved.volume));
        c.name = text(item.name);
        c.disabled = item.enabled === false;
        if (text(saved.id)) used.set(text(saved.id), { clip: c, track: t });
        t.clips.push(c);
        if (s !== "Stack.1") trackMarkers.push(...markers(item, at - secondsToFrames(r.start, fps)));
        at += r.duration;
      }
      if (node.source_range) {
        const trim = range(node), from = secondsToFrames(trim.start, fps), end = from + trim.duration;
        trackMarkers = trackMarkers.filter(m => m.frame >= from && m.frame < end).map(m => ({ ...m, frame: m.frame - from }));
        t.clips = t.clips.filter(c => c.start < end && c.start + c.duration > from).map(c => {
          const head = Math.max(0, from - c.start), duration = Math.min(c.start + c.duration, end) - Math.max(c.start, from);
          const cut = { ...c, start: Math.max(0, c.start - from), duration };
          if ("in" in cut) cut.in += framesToSeconds(head, fps);
          return cut;
        });
      }
      destMarkers.push(...trackMarkers);
      if (legacyCompanion && !t.clips.length) continue;
      result.push(t);
    }
    const video = result.filter(t => t.kind === "video").reverse();
    if (video.length && !video.some(t => t.main)) video.at(-1)!.main = true;
    return [...video, ...result.filter(t => t.kind === "audio").reverse()];
  };
  p.tracks = tracks(object(root.tracks), 0, p.markers);
  if (!p.tracks.some(t => t.main)) p.tracks.push(createTrack("video", "Main", true));
  return { project: normalizeProject(p), warnings };
}
