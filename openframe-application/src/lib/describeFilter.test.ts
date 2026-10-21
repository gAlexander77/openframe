import { describe, expect, it } from "vitest";
import { describeProject, runCommand } from "./commands";
import { filterDescription } from "./describeFilter";
import { handleMcp, type McpHost } from "./mcp";
import { createProject } from "./project/defaults";
import type { Project } from "./project/types";

type Desc = {
  tracks: { id: string; main?: boolean; clips: { id: string; type: string; start: number; end: number; asset?: string; compound?: string; in?: number; keyframes?: object }[] }[];
  assets?: { id: string }[];
  markers?: { at: number; label: string }[];
  compounds?: { id: string; tracks: { clips: { id: string }[] }[] }[];
  shown?: Record<string, string>;
  not_found?: string[];
};

/** A small ad: three shots, a song, two titles (one keyed), markers and an
 * end card made a compound clip. */
function project(): Project {
  let p: Project = {
    ...createProject(),
    assets: ["a.mp4", "b.mp4", "c.mp4"].map((name, i) => ({ id: `a${i}`, kind: "video" as const, name, src: name, duration: 10, width: 1920, height: 1080, hasVideo: true, hasAudio: false })),
  };
  p = { ...p, assets: [...p.assets, { id: "song", kind: "audio", name: "song.wav", src: "song.wav", duration: 30, hasVideo: false, hasAudio: true }] };
  for (const [i, start] of [0, 4, 8].entries()) p = runCommand(p, "add_media_clip", { asset_id: `a${i}`, start, duration: 4, in: 1 + i });
  p = runCommand(p, "add_media_clip", { asset_id: "song", start: 0, duration: 12 });
  p = runCommand(p, "add_text", { text: "HOOK", start: 0, duration: 2 });
  p = runCommand(p, "add_text", { text: "DROP", start: 8, duration: 2 });
  for (const at of [0, 2, 4, 6, 8, 10]) p = runCommand(p, "add_marker", { at, label: "Bar" });
  const end = runCommand(p, "add_text", { text: "end.example", start: 12, duration: 3 });
  const endId = describeProject(end).tracks.flatMap((t) => t.clips).find((c) => "text" in c && c.text === "end.example")!.id;
  return runCommand(end, "create_compound_clip", { clip_ids: [endId], name: "End card" });
}

const desc = (p: Project) => describeProject(p) as unknown as Desc;
const clips = (d: Desc) => d.tracks.flatMap((t) => t.clips);

