import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { describeChanges, handleMcp, listTools, type McpHost, TOOLS_META, toolsFingerprint } from "./mcp";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

function host() {
  const start: Project = { ...createProject(), assets: [{ id: "a1", kind: "video", name: "a.mp4", src: "a.mp4", duration: 10, hasVideo: true, hasAudio: true }] };
  const h = {
    project: start,
    name: "OpenFrame",
    version: "0.1.0",
    exec(name: string, args: unknown) {
      h.project = runCommand(h.project, name, args);
      return describeProject(h.project);
    },
    describe: () => describeProject(h.project),
    projectJson: () => h.project,
    catalog: () => ({}),
    importMedia: async () => [],
    undo: () => ({}),
    redo: () => ({}),
    seek: () => ({}),
    frame: async () => "iVBOR",
    sheets: [] as unknown[][],
    async sheet(times: number[], width: number, columns: number) {
      h.sheets.push([times, width, columns]);
      return "iVBOR";
    },
    async mediaSheet(assetId: string, times: number[], width: number, columns: number) {
      h.sheets.push([assetId, times, width, columns]);
      return "iVBOR";
    },
    checkProject: (kind: string) => ({ ok: true, kind }),
    auditions: [] as unknown[],
    async audition(o: { audio?: boolean }) {
      h.auditions.push(o);
      return { ...(o.audio === false ? {} : { data: "SUQz", mimeType: "audio/mpeg" }), summary: { integrated_lufs: -16.2, stems: { dialog: -17 } } };
    },
    exports: [] as unknown[],
    async exportVideo(o: unknown) {
      h.exports.push(o);
      return { state: "done", path: "C:/Users/me/Videos/OpenFrame/x.mp4" };
    },
    exportStatus: () => null,
    versionCalls: [] as unknown[],
    async exportVersions(o: unknown) {
      h.versionCalls.push(o);
      return { state: "done", versions: [] };
    },
    async versionsSheet(o: unknown) {
      h.versionCalls.push(o);
      return "iVBOR";
    },
    voiced: [] as unknown[][],
    async voiceover(lines: unknown, options: unknown) {
      h.voiced.push([lines, options]);
      return { lines: [], end: 0 };
    },
    aiCalls: [] as unknown[][],
    async ai(tool: string, target: unknown, options: unknown) {
      h.aiCalls.push([tool, target, options]);
      return { removed: 2 };
    },
    saved: [
      { id: "p1", name: "Race demo", updatedAt: 100, duration: 23.3, width: 1920, height: 1080, open: true },
      { id: "p2", name: "Race Demo", updatedAt: 300, duration: 5, width: 1080, height: 1920 },
      { id: "p3", name: "Trip", updatedAt: 200, duration: 60, width: 1920, height: 1080 },
    ],
    opened: [] as string[],
    listProjects: async () => h.saved,
    async openProject(id: string) {
      h.opened.push(id);
      return { name: h.saved.find((p) => p.id === id)!.name };
    },
    newProject: async (name?: string) => ({ name: name ?? "Untitled" }),
    saveCopy: async (name: string, open: boolean) => ({ saved: name, open: open ? name : "Race demo" }),
  };
  return h;
}

const call = (h: McpHost, method: string, params?: Record<string, unknown>) => handleMcp({ jsonrpc: "2.0", id: 1, method, params }, h);

const text = (r: Awaited<ReturnType<typeof call>>) => (r!.result as { content: { text: string }[] }).content[0].text;

