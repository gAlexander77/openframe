import { describe, expect, it } from "vitest";
import { runTurn, stripThinking, toFunctionTools, type ChatMessage } from "./assistant";

const toolMsg = (name: string, args: unknown, id = "t1"): ChatMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } }],
});

describe("assistant loop", () => {
  it("calls tools until the model answers in text", async () => {
    const script: ChatMessage[] = [toolMsg("describe_project", {}), toolMsg("add_text", { text: "Hi", start: 1, duration: 2 }), { role: "assistant", content: "<think>done</think>Added a title." }];
    const called: string[] = [];
    const r = await runTurn(
      [{ role: "system", content: "s" }],
      "add a title",
      async () => script.shift()!,
      async (name) => {
        called.push(name);
        return { text: "{}", isError: false };
      },
    );
    expect(called).toEqual(["describe_project", "add_text"]);
    expect(r.reply).toBe("Added a title.");
    expect(r.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("returns malformed arguments to the model as an error instead of throwing", async () => {
    const script: ChatMessage[] = [toolMsg("split", "{not json"), { role: "assistant", content: "Fixed." }];
    const r = await runTurn([], "split", async () => script.shift()!, async () => ({ text: "ok", isError: false }));
    expect(r.steps[0].ok).toBe(false);
    expect(r.messages.find((m) => m.role === "tool")!.content).toContain("invalid arguments");
  });

  it("stops after the step limit", async () => {
    const r = await runTurn([], "loop", async () => toolMsg("seek", { at: 1 }), async () => ({ text: "ok", isError: false }), undefined, 3);
    expect(r.steps).toHaveLength(3);
  });
});

it("maps MCP tools to OpenAI function tools", () => {
  const t = toFunctionTools([{ name: "seek", description: "Move", inputSchema: { type: "object", properties: {} } }]);
  expect(t[0]).toEqual({ type: "function", function: { name: "seek", description: "Move", parameters: { type: "object", properties: {} } } });
  expect(stripThinking("<think>x\ny</think> ok")).toBe("ok");
});
