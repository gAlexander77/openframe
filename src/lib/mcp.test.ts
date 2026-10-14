import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { handleMcp, listTools, type McpHost } from "./mcp";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

function host(): McpHost & { project: Project } {
  const start: Project = { ...createProject(), assets: [{ id: "a1", kind: "video", name: "a.mp4", src: "a.mp4", duration: 10, hasVideo: true, hasAudio: true }] };
  const h = {
    project: start,
    name: "Video Editor",
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
  };
  return h;
}

const call = (h: McpHost, method: string, params?: Record<string, unknown>) => handleMcp({ jsonrpc: "2.0", id: 1, method, params }, h);

describe("MCP", () => {
  it("initializes with tools and resources", async () => {
    const r = await call(host(), "initialize", { protocolVersion: "2025-06-18" });
    expect(r?.result).toMatchObject({ capabilities: { tools: {}, resources: {} }, serverInfo: { name: "Video Editor" } });
  });

  it("lists every registry command and the app tools, each with an object schema", () => {
    const names = listTools().map((t) => t.name);
    expect(names).toContain("add_media_clip");
    expect(names).toContain("preview_frame");
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
