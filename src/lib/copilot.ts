// The copilot's agent loop, provider-agnostic and pure: the model sees the
// same MCP tools external agents do (ADR-008), as OpenAI-style function
// definitions that local servers (Ollama, LM Studio, llama.cpp) understand.
// The host supplies chat() and callTool(); tests supply fakes.

import type { JsonSchema } from "./commands";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
}

export function toFunctionTools(tools: { name: string; description: string; inputSchema: JsonSchema }[]): FunctionTool[] {
  return tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

export const COPILOT_SYSTEM = `You are the editing assistant inside a video editor. You change the user's timeline by calling tools.
Rules:
- The current timeline is given to you below (times in seconds). Use clip and asset ids exactly as it reports them.
- Call describe_project only if you need to re-check after several edits.
- Make the smallest set of edits that does what the user asked. Every edit is undoable.
- If a tool returns an error, read it, fix the arguments, and try again once.
- When done, reply in one or two short sentences saying what you changed. Do not describe tools or JSON.`;

/** Remove the reasoning some local models put before their answer. */
export const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

export interface Step {
  tool: string;
  args: unknown;
  ok: boolean;
  summary: string;
}

export interface TurnResult {
  reply: string;
  steps: Step[];
  messages: ChatMessage[];
}

/**
 * Run one user turn: let the model call tools until it answers in text or
 * runs out of steps. Arguments that are not valid JSON go back to the model
 * as an error rather than throwing, so it can correct itself.
 */
export async function runTurn(
  history: ChatMessage[],
  user: string,
  chat: (messages: ChatMessage[]) => Promise<ChatMessage>,
  callTool: (name: string, args: unknown) => Promise<{ text: string; isError: boolean }>,
  onStep?: (s: Step) => void,
  maxSteps = 10,
): Promise<TurnResult> {
  const messages: ChatMessage[] = [...history, { role: "user", content: user }];
  const steps: Step[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const msg = await chat(messages);
    messages.push(msg);
    if (!msg.tool_calls?.length) return { reply: stripThinking(msg.content ?? ""), steps, messages };
    for (const tc of msg.tool_calls) {
      let args: unknown;
      let out: { text: string; isError: boolean };
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        out = await callTool(tc.function.name, args);
      } catch (e) {
        args = tc.function.arguments;
        out = { text: `invalid arguments: ${e instanceof Error ? e.message : e}`, isError: true };
      }
      const step = { tool: tc.function.name, args, ok: !out.isError, summary: out.text.slice(0, 160) };
      steps.push(step);
      onStep?.(step);
      // Keep the transcript lean: models only need the gist of big results.
      messages.push({ role: "tool", tool_call_id: tc.id, content: out.text.length > 6000 ? `${out.text.slice(0, 6000)}…` : out.text });
    }
  }
  return { reply: "I stopped after too many steps; check the timeline and tell me what to fix.", steps, messages };
}
