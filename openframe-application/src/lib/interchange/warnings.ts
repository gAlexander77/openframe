import type { Project } from "../project/types";

/** Losses a foreign editor cannot reconstruct from the saved timeline.
 * OTIO stores OpenFrame metadata, which is not a portable renderer. */
export function timelineWarnings(p: Project, format: "otio" | "fcpxml" | "edl"): string[] {
  const tracks = [...p.tracks, ...(p.compounds ?? []).flatMap(k => k.tracks)];
  const clips = tracks.flatMap(t => t.clips), warnings: string[] = [];
  if (format === "edl") return ["EDL carries main video and separate audio edit lists with dissolves; overlays, titles, generators, effects, volume, fades, markers and compounds are not included. Use the finished video and final mix as references."];
  if (clips.some(c => "effects" in c && c.effects.length || "adjust" in c && Object.values(c.adjust).some(Boolean) || "filter" in c && c.filter || "mask" in c && c.mask || "canvas" in c && c.canvas || "cutout" in c && c.cutout || "grade" in c && c.grade)) warnings.push("Grading, filters, masks, canvas fills and visual effects are not reproduced by other editors; use the finished video as a visual reference.");
  if (tracks.some(t => t.inserts?.some(i => i.on)) || clips.some(c => "volume" in c && (c.eq || c.compressor || c.inserts?.some(i => i.on) || c.highpass || c.lowpass || c.reverb || c.echo || c.tapeStop || c.saturation || c.ringMod || c.fill || c.mono))) warnings.push("Dialogue cleanup, EQ, compression, track/clip inserts and sound processing are not rendered in interchange; export a final WAV mix for an audible reference.");
  if (clips.some(c => "speed" in c && (c.speed !== 1 || c.speedCurve || c.reverse || c.freeze))) warnings.push("Speed ramps, reverse and freezes are not reproduced by other editors; use rendered media for those shots.");
  if (format === "otio") {
    if (clips.some(c => c.type === "text" || c.type === "color" || c.type === "adjustment" || "keyframes" in c && Object.keys(c.keyframes ?? {}).length || "fadeIn" in c && (c.fadeIn || c.fadeOut))) warnings.push("OpenFrame titles, generators, keyframes and fades in OTIO metadata require OpenFrame; other editors may show gaps or omit their look and automation.");
    return warnings;
  }
  if (clips.some(c => !["video", "audio", "image", "compound", "text"].includes(c.type))) warnings.push("Color clips, shapes and adjustment layers become gaps in FCPXML; basic color remains in OpenFrame metadata. Export the finished video as the visual reference.");
  if (clips.some(c => c.type === "text")) warnings.push("FCPXML writes native Basic Titles with text, font, color, alignment and placement; wrapping, backgrounds, shadows, kinetic styling and title animations need finishing in the receiving editor.");
  if (clips.some(c => "keyframes" in c && Object.keys(c.keyframes ?? {}).some(k => k !== "volume") || "transform" in c && c.type !== "text" && (c.transform.x || c.transform.y || c.transform.scale !== 1 || c.transform.rotation) || "crop" in c && Object.values(c.crop).some(Boolean))) warnings.push("Picture transforms, crops and non-volume keyframes are not carried by FCPXML; use the finished video as a framing reference. Volume keys are sampled at timeline frames.");
  if (clips.some(c => "transitionOut" in c && c.transitionOut && c.transitionOut.type !== "dissolve")) warnings.push("FCPXML maps transitions to cross dissolves.");
  if (tracks.some(t => t.pan) || clips.some(c => "pan" in c && c.pan || "crossfade" in c && c.crossfade || "fadeInCurve" in c && c.fadeInCurve && c.fadeInCurve !== "linear" || "fadeOutCurve" in c && c.fadeOutCurve && c.fadeOutCurve !== "linear")) warnings.push("Audio pan, crossfades and custom fade curves are not carried exactly; FCPXML carries clip/track volume and linear fades. Export a final WAV mix for reference.");
  return warnings;
}
