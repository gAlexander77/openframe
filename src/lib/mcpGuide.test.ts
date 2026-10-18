import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "./commands";
import { handleMcp, instructions, listTools, type McpHost } from "./mcp";
import { agentPlaybook, EXAMPLES, fullCatalog, groupOf, helpText, HELP_TOPICS, promptMessages, PROMPTS, TOOL_GROUPS, toolReference } from "./mcpGuide";

const tools = listTools();
const DOC = "docs/MCP tools.md";

describe("the MCP guide", () => {
  it("files every tool in a group, and groups only tools that exist", () => {
    expect(tools.filter((t) => groupOf(t.name) === "More").map((t) => t.name)).toEqual([]);
    const names = new Set(tools.map((t) => t.name));
    expect(TOOL_GROUPS.flatMap((g) => g.tools).filter((n) => !names.has(n))).toEqual([]);
  });

  it("gives every tool a title and hints, and only read tools are read-only", () => {
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
    }
    expect(tools.find((t) => t.name === "describe_project")!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "delete_clips")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("has examples that pass their tool's own schema", () => {
    for (const [name, args] of Object.entries(EXAMPLES)) {
      const t = tools.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(validate(args, t!.inputSchema), name).toEqual([]);
    }
  });

  it("answers every topic and every tool, and says what exists when asked wrong", () => {
    for (const topic of HELP_TOPICS) expect(helpText(topic, tools, instructions()).length).toBeGreaterThan(100);
    for (const t of tools) expect(helpText(t.name, tools, instructions())).toContain(`## ${t.name}`);
    expect(() => helpText("efects", tools, instructions())).toThrow("Topics:");
  });

  it("serves a catalog index and each section, and searches stickers", () => {
    const index = fullCatalog() as { sections: string[] };
    for (const s of index.sections) expect(fullCatalog(s)).toBeTruthy();
    expect((fullCatalog("effects") as { id: string; params: object }[]).find((e) => e.id === "glow")!.params).toHaveProperty("threshold");
    expect((fullCatalog("stickers", "fire") as unknown[]).length).toBeGreaterThan(0);
    expect(() => fullCatalog("colours")).toThrow("No catalog section");
  });

  it("fills a prompt with the user's details, and asks for what it needs", () => {
    const m = promptMessages("make_ad", { product: "A steel water bottle, 20% off", shape: "9:16" });
    expect(m.messages[0].content.text).toContain("- product: A steel water bottle, 20% off");
    expect(m.messages[0].content.text).toContain("End card");
    expect(() => promptMessages("make_ad", {})).toThrow("needs product");
    expect(PROMPTS.map((p) => p.name)).toEqual(["make_ad", "epic_edit", "social_short"]);
  });

  it("speaks prompts and guides over MCP", async () => {
    const host = {} as McpHost;
    const call = (method: string, params: Record<string, unknown> = {}) => handleMcp({ jsonrpc: "2.0", id: 1, method, params }, host);
    const init = (await call("initialize")) as { result: { capabilities: object } };
    expect(init.result.capabilities).toHaveProperty("prompts");
    const listed = (await call("prompts/list")) as { result: { prompts: unknown[] } };
    expect(listed.result.prompts).toHaveLength(3);
    const got = (await call("prompts/get", { name: "epic_edit", arguments: { theme: "a ski season" } })) as { result: { messages: { content: { text: string } }[] } };
    expect(got.result.messages[0].content.text).toContain("mark_beats");
    const guide = (await call("resources/read", { uri: "guide://ad" })) as { result: { contents: { text: string }[] } };
    expect(guide.result.contents[0].text).toContain("End card");
    const help = (await call("tools/call", { name: "help", arguments: { topic: "set_fades" } })) as { result: { content: { text: string }[] } };
    expect(help.result.content[0].text).toContain("fade_in");
  });

  it("keeps docs/MCP tools.md and docs/Agent playbook.md in step with the tools", () => {
    for (const [file, want] of [[DOC, toolReference(tools, instructions())], ["docs/Agent playbook.md", agentPlaybook()]]) {
      if (process.env.UPDATE_MCP_DOCS) writeFileSync(file, want);
      const have = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      // Out of date: run UPDATE_MCP_DOCS=1 npx vitest run src/lib/mcpGuide.test.ts
      expect(have, file).toBe(want);
    }
  });
});
