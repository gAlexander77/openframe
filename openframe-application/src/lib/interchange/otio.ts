// The timeline as OpenTimelineIO JSON (.otio), so an edit started here can
// be finished in DaVinci Resolve (File > Import > Timeline), Premiere (with
// its OTIO plugin) or any OTIO tool. Times use the project's frame rate.
//
// Mapping: tracks become OTIO tracks bottom to top (OTIO stacks list the
// lowest first); empty time becomes Gaps; a transition sits between its two
// clips, centered on the cut as ours are; speed is a LinearTimeWarp and a
// freeze a FreezeFrame. A video clip's own sound goes on a companion audio
// track, the way NLEs link picture and sound. Titles, color clips and
// adjustment layers have no media file: they are Clips with a
// GeneratorReference that keeps their content. A compound clip (ADR-037)
// is a nested Stack of its timeline's tracks, trimmed by source_range, the
// way OTIO nests sequences. Every clip carries its full definition under
// metadata.video_editor for a future importer.
// ponytail: markers are all RED (OTIO's palette is eight names); effects,
// keyframes and text styling ride only in metadata.

import type { Asset, Clip, Project, Track } from "../project/types";

type Json = Record<string, unknown>;

const rt = (value: number, rate: number): Json => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, duration: number, rate: number): Json => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });

/** An absolute path as a file:// URL; URLs and bare names pass through. */
export function fileUrl(src: string): string {
  if (/^[a-z][a-z0-9+.-]+:\/\//i.test(src)) return src;
  const win = /^[a-z]:[\\/]/i.test(src);
  if (!win && !src.startsWith("/")) return src;
  const path = src.replace(/\\/g, "/");
  return "file://" + encodeURI(win ? `/${path}` : path).replace(/#/g, "%23").replace(/\?/g, "%3F");
}

function mediaRef(a: Asset, rate: number): Json {
  return {
    OTIO_SCHEMA: "ExternalReference.1",
    target_url: fileUrl(a.src),
    available_range: a.kind === "image" ? null : range(0, a.duration * rate, rate),
    metadata: {},
  };
}

function clip(c: Clip, p: Project, rate: number, sound: boolean, depth: number): Json {
  const asset = "assetId" in c ? p.assets.find((a) => a.id === c.assetId) : undefined;
  const effects: Json[] = [];
  if ("speed" in c && c.freeze) effects.push({ OTIO_SCHEMA: "FreezeFrame.1", name: "Freeze", effect_name: "FreezeFrame", time_scalar: 0, metadata: {} });
  else if ("speed" in c && c.speed !== 1) effects.push({ OTIO_SCHEMA: "LinearTimeWarp.1", name: "Speed", effect_name: "LinearTimeWarp", time_scalar: c.speed, metadata: {} });
  const start = "in" in c ? c.in * rate : 0;
  const k = c.type === "compound" ? p.compounds?.find((x) => x.id === c.compoundId) : undefined;
  if (c.type === "compound") {
    return {
      OTIO_SCHEMA: "Stack.1",
      name: c.name ?? k?.name ?? "Compound clip",
      source_range: range(start, c.duration, rate),
      children: k && depth < 16 ? layers(k.tracks, p, rate, depth + 1) : [],
      effects,
      markers: [],
      enabled: !c.disabled,
      metadata: { video_editor: c },
    };
  }
  return {
    OTIO_SCHEMA: "Clip.1",
    name: c.name ?? (c.type === "text" ? c.text : asset?.name ?? c.type),
    source_range: range(start, c.duration, rate),
    media_reference: asset
      ? mediaRef(asset, rate)
      : { OTIO_SCHEMA: "GeneratorReference.1", generator_kind: c.type, parameters: c.type === "text" ? { text: c.text } : c.type === "color" ? { color: c.color } : {}, available_range: null, metadata: {} },
    effects,
    markers: [],
    enabled: !c.disabled && !(sound && "muted" in c && c.muted),
    metadata: { video_editor: c },
  };
}

const gap = (frames: number, rate: number): Json => ({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, frames, rate), effects: [], markers: [], metadata: {} });

function track(t: Track, clips: Clip[], kind: "Video" | "Audio", p: Project, rate: number, depth: number): Json {
  const children: Json[] = [];
  let at = 0;
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  sorted.forEach((c, i) => {
    if (c.start > at) children.push(gap(c.start - at, rate));
    children.push(clip(c, p, rate, kind === "Audio", depth));
    at = c.start + c.duration;
    const tr = "transitionOut" in c ? c.transitionOut : undefined;
    const next = sorted[i + 1];
    if (tr && next && next.start === at) {
      const before = Math.floor(tr.duration / 2);
      children.push({
        OTIO_SCHEMA: "Transition.1",
        name: tr.type,
        transition_type: tr.type === "dissolve" ? "SMPTE_Dissolve" : "Custom_Transition",
        in_offset: rt(before, rate),
        out_offset: rt(tr.duration - before, rate),
        metadata: { video_editor: tr },
      });
    }
  });
  return { OTIO_SCHEMA: "Track.1", name: kind === "Audio" && t.kind === "video" ? `${t.name} audio` : t.name, kind, children, source_range: null, effects: [], markers: [], enabled: kind === "Audio" ? !t.muted : !t.hidden, metadata: {} };
}

/** One timeline's tracks as a Stack's children: video bottom to top, the
 * video clips' own sound, then the audio tracks. */
function layers(tracks: Track[], p: Project, rate: number, depth: number): Json[] {
  const hasSound = (c: Clip) => {
    if (c.type !== "video") return false;
    const a = p.assets.find((x) => x.id === c.assetId);
    return !!a?.hasAudio && c.volume > 0;
  };
  // Our tracks list the topmost first; OTIO stacks list the lowest first.
  const bottomUp = [...tracks].reverse();
  const video = bottomUp.filter((t) => t.kind === "video").map((t) => track(t, t.clips, "Video", p, rate, depth));
  const linked = bottomUp
    .filter((t) => t.kind === "video" && t.clips.some(hasSound))
    .map((t) => track(t, t.clips.filter(hasSound), "Audio", p, rate, depth));
  const audio = bottomUp.filter((t) => t.kind === "audio").map((t) => track(t, t.clips, "Audio", p, rate, depth));
  return [...video, ...linked, ...audio];
}

/** The project as an OTIO Timeline, ready for JSON.stringify. */
export function toOtio(p: Project): Json {
  const rate = p.fps.num / p.fps.den;
  return {
    OTIO_SCHEMA: "Timeline.1",
    name: p.name,
    global_start_time: rt(0, rate),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      name: "tracks",
      children: layers(p.tracks, p, rate, 0),
      source_range: null,
      effects: [],
      markers: p.markers.map((m) => ({ OTIO_SCHEMA: "Marker.2", name: m.label, marked_range: range(m.frame, 0, rate), color: "RED", comment: "", metadata: {} })),
      enabled: true,
      metadata: {},
    },
    metadata: { video_editor: { width: p.width, height: p.height, fps: p.fps } },
  };
}
