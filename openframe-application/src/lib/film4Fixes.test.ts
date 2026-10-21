// The fourth Claude film test's answers, captions and hints (ADR-124): each
// test fails without its change.
import { afterAll, expect, it } from "vitest";
import { setTextMeasure } from "./align";
import { groupFindings, quietAnswer, shareClips, shareCommon, wholeClips } from "./answerSize";
import { addCaptions, describeProject, runCommand, type CommandReport } from "./commands";
import { checkProject } from "./designCheck";
import { filterDescription } from "./describeFilter";
import { describeChanges, handleMcp, type McpHost } from "./mcp";
import { createProject, createTextClip, createTrack } from "./project/defaults";
import type { Project, TextClip } from "./project/types";
import { lineScale, wrappedRange } from "./textRuns";

const tall = () => createProject({ width: 1080, height: 1920 });
const capStyle = { font: "Inter", weight: 800, size: 66, color: "#FFFFFF", highlight: "#FFD23F", case: "upper" as const, stroke: { color: "#000000", width: 8 } };
const words = ["Want to make", "this? Here's how,", "in four steps.", "Step one. Bring", "your clips in.", "They land in", "the Media tab.", "Hover one to"];
/** A tall project with 40 word captions and four step labels on their own track. */
function film() {
  let p = addCaptions(tall(), Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1, text: words[i % words.length] })), capStyle, 0.1);
  for (const [i, label] of ["1 · IMPORT", "2 · CUT", "3 · TITLES + CAPTIONS", "4 · EXPORT"].entries())
    p = runCommand(p, "add_text", { text: label, start: i * 10, duration: 10, x: -0.04, y: -0.4, style: { font: "Inter", weight: 800, size: 38, color: "#0D1117", background: { color: "#22C7D3", padding: 18, radius: 40 } } });
  const caps = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && c.caption).map((c) => c.id);
  const labels = p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && !c.caption).map((c) => c.id);
  return { p, caps, labels };
}

it("shares what each track's clips share when a batch spans tracks, losing nothing (C)", () => {
  const { p, caps, labels } = film();
  const q = runCommand(p, "batch", { commands: [
    { command: "set_param", args: { clip_ids: caps, path: "transform.y", value: -0.215 } },
    { command: "set_text", args: { clip_ids: caps, style: { size: 52, maxWidth: 0.7 } } },
    { command: "set_param", args: { clip_ids: labels, path: "transform.y", value: -0.325 } },
  ] });
  const a = describeChanges(describeProject(p), describeProject(q)) as Record<string, unknown>;
  // Nothing was common to captions and labels together: each track's part is given once.
  expect(a.changed_clips_common).toBeUndefined();
  const byTrack = a.changed_clips_common_by_track as Record<string, Record<string, unknown>>;
  expect(Object.values(byTrack)).toEqual(expect.arrayContaining([expect.objectContaining({ case: "upper", size: 52, transform: { x: -0.04, y: -0.215 } })]));
  expect(Object.keys((a.changed_clips as Record<string, unknown>[]).find((c) => c.id === caps[3])!).sort()).toEqual(["end", "id", "start", "text", "track", "type"]);
  // Whole again, every clip as describe_project has it.
  const now = new Map(describeProject(q).tracks.flatMap((t) => t.clips.map((c) => [c.id, { ...c, track: t.id }] as const)));
  for (const c of wholeClips(a, "changed") as { id: string }[]) expect(c).toEqual(now.get(c.id));
  // Under half of sharing across the whole list only (the film test's 20 KB).
  const flat = shareCommon(wholeClips(a, "changed"));
  expect(JSON.stringify(a.changed_clips).length + JSON.stringify(byTrack).length).toBeLessThan(JSON.stringify(flat).length / 2);
  // A list on one track shares as before.
  expect(Object.keys(shareClips((a.changed_clips as { track: string }[]).filter((c) => c.track === (a.changed_clips as { track: string }[])[0].track).map((c) => ({ ...c, size: 1 })), "changed"))).toEqual(["changed_clips", "changed_clips_common"]);
});

