// Auto ducking: where speech plays, dip a music clip's volume, as editable
// volume keyframes rather than a hidden sidechain (Premiere's Auto-Duck
// works this way; CapCut's ducking is a black box you cannot touch up).

import { tracksOfRole } from "../audioRoles";
import { sourceToTimeline } from "./musicMap";
import { soundingClips, soundSpan } from "../audio";
import { interpolate } from "../keyframes";
import { clipEnd } from "../project/ops";
import type { AudioClip, Clip, DuckRecord, Id, Keyframe, MusicGrid, Project, VideoClip } from "../project/types";
import { framesToSeconds, secondsToFrames, type Rational } from "../time";
import { voiceClips } from "../voiceLines";

/** A deep dip often hides a quiet recording; normalize the voice first. */
export function quietVoiceNote(lufs: number | null | undefined, depth: number, clipIds: Id[]): string | undefined {
  if (!(typeof lufs === "number" && lufs < -23) && depth <= 20) return undefined;
  return `The voice is quiet${typeof lufs === "number" ? ` (${+lufs.toFixed(1)} LUFS in the speech window)` : ""}; the music had to dip ${+depth.toFixed(1)} dB. Run normalize_loudness clip_ids ${JSON.stringify([...new Set(clipIds)])} target -16 on the dialog first to let the music dip less.`;
}

/** A sound that plays under ducked music: the clip as it plays on the
 * timeline (moved out through any compound clips it is in), the top-level
 * clip that plays it (a stem keeps that one) and the frames it is heard. */
export interface VoiceUnder {
  clip: VideoClip | AudioClip;
  top: Id;
  /** Timeline frames it sounds in (inside a compound clip, its span). */
  span: [number, number];
}

/**
 * The clips with sound under any of `music` that are not one of them,
 * as the mixer hears them (soundingClips: muted, disabled and frozen ones
 * left out; a track soloed to listen is no reason to leave the rest out),
 * through compound clips too: an interview kept in a compound clip (a
 * template, ADR-100's bus) is a voice like any other, where
 * duck_under_speech said nothing played under the music.
 */
export function voicesUnder(p: Project, music: (VideoClip | AudioClip)[], hasAudio: (assetId: string) => boolean): VoiceUnder[] {
  const ids = new Set(music.map((m) => m.id));
  return soundingClips({ ...p, tracks: p.tracks.map((t) => (t.solo ? { ...t, solo: false } : t)) }, hasAudio).flatMap((s) => {
    const top = s.via?.at(-1)?.clip.id ?? s.clip.id;
    if (ids.has(top) || !(s.clip.volume > 0)) return [];
    const [lo, hi] = soundSpan(s, p.fps);
    const span: [number, number] = [secondsToFrames(lo, p.fps), secondsToFrames(hi, p.fps)];
    if (!(span[1] > span[0]) || !music.some((m) => span[0] < m.start + m.duration && span[1] > m.start)) return [];
    return [{ clip: s.clip, top, span }];
  });
}

/** duck_under_speech's defaults (ADR-114): a pause under 1.1 s stays down
 * (with the 0.1 s attack and 0.4 s release it would be up for under 0.6 s:
 * a pump), and the music takes 0.4 s to come back after a line. */
export const DUCK_MIN_GAP = 1.1;
export const DUCK_RELEASE = 0.4;
export const DUCK_ATTACK = 0.1;

export interface DuckOptions {
  /** How far the music dips under speech, dB. */
  depthDb: number;
  /** Frames the dip starts before speech, so the first word is clear. */
  attack: number;
  /** Frames the music takes to come back after speech. */
  release: number;
  /** A pause shorter than this many frames stays down: between lines, and
   * between the music's start and the first line or the last line and the
   * music's end, so the music never swells for a moment and dips again
   * (a pump, or the 0.1 s blip before a first line: ADR-114). */
  gap: number;
  /** Timeline frames the music is up at (open_at: a drop): the pause that
   * holds one comes up, however short; one inside a line stays down. */
  open?: number[];
}

