// Auto ducking: where speech plays, dip a music clip's volume, as editable
// volume keyframes rather than a hidden sidechain (Premiere's Auto-Duck
// works this way; CapCut's ducking is a black box you cannot touch up).

import { clipEnd } from "../project/ops";
import type { AudioClip, DuckRecord, Id, Keyframe, Project, VideoClip } from "../project/types";
import { voiceClips } from "../voiceLines";

export interface DuckOptions {
  /** How far the music dips under speech, dB. */
  depthDb: number;
  /** Frames the dip starts before speech, so the first word is clear. */
  attack: number;
  /** Frames the music takes to come back after speech. */
  release: number;
  /** Pauses up to this many frames stay ducked, so the music does not pump
   * between sentences. */
  hold: number;
}

/**
 * Volume keyframes (frames from the clip's start, linear gain) that hold
 * `base` and dip to `base - depthDb` under `speech` (timeline frame spans
 * [a, b)). The clip covers timeline frames [start, end). `depths` gives
 * each span its own depth instead (dB, in `speech`'s order: a line the
 * music covers more dips deeper). Spans close enough to share a dip stay
 * down between them, and where their depths differ the level moves in the
 * pause between them, as a mixer rides a fader between lines.
 */
export function duckKeys(speech: [number, number][], start: number, end: number, base: number, o: DuckOptions, depths?: number[]): { f: number; v: number }[] {
  const spans = speech
    .map(([a, b], i) => ({ a: Math.max(a, start), b: Math.min(b, end), d: depths?.[i] ?? o.depthDb }))
    .filter((s) => s.b > s.a)
    .sort((x, y) => x.a - y.a);
  // Overlapping spans are one, at the deeper depth; nearby ones share a dip.
  const groups: { a: number; b: number; d: number }[][] = [];
  for (const s of spans) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (last && s.a <= last.b) [last.b, last.d] = [Math.max(last.b, s.b), Math.max(last.d, s.d)];
    else if (last && s.a - last.b <= o.attack + o.release + o.hold) group.push({ ...s });
    else groups.push([{ ...s }]);
  }
  const lastFrame = end - start - 1;
  const low = (d: number) => base * Math.pow(10, -d / 20);
  const keys: { f: number; v: number }[] = [];
  for (const g of groups) {
    const down = g[0].a - start;
    const up = g[g.length - 1].b - start;
    if (down - o.attack > 0) keys.push({ f: down - o.attack, v: base });
    keys.push({ f: Math.max(0, down), v: low(g[0].d) });
    for (let i = 1; i < g.length; i++) {
      if (g[i].d === g[i - 1].d) continue;
      keys.push({ f: Math.max(0, g[i - 1].b - start), v: low(g[i - 1].d) });
      keys.push({ f: Math.max(0, g[i].a - start), v: low(g[i].d) });
    }
    keys.push({ f: Math.min(lastFrame, up), v: low(g[g.length - 1].d) });
    if (up + o.release < lastFrame) keys.push({ f: up + o.release, v: base });
  }
  // Same frame twice (a dip from the clip's first frame): the later one wins.
  return keys.filter((k, i) => keys[i + 1]?.f !== k.f);
}

/**
 * Each music clip's volume keys for one dip under `speech` across several
 * clips (a music track cut into pieces, ducked in one call): every clip
 * gets duckKeys over its own span, so a line across a cut dips on both
 * sides of it at the same depth.
 */
export function trackDuckKeys(speech: [number, number][], clips: { id: string; start: number; end: number; base: number }[], o: DuckOptions, depths?: number[]): Map<string, { f: number; v: number }[]> {
  return new Map(clips.map((c) => [c.id, duckKeys(speech, c.start, c.end, c.base, o, depths)]));
}

// ---- a duck that a voice line's change leaves behind (ADR-104) ----------------
// The film test retook its end-card line (34.30 -> 34.57 s) and the music
// rose under its last word: the dip stayed where the old take ended.