describe("MCP projects", () => {
  it("lists saved projects newest first, marking the open one", async () => {
    const list = JSON.parse(text(await call(host(), "tools/call", { name: "list_projects", arguments: {} })));
    expect(list.map((p: { id: string }) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(list[2]).toMatchObject({ name: "Race demo", canvas: "1920x1080", open: true });
    expect(list[0].open).toBeUndefined();
  });

  it("opens by id, or by name in any case with the newest winning a tie", async () => {
    const h = host();
    await call(h, "tools/call", { name: "open_project", arguments: { project: "p3" } });
    await call(h, "tools/call", { name: "open_project", arguments: { project: "race DEMO" } });
    expect(h.opened).toEqual(["p3", "p2"]);
    const miss = await call(h, "tools/call", { name: "open_project", arguments: { project: "Nope" } });
    expect(miss!.result).toMatchObject({ isError: true });
    expect(text(miss)).toContain('Recent: "Race Demo", "Trip", "Race demo"');
  });

  it("starts a new project with an optional name", async () => {
    expect(JSON.parse(text(await call(host(), "tools/call", { name: "new_project", arguments: { name: "Agent scratch" } })))).toEqual({ name: "Agent scratch" });
  });
});

describe("MCP", () => {
  it("initializes with tools and resources", async () => {
    const r = await call(host(), "initialize", { protocolVersion: "2025-06-18" });
    expect(r?.result).toMatchObject({ capabilities: { tools: {}, resources: {} }, serverInfo: { name: "OpenFrame" } });
  });

  it("lists every registry command and the app tools, each with an object schema", () => {
    const names = listTools().map((t) => t.name);
    expect(names).toContain("add_media_clip");
    expect(names).toContain("preview_frame");
    expect(names).toContain("remove_background");
    expect(new Set(names).size).toBe(names.length);
    expect(listTools().every((t) => t.inputSchema.type === "object")).toBe(true);
  });

  it("runs a command and reports tool errors as results the model can read", async () => {
    const h = host();
    const r = await call(h, "tools/call", { name: "add_media_clip", arguments: { asset_id: "a1", start: 0, duration: 4 } });
    expect(JSON.parse((r!.result as { content: { text: string }[] }).content[0].text).duration).toBe(4);
    const bad = await call(h, "tools/call", { name: "split", arguments: { at: "soon" } });
    expect(bad!.result).toMatchObject({ isError: true });
    expect(JSON.stringify(bad!.result)).toContain("args.at must be a number");
  });

  it("returns an image for preview_frame", async () => {
    const r = await call(host(), "tools/call", { name: "preview_frame", arguments: { at: 1 } });
    expect((r!.result as { content: { type: string }[] }).content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
  });

  it("ignores notifications and rejects unknown methods", async () => {
    expect(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, host())).toBeNull();
    expect((await call(host(), "nope"))!.error!.code).toBe(-32601);
  });

  it("serves the project as a resource", async () => {
    const r = await call(host(), "resources/read", { uri: "project://summary" });
    expect((r!.result as { contents: { text: string }[] }).contents[0].text).toContain("canvas");
  });
});

describe("MCP AI tools", () => {
  it("routes to the app's AI tools with only the options given", async () => {
    const h = host() as ReturnType<typeof host> & { aiCalls: unknown[][] };
    const r = await call(h, "tools/call", { name: "remove_silences", arguments: { clip_id: "c1", padding: 0.2 } });
    expect(r?.result).toMatchObject({ content: [{ type: "text", text: JSON.stringify({ removed: 2 }) }] });
    await call(h, "tools/call", { name: "normalize_loudness", arguments: { clip_ids: ["c1", "c2"] } });
    await call(h, "tools/call", { name: "remove_background", arguments: { clip_id: "c3" } });
    await call(h, "tools/call", { name: "sync_audio", arguments: { clip_id: "c4", video_clip_id: "c1", mute_camera: true } });
    expect(h.aiCalls).toEqual([
      ["removeSilences", "c1", { padding: 0.2 }],
      ["normalizeLoudness", ["c1", "c2"], {}],
      ["removeBackground", "c3", {}],
      ["syncAudio", "c4", { videoId: "c1", muteCamera: true }],
    ]);
    expect(listTools().map((t) => t.name)).toEqual(expect.arrayContaining(["split_scenes", "mark_beats", "duck_under_speech", "sync_audio", "sync_to_clip"]));
  });

  it("measures loudness against a named spec, and normalizes to one", async () => {
    const h = host() as ReturnType<typeof host> & { aiCalls: unknown[][] };
    await call(h, "tools/call", { name: "measure_loudness", arguments: { spec: "ebu_r128", loudness: -23, end: 10 } });
    await call(h, "tools/call", { name: "measure_loudness", arguments: {} });
    await call(h, "tools/call", { name: "normalize_loudness", arguments: { clip_ids: ["c1"], spec: "atsc_a85" } });
    expect(h.aiCalls).toEqual([
      ["loudnessReport", "ebu_r128", { loudness: -23, end: 10 }],
      ["loudnessReport", "", {}],
      ["normalizeLoudness", ["c1"], { spec: "atsc_a85" }],
    ]);
    const tools = listTools();
    expect(tools.find((t) => t.name === "measure_loudness")?.inputSchema.properties?.spec?.enum).toEqual(["online", "ebu_r128", "atsc_a85"]);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["set_audio_filter", "set_reverb", "set_echo", "set_tape_stop"]));
  });
});