/** One dip under the lines of a music bed, on the timeline. */
export interface DuckPlan {
  /** Timeline frames and gains against the music's own volume (1: as it is). */
  keys: { f: number; g: number }[];
  /** Stretches the music dips for (lines sharing a dip are one). */
  dips: number;
  /** Pauses between lines the music stays down through (shorter than the
   * gap, holding no open moment), timeline frames. */
  held: [number, number][];
  /** Each open moment: the frames the music is up around it (up), or the
   * line it falls inside, where it stays down (line); neither when the
   * music does not play there. */
  open: { at: number; up?: [number, number]; line?: [number, number] }[];
}

/**
 * Where the music sits under `speech` (timeline frame spans [a, b), one
 * per line) across a bed playing timeline frames [lo, hi): down to
 * `depthDb` (or each line's `depths`, dB, in `speech`'s order: a line the
 * music covers more dips deeper) while a line speaks. Lines whose pause
 * is shorter than the gap share a dip, the level moving in the pause
 * where their depths differ, as a mixer rides a fader between lines; a
 * pause that holds an open moment comes up whatever its length, back at
 * the music's volume by the moment and down again after it. One plan over
 * the whole bed, so a cut between two pieces of a song is no edge.
 */
export function duckPlan(speech: [number, number][], lo: number, hi: number, o: DuckOptions, depths?: number[]): DuckPlan {
  const spans = speech
    .map(([a, b], i) => ({ a: Math.max(a, lo), b: Math.min(b, hi), d: depths?.[i] ?? o.depthDb }))
    .filter((s) => s.b > s.a)
    .sort((x, y) => x.a - y.a);
  // Overlapping lines (two voices at once) are one, at the deeper depth.
  const lines: { a: number; b: number; d: number }[] = [];
  for (const s of spans) {
    const last = lines[lines.length - 1];
    if (last && s.a <= last.b) [last.b, last.d] = [Math.max(last.b, s.b), Math.max(last.d, s.d)];
    else lines.push({ ...s });
  }
  const moments = [...new Set(o.open ?? [])].sort((x, y) => x - y);
  const inLine = (m: number) => lines.find((l) => m >= l.a && m < l.b);
  const low = (d: number) => Math.pow(10, -d / 20);
  const keys: { f: number; g: number }[] = [];
  const held: [number, number][] = [];
  const up = new Map<number, [number, number]>();
  // Each pause, from a to b, between two lines or a line and the bed's
  // edge: held down, or up from the release to the attack and at its
  // music's volume by every moment it holds.
  const pause = (a: number, b: number, before?: { d: number }, after?: { d: number }) => {
    const ms = moments.filter((m) => m >= a && m < b && !inLine(m));
    if (!ms.length && b - a < o.gap) {
      if (!before) keys.push({ f: lo, g: low(after!.d) });
      else if (!after) keys.push({ f: hi - 1, g: low(before.d) });
      else {
        held.push([a, b]);
        if (before.d !== after.d) keys.push({ f: a, g: low(before.d) }, { f: b, g: low(after.d) });
      }
      return;
    }
    // Never up inside a line: a frame after the one before, a frame
    // before the next.
    let rise = before ? Math.max(a + 1, Math.min(a + o.release, ...ms)) : lo;
    let fall = after ? Math.min(b - 1, Math.max(b - o.attack, ...ms)) : hi - 1;
    if (before && after && rise > fall) {
      if (!ms.length) {
        // Shorter than the attack and the release together: the music
        // comes part of the way up, where the two ramps meet.
        const at = Math.round(a + ((b - a) * o.release) / (o.attack + o.release));
        if (at > a && at < b) keys.push({ f: at, g: low(before.d) + (1 - low(before.d)) * Math.min(1, (at - a) / o.release) });
        return;
      }
      rise = fall = Math.max(a + 1, Math.min(b - 1, ms[0]));
    }
    if (before && rise < hi - 1) keys.push({ f: rise, g: 1 });
    if (after) keys.push({ f: Math.max(lo, fall), g: 1 });
    for (const m of ms) up.set(m, [rise, fall]);
  };
  if (lines.length) pause(lo, lines[0].a, undefined, lines[0]);
  lines.forEach((l, i) => {
    keys.push({ f: l.a, g: low(l.d) }, { f: Math.min(hi - 1, l.b), g: low(l.d) });
    const next = lines[i + 1];
    pause(l.b, next ? next.a : hi, l, next);
  });
  const open = moments.map((at) => {
    const line = inLine(at);
    if (line) return { at, line: [line.a, line.b] as [number, number] };
    const u = up.get(at);
    return u ? { at, up: u } : { at };
  });
  // In time order, one key a frame (the later wins), none in the middle
  // of three at one level.
  keys.sort((x, y) => x.f - y.f);
  const one = keys.filter((k, i) => keys[i + 1]?.f !== k.f);
  return { keys: one.filter((k, i) => !(i > 0 && i < one.length - 1 && one[i - 1].g === k.g && one[i + 1].g === k.g)), dips: lines.length ? lines.length - held.length : 0, held, open };
}

