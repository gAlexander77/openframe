// CMX 3600 carries one picture track. Sound tracks are separate lists;
// compositions, effects and overlays need OTIO/FCPXML instead.
import type { Project, Track } from "../project/types";
import { formatTimecode, isDropFrameRate, secondsToFrames } from "../time";

export function toEdl(p: Project, track: Track | undefined = p.tracks.find(t => t.main)): string {
  const clean = (s: string) => s.replace(/[\r\n\x00-\x1f]/g, " ");
  const tc = (f: number) => formatTimecode(f, p.fps).replace(";", ":");
  const lines = [`TITLE: ${clean(p.name)}${track?.kind === "audio" ? ` - ${clean(track.name)}` : ""}`, `FCM: ${isDropFrameRate(p.fps) ? "DROP FRAME" : "NON-DROP FRAME"}`, ""];
  const clips = [...(track?.clips ?? [])].sort((a, b) => a.start - b.start);
  const incoming = (i: number) => {
    const prev = clips[i - 1], c = clips[i];
    return prev && c && prev.start + prev.duration === c.start && "transitionOut" in prev ? prev.transitionOut : undefined;
  };
  const head = (i: number) => Math.min(Math.floor((incoming(i)?.duration ?? 0) / 2), secondsToFrames("in" in clips[i] ? clips[i].in : 0, p.fps));
  const reels = new Map<string, string>();
  const taken = new Set<string>();
  for (const a of p.assets) {
    const base = clean(a.name).replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 8) || "AX";
    let reel = base, i = 1;
    while (taken.has(reel)) { const suffix = String(++i); reel = base.slice(0, 8 - suffix.length) + suffix; }
    reels.set(a.id, reel); taken.add(reel);
  }
  let event = 0, at = 0;
  const emit = (reel: string, edit: string, source: number, end: number, start: number, finish: number) => {
    if (++event > 999) throw new Error("CMX 3600 supports at most 999 events per EDL.");
    lines.push(`${String(event).padStart(3, "0")}  ${reel.padEnd(8)} ${track?.kind === "audio" ? "A" : "V"}     ${edit.padEnd(7)} ${tc(source)} ${tc(end)} ${tc(start)} ${tc(finish)}`);
  };
  clips.forEach((c, i) => {
    if (c.start > at) { emit("BL", "C", 0, c.start - at, at, c.start); lines.push(""); }
    const a = "assetId" in c ? p.assets.find(a => a.id === c.assetId) : undefined;
    const source = secondsToFrames("in" in c ? c.in : 0, p.fps);
    const prev = clips[i - 1], tr = incoming(i);
    const before = head(i), tail = i + 1 < clips.length ? head(i + 1) : 0;
    const record = c.start - before, finish = c.start + c.duration - tail;
    // CMX's D row begins at the transition's first frame. Shift the two
    // adjacent events back by the incoming handle to keep our centered cut.
    if (tr) {
      const outgoing = "assetId" in prev ? reels.get(prev.assetId) ?? "AX" : "BL";
      const out = secondsToFrames("in" in prev ? prev.in : 0, p.fps) + prev.duration - before;
      emit(outgoing, "C", out, out, record, record);
      event--;
    }
    emit(a ? reels.get(a.id)! : "BL", tr ? `D ${String(tr.duration).padStart(3, "0")}` : "C", source - before, source + c.duration - tail, record, finish);
    lines.push(`* FROM CLIP NAME: ${clean(a?.name ?? c.name ?? c.type)}`, "");
    at = c.start + c.duration;
  });
  return lines.join("\n");
}

export function audioEdls(p: Project): { name: string; text: string }[] {
  return p.tracks.filter(t => t.kind === "audio").map(t => ({ name: t.name, text: toEdl(p, t) }));
}