describe("MCP edits answer with what changed", () => {
  const run = async (h: ReturnType<typeof host>, name: string, args: unknown) => JSON.parse(text(await call(h, "tools/call", { name, arguments: args })));

  it("names added, changed and removed clips with their track, never the whole timeline", async () => {
    const h = host();
    const added = await run(h, "add_media_clip", { asset_id: "a1", start: 0, duration: 4 });
    expect(added.duration).toBe(4);
    expect(added.added_clips).toHaveLength(1);
    expect(added.added_clips[0]).toMatchObject({ type: "video", start: 0, end: 4, track: h.project.tracks[0].id });
    expect(added.tracks).toBeUndefined();
    expect(added.assets).toBeUndefined();
    const id = added.added_clips[0].id;
    const changed = await run(h, "set_param", { clip_ids: [id], path: "volume", value: 0.5 });
    expect(changed.changed_clips).toEqual([expect.objectContaining({ id, volume: 0.5 })]);
    expect(changed.added_clips).toBeUndefined();
    const removed = await run(h, "delete_clips", { clip_ids: [id] });
    expect(removed).toMatchObject({ removed_clips: [id], duration: 0 });
  });

  it("says when nothing changed, and passes other parts through", () => {
    const before = { name: "A", duration: 1, assets: [], tracks: [{ id: "t", clips: [] }], markers: [] };
    expect(describeChanges(before, before)).toEqual({ unchanged: true, duration: 1 });
    const after = { ...before, markers: [{ id: "m", at: 0.5 }], assets: [{ id: "x" }] };
    expect(describeChanges(before, after)).toEqual({ duration: 1, added_markers: [{ id: "m", at: 0.5 }], added_assets: [{ id: "x" }] });
    expect(describeChanges(before, { screen: "home" })).toEqual({ screen: "home" });
  });

  it("runs a batch as one edit, all or nothing, naming the failing step", async () => {
    const h = host();
    const r = await run(h, "batch", {
      commands: [
        { command: "add_media_clip", args: { asset_id: "a1", start: 0, duration: 4 } },
        { command: "add_text", args: { text: "Hi", start: 0, duration: 2, style: { background: { color: "rgba(0,0,0,0.6)" } } } },
      ],
    });
    expect(r.added_clips).toHaveLength(2);
    const title = h.project.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!;
    expect(title.type === "text" && title.style.background).toEqual({ color: "rgba(0,0,0,0.6)", padding: 16, radius: 8 });
    const before = h.project;
    const bad = await call(h, "tools/call", { name: "batch", arguments: { commands: [{ command: "split", args: { at: 1 } }, { command: "split", args: { at: "soon" } }] } });
    expect(bad!.result).toMatchObject({ isError: true });
    expect(text(bad)).toContain("step 2 (split): args.at must be a number");
    expect(h.project).toBe(before);
  });

  it("exports through the host and makes a contact sheet", async () => {
    const h = host();
    const done = await run(h, "export_video", { name: "Promo", loudness: -14 });
    expect(done).toMatchObject({ state: "done" });
    expect(h.exports).toEqual([{ name: "Promo", loudness: -14 }]);
    expect(await run(h, "export_status", {})).toEqual({ state: "none" });
    const r = await call(h, "tools/call", { name: "preview_frames", arguments: { times: [1, 2, 3] } });
    expect((r!.result as { content: { type: string }[] }).content[0]).toMatchObject({ type: "image" });
    expect(h.sheets).toEqual([[[1, 2, 3], 320, 4]]);
  });
});

it("passes a voiceover script through with the options given, in the app's names", async () => {
  const h = host();
  const lines = [{ text: "Meet RacePulse." }, { text: "Pick your widgets.", at: 6 }];
  await call(h, "tools/call", { name: "add_voiceover", arguments: { lines, voice: "am_michael", caption_y: 0.4 } });
  expect(h.voiced).toEqual([[lines, { voice: "am_michael", captionY: 0.4 }]]);
});

it("passes a line's pace with its script, and review's second hearing", async () => {
  const h = host();
  await call(h, "tools/call", { name: "add_voiceover", arguments: { lines: [{ text: "Free. Yours.", pace: "slow", pause_after: 0.8 }] } });
  expect(h.voiced).toEqual([[[{ text: "Free. Yours.", pace: "slow", pauseAfter: 0.8 }], {}]]);
  await call(h, "tools/call", { name: "retake_voiceover", arguments: { clip_id: "c1", pace: "slow" } });
  await call(h, "tools/call", { name: "review_voiceover", arguments: { recheck: false } });
  expect(h.aiCalls).toEqual([["retakeVoiceover", "c1", { pace: "slow" }], ["reviewVoiceover", [], { recheck: false }]]);
  const bad = await call(h, "tools/call", { name: "add_voiceover", arguments: { lines: [{ text: "Hi", pace: "dramatic" }] } });
  expect(bad!.result).toMatchObject({ isError: true });
});