/** The plan's keys as one clip of the bed plays them: frames from its
 * start, scaled by its volume; where the plan runs on past its edges, a
 * key at each edge holds the level there. */
export function clipKeys(plan: Pick<DuckPlan, "keys">, start: number, end: number, base: number): { f: number; v: number }[] {
  const ks = plan.keys;
  if (!ks.length) return [];
  const at = (f: number) => interpolate(ks.map((k) => ({ f: k.f, v: k.g })), f);
  const inside = ks.filter((k) => k.f >= start && k.f <= end - 1).map((k) => ({ f: k.f, g: k.g }));
  if (ks[0].f < start && inside[0]?.f !== start) inside.unshift({ f: start, g: at(start) });
  if (ks[ks.length - 1].f > end - 1 && inside[inside.length - 1]?.f !== end - 1) inside.push({ f: end - 1, g: at(end - 1) });
  return inside.map((k) => ({ f: k.f - start, v: base * k.g }));
}

/**
 * Volume keyframes (frames from the clip's start, linear gain) that hold
 * `base` and dip under `speech` (timeline frame spans [a, b)) for a clip
 * covering timeline frames [start, end): duckPlan over the clip alone.
 */
export function duckKeys(speech: [number, number][], start: number, end: number, base: number, o: DuckOptions, depths?: number[]): { f: number; v: number }[] {
  return clipKeys(duckPlan(speech, start, end, o, depths), start, end, base);
}

/**
 * Each music clip's volume keys for one dip under `speech` across several
 * clips (a music track cut into pieces, ducked in one call): one plan over
 * the whole bed, each clip given its part, so a line across a cut dips on
 * both sides of it and the music never comes up at a cut between lines
 * (it did, for 0.2 s, at a song's cut 0.7 s before a line).
 */
export function trackDuckKeys(speech: [number, number][], clips: { id: string; start: number; end: number; base: number }[], o: DuckOptions, depths?: number[]): { plan: DuckPlan; keys: Map<string, { f: number; v: number }[]> } {
  const plan = duckPlan(speech, Math.min(...clips.map((c) => c.start)), Math.max(...clips.map((c) => c.end)), o, depths);
  return { plan, keys: new Map(clips.map((c) => [c.id, clipKeys(plan, c.start, c.end, c.base)])) };
}

// ---- keys made by hand outlive a duck (ADR-114) ---------------------------------
// The second film test lifted its music on the drops and before its last
// hit by hand; running the duck again wiped those keys.

/** A key's place in the clip's file, ms: it keeps it through a move, a
 * split or a trim (the keys shift with the in-point). ponytail: a speed
 * curve or a reversed clip is read at its plain speed. */
const fileMs = (c: { in: number; speed: number }, f: number, fps: Rational) => Math.round((c.in + framesToSeconds(f, fps) * (c.speed || 1)) * 1000);

/** What a duck keeps of the keys it wrote: each key's place in the file
 * (ms) and its value (x 1e4), so a key it wrote is known later and one
 * added or changed by hand is not. */