describe("describe_project's filters", () => {
  const p = project();
  const all = desc(p);
  const shot = clips(all).find((c) => c.type === "video" && c.start === 4)!;

  it("answers the whole description when nothing is asked for", () => {
    expect(filterDescription(all, {})).toBe(all);
  });

  it("reads one clip, its in-point and keyframes, with only its own media", () => {
    const one = filterDescription(all, { clip_ids: [shot.id] }) as Desc;
    expect(clips(one)).toEqual([shot]);
    expect(clips(one)[0].in).toBe(2);
    expect(one.assets!.map((a) => a.id)).toEqual(["a1"]);
    expect(one.markers).toEqual([]);
    expect(one.compounds).toBeUndefined();
    expect(one.shown).toEqual({ tracks: `1 of ${all.tracks.length}`, clips: `1 of ${clips(all).length}`, assets: "1 of 4", markers: "0 of 6", compounds: "0 of 1" });
    expect(JSON.stringify(one).length).toBeLessThan(JSON.stringify(all).length / 3);
  });

  it("narrows to a stretch of the timeline: the clips playing in it and its markers", () => {
    const d = filterDescription(all, { start: 7, end: 9 }) as Desc;
    // The shot at 4-8 is still playing at 7, the one at 8-12 starts in it,
    // the song spans it, and the DROP title starts at 8.
    expect(clips(d).map((c) => [c.type, c.start]).sort()).toEqual([["audio", 0], ["text", 8], ["video", 4], ["video", 8]]);
    expect(d.markers!.map((m) => m.at)).toEqual([8]);
    expect(d.assets!.map((a) => a.id).sort()).toEqual(["a1", "a2", "song"]);
  });

  it("keeps a track asked for by id, even empty, and names ids it does not know", () => {
    const main = all.tracks.find((t) => t.main)!;
    const d = filterDescription(all, { track_ids: [main.id, "t_nope"], start: 100 }) as Desc;
    expect(d.tracks).toEqual([{ ...main, clips: [] }]);
    expect(d.not_found).toEqual(["t_nope"]);
  });

  it("leaves out the media or the markers on request, whole timeline otherwise", () => {
    const d = filterDescription(all, { assets: false, markers: false }) as Desc;
    expect(d.tracks).toEqual(all.tracks);
    expect(d.assets).toBeUndefined();
    expect(d.markers).toBeUndefined();
    expect(d.compounds).toEqual(all.compounds);
    expect(d.shown).toEqual({ assets: "0 of 4", markers: "0 of 6" });
  });

  it("shows a compound clip's nested timeline with it, and finds a clip inside one", () => {
    const card = clips(all).find((c) => c.type === "compound")!;
    const d = filterDescription(all, { clip_ids: [card.id] }) as Desc;
    expect(d.compounds).toEqual(all.compounds);
    const inner = all.compounds![0].tracks[0].clips[0].id;
    const i = filterDescription(all, { clip_ids: [inner] }) as Desc;
    expect(i.tracks).toEqual([]);
    expect(i.compounds![0].tracks[0].clips.map((c) => c.id)).toEqual([inner]);
    expect(i.not_found).toBeUndefined();
  });

  it("lists every track over a stretch, those with nothing in it empty (ADR-115)", () => {
    // The film test learned a track's id by adding a clip to it: a stretch
    // left out the tracks with nothing playing in it.
    const d = filterDescription(all, { start: 13, end: 14 }) as Desc;
    expect(d.tracks.map((t) => t.id)).toEqual(all.tracks.map((t) => t.id));
    expect(d.tracks.find((t) => t.main)!.clips).toEqual([]);
    expect(d.shown?.tracks).toBeUndefined();
  });

  it("lists the tracks alone, with how many clips each holds, for clips false", () => {
    const d = filterDescription(all, { clips: false }) as Desc & { tracks: { clips: unknown }[] };
    expect(d.tracks).toEqual(all.tracks.map(({ clips: c, ...t }) => ({ ...t, clips: c.length })));
    expect(d.assets).toBeUndefined();
    expect(d.markers).toBeUndefined();
    expect(d.compounds).toBeUndefined();
    expect(JSON.stringify(d).length).toBeLessThan(JSON.stringify(all).length / 3);
    // A list asked for stays.
    expect((filterDescription(all, { clips: false, markers: true }) as Desc).markers).toHaveLength(6);
  });

  it("is what the tool answers over MCP", async () => {
    const host = { describe: () => describeProject(p) } as unknown as McpHost;
    const call = async (args: Record<string, unknown>) => {
      const r = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "describe_project", arguments: args } }, host)) as { result: { content: { text: string }[]; isError?: boolean } };
      return { text: r.result.content[0].text, error: r.result.isError };
    };
    const one = await call({ clip_ids: [shot.id] });
    expect(one.error).toBeFalsy();
    expect(clips(JSON.parse(one.text))).toEqual([shot]);
    expect((await call({})).text).toBe(JSON.stringify(describeProject(p)));
    expect((await call({ start: 5, end: 4 })).text).toContain("end must not be before start");
  });
});

