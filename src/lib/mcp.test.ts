import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { describeChanges, handleMcp, listTools, type McpHost } from "./mcp";
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
    expect(r?.result).toEqual({ content: [{ type: "text", text: JSON.stringify({ removed: 2 }) }] });
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
    expect(describeChanges(before, after)).toEqual({ duration: 1, markers: [{ id: "m", at: 0.5 }], added_assets: [{ id: "x" }] });
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
    expect(content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(h.versionCalls).toEqual([{ versions: [{ ratio: "1:1", fit: "blur" }] }]);
    const none = await call(h, "tools/call", { name: "export_versions", arguments: {} });
    expect(none!.result).toMatchObject({ isError: true });
  });
});
