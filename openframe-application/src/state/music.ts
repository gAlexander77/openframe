import { dismiss, toast, updateToast } from "./toast";
// Generate music (ADR-085): an original score rendered on this computer in
// a worker, imported like a dropped file (the mix, and the four stems when
// asked), then placed on an audio track and marked as analyze_music marks a
// track, the placing and marking one undoable edit (the files stay in the
// media, as add_sound_effect's do). The Audio tab's card previews a score
// through the app's own audio output before adding it.

import { renderMusicFiles, renderMusicPcm, type Measured } from "../engine/music";
import { audioContext, masterBus } from "../engine/audio";
import { planMusic, type MusicPlan } from "../lib/music/arrange";
import { cueSheet, musicName, readMusicArgs, type CueSheet, type MusicOptions } from "../lib/music/cues";
import { STEMS, STYLES, type Stem } from "../lib/music/styles";
import { placeAsset } from "../lib/drop";
import { runCommand } from "../lib/commands";
import { markMusicClip, MUSIC_MARKERS, SECTION_NAMES } from "../lib/epic";
import { createTrack } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Asset, Id, MusicGrid, Project } from "../lib/project/types";
import { secondsToFrames } from "../lib/time";
import { edit } from "./actions";
import { adoptAndImport } from "./media";
import { projectWork } from "./projectWork";

export interface MusicAnswer extends CueSheet {
  asset_id: Id;
  clip_id?: Id;
  stems?: Partial<Record<Stem, { asset_id: Id; clip_id?: Id }>>;
  measured: Measured;
  markers: number;
  note: string;
}

const STEM_NAMES: Record<Stem, string> = { drums: "Drums", bass: "Bass", harmony: "Harmony", lead: "Lead" };

/** The markers analyze_music would leave, from the cue sheet: on the placed
 * clip, following it (a song's beats stay on it when it is moved or
 * trimmed); not placed, at seconds into the music. */
function markMusic(p: Project, cue: CueSheet, kinds: MusicOptions["markers"], clipId?: Id): Project {
  if (clipId) {
    const file = (ts: number[]) => ts.map((t) => t - cue.start);
    const phrases = cue.cut_points.filter((c) => c.kind !== "bar").map((c) => c.at);
    return markMusicClip(p, clipId, { beats: file(cue.beats), downbeats: file(cue.bars), phrases: file(phrases), sections: cue.sections.map((x) => ({ start: x.start - cue.start, label: x.role })), drops: file(cue.drops) }, kinds);
  }
  for (const k of kinds) {
    const { label, color } = MUSIC_MARKERS[k];
    if (k === "sections") {
      for (const s of cue.sections) p = runCommand(p, "add_markers", { times: [s.start], label: SECTION_NAMES[s.role], color });
      continue;
    }
    const times = k === "beats" ? cue.beats : k === "bars" ? cue.bars : k === "drop" ? cue.drops : cue.cut_points.filter((c) => c.kind !== "bar").map((c) => c.at);
    if (times.length) p = runCommand(p, "add_markers", { times, label, color });
  }
  return p;
}

/** Place the mix (or the stems, each on a new track, grouped) at `start`. */
function placeMusic(p: Project, o: MusicOptions, mix: Asset, stems: Partial<Record<Stem, Asset>>): { project: Project; clipId?: Id; stemClips: Partial<Record<Stem, Id>> } {
  const frame = secondsToFrames(o.start, p.fps);
  const stemClips: Partial<Record<Stem, Id>> = {};
  if (o.place === "mix") {
    const r = placeAsset(p, mix, frame, undefined, false);
    return { project: r.project, clipId: r.clipId, stemClips };
  }
  if (o.place === "stems") {
    for (const s of STEMS) {
      const a = stems[s];
      if (!a) continue;
      const t = { ...createTrack("audio", STEM_NAMES[s]), role: "music" as const };
      p = ops.addTrack(p, t);
      const r = placeAsset(p, a, frame, t.id, false);
      p = r.project;
      stemClips[s] = r.clipId;
    }
    const ids = Object.values(stemClips) as Id[];
    if (ids.length > 1) p = runCommand(p, "group_clips", { clip_ids: ids });
  }
  return { project: p, stemClips };
}

/**
 * generate_music: plan, render (in the worker), import, place and mark.
 * `args` are the tool's (snake_case); answers the cue sheet in timeline
 * seconds (music seconds when not placed), the new ids and measurements.
 */