/** A signature of a clip's volume keys: the duck keeps the one it wrote. */
export function duckSignature(keys: Keyframe[] | undefined): number {
  const s = JSON.stringify((keys ?? []).map((k) => [Math.round(k.f * 1000), Math.round(k.v * 1e4)]));
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** Ducked music whose voice lines moved or changed length since. */
export interface StaleDuck {
  /** The music clips to dip again together: a whole track's when it was ducked so. */
  clipIds: Id[];
  trackId: Id;
  record: DuckRecord;
  /** The voice lines over it that changed. */
  lineIds: Id[];
  /** Clips whose volume keys were changed since the duck (by hand): left alone. */
  edited: Id[];
}

type Span = [number, number];
const spansOf = (p: Project) => new Map(voiceClips(p).map((c) => [c.id, [c.start, clipEnd(c)] as Span]));
const meets = (a: Span, b: Span) => a[0] < b[1] && a[1] > b[0];

/**
 * The ducks an edit left behind: music clips duck_under_speech dipped
 * (their `duck`) under a voice line that the edit added, removed, moved
 * or changed the length of, judged from the line's old place and its new
 * one. A track ducked whole is one duck.
 */
export function staleDucks(before: Project, after: Project): StaleDuck[] {
  const was = spansOf(before), now = spansOf(after);
  const changed: { id: Id; spans: Span[] }[] = [];
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id), b = now.get(id);
    if (a && b && a[0] === b[0] && a[1] === b[1]) continue;
    changed.push({ id, spans: [a, b].filter((s): s is Span => !!s) });
  }
  if (!changed.length) return [];
  const out: StaleDuck[] = [];
  for (const t of after.tracks) {
    const ducked = t.clips.filter((c): c is VideoClip | AudioClip => (c.type === "audio" || c.type === "video") && !!c.duck);
    const whole = ducked.filter((c) => c.duck!.track);
    const groups = [...(whole.length ? [whole] : []), ...ducked.filter((c) => !c.duck!.track).map((c) => [c])];
    for (const g of groups) {
      const lines = changed.filter((l) => g.some((c) => l.spans.some((s) => meets(s, [c.start, clipEnd(c)])))).map((l) => l.id);
      if (!lines.length) continue;
      out.push({ clipIds: g.map((c) => c.id), trackId: t.id, record: g[0].duck!, lineIds: lines, edited: g.filter((c) => duckSignature(c.keyframes?.volume) !== c.duck!.keys).map((c) => c.id) });
    }
  }
  return out;
}

/** duck_under_speech's arguments that dip a stale duck again as it was dipped. */
export function duckArgs(d: Pick<StaleDuck, "clipIds" | "trackId" | "record">): Record<string, unknown> {
  const r = d.record;
  return {
    ...(r.track ? { track_id: d.trackId } : { clip_id: d.clipIds[0] }),
    ...(r.voiceAboveMusicLu !== undefined ? { voice_above_music_lu: r.voiceAboveMusicLu } : {}),
    ...(r.minLineLu !== undefined ? { min_line_lu: r.minLineLu } : {}),
    ...(r.maxLineLu !== undefined ? { max_line_lu: r.maxLineLu } : {}),
    ...(r.depth !== undefined ? { depth: r.depth } : {}),
  };
}

/** What an edit's answer says about a duck it left behind: the music still
 * dips where the lines were, and the call that dips it again. */
export function staleDuckNote(d: StaleDuck): string {
  const what = d.record.track ? `The music on track ${d.trackId}` : `The music clip ${d.clipIds[0]}`;
  const lines = d.lineIds.join(", ");
  return d.edited.length
    ? `${what} was ducked under the voice before ${lines} changed, and its volume keys were edited since (${d.edited.join(", ")}), so it was not dipped again: duck_under_speech ${JSON.stringify(duckArgs(d))} would replace those keys.`
    : `${what} still dips for the voice as it was before this edit (${lines} added, moved or changed length): duck_under_speech ${JSON.stringify(duckArgs(d))} dips it under the lines as they are now.`;
}
