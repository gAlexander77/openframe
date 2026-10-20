import { describe, expect, it } from "vitest";
import { handleMcp, type McpHost } from "./mcp";
import { beatGrid, musicSummary } from "./musicSummary";

/** The reading the Claude film test got for its 56 s, 120 BPM song: an
 * even grid with three beats a frame late (0.033, 33.033, 44.533). */
function reading() {
  const beats = Array.from({ length: 105 }, (_, i) => i * 0.5).map((t) => (t === 0 || t === 33 || t === 44.5 ? +(t + 0.033).toFixed(3) : t));
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  return {
    bpm: 120,
    beats,
    downbeats,
    phrases: downbeats.filter((_, i) => i % 4 === 0),
    hits: Array.from({ length: 170 }, (_, i) => 4 + i * 0.267),
    beat_energy: beats.map(() => 0.9),
    sections: [
      { start: 0, end: 8, label: "intro" as const, energy: 0.5 },
      { start: 8, end: 36, label: "drop" as const, energy: 0.9 },
      { start: 36, end: 56, label: "drop" as const, energy: 0.93 },
    ],
    drop: 36,
    drops: [8, 36],
    beats_per_bar: 4,
    source: { asset_id: "a_song", analyzed: [0, 56], whole_file: true, cached: false, clip_in: 0, clip_speed: 1 },
    confidence: { tempo: 0.86, bars: 0.17, sections: 0.87 },
    markers: 0,
  };
}

describe("analyze_music's summary", () => {
  it("finds the even grid most beats sit on, a stray first beat included", () => {
    const g = beatGrid(reading().beats, 120)!;
    expect(g.first_beat).toBe(0);
    expect(g.beat_seconds).toBe(0.5);
    expect(g.off_grid).toEqual([0.033, 33.033, 44.533]);
    // A grid that starts off zero keeps its phase.
    expect(beatGrid([1.25, 1.75, 2.25, 2.75], 120)).toEqual({ first_beat: 1.25, beat_seconds: 0.5, off_grid: [] });
    expect(beatGrid([], 120)).toBeNull();
  });

  it("keeps the tempo, bars, parts and drops, and counts the long lists", () => {
    const full = reading();
    const s = musicSummary(full);
    expect(s).not.toHaveProperty("beats");
    expect(s).not.toHaveProperty("hits");
    expect(s).not.toHaveProperty("beat_energy");
    expect(s).toMatchObject({ bpm: 120, downbeats: full.downbeats, phrases: full.phrases, sections: full.sections, drop: 36, drops: [8, 36], confidence: full.confidence, source: full.source, markers: 0 });
    expect(s.grid).toEqual({ first_beat: 0, beat_seconds: 0.5, bar_seconds: 2, off_grid: [0.033, 33.033, 44.533] });
    expect(s.counts).toEqual({ beats: 105, bars: 27, phrases: 7, hits: 170 });
    expect(JSON.stringify(s).length).toBeLessThan(JSON.stringify(full).length / 2);
  });

  it("says when the beats do not follow one grid", () => {
    const beats = Array.from({ length: 40 }, (_, i) => +(i * 0.5 + (i % 3) * 0.05).toFixed(3));
    const s = musicSummary({ ...reading(), beats });
    expect(s.grid!.off_grid).toHaveLength(16);
    expect(s.grid!.off_grid_count).toBeGreaterThan(16);
    expect(s.detail).toContain("detail full is worth reading");
  });

  it("answers the summary over MCP, and every list with detail full", async () => {
    const asked: unknown[] = [];
    const host = { ai: async (tool: string, target: string, opts: unknown) => (asked.push([tool, target, opts]), reading()) } as unknown as McpHost;
    const call = async (args: Record<string, unknown>) => {
      const r = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "analyze_music", arguments: args } }, host)) as { result: { content: { text: string }[]; isError?: boolean } };
      expect(r.result.isError, r.result.content[0].text).toBeFalsy();
      return JSON.parse(r.result.content[0].text);
    };
    const summary = await call({ clip_id: "c_song", markers: ["bars"] });
    expect(summary.grid.first_beat).toBe(0);
    expect(summary.beats).toBeUndefined();
    expect(asked[0]).toEqual(["analyzeMusic", "c_song", { markers: ["bars"] }]);
    const full = await call({ clip_id: "c_song", detail: "full" });
    expect(full.beats).toHaveLength(105);
    expect(full.hits).toHaveLength(170);
  });
});
