// FCPXML 1.10: primary storyline, connected lanes and referenced compound
// sequences. Connections use the parent's source clock, not sequence time.
// ponytail: native effects and titles need per-element adapters. Unsupported
// elements are reported; OpenFrame text/color survive only in metadata.
import type { Clip, Marker, Project, Track } from "../project/types";
import { projectDuration } from "../project/ops";
import { framesToSeconds, isDropFrameRate, secondsToFrames } from "../time";
import { fileUrl } from "./otio";
import { fromOtio, type TimelineImport } from "./fromOtio";
import { escapeXml as esc, parseXml, type XmlNode } from "./xml";

const attrs = (values: Record<string, string | number | undefined>) => Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join("");
const md = (key: string, value: unknown) => `<metadata><md key="com.openframe.${key}" value="${esc(JSON.stringify(value))}"/></metadata>`;

export function toFcpxml(p: Project): string {
  const time = (f: number) => `${Math.round(f * p.fps.den)}/${p.fps.num}s`;
  const sec = (s: number) => time(secondsToFrames(s, p.fps));
  const assetIds = new Map(p.assets.map((a, i) => [a.id, `a${i + 1}`]));
  const compoundIds = new Map((p.compounds ?? []).map((k, i) => [k.id, `c${i + 1}`]));
  const markerXml = (markers: Marker[], offset: number, start: number, duration: number) => markers.filter(m => m.frame >= offset && m.frame < offset + duration).map(m => `<marker${attrs({ start: time(start + m.frame - offset), duration: time(1), value: m.label })}/>`).join("");
  const sequence = (tracks: Track[], markers: Marker[], depth: number): string => {
    if (depth > 16) throw new Error("Compound nesting exceeds 16 levels.");
    const main = tracks.find(t => t.main) ?? tracks.find(t => t.kind === "video");
    const duration = Math.max(1, ...tracks.flatMap(t => t.clips.map(c => c.start + c.duration)), ...markers.map(m => m.frame + 1));
    type Item = { clip?: Clip; offset: number; start: number; duration: number; transition?: number; connected: string[] };
    const items: Item[] = [];
    let at = 0;
    const clips = [...(main?.clips ?? [])].sort((a, b) => a.start - b.start);
    clips.forEach((c, i) => {
      const prev = clips[i - 1], next = clips[i + 1];
      const before = prev && prev.start + prev.duration === c.start && "transitionOut" in prev ? prev.transitionOut?.duration ?? 0 : 0;
      const after = next && c.start + c.duration === next.start && "transitionOut" in c ? c.transitionOut?.duration ?? 0 : 0;
      const head = Math.ceil(before / 2), tail = Math.floor(after / 2);
      if (c.duration <= head + tail) throw new Error("Transition handles exceed a clip's duration.");
      if (c.start > at) items.push({ offset: at, start: 0, duration: c.start - at, connected: [] });
      items.push({ clip: c, offset: c.start + head, start: secondsToFrames("in" in c ? c.in : 0, p.fps) + head, duration: c.duration - head - tail, connected: [] });
      if (after) items.push({ offset: c.start + c.duration - tail, start: 0, duration: after, transition: after, connected: [] });
      at = c.start + c.duration;
    });
    if (at < duration) items.push({ offset: at, start: 0, duration: duration - at, connected: [] });
    const writeClip = (c: Clip | undefined, offset: number, start: number, length: number, children: string, track?: Track, lane?: number): string => {
      const ref = c && ("assetId" in c ? assetIds.get(c.assetId) : c.type === "compound" ? compoundIds.get(c.compoundId) : undefined);
      const tag = ref ? c?.type === "compound" ? "ref-clip" : "asset-clip" : "gap";
      const extra = c && !ref ? { type: c.type, text: c.type === "text" ? c.text : undefined, color: c.type === "color" ? c.color : undefined } : undefined;
      const meta = md("track", { name: track?.name ?? main?.name ?? "Main", main: lane === undefined, kind: track?.kind ?? "video", order: tracks.indexOf(track ?? main!) });
      const contents = `<${tag}${attrs({ ref, name: c?.name ?? (c && "assetId" in c ? p.assets.find(a => a.id === c.assetId)?.name : c?.type) ?? "Gap", lane: tag === "gap" ? undefined : lane, offset: time(tag === "gap" && lane !== undefined ? 0 : offset), start: time(start), duration: time(length), enabled: c?.disabled ? "0" : undefined, srcEnable: ref && c && "muted" in c && c.muted ? "video" : c?.type === "audio" ? "audio" : undefined, audioRole: tag === "asset-clip" && track?.kind === "audio" ? "dialogue" : undefined })}>${children}${extra ? md("generator", extra).replace("</metadata>", meta.replace("<metadata>", "")) : meta}</${tag}>`;
      // A gap has no lane attribute in the DTD; a connected storyline does.
      return tag === "gap" && lane !== undefined ? `<spine${attrs({ lane, offset: time(offset) })}>${contents}</spine>` : contents;
    };
    let videoLane = 1, audioLane = -1;
    for (const t of [...tracks.filter(t => t.kind === "video").reverse(), ...tracks.filter(t => t.kind === "audio")].filter(t => t !== main)) {
      const lane = t.kind === "audio" ? audioLane-- : videoLane++;
      if (t.clips.some(c => "transitionOut" in c && c.transitionOut)) {
        const nested = sequence([{ ...t, main: true }], [], depth + 1);
        const spine = nested.slice(nested.indexOf("<spine>") + 7, nested.lastIndexOf("</spine>"));
        const host = items.find(it => !it.transition)!;
        host.connected.push(`<spine${attrs({ lane, offset: time(host.start - host.offset) })}>${spine}</spine>`);
        continue;
      }
      for (const c of t.clips) {
        const host = items.find(it => !it.transition && c.start >= it.offset && c.start < it.offset + it.duration) ?? items.find(it => !it.transition)!;
        host.connected.push(writeClip(c, host.start + c.start - host.offset, secondsToFrames("in" in c ? c.in : 0, p.fps), c.duration, "", t, lane));
      }
    }
    const spine = items.map(it => it.transition
      ? `<transition${attrs({ name: "Cross Dissolve", offset: time(it.offset), duration: time(it.duration) })}><filter-video ref="dissolve"/>${markerXml(markers, it.offset, 0, it.duration)}</transition>`
      : writeClip(it.clip, it.offset, it.start, it.duration, it.connected.join("") + markerXml(markers, it.offset, it.start, it.duration), main)).join("");
    return `<sequence${attrs({ format: "f1", duration: time(duration), tcStart: "0s", tcFormat: isDropFrameRate(p.fps) ? "DF" : "NDF", audioLayout: "stereo", audioRate: "48k" })}><spine>${spine}</spine></sequence>`;
  };
  const resources = [`<format${attrs({ id: "f1", frameDuration: time(1), width: p.width, height: p.height, colorSpace: "1-1-1 (Rec. 709)" })}/>`, '<effect id="dissolve" name="Cross Dissolve" uid="FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265"/>'];
  for (const a of p.assets) resources.push(`<asset${attrs({ id: assetIds.get(a.id), name: a.name, start: "0s", duration: sec(a.kind === "image" ? Math.max(a.duration, framesToSeconds(projectDuration(p), p.fps)) : a.duration), hasVideo: a.hasVideo ? "1" : "0", hasAudio: a.hasAudio ? "1" : "0", format: a.hasVideo ? "f1" : undefined, audioSources: a.hasAudio ? "1" : undefined, audioChannels: a.hasAudio ? "2" : undefined })}><media-rep kind="original-media" src="${esc(fileUrl(a.src))}"/></asset>`);
  for (const k of p.compounds ?? []) resources.push(`<media${attrs({ id: compoundIds.get(k.id), name: k.name })}>${sequence(k.tracks, k.markers, 1)}</media>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources>${resources.join("")}</resources><library><event name="OpenFrame"><project name="${esc(p.name)}">${sequence(p.tracks, p.markers, 0)}</project></event></library></fcpxml>\n`;
}

/** The supported FCPXML subset is translated to the same OTIO trust boundary. */
export function fromFcpxml(xml: string): TimelineImport {
  const root = parseXml(xml);
  if (root.tag !== "fcpxml") throw new Error("Expected an FCPXML document.");
  const warnings: string[] = [];
  const warn = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const child = (n: XmlNode, tag: string) => n.children.find(c => c.tag === tag);
  const descendants = (n: XmlNode, tag: string): XmlNode[] => [...(n.tag === tag ? [n] : []), ...n.children.flatMap(c => descendants(c, tag))];
  const resources = child(root, "resources");
  const byId = new Map((resources?.children ?? []).map(n => [n.attrs.id, n]));
  const projects = descendants(root, "project");
  if (projects.length > 1) warn("Multiple projects: only the first project was imported.");
  const project = projects[0];
  const seq = project && child(project, "sequence");
  if (!seq || !child(seq, "spine")) throw new Error("FCPXML needs a project with a sequence and spine.");
  const number = (s: string | undefined, fallback = 0): number => {
    if (s === undefined) return fallback;
    const m = /^(-?\d+(?:\.\d+)?)(?:\/(\d+))?s$/.exec(s);
    const n = m ? Number(m[1]) / Number(m[2] ?? 1) : NaN;
    if (!Number.isFinite(n)) throw new Error(`Invalid FCPXML rational time ${s}.`);
    return n;
  };
  const format = byId.get(seq.attrs.format);
  const fd = number(format?.attrs.frameDuration, 1 / 30);
  if (fd <= 0) throw new Error("Invalid FCPXML frame duration.");
  const rt = (s: number) => ({ OTIO_SCHEMA: "RationalTime.1", value: s / fd, rate: 1 / fd });
  const range = (start: number, duration: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start), duration: rt(duration) });
  const metadata = (n: XmlNode, key: string): Record<string, unknown> => {
    const value = child(n, "metadata")?.children.find(m => m.attrs.key === `com.openframe.${key}`)?.attrs.value;
    if (!value) return {};
    try { const v: unknown = JSON.parse(value); return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; } catch { warn(`Invalid OpenFrame ${key} metadata was ignored.`); return {}; }
  };
  const stack = (sequence: XmlNode, path: string[] = []): Record<string, unknown> => {
    if (path.length > 16) throw new Error("Compound nesting exceeds 16 levels.");
    type Entry = { node: XmlNode; start: number; duration: number; source: number };
    const lanes = new Map<number, Entry[]>();
    const marks: Record<string, unknown>[] = [];
    const collect = (parent: XmlNode, parentAt: number, parentSource: number, defaultLane = 0) => {
      let cursor = 0;
      for (const n of parent.children) {
        if (["marker", "chapter-marker"].includes(n.tag)) {
          marks.push({ OTIO_SCHEMA: "Marker.2", name: n.attrs.value ?? "", marked_range: range(parentAt + number(n.attrs.start) - parentSource, 0) }); continue;
        }
        if (n.tag === "spine") { collect(n, parentAt + number(n.attrs.offset) - parentSource, number(n.attrs.start), Number(n.attrs.lane) || defaultLane); continue; }
        const unsupported = ["title", "mc-clip", "sync-clip", "audition"].includes(n.tag);
        if (!["asset-clip", "ref-clip", "gap", "clip", "video", "audio", "transition"].includes(n.tag) && !unsupported) {
          if (parent.tag !== "transition" && ["timeMap", "filter-video", "filter-audio", "title", "mc-clip", "sync-clip", "audition"].includes(n.tag)) warn(`FCPXML ${n.tag} could not be mapped.`);
          continue;
        }
        if (unsupported) warn(`FCPXML ${n.tag} could not be mapped; kept as a gap.`);
        const start = parentAt + number(n.attrs.offset, cursor + parentSource) - parentSource;
        const component = n.tag === "clip" ? n.children.find(c => ["video", "audio"].includes(c.tag) && c.attrs.ref) : undefined;
        const ref = byId.get(n.attrs.ref ?? component?.attrs.ref);
        const originalSource = number(n.attrs.start);
        const source = component ? originalSource + number(component.attrs.start) - number(component.attrs.offset) : originalSource;
        const available = ref?.tag === "media" ? child(ref, "sequence")?.attrs.duration : ref?.attrs.duration;
        const duration = number(n.attrs.duration, Math.max(0, number(component?.attrs.duration ?? available) - (source - number(ref?.attrs.start))));
        if (duration < 0) throw new Error("Negative FCPXML duration.");
        cursor = start - parentAt + duration;
        const lane = Number(n.attrs.lane) || defaultLane;
        const entries = lanes.get(lane) ?? []; lanes.set(lane, entries);
        entries.push({ node: component ? { ...n, tag: "asset-clip", attrs: { ...n.attrs, ref: component.attrs.ref } } : n, start, source, duration });
        collect(component ? { ...n, children: n.children.filter(c => c !== component) } : n, start, originalSource, lane);
      }
    };
    collect(child(sequence, "spine")!, 0, number(sequence.attrs.tcStart));
    // Spine offsets use the sequence's start clock; the OpenFrame timeline starts at 0.
    const result = [];
    for (const [lane, entries] of [...lanes].sort((a, b) => a[0] - b[0])) {
      entries.sort((a, b) => a.start - b.start);
      const transitions = entries.filter(e => e.node.tag === "transition");
      for (const tr of transitions) {
        const i = entries.indexOf(tr), prev = entries[i - 1], next = entries[i + 1];
        const before = Math.floor(tr.duration / fd / 2) * fd, after = tr.duration - before;
        if (prev && next) { prev.duration += before; next.start -= after; next.source -= after; next.duration += after; }
        else warn("FCPXML transition without two neighboring clips was skipped.");
      }
      let at = 0;
      const children: Record<string, unknown>[] = [];
      let info: Record<string, unknown> = {};
      for (const e of entries) {
        const n = e.node;
        if (n.tag === "transition") {
          const effect = byId.get(child(n, "filter-video")?.attrs.ref ?? "");
          if (!/dissolve/i.test(n.attrs.name ?? effect?.attrs.name ?? "")) warn(`FCPXML transition ${n.attrs.name ?? effect?.attrs.name ?? "unknown"} mapped to dissolve.`);
          if (children.length) children.push({ OTIO_SCHEMA: "Transition.1", transition_type: "SMPTE_Dissolve", in_offset: rt(Math.floor(e.duration / fd / 2) * fd), out_offset: rt(e.duration - Math.floor(e.duration / fd / 2) * fd) });
          continue;
        }
        info = { ...info, ...metadata(n, "track") };
        if (e.start > at + fd / 10) children.push({ OTIO_SCHEMA: "Gap.1", source_range: range(0, e.start - at) });
        const asset = byId.get(n.attrs.ref);
        const generator = metadata(n, "generator");
        let item: Record<string, unknown>;
        if (asset?.tag === "media") {
          if (path.includes(n.attrs.ref)) throw new Error("Cyclic FCPXML compound reference.");
          const nested = child(asset, "sequence");
          if (!nested) { warn(`Compound ${n.attrs.name ?? n.attrs.ref} has no sequence; kept as a gap.`); item = { OTIO_SCHEMA: "Gap.1" }; }
          else item = { ...stack(nested, [...path, n.attrs.ref]), metadata: { openframe: { compoundName: asset.attrs.name, compoundRef: n.attrs.ref } } };
        } else if ((n.tag === "gap" && !["text", "color"].includes(String(generator.type))) || ["title", "mc-clip", "sync-clip", "audition"].includes(n.tag)) item = { OTIO_SCHEMA: "Gap.1" };
        else if (generator.type === "text" || generator.type === "color") item = { OTIO_SCHEMA: "Clip.1", media_reference: { OTIO_SCHEMA: "GeneratorReference.1", generator_kind: generator.type, parameters: generator } };
        else {
          const src = asset && (child(asset, "media-rep")?.attrs.src ?? asset.attrs.src);
          item = { OTIO_SCHEMA: "Clip.1", metadata: { video_editor: { muted: n.attrs.srcEnable === "video" } }, media_reference: { OTIO_SCHEMA: src ? "ExternalReference.1" : "MissingReference.1", target_url: src, available_range: asset?.attrs.duration ? range(0, number(asset.attrs.duration)) : null, metadata: { openframe: { name: asset?.attrs.name, hasAudio: asset?.attrs.hasAudio === "1" } } } };
        }
        Object.assign(item, { name: n.attrs.name, source_range: range(Math.max(0, e.source - (asset?.tag === "asset" ? number(asset.attrs.start) : 0)), e.duration), enabled: n.attrs.enabled !== "0" });
        children.push(item); at = e.start + e.duration;
        for (const c of n.children) if (["timeMap", "filter-video", "filter-audio"].includes(c.tag)) warn(`FCPXML ${c.tag} could not be mapped.`);
      }
      result.push({ OTIO_SCHEMA: "Track.1", kind: lane < 0 || info.kind === "audio" ? "Audio" : "Video", name: info.name ?? (lane === 0 ? "Main" : `Lane ${lane}`), children, metadata: { openframe: { main: lane === 0 } } });
    }
    return { OTIO_SCHEMA: "Stack.1", children: result, markers: marks };
  };
  const imported = fromOtio({ OTIO_SCHEMA: "Timeline.1", name: project.attrs.name ?? "Imported timeline", global_start_time: rt(0), tracks: stack(seq), metadata: { video_editor: { width: Number(format?.attrs.width) || 1920, height: Number(format?.attrs.height) || 1080 } } });
  return { project: imported.project, warnings: [...warnings, ...imported.warnings] };
}