describe("MCP ad tools", () => {
  it("puts titles behind the subject through the AI host", async () => {
    const h = host();
    await call(h, "tools/call", { name: "text_behind_subject", arguments: { clip_id: "c1", text_clip_ids: ["t1", "t2"] } });
    expect(h.aiCalls).toEqual([["textBehindSubject", "c1", { textIds: ["t1", "t2"] }]]);
  });

  it("spells versions out from ratios and durations, and exports them", async () => {
    const h = host();
    h.project = runCommand(h.project, "add_media_clip", { asset_id: "a1", start: 0 });
    const r = await call(h, "tools/call", { name: "export_versions", arguments: { ratios: ["16:9", "9:16"], durations: [10, 6], textless: true, loudness: -14 } });
    expect(JSON.parse(text(r))).toMatchObject({ state: "done" });
    expect(h.versionCalls).toEqual([
      {
        versions: [{ ratio: "16:9" }, { ratio: "16:9", duration: 6 }, { ratio: "9:16" }, { ratio: "9:16", duration: 6 }, { ratio: "16:9", textless: true }],
        loudness: -14,
      },
    ]);
  });

  it("answers a contact sheet of the versions when asked to check, exporting nothing", async () => {
    const h = host();
    const r = await call(h, "tools/call", { name: "export_versions", arguments: { versions: [{ ratio: "1:1", fit: "blur" }], check: true } });
    const content = (r!.result as { content: { type: string }[] }).content;
    expect(content[0]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
    expect(h.versionCalls).toEqual([{ versions: [{ ratio: "1:1", fit: "blur" }] }]);
    const none = await call(h, "tools/call", { name: "export_versions", arguments: {} });
    expect(none!.result).toMatchObject({ isError: true });
  });

  it("passes captions to every version that does not say", async () => {
    const h = host();
    await call(h, "tools/call", { name: "export_versions", arguments: { versions: [{ ratio: "9:16" }, { ratio: "1:1", captions: "burn" }], captions: "none", check: true } });
    expect(h.versionCalls).toEqual([{ versions: [{ ratio: "9:16", captions: "none" }, { ratio: "1:1", captions: "burn" }] }]);
    const bad = await call(h, "tools/call", { name: "export_versions", arguments: { ratios: ["9:16"], captions: "srt" } });
    expect(bad!.result).toMatchObject({ isError: true });
  });
});

describe("what a blind test of the tools found", () => {
  const run = async (h: ReturnType<typeof host>, name: string, args: unknown) => JSON.parse(text(await call(h, "tools/call", { name, arguments: args })));

  it("checks app tools' arguments too, naming the ones it knows", async () => {
    const r = await call(host(), "tools/call", { name: "preview_frame", arguments: { time: 0.7 } });
    expect(r!.result).toMatchObject({ isError: true });
    expect(text(r)).toBe("args.at is required; args.time is not a known argument; did you mean at? (known: at, max_width)");
  });

  it("says what set_filter and a picture's set_animation changed", async () => {
    const h = host();
    h.project = { ...h.project, assets: [...h.project.assets, { id: "i", kind: "image", name: "p.jpg", src: "p.jpg", duration: 0, width: 600, height: 400, hasVideo: true, hasAudio: false }] };
    const id = (await run(h, "add_media_clip", { asset_id: "i", start: 0, duration: 3 })).added_clips[0].id;
    expect((await run(h, "set_filter", { clip_id: id, type: "noir", intensity: 0.6 })).changed_clips[0]).toMatchObject({ filter: "noir", filter_intensity: 0.6 });
    expect((await run(h, "set_animation", { clip_id: id, slot: "out", type: "fade" })).changed_clips[0].animation).toEqual({ out: "fade" });
  });

  it("lets a batch step name the clips earlier steps added", async () => {
    const h = host();
    const r = await run(h, "batch", {
      commands: [
        { command: "add_text", args: { text: "SALE", start: 1, duration: 2 } },
        { command: "set_animation", args: { clip_id: "$1", slot: "in", type: "pop" } },
      ],
    });
    expect(r.added_clips[0]).toMatchObject({ text: "SALE", animation: { in: "pop" } });
    const bad = await call(h, "tools/call", { name: "batch", arguments: { commands: [{ command: "add_sound_effect", args: { name: "pop" } }] } });
    expect(text(bad)).toContain("add_sound_effect is not an editing command");
    const early = await call(h, "tools/call", { name: "batch", arguments: { commands: [{ command: "set_animation", args: { clip_id: "$2", slot: "in", type: "pop" } }] } });
    expect(text(early)).toContain("$2: step 2 has not run yet");
  });

  it("meets clips given back to back in seconds, frame for frame", async () => {
    const h = host();
    await run(h, "add_color_clip", { color: "#000", start: 6.9, duration: 2.05 });
    const next = await run(h, "add_color_clip", { color: "#fff", start: 8.95, duration: 1, track_id: h.project.tracks.find((t) => t.clips.length)!.id });
    const [a, b] = h.project.tracks.flatMap((t) => t.clips).sort((x, y) => x.start - y.start);
    expect(a.start + a.duration).toBe(b.start);
    expect(next.added_clips[0].start).toBe(8.967);
  });

  it("slips a shot's source without moving it", async () => {
    const h = host();
    const id = (await run(h, "add_media_clip", { asset_id: "a1", start: 2, duration: 3, in: 1 })).added_clips[0].id;
    const r = await run(h, "slip_clip", { clip_id: id, by: 1.5 });
    expect(r.changed_clips.find((c: { id: string }) => c.id === id)).toMatchObject({ start: 2, end: 5, in: 2.5 });
  });
});

describe("what a second blind test found", () => {
  const run = async (h: ReturnType<typeof host>, name: string, args: unknown) => JSON.parse(text(await call(h, "tools/call", { name, arguments: args })));

  it("sets an effect's parameter by its place, id or type, and refuses one that is not there", async () => {
    const h = host();
    const id = (await run(h, "add_color_clip", { color: "#204060", start: 0, duration: 2 })).added_clips[0].id;
    await run(h, "add_effect", { clip_id: id, type: "glow" });
    const by = async (path: string, value: number) => (await run(h, "set_param", { clip_ids: [id], path, value })).changed_clips[0].effectStack[0].params;
    expect((await by("effects.0.amount", 61)).amount).toBe(61);
    expect((await by("effects.glow.amount", 62)).amount).toBe(62);
    const fx = h.project.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
    expect((await by(`effects.${"effects" in fx ? fx.effects[0].id : ""}.amount`, 63)).amount).toBe(63);
    const bad = await call(h, "tools/call", { name: "set_param", arguments: { clip_ids: [id], path: "effects.0.hue", value: 1 } });
    expect(text(bad)).toMatch(/^glow has no parameter hue; it has /);
    const none = await call(h, "tools/call", { name: "add_keyframe", arguments: { clip_id: id, path: "effects.3.amount", at: 1, value: 1 } });
    expect(text(none)).toContain("has no effect 3; its stack: 0 glow");
  });

  it("moves a track within its kind, never under the main track", async () => {
    const h = host();
    await run(h, "add_track", { kind: "video" });
    await run(h, "add_track", { kind: "video" });
    const [top, second] = h.project.tracks;
    const r = await run(h, "move_track", { track_id: top.id, below_track_id: second.id });
    expect(r.track_order.slice(0, 2)).toEqual([second.id, top.id]);
    const main = h.project.tracks.find((t) => t.main)!;
    expect(text(await call(h, "tools/call", { name: "move_track", arguments: { track_id: top.id, below_track_id: main.id } }))).toContain("main track stays");
  });

  it("names a track an earlier batch step added", async () => {
    const h = host();
    const r = await run(h, "batch", { commands: [{ command: "add_track", args: { kind: "video", name: "Grade" } }, { command: "add_adjustment_clip", args: { start: 0, duration: 2, track_id: "$1.track" } }] });
    expect(r.added_clips[0].track).toBe(h.project.tracks.find((t) => t.name === "Grade")!.id);
  });

  it("says up front when this build cannot export", async () => {
    const h = { ...host(), canExport: () => false };
    const init = await call(h, "initialize");
    expect((init!.result as { instructions: string }).instructions).toContain("cannot write files");
    expect((await call(host(), "initialize"))!.result).not.toMatchObject({ instructions: expect.stringContaining("cannot write files") });
  });
});

describe("what the launch film found (2026-10-18)", () => {
  const run = async (h: ReturnType<typeof host>, name: string, args: unknown) => JSON.parse(text(await call(h, "tools/call", { name, arguments: args })));

  /** Two window compounds, each a title and a picture. */
  function windows() {
    const h = host();
    for (const at of [0, 3]) {
      h.project = runCommand(h.project, "add_media_clip", { asset_id: "a1", start: at, duration: 2 });
      h.project = runCommand(h.project, "add_text", { text: `Window ${at}`, start: at, duration: 2 });
      const ids = h.project.tracks.flatMap((t) => t.clips).filter((c) => c.start === at * 30 && c.type !== "compound").map((c) => c.id);
      h.project = runCommand(h.project, "create_compound_clip", { clip_ids: ids, name: `Window ${at}` });
    }
    return h;
  }

  it("answers an edit inside a compound with that compound alone, summed up, and what changed inside it", async () => {
    const h = windows();
    const [k0] = h.project.compounds!;
    const inner = k0.tracks.flatMap((t) => t.clips).find((c) => c.type === "text")!;
    const r = await run(h, "edit_compound", { compound_id: k0.id, command: "set_text", args: { clip_id: inner.id, text: "Cut." } });
    expect(r.compounds).toBeUndefined();
    expect(r.changed_compounds).toEqual([{ id: k0.id, name: "Window 0", duration: 2, clips: 2, changed_clips: [expect.objectContaining({ id: inner.id, text: "Cut." })] }]);
    const renamed = await run(h, "rename_compound", { compound_id: k0.id, name: "Window: cut" });
    expect(renamed.changed_compounds).toEqual([{ id: k0.id, name: "Window: cut", duration: 2, clips: 2 }]);
    // An edit outside every compound says nothing about them.
    const outside = await run(h, "add_text", { text: "Hi", start: 6, duration: 1 });
    expect(outside.changed_compounds).toBeUndefined();
  });

  it("answers a unique copy of a compound clip with the new compound, summed up", async () => {
    const h = windows();
    const clip = h.project.tracks.flatMap((t) => t.clips).find((c) => c.type === "compound")!;
    const r = await run(h, "duplicate_clips", { clip_ids: [clip.id], at: 8, unique: true });
    expect(r.added_compounds).toEqual([expect.objectContaining({ name: "Window 0 copy", duration: 2, clips: 2 })]);
    expect(r.added_clips[0].compound).toBe(r.added_compounds[0].id);
  });

  it("answers open_project and new_project with a summary, not the timeline", async () => {
    const h = windows();
    h.openProject = async () => describeProject(h.project);
    const r = await run(h, "open_project", { project: "p1" });
    expect(r).toEqual({ name: h.project.name, canvas: { width: 1920, height: 1080 }, fps: 30, duration: 5, counts: { tracks: 1, clips: 2, assets: 1, markers: 0, compounds: 2 }, note: expect.stringContaining("describe_project") });
  });

  it("places a list of sound effects in one call, with their volumes, as one host call", async () => {
    const h = host();
    h.ai = (async (tool: string, target: unknown, options: unknown) => {
      h.aiCalls.push([tool, target, options]);
      return { clipIds: ["c_1", "c_2"] };
    }) as unknown as typeof h.ai;
    const r = await run(h, "add_sound_effect", { sounds: [{ name: "whoosh", start: 1 }, { name: "rise", end_at: 4, volume: 0.5 }] });
    expect(r.clip_ids).toEqual(["c_1", "c_2"]);
    expect(h.aiCalls).toEqual([["addSoundEffects", "", { sounds: [{ name: "whoosh", at: 1 }, { name: "rise", endAt: 4, volume: 0.5 }] }]]);
    const one = await run(h, "add_sound_effect", { name: "pop", start: 2, volume: 0.25 });
    expect(one.clip_id).toBe("c_1");
    expect(h.aiCalls[1]).toEqual(["addSoundEffects", "", { sounds: [{ name: "pop", at: 2, volume: 0.25 }] }]);
    const both = await call(h, "tools/call", { name: "add_sound_effect", arguments: { name: "pop", sounds: [{ name: "pop" }] } });
    expect(text(both)).toMatch(/not both/);
    // A track of the agent's own, for the call or per sound.
    await run(h, "add_sound_effect", { sounds: [{ name: "pop", start: 1 }, { name: "pop", start: 2, track_id: "t_b" }], track_id: "t_a" });
    expect(h.aiCalls[2]).toEqual(["addSoundEffects", "", { sounds: [{ name: "pop", at: 1, trackId: "t_a" }, { name: "pop", at: 2, trackId: "t_b" }] }]);
  });

  it("lays an ambience bed through the host, by name, with its stretch, fades, level and take", async () => {
    const h = host();
    await run(h, "add_ambience", { name: "waterfall", start: 22, end: 34, fade_in: 1.5, volume: 0.7, seed: 2, track_id: "t_amb" });
    expect(h.aiCalls[0]).toEqual(["addAmbience", "", { name: "waterfall", start: 22, end: 34, fadeIn: 1.5, volume: 0.7, seed: 2, trackId: "t_amb" }]);
    expect(text(await call(h, "tools/call", { name: "add_ambience", arguments: { name: "wind", end: 4, length: 3 } }))).toMatch(/not both/);
    expect(text(await call(h, "tools/call", { name: "add_ambience", arguments: { name: "kazoo" } }))).toMatch(/name/);
    const cat = JSON.parse(text(await call(h, "tools/call", { name: "list_catalog", arguments: { section: "ambience" } }))) as { id: string; about: string }[];
    expect(cat.map((b) => b.id)).toEqual(["wind", "stream", "waterfall", "surf", "rain", "rocket", "city", "roomTone"]);
  });

  it("answers preview_audio with an MP3 block and the measurements, or the measurements alone", async () => {
    const h = host();
    const r = await call(h, "tools/call", { name: "preview_audio", arguments: { start: 6, end: 14, solo: "voice" } });
    const content = (r!.result as { content: { type: string; data?: string; mimeType?: string; text?: string }[] }).content;
    expect(content[0]).toEqual({ type: "audio", data: "SUQz", mimeType: "audio/mpeg" });
    expect(JSON.parse(content[1].text!)).toMatchObject({ integrated_lufs: -16.2 });
    expect(h.auditions[0]).toEqual({ start: 6, end: 14, solo: "voice" });
    const quiet = await call(h, "tools/call", { name: "preview_audio", arguments: { start: 0, audio: false } });
    expect((quiet!.result as { content: { type: string }[] }).content.map((c) => c.type)).toEqual(["text"]);
    expect(text(await call(h, "tools/call", { name: "preview_audio", arguments: { start: 0, solo: "drums" } }))).toMatch(/solo/);
    const tool = (await call(h, "tools/list"))!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] };
    expect(tool.tools.find((t) => t.name === "preview_audio")!.annotations.readOnlyHint).toBe(true);
  });

  it("waits for a measured check, takes preview_motion tiles as wide as preview_frames', and checks versions at chosen moments", async () => {
    const h = host();
    h.checkProject = (async (kind: string) => ({ ok: true, kind, measured: true })) as unknown as typeof h.checkProject;
    expect(await run(h, "check_project", { kind: "ad" })).toEqual({ ok: true, kind: "ad", measured: true });
    await call(h, "tools/call", { name: "preview_motion", arguments: { start: 0, end: 1, tile_width: 640 } });
    expect(h.sheets.at(-1)![1]).toBe(640);
    const r = await call(h, "tools/call", { name: "export_versions", arguments: { ratios: ["9:16"], check: true, check_at: [0.3, 0.6] } });
    expect(h.versionCalls.at(-1)).toEqual({ versions: [{ ratio: "9:16" }], at: [0.3, 0.6] });
    expect(text({ ...r!, result: { content: [(r!.result as { content: unknown[] }).content[1]] } } as typeof r)).toContain("30%, 60%");
  });
});