it("answers ids alone with quiet, on any edit and on a batch (C)", async () => {
  const { p, caps } = film();
  let project: Project = p;
  const h = { name: "OpenFrame", version: "0", exec: (name: string, args: unknown) => describeProject((project = runCommand(project, name, args))), describe: () => describeProject(project) } as unknown as McpHost;
  const run = async (name: string, args: unknown) => {
    const r = await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, h);
    return JSON.parse((r!.result as { content: { text: string }[] }).content[0].text);
  };
  const quiet = await run("batch", { quiet: true, commands: [{ command: "set_text", args: { clip_ids: caps, style: { size: 50 } } }, { command: "add_text", args: { text: "Hook", start: 0, duration: 2 } }] });
  expect(quiet.changed_clips).toEqual(caps);
  expect(quiet.added_clips).toEqual([expect.stringMatching(/^c_/)]);
  expect(quiet.changed_clips_common).toBeUndefined();
  expect((await run("set_param", { quiet: true, clip_ids: caps.slice(0, 2), path: "opacity", value: 0.5 })).changed_clips).toEqual(caps.slice(0, 2));
  // Notes stay: they are what an answer says in words.
  expect(quietAnswer({ duration: 3, notes: ["a gap closed"], changed_clips: [{ id: "c_1", size: 3 }] })).toEqual({ duration: 3, notes: ["a gap closed"], changed_clips: ["c_1"] });
});

it("sums up keys baked a frame apart, and an answer's anchor glides (C)", () => {
  let p = createProject();
  p = runCommand(p, "add_color_clip", { color: "#ff0000", start: 0, duration: 4 });
  const id = p.tracks[0].clips[0].id;
  // A glide baked a key a frame, and three keys set by hand.
  p = runCommand(p, "batch", { commands: [
    ...Array.from({ length: 6 }, (_, i) => ({ command: "add_keyframe", args: { clip_id: id, path: "transform.x", at: 1 + i / 30, value: i / 10 } })),
    ...[0, 1, 2].map((s) => ({ command: "add_keyframe", args: { clip_id: id, path: "opacity", at: s, value: s % 2 } })),
  ] });
  const keys = (describeProject(p).tracks[0].clips[0] as { keyframes: Record<string, unknown> }).keyframes;
  expect(keys["transform.x"]).toEqual({ count: 6, first: [1, 0], last: [1.167, 0.5], range: [0, 0.5] });
  expect(keys.opacity).toEqual([[0, 0], [1, 1], [2, 0]]);
  // A pinned clip's glides: counted in an edit's answer, listed by describe_project.
  const region = (x: number) => ({ x, y: 0.1, w: 0.1, h: 0.1 });
  const pinned = { id: "c_ring", type: "color", start: 0, end: 4, anchor: { clip_id: "c_shot", region: region(0), keys: [0, 1, 1.5, 2, 3].map((at, i) => ({ at, region: region(i / 10) })) } };
  const a = describeChanges({ tracks: [{ id: "t", clips: [] }] }, { tracks: [{ id: "t", clips: [pinned] }] }) as { added_clips: { anchor: unknown }[] };
  expect(a.added_clips[0].anchor).toEqual({ clip_id: "c_shot", region: region(0), keys: { count: 5, from: 0, to: 3 } });
});

it("narrows describe_project's clips to the fields asked for (C)", () => {
  const { p, caps } = film();
  const d = filterDescription(describeProject(p), { fields: ["text"] }) as { tracks: { clips: Record<string, unknown>[] }[]; fields_not_found?: string };
  const cap = d.tracks.flatMap((t) => t.clips).find((c) => c.id === caps[0])!;
  expect(cap).toEqual({ id: caps[0], type: "text", start: 0, end: 1, text: "Want to make" });
  expect(d.fields_not_found).toBeUndefined();
  const asked = filterDescription(describeProject(p), { fields: ["text", "volumes"], clip_ids: [caps[0]] }) as { fields_not_found?: string };
  expect(asked.fields_not_found).toMatch(/^volumes: no clip shown has it/);
  // Smaller by far than the clips whole.
  expect(JSON.stringify(d).length).toBeLessThan(JSON.stringify(describeProject(p)).length / 2);
});