export function writtenKeys(c: { in: number; speed: number }, keys: { f: number; v: number }[], fps: Rational): [number, number][] {
  return keys.map((k) => [fileMs(c, k.f, fps), Math.round(k.v * 1e4)]);
}

/** Is a volume key one the clip's last duck wrote? With no record of its
 * keys (a duck from before ADR-114) every key is; never ducked, none is. */
export function duckWrote(c: { in: number; speed: number; duck?: DuckRecord }, fps: Rational): (k: Keyframe) => boolean {
  const list = c.duck?.written;
  if (!c.duck) return () => false;
  if (!list) return () => true;
  // Within 0.6 of a frame: a key the duck wrote stays on its frame.
  const tol = framesToSeconds(0.6, fps) * 1000;
  return (k) => {
    const ms = fileMs(c, k.f, fps), v = Math.round(k.v * 1e4);
    return list.some(([m, x]) => Math.abs(m - ms) <= tol && Math.abs(x - v) <= 1);
  };
}

/**
 * A clip's volume keys after a duck: `duck` (its new keys, clip frames)
 * and the keys already there that the last duck did not write (made by
 * hand) wherever no line speaks (`lines`, clip frames, edges included).
 * In a pause that holds one, the hand's keys replace the duck's there,
 * and the duck's level is held at the lines either side, so the hand's
 * level never ramps under a voice. One on a line's first or last frame
 * moves a frame into the pause; one inside a line is replaced: the duck
 * sets the level a voice is heard over.
 */
export function mergeKeys(current: Keyframe[] | undefined, wrote: (k: Keyframe) => boolean, duck: { f: number; v: number }[], lines: [number, number][]): { keys: Keyframe[]; ours: { f: number; v: number }[]; kept: Keyframe[]; replaced: Keyframe[] } {
  const under = (f: number) => lines.some(([a, b]) => f >= a && f <= b);
  // A key on a line's first or last frame (the tester lifted the duck's
  // own key at a line's end for the hit after it) moves a frame into the
  // pause beside it: the line's edge is the duck's, or the level would
  // ramp under the voice.
  const hand = (current ?? []).filter((k) => !wrote(k)).map((k) => {
    const off = lines.find(([, b]) => k.f === b && !under(b + 1)) ? 1 : lines.find(([a]) => k.f === a && !under(a - 1)) ? -1 : 0;
    return off ? { ...k, f: k.f + off } : k;
  });
  const kept = hand.filter((k) => !under(k.f)), replaced = hand.filter((k) => under(k.f));
  if (!kept.length || !duck.length) return { keys: [...duck.map((k) => ({ f: k.f, v: k.v })), ...(duck.length ? [] : kept)].sort((x, y) => x.f - y.f), ours: duck, kept, replaced };
  // The pause around a frame: the end of the line before, the start of the next.
  const pauses = kept.map((k): [number, number] => [Math.max(-Infinity, ...lines.filter(([, b]) => b < k.f).map(([, b]) => b)), Math.min(Infinity, ...lines.filter(([a]) => a > k.f).map(([a]) => a))]);
  const theirs = (f: number) => pauses.some(([a, b]) => f > a && f < b);
  const ours = duck.filter((k) => !theirs(k.f));
  for (const f of pauses.flat()) if (Number.isFinite(f) && !ours.some((k) => k.f === f)) ours.push({ f, v: interpolate(duck, f) });
  ours.sort((x, y) => x.f - y.f);
  return { keys: [...ours.map((k) => ({ f: k.f, v: k.v })), ...kept].sort((x, y) => x.f - y.f), ours, kept, replaced };
}

// ---- a duck that a voice line's change leaves behind (ADR-104) ----------------
// The film test retook its end-card line (34.30 -> 34.57 s) and the music
// rose under its last word: the dip stayed where the old take ended.

/** A signature of a clip's volume keys: their shape (each key's value and
 * where it sits from the first), so keys moved with their clip, or split
 * or trimmed with it (the keys shift, the shape stays), are still the ones
 * the duck wrote; a key added, moved or changed by hand is not. */