describe("describe_project's filters on nested timelines and edge cases (ADR-108)", () => {
  /** The ad with its end card nested again: the outer compound "Outro"
   * holds the End card compound clip and a logo picture. */
  function nested(): { p: Project; outer: string; inner: string; d: Desc } {
    let p = project();
    p = { ...p, assets: [...p.assets, { id: "logo", kind: "image", name: "logo.png", src: "logo.png", duration: 0, width: 400, height: 400, hasVideo: true, hasAudio: false }] };
    const card = clips(desc(p)).find((c) => c.type === "compound")!;
    p = runCommand(p, "add_media_clip", { asset_id: "logo", start: 12, duration: 3 });
    const logo = clips(desc(p)).find((c) => c.asset === "logo")!;
    p = runCommand(p, "create_compound_clip", { clip_ids: [card.id, logo.id], name: "Outro" });
    const d = desc(p);
    const outer = clips(d).find((c) => c.type === "compound")!;
    return { p, outer: outer.compound!, inner: card.compound!, d };
  }

  it("lists the compounds a compound shown plays, all the way down, with their media", () => {
    const { outer, inner, d } = nested();
    const clip = clips(d).find((c) => c.compound === outer)!;
    const one = filterDescription(d, { clip_ids: [clip.id] }) as Desc;
    // The End card plays inside the Outro: before, only the Outro was listed.
    expect(one.compounds!.map((k) => k.id).sort()).toEqual([outer, inner].sort());
    expect(one.compounds).toEqual(d.compounds!.filter((k) => k.id === outer || k.id === inner));
    expect(one.assets!.map((a) => a.id)).toEqual(["logo"]);
    // A stretch over the outro lists both too.
    expect((filterDescription(d, { start: 13, end: 14 }) as Desc).compounds!.length).toBe(2);
  });

  it("finds a track inside a compound by its id, as it finds a clip there", () => {
    const { inner, d } = nested();
    const k = d.compounds!.find((x) => x.id === inner)! as unknown as { id: string; tracks: { id: string; clips: { id: string }[] }[] };
    const track = k.tracks[0];
    const one = filterDescription(d, { track_ids: [track.id] }) as Desc;
    // Before: not_found named it, and nothing was listed.
    expect(one.not_found).toBeUndefined();
    expect(one.compounds!.map((x) => x.id)).toEqual([inner]);
    expect(one.compounds![0].tracks).toEqual([track]);
    expect(one.tracks).toEqual([]);
  });

  it("reads an empty list of ids as no filter, and a stretch with no length as a moment", () => {
    const d = desc(project());
    // An agent that fills every optional argument sends []: it meant all.
    expect(filterDescription(d, { clip_ids: [], track_ids: [] })).toBe(d);
    const main = d.tracks.find((t) => t.main)!;
    expect((filterDescription(d, { clip_ids: [], track_ids: [main.id] }) as Desc).tracks).toEqual([main]);
    // start = end: what plays at that moment (the shot from 4 to 8, the
    // song), and the marker on it.
    const at = filterDescription(d, { start: 4, end: 4 }) as Desc;
    expect(clips(at).map((c) => [c.type, c.start]).sort()).toEqual([["audio", 0], ["video", 4]]);
    expect(at.markers!.map((m) => m.at)).toEqual([4]);
    expect(() => filterDescription(d, { start: 5, end: 4 })).toThrow("end must not be before start");
  });
});

describe("describe_project leaves the brand kit to the whole timeline (ADR-121)", () => {
  it("gives the kit with the whole timeline, and with a narrowed answer only when asked", () => {
    const p = runCommand(project(), "set_brand", { name: "Roast", primary: "#ff3366", tagline: "Fresh every morning" });
    const whole = describeProject(p) as unknown as { brand?: unknown; tracks: { clips: { id: string }[] }[] };
    expect(whole.brand).toBeDefined();
    const id = whole.tracks[0].clips[0].id;
    // The third film test read the kit with every clip it looked up.
    expect((filterDescription(whole, { clip_ids: [id] }) as { brand?: unknown }).brand).toBeUndefined();
    expect((filterDescription(whole, { start: 1, end: 2 }) as { brand?: unknown }).brand).toBeUndefined();
    expect((filterDescription(whole, { clip_ids: [id], brand: true }) as { brand?: unknown }).brand).toEqual(whole.brand);
    const without = filterDescription(whole, { brand: false }) as { brand?: unknown; tracks: unknown[] };
    expect(without.brand).toBeUndefined();
    expect(without.tracks).toEqual(whole.tracks);
  });
});
