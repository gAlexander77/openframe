import { safeFileName } from "../lib/export";
import { toOtio } from "../lib/interchange/otio";
import { toFcpxml } from "../lib/interchange/fcpxml";
import { audioEdls, toEdl } from "../lib/interchange/edl";
import { platform } from "../platform";
import { store } from "./store";

export type TimelineFormat = "otio" | "fcpxml" | "edl";

/** The same positional save path as a video or the original OTIO export. */
export async function saveTimeline(format: TimelineFormat, folder?: string, agent = false): Promise<{ files: string[]; warnings: string[] } | null> {
  if (folder !== undefined && platform.kind !== "desktop") throw new Error("Exporting to a folder is desktop only; the web build uses a save dialog or download.");
  const p = store.document();
  const warnings: string[] = [];
  const tracks = [...p.tracks, ...(p.compounds ?? []).flatMap(k => k.tracks)];
  if (format !== "otio") {
    if (tracks.some(t => t.clips.some(c => "effects" in c && c.effects.length || "keyframes" in c && Object.keys(c.keyframes ?? {}).length))) warnings.push("Effects and keyframes are not carried by this format.");
    if (tracks.some(t => t.clips.some(c => "speed" in c && (c.speed !== 1 || c.speedCurve || c.reverse || c.freeze)))) warnings.push("Speed changes are exported as cuts with the original source in-point; use OTIO for speed metadata.");
    if (tracks.some(t => t.clips.some(c => !["video", "audio", "image", "compound"].includes(c.type)))) warnings.push("Titles, color clips and adjustment layers become gaps in other editors; FCPXML retains basic text and color in OpenFrame metadata.");
    if (tracks.some(t => t.clips.some(c => "transitionOut" in c && c.transitionOut && c.transitionOut.type !== "dissolve"))) warnings.push("Transitions are mapped to cross dissolves.");
  }
  if (format === "edl") warnings.push("EDL carries the main video track and one file per audio track. Overlays, markers and compounds are not included; compound clips become black.");
  if (format === "edl" && tracks.some(t => t.clips.some((c, i) => {
    const next = t.clips[i + 1];
    return "transitionOut" in c && c.transitionOut && next && "in" in next && next.in * p.fps.num / p.fps.den < Math.floor(c.transitionOut.duration / 2);
  }))) warnings.push("An incoming clip has too little source before its in-point for a centered EDL dissolve; that dissolve begins later, at the available handle.");
  const entries = [{ name: p.name, text: format === "otio" ? JSON.stringify(toOtio(p), null, 2) : format === "fcpxml" ? toFcpxml(p) : toEdl(p) }, ...(format === "edl" ? audioEdls(p).map((e, i) => ({ name: `${p.name} - A${i + 1} ${e.name}`, text: e.text })) : [])];
  const files: string[] = [];
  for (const entry of entries) {
    const target = agent && platform.createAgentExportTarget
      ? await platform.createAgentExportTarget(safeFileName(entry.name), format, folder)
      : await platform.createExportTarget(safeFileName(entry.name), format);
    if (!target) return files.length ? { files, warnings: [...warnings, "Save canceled before all timeline files were written."] } : null;
    const writer = target.writable.getWriter();
    try {
      await writer.write({ type: "write", data: new TextEncoder().encode(entry.text), position: 0 });
      await writer.close();
    } catch (e) { await writer.abort(e).catch(() => undefined); throw e; }
    finally { writer.releaseLock(); }
    files.push(target.displayName);
    if (target.revealLabel) await target.reveal();
  }
  return { files, warnings };
}