it("names the tool set in every answer, so the stdio bridge can say when it changes", async () => {
  const h = host();
  const init = (await call(h, "initialize")) as { result: { capabilities: { tools: { listChanged: boolean } }; _meta: Record<string, string> } };
  expect(init.result.capabilities.tools.listChanged).toBe(true);
  const mark = init.result._meta[TOOLS_META];
  expect(mark).toMatch(/^[0-9a-f]{8}-[0-9a-f]+$/);
  expect(mark).toBe(toolsFingerprint());
  for (const [method, params] of [["tools/list", {}], ["ping", {}], ["tools/call", { name: "describe_project", arguments: {} }]] as const) {
    const r = (await call(h, method, params)) as { result: { _meta: Record<string, string> } };
    expect(r.result._meta[TOOLS_META], method).toBe(mark);
  }
});

describe("what the Codex film test found (2026-10-19)", () => {
  const run = async (h: ReturnType<typeof host>, name: string, args: unknown) => JSON.parse(text(await call(h, "tools/call", { name, arguments: args })));
  const err = async (h: McpHost, name: string, args: unknown) => {
    const r = await call(h, "tools/call", { name, arguments: args });
    expect(r!.result).toMatchObject({ isError: true });
    return text(r);
  };

  it("keeps the server's instructions to a few lines, the guide in help, and no tool repeating either", async () => {
    // Codex's tool discovery prepends the instructions to every tool's
    // description: 156 copies of a 3.5 KB guide were ~135,000 tokens.
    const init = (await call(host(), "initialize"))!.result as { instructions: string };
    expect(init.instructions.length).toBeLessThan(700);
    expect(init.instructions).toContain("Call help first");
    const overview = text(await call(host(), "tools/call", { name: "help", arguments: {} }));
    expect(overview).toContain("To make a video:");
    expect(overview).toContain("Tools by step:");
    for (const t of listTools()) {
      expect(t.description, t.name).not.toContain("To make a video:");
      expect(t.description, t.name).not.toContain(init.instructions.slice(0, 80));
    }
    // The browser's word on export reaches both.
    const web = { ...host(), canExport: () => false };
    expect(text(await call(web, "tools/call", { name: "help", arguments: {} }))).toContain("cannot write files");
  });

  it("answers every imported file in order, and refuses an import where every file failed", async () => {
    const h = host();
    const asked: unknown[] = [];
    h.importMedia = (async (files: unknown) => {
      asked.push(files);
      return [
        { id: "a2", name: "launch", kind: "video", duration: 8, width: 1920, height: 1080 },
        { src: "C:/x/notes.txt", name: "notes", error: "isn't a video, audio or image file" },
      ];
    }) as unknown as typeof h.importMedia;
    const r = await run(h, "import_media", { files: [{ src: "C:/x/launch.mp4", name: "launch" }, { src: "C:/x/notes.txt", name: "notes" }] });
    expect(asked[0]).toEqual([{ src: "C:/x/launch.mp4", name: "launch" }, { src: "C:/x/notes.txt", name: "notes" }]);
    expect(r).toEqual([expect.objectContaining({ id: "a2", name: "launch" }), expect.objectContaining({ error: expect.stringContaining("isn't") })]);
    h.importMedia = (async () => [
      { src: "C:/x/a", name: "a", error: "it could not be read" },
      { src: "C:/x/b.mov", name: "b", error: "this browser can't decode ProRes" },
    ]) as unknown as typeof h.importMedia;
    expect(await err(h, "import_media", { files: [{ src: "C:/x/a" }, { src: "C:/x/b.mov" }] })).toBe("Nothing was imported. C:/x/a: it could not be read; C:/x/b.mov: this browser can't decode ProRes");
    expect(await err(h, "import_media", { files: [] })).toMatch(/at least one/);
  });

  it("exports into a folder the agent names, and says the folder is desktop only rather than ignore it", async () => {
    const h = host();
    await run(h, "export_video", { name: "film", folder: "D:/Deliveries" });
    expect(h.exports.at(-1)).toEqual({ name: "film", folder: "D:/Deliveries" });
    await run(h, "export_versions", { ratios: ["9:16"], folder: "D:/Deliveries" });
    expect(h.versionCalls.at(-1)).toMatchObject({ folder: "D:/Deliveries" });
    const web = { ...host(), canExport: () => false };
    expect(await err(web, "export_video", { folder: "D:/Deliveries" })).toMatch(/folder is desktop only/);
    expect(await err(web, "export_versions", { ratios: ["9:16"], folder: "D:/Deliveries" })).toMatch(/folder is desktop only/);
    expect(listTools().find((t) => t.name === "collect_project")!.inputSchema.properties).toHaveProperty("folder");
  });

  it("names the argument a model meant, for every tool", async () => {
    expect(await err(host(), "seek", { time: 11 })).toBe("args.at is required; args.time is not a known argument; did you mean at? (known: at)");
    expect(await err(host(), "set_text", { clip_id: "c", style: { fontSize: 80 } })).toContain("args.style.fontSize is not a known argument; did you mean size?");
    const r = await call(host(), "tools/call", { name: "set_fade", arguments: {} });
    expect(r!.error!.message).toBe("unknown tool set_fade; did you mean set_fades?");
  });

  it("takes as many columns on preview_frames and preview_media as on preview_motion", async () => {
    const h = host();
    await call(h, "tools/call", { name: "preview_frames", arguments: { times: [1, 2], columns: 8 } });
    expect(h.sheets.at(-1)).toEqual([[1, 2], 320, 8]);
    await call(h, "tools/call", { name: "preview_media", arguments: { asset_id: "a1", columns: 8, count: 8 } });
    expect(h.sheets.at(-1)![3]).toBe(8);
    for (const n of ["preview_frames", "preview_motion", "preview_media"]) expect(listTools().find((t) => t.name === n)!.inputSchema.properties!.columns.maximum, n).toBe(8);
  });

  it("describes a title's type and a custom speed curve, compactly", async () => {
    const h = host();
    const t = (await run(h, "add_text", { text: "Home", start: 0, duration: 2, style: { font: "Georgia", weight: 300, size: 72, maxWidth: 0.5, letterSpacing: 12, lineHeight: 0.95 } })).added_clips[0];
    expect(t).toMatchObject({ weight: 300, size: 72, style: { font: "Georgia", maxWidth: 0.5, letterSpacing: 12, lineHeight: 0.95 } });
    const plain = (await run(h, "add_text", { text: "Plain", start: 3, duration: 1, style: { maxWidth: 0.9 } })).added_clips[0];
    expect(plain.style).toBeUndefined();
    const v = (await run(h, "add_media_clip", { asset_id: "a1", start: 5, duration: 4 })).added_clips[0];
    const ramped = (await run(h, "set_speed_curve", { clip_id: v.id, points: [{ t: 0, speed: 2 }, { t: 0.5, speed: 0.5 }, { t: 1, speed: 2 }] })).changed_clips[0];
    expect(ramped.speed_curve).toBe("custom");
    expect(ramped.speed_points).toEqual([[0, 2], [0.5, 0.5], [1, 2]]);
  });

  it("answers edits beside compound clips without their timelines, and open_project_file with a summary", async () => {
    const h = host();
    for (const at of [0, 3, 6]) {
      h.project = runCommand(h.project, "add_media_clip", { asset_id: "a1", start: at, duration: 2 });
      h.project = runCommand(h.project, "add_text", { text: `Window ${at}`, start: at, duration: 2 });
      const ids = h.project.tracks.flatMap((t) => t.clips).filter((c) => c.start === at * 30 && c.type !== "compound").map((c) => c.id);
      h.project = runCommand(h.project, "create_compound_clip", { clip_ids: ids, name: `Window ${at}` });
    }
    const r = await call(h, "tools/call", { name: "add_text", arguments: { text: "Title", start: 0, duration: 1 } });
    expect(text(r)).not.toContain("compounds");
    expect(text(r).length).toBeLessThan(600);
    h.exec = ((name: string) => (name === "open_project_file" ? { opened: true, project: describeProject(h.project) } : null)) as unknown as typeof h.exec;
    const opened = await run(h, "open_project_file", { path: "D:/films/cut.json" });
    expect(opened).toEqual({ opened: true, project: expect.objectContaining({ counts: expect.objectContaining({ compounds: 3 }), note: expect.stringContaining("describe_project") }) });
    expect(opened.project.tracks).toBeUndefined();
  });
});