it("moves, sizes and narrows every caption with set_caption_look (D)", () => {
  const { p, caps } = film();
  expect(() => runCommand(p, "set_caption_look", {})).toThrow(/Give a look, or what to change/);
  const q = runCommand(p, "set_caption_look", { y: -0.2, size: 52, maxWidth: 0.6, style: { highlight: "#2EE59D" } });
  const all = q.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === "text" && !!c.caption);
  expect(all.map((c) => c.id)).toEqual(caps);
  for (const c of all) {
    expect(c.transform).toMatchObject({ x: -0.04, y: -0.2 });
    expect(c.style).toMatchObject({ size: 52, maxWidth: 0.6, highlight: "#2EE59D", case: "upper", font: "Inter" });
  }
  // Titles stay as they were.
  expect(q.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && !c.caption)).toEqual(p.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text" && !c.caption));
  // A look, then a place over it.
  const pop = runCommand(p, "set_caption_look", { look: "pop", y: -0.25 }).tracks.flatMap((t) => t.clips).find((c) => c.id === caps[0]) as TextClip;
  expect(pop.style.highlight).toBe("#2ee59d");
  expect(pop.transform.y).toBe(-0.25);
});

it("fixes each finding for the zones it reaches into, and groups alike ones by them (E)", () => {
  // Captions wider than the column between a tall frame's rails.
  const { p } = film();
  const wide = runCommand(p, "set_caption_look", { y: 0.05, maxWidth: 0.74 });
  const r = checkProject(wide, "social_short");
  const sides = r.findings.filter((f) => f.rule === "text_under_app_buttons" && /A caption/.test(f.message));
  expect(sides.length).toBeGreaterThan(30);
  for (const f of sides) {
    expect(f.message).toMatch(/right 19%.*left 11%/);
    // Before: "captions on a tall canvas sit at y 0.05", for an x overflow.
    expect(f.fix).toBe("set_caption_look x -0.04 maxWidth 0.69 (every caption, between the side rails (x -0.39..0.31)), or a smaller size");
  }
  // That fix clears them.
  const fixed = runCommand(wide, "set_caption_look", { x: -0.04, maxWidth: 0.69 });
  expect(checkProject(fixed, "social_short").findings.filter((f) => f.rule === "text_under_app_buttons" && /A caption/.test(f.message))).toEqual([]);

  // Step labels in the top 14% and a title in the bottom 35%: one group each.
  const q = runCommand(fixed, "add_text", { text: "Follow for more", start: 0, duration: 5, y: 0.3 });
  const grouped = groupFindings(checkProject(q, "social_short")).findings!.filter((f) => f.rule === "text_under_app_buttons");
  const top = grouped.find((f) => /top 14%/.test(f.message))!;
  const bottom = grouped.find((f) => /bottom 35%/.test(f.message))!;
  // Without the rasterizer every label measures alike: all four.
  expect(top).toMatchObject({ count: 4 });
  expect(top.fix).toMatch(/^set_param transform\.y -0\.3\d+ \(so its box stays within/);
  expect(bottom.fix).toMatch(/^set_param transform\.y 0\.\d+ \(so its box stays within/);
  expect((bottom as { count?: number }).count).toBeUndefined();
  // Each fix clears its own title.
  const t = q.tracks.flatMap((x) => x.clips).find((c) => c.type === "text" && c.text === "Follow for more")!;
  const moved = runCommand(q, "set_param", { clip_ids: [t.id], path: "transform.y", value: Number(/transform\.y (\S+)/.exec(bottom.fix)![1]) });
  expect(checkProject(moved, "social_short").findings.some((f) => f.rule === "text_under_app_buttons" && f.clip_id === t.id)).toBe(false);
});

it("moves a title off the captions inside the zone a tall frame allows, or the captions by a value (E, D)", () => {
  let p = addCaptions(tall(), [{ start: 0, end: 4, text: "Pick YouTube 1080p" }], capStyle, -0.31);
  p = runCommand(p, "add_text", { text: "4 · EXPORT", start: 0, duration: 4, y: -0.33, style: { size: 38 } });
  const f = checkProject(p, "social_short").findings.find((x) => x.rule === "text_overlaps_text")!;
  // Before: "move it up ... (set_param transform.y -0.37)", into the apps' top 14%, "or move the captions (set_caption_look y)".
  expect(f.fix).toMatch(/^move it down 0\.\d+ of the frame's height \(set_param transform\.y -0\.2\d+\), or move the captions down \(set_caption_look y -0\.2\d+\)$/);
  const capY = Number(/set_caption_look y (\S+)\)/.exec(f.fix)![1]);
  const q = runCommand(p, "set_caption_look", { y: capY });
  expect(checkProject(q, "social_short").findings.filter((x) => x.rule === "text_overlaps_text" || (x.rule === "text_under_app_buttons" && /A caption/.test(x.message)))).toEqual([]);
});

it("takes style_text_range's style flat or as an object, and sizes each line by its own letters (H)", () => {
  const a = createTextClip("YOUR FIRST EDIT\nIN OPENFRAME", 0, 60);
  const p = { ...tall(), tracks: [{ ...createTrack("video", "Titles"), clips: [a] }] };
  const flat = runCommand(p, "style_text_range", { clip_id: a.id, match: "IN OPENFRAME", color: "#22C7D3", scale: 0.72 });
  const nested = runCommand(p, "style_text_range", { clip_id: a.id, match: "IN OPENFRAME", style: { color: "#22C7D3", scale: 0.72 } });
  expect(nested).toEqual(flat);
  expect(() => runCommand(p, "style_text_range", { clip_id: a.id, match: "IN", style: { size: 40 } })).toThrow(/style\.size is not a known argument/);
  const style = (flat.tracks[0].clips[0] as TextClip).style;
  // A line all at 0.72 is 0.72 of a line high; one with letters at full size, a whole line.
  expect(lineScale("IN OPENFRAME", 16, style)).toBe(0.72);
  expect(lineScale("YOUR FIRST EDIT", 0, style)).toBe(1);
  expect(lineScale("EDIT IN", 11, style)).toBe(1);
  expect(lineScale("", 0, style)).toBe(1);
});

it("says when the wrap parts a styled stretch, with the lines it is drawn on (H)", () => {
  expect(wrappedRange("YOUR FIRST\nEDIT\nIN OPENFRAME", ["YOUR FIRST", "EDIT", "IN", "OPENFRAME"], 16, 28)).toEqual(["IN", "OPENFRAME"]);
  expect(wrappedRange("YOUR FIRST\nEDIT\nIN OPENFRAME", ["YOUR FIRST", "EDIT", "IN OPENFRAME"], 16, 28)).toBeNull();
  // The writer's own line break is not a wrap.
  expect(wrappedRange("YOUR\nFIRST", ["YOUR", "FIRST"], 0, 10)).toBeNull();
  // Through the command, with the rasterizer's lines (a stand-in here).
  setTextMeasure((c, w, h) => ({ width: w * c.style.maxWidth, height: h / 10, layout: { pad: 0, lines: c.text === "YOUR FIRST\nEDIT\nIN OPENFRAME" ? ["YOUR FIRST", "EDIT", "IN", "OPENFRAME"] : c.text.split("\n") } }));
  const a = createTextClip("YOUR FIRST\nEDIT\nIN OPENFRAME", 0, 60);
  const p = { ...tall(), tracks: [{ ...createTrack("video", "Titles"), clips: [a] }] };
  const report: CommandReport = {};
  runCommand(p, "style_text_range", { clip_id: a.id, match: "IN OPENFRAME", scale: 0.72 }, report);
  expect(report.notes).toEqual([expect.stringMatching(/^"IN OPENFRAME" is drawn on 2 lines \("IN" \/ "OPENFRAME"\): at its size it is wider than the title wraps at \(style\.maxWidth /)]);
});

afterAll(() => setTextMeasure((c, w, h) => ({ width: c.style.maxWidth * w, height: ((c.style.size * h) / 1080) * c.style.lineHeight * Math.max(1, c.text.split("\n").length) })));
