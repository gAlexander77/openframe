import { describe, expect, it } from "vitest";
import { planMusic } from "./arrange";
import { cueSheet, musicName, planMusicAnswer, readMusicArgs } from "./cues";
import { handleMcp, listTools, type McpHost } from "../mcp";

describe("the cue sheet", () => {
  const plan = planMusic({ style: "launch", seed: 5, sections: [{ name: "intro", bars: 4 }, { name: "build", bars: 4 }, { name: "drop", bars: 8 }, { name: "outro", bars: 4 }] });

  it("lists every bar and beat, the sections and the drop, in timeline seconds once placed", () => {
    const c = cueSheet(plan, 10);
    expect(c.bpm).toBe(120);
    expect(c.bars).toHaveLength(20);
    expect(c.bars[0]).toBe(10);
    expect(c.bars[1]).toBe(12);
    expect(c.beats).toHaveLength(80);
    expect(c.beats[1]).toBe(10.5);
    expect(c.sections.map((s) => [s.role, s.start, s.end, s.bars])).toEqual([["intro", 10, 18, 4], ["build", 18, 26, 4], ["drop", 26, 42, 8], ["outro", 42, 50, 4]]);
    expect(c.drops).toEqual([26]);
    expect(c.final_hit).toBe(42);
    expect(c.breaths).toEqual([[25.75, 26], [41.75, 42]]);
    expect(c.start).toBe(10);
    expect(c.duration).toBe(40);
  });

  it("ranks the cut points: the drop first, then section starts, phrases and bars", () => {
    const c = cueSheet(plan);
    const kind = (t: number) => c.cut_points.find((x) => x.at === t)?.kind;
    expect(kind(16)).toBe("drop");
    expect(kind(8)).toBe("section");
    expect(kind(24)).toBe("phrase");
    expect(kind(18)).toBe("bar");
    expect(kind(2)).toBeUndefined();
    expect(c.cut_points.map((x) => x.at)).toEqual([...c.cut_points.map((x) => x.at)].sort((a, b) => a - b));
  });

  it("reads the tools' arguments, checking each", () => {
    const o = readMusicArgs({ style: "lofi", key: "Eb", mode: "dorian", length: 45, stems: true, markers: ["bars", "drop"] }, () => 42);
    expect(o.request).toMatchObject({ style: "lofi", key: "Eb", mode: "dorian", length: 45, seed: 42 });
    expect(o).toMatchObject({ stems: true, place: "mix", start: 0, loudness: -14 });
    expect(readMusicArgs({ style: "launch", place: "stems" }).stems).toBe(true);
    expect(() => readMusicArgs({ style: "polka" })).toThrow(/style must be/);
    expect(() => readMusicArgs({ style: "launch", bpm: 400 })).toThrow(/bpm must be/);
    expect(() => readMusicArgs({ style: "launch", sections: [{ bars: 4 }] })).toThrow(/needs a name/);
    expect(() => readMusicArgs({ style: "launch", markers: ["chords"] })).toThrow(/markers takes/);
    expect(() => readMusicArgs({ style: "launch", length: 900 })).toThrow(/length must be/);
  });

  it("names the files after the style, tempo, key and seed", () => {
    expect(musicName(plan, "Product launch")).toBe("Product launch 120 BPM A minor (seed 5)");
    expect(musicName(plan, "x", "My: score")).toBe("My- score");
  });
});

describe("plan_music and generate_music over MCP", () => {
  const calls: unknown[][] = [];
  const host = {
    name: "OpenFrame",
    version: "0",
    ai: async (tool: string, target: string, options: unknown) => (calls.push([tool, target, options]), { asset_id: "a_1" }),
  } as unknown as McpHost;
  const call = (name: string, args: Record<string, unknown>) => handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, host);
  const text = (r: Awaited<ReturnType<typeof call>>) => (r!.result as { content: { text: string }[] }).content[0].text;

  it("lists both, plan_music read-only", () => {
    const tools = listTools();
    const plan = tools.find((t) => t.name === "plan_music")!;
    expect(plan.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "generate_music")!.inputSchema.required).toEqual(["style"]);
  });

  it("answers a plan without rendering, the same as generate_music would place", async () => {
    const r = JSON.parse(text(await call("plan_music", { style: "cinematic", seed: 9, length: 30, start: 4 })));
    expect(r.start).toBe(4);
    expect(r.sections[0].start).toBe(4);
    expect(r.chords.length).toBe(r.bars.length);
    expect(r.note).toMatch(/seed 9/);
    expect(JSON.stringify(planMusicAnswer({ style: "cinematic", seed: 9, length: 30, start: 4 }))).toBe(JSON.stringify(r));
  });

  it("hands generate_music to the app with its arguments", async () => {
    await call("generate_music", { style: "ambient", length: 20 });
    expect(calls.at(-1)).toEqual(["generateMusic", "", { style: "ambient", length: 20 }]);
  });
});
