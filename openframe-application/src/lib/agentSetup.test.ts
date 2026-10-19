import { describe, expect, it } from "vitest";
import { claudeAddLine, codexAddLine, codexToml, resultText, tomlString } from "./agentSetup";

const exe = "C:\\Program Files\\OpenFrame\\openframe.exe";

describe("agent setup lines", () => {
  it("writes Codex's stdio form with the exe as one word", () => {
    expect(codexAddLine(exe)).toBe('codex mcp add openframe -- "C:\\Program Files\\OpenFrame\\openframe.exe" --mcp-stdio');
  });

  it("writes Claude Code's HTTP form for every project", () => {
    expect(claudeAddLine("http://127.0.0.1:47280/mcp", "abc")).toBe(
      'claude mcp add --transport http --scope user openframe http://127.0.0.1:47280/mcp --header "Authorization: Bearer abc"',
    );
  });

  it("escapes TOML strings so a Windows path reads back exactly", () => {
    expect(tomlString(exe)).toBe('"C:\\\\Program Files\\\\OpenFrame\\\\openframe.exe"');
    expect(tomlString('a"b\tc\u0001')).toBe('"a\\"b\\tc\\u0001"');
    expect(tomlString("/Applications/OpenFrame.app/Contents/MacOS/openframe")).toBe('"/Applications/OpenFrame.app/Contents/MacOS/openframe"');
  });

  it("gives Codex a config.toml entry with a timeout to match the bridge", () => {
    expect(codexToml(exe)).toBe(
      '[mcp_servers.openframe]\ncommand = "C:\\\\Program Files\\\\OpenFrame\\\\openframe.exe"\nargs = ["--mcp-stdio"]\ntool_timeout_sec = 300\n',
    );
  });

  it("says what a one-click add did", () => {
    expect(resultText("codex", { status: "added", detail: "" })).toMatch(/^Added to Codex/);
    expect(resultText("claude", { status: "exists", detail: "" })).toMatch(/already has a server named "openframe"; nothing was changed/);
    expect(resultText("codex", { status: "missing", detail: "" })).toBe("The codex command was not found on this computer.");
    expect(resultText("claude", { status: "failed", detail: "boom" })).toBe("Claude Code could not add it: boom");
  });
});