export async function generateMusic(args: Record<string, unknown>, onProgress?: (p: number) => void): Promise<MusicAnswer> {
  const o = readMusicArgs(args);
  const plan: MusicPlan = planMusic(o.request);
  const cancel = new AbortController();
  const signal = AbortSignal.any([cancel.signal, projectWork.capture()]);
  const tid = toast("Composing and rendering music\u2026", "progress", undefined, { label: "Cancel", run: () => cancel.abort() });
  try {
    const files = await renderMusicFiles(o.request, { stems: o.stems, loudness: o.loudness }, x => { onProgress?.(x); updateToast(tid, { progress: x }); }, signal);
    signal.throwIfAborted();
    const base = musicName(plan, STYLES[plan.style].label, o.name);
    const list = [new File([files.mix], `${base}.wav`, { type: "audio/wav" })];
    if (files.stems) for (const s of STEMS) list.push(new File([files.stems[s]], `${base} - ${s}.wav`, { type: "audio/wav" }));
    const assets = await adoptAndImport(list, signal);
    signal.throwIfAborted();
    if (assets.length !== list.length) throw new Error("The music was made but could not be imported; the app shows why.");
    // A score is music (ADR-098): its track is the music stem, never a gap on the voiceover.
    const made = new Set(assets.map((a) => a.id));
    const [mix, ...rest] = assets.map((a) => ({ ...a, role: "music" as const }));
    const stemAssets: Partial<Record<Stem, Asset>> = files.stems ? Object.fromEntries(STEMS.map((s, i) => [s, rest[i]])) : {};
    const placed = o.place !== "none";
    const cue = cueSheet(plan, placed ? o.start : 0);
    let clipId: Id | undefined;
    let stemClips: Partial<Record<Stem, Id>> = {};
    let markers = 0;
    // The score's grid is known exactly: kept with its files, so analyze_music,
    // mark_beats and check_project read it instead of guessing (ADR-101).
    const grid: MusicGrid = { bpm: +(60 / plan.beat).toFixed(4), firstDownbeat: 0, sections: cue.sections.map((x) => ({ at: +(x.start - cue.start).toFixed(4), label: x.role })) };
    if (placed || o.markers.length) {
      edit(`Generate music`, (p0) => {
        let p = { ...p0, assets: p0.assets.map((a) => (made.has(a.id) ? { ...a, role: "music" as const, musicGrid: grid } : a)) };
        if (placed) ({ project: p, clipId, stemClips } = placeMusic(p, o, mix, stemAssets));
        const before = p.markers.length;
        p = markMusic(p, cue, o.markers, clipId ?? Object.values(stemClips)[0]);
        markers = p.markers.length - before;
        return p;
      });
    } else edit(`Generate music`, (p0) => ({ ...p0, assets: p0.assets.map((a) => (made.has(a.id) ? { ...a, role: "music" as const, musicGrid: grid } : a)) }));
    const stems = files.stems ? Object.fromEntries(STEMS.map((s) => [s, { asset_id: stemAssets[s]!.id, ...(stemClips[s] ? { clip_id: stemClips[s] } : {}) }])) : undefined;
    const note = [
      placed ? `Placed at ${o.start} s; every time is timeline seconds.` : "Not placed: times are seconds into the music.",
      plan.fit.targets.length ? plan.fit.note : "",
      plan.ending === "ring" ? `The final hit is at ${cue.final_hit} s and rings out to the end.` : `It stops on the final hit at ${cue.final_hit} s.`,
    ].filter(Boolean).join(" ");
    const brightness = o.request.brightness ?? STYLES[plan.style].brightness ?? 0;
    return { asset_id: mix.id, ...(clipId ? { clip_id: clipId } : {}), ...(stems ? { stems } : {}), ...cue, measured: { ...files.measured, brightness }, markers, note };
  } finally { dismiss(tid); }
}

// ---- preview (the Generate music card) -------------------------------------------------

let playing: AudioBufferSourceNode | null = null;

/** Stop a preview that is playing. */
export function stopPreview() {
  try {
    playing?.stop();
  } catch {
    /* already stopped */
  }
  playing = null;
}

/** Render and play a score without adding it; resolves when it starts. */
export async function previewMusic(args: Record<string, unknown>, onProgress?: (p: number) => void, signal?: AbortSignal, onEnded?: () => void): Promise<Measured> {
  const o = readMusicArgs(args);
  const r = await renderMusicPcm(o.request, o.loudness, onProgress, signal);
  stopPreview();
  const ctx = audioContext();
  const buf = ctx.createBuffer(2, r.left.length, r.rate);
  buf.copyToChannel(r.left, 0);
  buf.copyToChannel(r.right, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(masterBus().input);
  src.onended = () => {
    if (playing === src) playing = null;
    onEnded?.();
  };
  await ctx.resume();
  src.start();
  playing = src;
  return r.measured;
}