export function duckSignature(keys: Keyframe[] | undefined): number {
  const f0 = keys?.[0]?.f ?? 0;
  const s = JSON.stringify((keys ?? []).map((k) => [Math.round((k.f - f0) * 1000), Math.round(k.v * 1e4)]));
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** The timeline frame of a clip's first volume key: where its dips sit. */
const firstKeyAt = (c: { start: number; keyframes?: Clip["keyframes"] }) => {
  const k = c.keyframes?.volume?.[0];
  return k ? c.start + k.f : undefined;
};

/** What a duck keeps of the keys it wrote on a clip: their signature and
 * where the first sits on the timeline (DuckRecord's keys and at). */
export function duckMark(c: { start: number; keyframes?: Clip["keyframes"] }): Pick<DuckRecord, "keys" | "at"> {
  const at = firstKeyAt(c);
  return { keys: duckSignature(c.keyframes?.volume), ...(at !== undefined ? { at } : {}) };
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
  /** Clips the edit moved on the timeline, their dips with them, away
   * from the lines they were dipped for (a move, bars cut out before them). */
  moved: Id[];
}

type Span = [number, number];
const spansOf = (p: Project) => new Map(voiceClips(p).map((c) => [c.id, [c.start, clipEnd(c)] as Span]));
const meets = (a: Span, b: Span) => a[0] < b[1] && a[1] > b[0];

/**
 * The ducks an edit left behind: music clips duck_under_speech dipped
 * (their `duck`) under a voice line that the edit added, removed, moved
 * or changed the length of, judged from the line's old place and its new
 * one; and music the edit moved, its dips with it, away from where the
 * duck put them (cut_music on a ducked song moved the piece after the cut
 * and its dips under no line). A track ducked whole is one duck.
 */
export function staleDucks(before: Project, after: Project): StaleDuck[] {
  const was = spansOf(before), now = spansOf(after);
  const changed: { id: Id; spans: Span[] }[] = [];
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id), b = now.get(id);
    if (a && b && a[0] === b[0] && a[1] === b[1]) continue;
    changed.push({ id, spans: [a, b].filter((s): s is Span => !!s) });
  }
  const old = new Map(before.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
  const off = (x: number | undefined, y: number | undefined) => x !== undefined && y !== undefined && Math.abs(x - y) >= 0.5;
  // Moved by this edit: its first key is not where the duck put it, and was
  // somewhere else before the edit (or the clip is a new piece of one).
  const movedNow = (c: VideoClip | AudioClip) => {
    const at = firstKeyAt(c), prev = old.get(c.id);
    return off(at, c.duck!.at) && duckSignature(c.keyframes?.volume) === c.duck!.keys && (!prev || off(firstKeyAt(prev), at));
  };
  const out: StaleDuck[] = [];
  for (const t of after.tracks) {
    const ducked = t.clips.filter((c): c is VideoClip | AudioClip => (c.type === "audio" || c.type === "video") && !!c.duck);
    const whole = ducked.filter((c) => c.duck!.track);
    const groups = [...(whole.length ? [whole] : []), ...ducked.filter((c) => !c.duck!.track).map((c) => [c])];
    for (const g of groups) {
      const lines = changed.filter((l) => g.some((c) => l.spans.some((s) => meets(s, [c.start, clipEnd(c)])))).map((l) => l.id);
      const moved = g.filter(movedNow).map((c) => c.id);
      if (!lines.length && !moved.length) continue;
      out.push({ clipIds: g.map((c) => c.id), trackId: t.id, record: g[0].duck!, lineIds: lines, edited: g.filter((c) => duckSignature(c.keyframes?.volume) !== c.duck!.keys).map((c) => c.id), moved });
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
    ...(r.openAt?.length ? { open_at: r.openAt } : {}),
    ...(r.minGap !== undefined ? { min_gap: r.minGap } : {}),
    ...(r.release !== undefined ? { release: r.release } : {}),
  };
}

/** What an edit's answer says about a duck it left behind: the music still
 * dips where the lines were, and the call that dips it again. */
export function staleDuckNote(d: StaleDuck): string {
  const what = d.record.track ? `The music on track ${d.trackId}` : `The music clip ${d.clipIds[0]}`;
  const why = [d.lineIds.length ? `${d.lineIds.join(", ")} added, moved or changed length` : "", d.moved.length ? `${d.moved.join(", ")} moved, its dips with it` : ""].filter(Boolean).join("; ");
  return d.edited.length
    ? `${what} was ducked under the voice before this edit (${why}), and its volume keys were edited since (${d.edited.join(", ")}), so it was not dipped again: duck_under_speech ${JSON.stringify(duckArgs(d))} dips it under the lines as they are now, keeping the keys made by hand outside the lines and replacing those under a line.`
    : `${what} still dips for the voice as it was before this edit (${why}): duck_under_speech ${JSON.stringify(duckArgs(d))} dips it under the lines as they are now.`;
}

/** A moment a song is heard on (a drop, the final hit), a timeline frame. */
export interface CueMoment {
  frame: number;
  label: string;
}

/**
 * The moments of a song its music should be heard on, from the grid kept
 * with its file (generate_music's cue sheet, set_music_grid): each drop (a
 * drop after another part) and the final hit (the first beat of an outro
 * that ends the song), placed through `toFrame` (a source second to a
 * timeline frame; null where the clip does not play it).
 */
export function cueMoments(grid: MusicGrid | undefined, toFrame: (t: number) => number | null): CueMoment[] {
  const parts = grid?.sections ?? [];
  const out: CueMoment[] = [];
  parts.forEach((s, i) => {
    const what = s.label === "drop" && i > 0 && parts[i - 1].label !== "drop" ? "the drop" : s.label === "outro" && i === parts.length - 1 && i > 0 ? "the final hit (the outro's first beat)" : undefined;
    const f = what ? toFrame(s.at) : null;
    if (what && f !== null) out.push({ frame: f, label: what });
  });
  return out;
}

/**
 * The moments that fall inside a line, from the dip's attack before it to
 * its last word, and so play ducked under the voice (ADR-121): the third
 * film test's final hit at 60.234 s, a line starting at 60.233 s, went 10
 * dB down and nothing said so. `asked`: frames open_at named, which have
 * their own note. Each with the index of its line.
 */
export function cuesUnderLines(moments: CueMoment[], lines: [number, number][], attack: number, asked: number[]): { moment: CueMoment; line: number }[] {
  const out: { moment: CueMoment; line: number }[] = [];
  const seen: number[] = [];
  for (const m of moments) {
    if (asked.some((f) => Math.abs(f - m.frame) <= 1) || seen.some((f) => Math.abs(f - m.frame) <= 2)) continue;
    const line = lines.findIndex(([a, b]) => m.frame >= a - attack && m.frame < b);
    if (line < 0) continue;
    seen.push(m.frame);
    out.push({ moment: m, line });
  }
  return out;
}

/** Pauses actually held by the last duck, clipped to the measured window.
 * Split pieces may share one pause: count the union, not the records. */
export function duckRangeContext(p: Project, start = 0, end = Infinity): { music: boolean; heldPauses?: number } {
  const clips = tracksOfRole(p, "music").filter((t) => !t.muted && t.volume > 0).flatMap((t) => t.clips).filter((c): c is AudioClip => c.type === "audio" && !c.muted && !c.disabled && c.volume > 0 && framesToSeconds(c.start, p.fps) < end && framesToSeconds(c.start + c.duration, p.fps) > start);
  const ducked = clips.filter((c) => c.duck);
  if (!ducked.length || ducked.some((c) => c.duck!.held === undefined)) return { music: clips.length > 0 };
  const spans = ducked.flatMap((c) => {
    const map = sourceToTimeline(c, p.fps);
    return c.duck!.held!.map(([a, b]) => [Math.max(start, map.edge(a)), Math.min(end, map.edge(b))]).filter(([a, b]) => b > a);
  }).sort((a, b) => a[0] - b[0]);
  let count = 0, last = -Infinity;
  for (const [a, b] of spans) {
    if (a > last + 0.001) count++;
    last = Math.max(last, b);
  }
  return { music: clips.length > 0, heldPauses: count };
}
