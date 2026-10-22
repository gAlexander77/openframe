import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProject, normalizeProject } from "../lib/project/defaults";
import type { Asset, Project, VideoClip } from "../lib/project/types";
import { projectDuration } from "../lib/project/ops";
import { seenLetters, seenTexts } from "../lib/designCheck";
import { streamBands } from "../lib/streamLayout";
import { setTextMeasure } from "../lib/render/size";
import { platform } from "../platform";
import { measureMix } from "../engine/mixdown";
import { createClips, createdClipProjects } from "./clips";
import { hearAsset } from "./transcript";
import { measureForCheck } from "./check";
import { store } from "./store";

vi.mock("../platform", () => ({ platform: { saveProject: vi.fn() } }));
vi.mock("../engine/mixdown", () => ({ measureMix: vi.fn(async () => ({ integrated: -20, truePeak: 0.1 })) }));
vi.mock("./transcript", () => ({ hearAsset: vi.fn(async () => {}), clipWords: (_p: Project, c: VideoClip) => [{ text: "Great", start: c.in + 0.2, end: c.in + 0.5 }, { text: "play", start: c.in + 0.6, end: c.in + 0.9 }] }));
vi.mock("./subjects", () => ({ lookAtShots: vi.fn(async () => ({})) }));
vi.mock("./check", () => ({ measureForCheck: vi.fn(async () => ({})) }));
vi.mock("./toast", () => ({ toast: () => "toast", updateToast: () => {}, dismiss: () => {} }));

let original: Project;
const asset: Asset = { id: "vod", kind: "video", name: "VOD.mp4", src: "shared.mp4", duration: 120, width: 1920, height: 1080, hasAudio: true, hasVideo: true, playbackProxy: { src: "proxy.mp4", width: 960, height: 540, size: "half", fingerprint: "same" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platform.saveProject).mockResolvedValue(undefined);
  original = createProject(); original.assets = [asset]; store.load(original);
});
afterEach(() => setTextMeasure((c, w, h) => ({ width: c.style.maxWidth * w, height: c.style.size * h / 1080 * c.style.lineHeight * Math.max(1, c.text.split("\n").length) })));

it("saves edited clip documents with bounded captions, hook, credit, one audio owner and shared media, leaving the editor intact", async () => {
  const state = store.get();
  const result = await createClips({ asset_id: asset.id, clips: [{ start: 20, end: 40, title: "A clutch" }, { start: 60, end: 90, title: "Another" }], template: { facecam: { x: 0, y: 0, w: 0.25, h: 0.3 }, credit: { name: "Streamer", handle: "@streamer", platform: "twitch" } } });
  expect(store.document()).toBe(original); expect(store.get()).toBe(state);
  expect(result.projects.map(p => p.seconds)).toEqual([661 / 30, 961 / 30]);
  expect(result.projects.every(p => p.captions > 0)).toBe(true);
  expect(hearAsset).toHaveBeenNthCalledWith(1, expect.anything(), asset.id, { from: 20, to: 40 }, expect.any(AbortSignal), expect.any(Function));
  expect(hearAsset).toHaveBeenNthCalledWith(2, expect.anything(), asset.id, { from: 60, to: 90 }, expect.any(AbortSignal), expect.any(Function));
  expect(measureMix).toHaveBeenCalledTimes(2);
  expect(measureForCheck).toHaveBeenCalledTimes(2);
  expect(result.projects.every(p => Array.isArray(p.findings))).toBe(true);
  const p = vi.mocked(platform.saveProject).mock.calls[0][0];
  expect(() => normalizeProject(JSON.parse(JSON.stringify(p)))).not.toThrow();
  expect(p.assets[0]).toBe(asset); expect(p.assets[0].playbackProxy).toBe(asset.playbackProxy);
  expect(projectDuration(p)).toBe(661);
  const all = p.tracks.flatMap(t => t.clips);
  const text = all.filter(c => c.type === "text");
  expect(text.some(c => c.text === "A clutch" && c.duration === 75)).toBe(true);
  expect(text.some(c => c.text.includes("@streamer") && c.duration === 90)).toBe(true);
  expect(text.some(c => c.text === "Follow Streamer on twitch")).toBe(true);
  expect(text.filter(c => c.caption).every(c => c.wordTimes?.length === 2 && c.style.highlight)).toBe(true);
  expect(all.filter(c => c.type === "video" && !c.muted)).toHaveLength(1);
  expect(createdClipProjects()).toEqual(expect.arrayContaining(result.projects.map(p => p.id)));
});

it("validates all moments before saving and reports a partial batch without changing the source", async () => {
  await expect(createClips({ asset_id: asset.id, clips: [{ start: 0, end: 5 }, { start: 200, end: 210 }] })).rejects.toThrow("Moment 2");
  expect(platform.saveProject).not.toHaveBeenCalled();
  vi.mocked(platform.saveProject).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Disk full"));
  await expect(createClips({ asset_id: asset.id, clips: [{ start: 0, end: 5 }, { start: 10, end: 15 }], template: { captions: false } })).rejects.toThrow(/Disk full.*Saved projects/);
  expect(store.document()).toBe(original);
});

it.each(["stream", "vertical_fill", "full"] as const)("keeps a visible %s hook with opening credit and captions", async layout => {
  // Account for wrapped credit and box padding, which the default test
  // measurement omits. Exact font glyphs are checked by the browser drive.
  setTextMeasure((c, w, h) => {
    const k = h / 1080, pad = (c.style.background?.padding ?? 0) * k + 2;
    const measure = (s: string) => s.length * (c.style.size * k * 0.55 + c.style.letterSpacing * k);
    const lines = [""];
    for (const word of c.text.split(/\s+/)) {
      const next = [lines.at(-1), word].filter(Boolean).join(" ");
      if (lines.at(-1) && measure(next) > c.style.maxWidth * w) lines.push(word);
      else lines[lines.length - 1] = next;
    }
    return { width: Math.ceil(Math.max(...lines.map(measure)) + pad * 2), height: Math.ceil(c.style.size * k * c.style.lineHeight * lines.length + pad * 2), layout: { pad, lines } };
  });
  const template = { layout, facecam: { x: 0, y: 0, w: 0.3, h: 0.35 }, split: 0.35, credit: { name: "Fixture streamer", handle: "@fixture", platform: "twitch" as const } };
  const result = await createClips({ asset_id: asset.id, clips: [{ start: 0, end: 10, title: "Watch this" }], template });
  expect(result.projects[0].findings.filter(f => f.rule === "hook_no_clear_room")).toEqual([]);
  const p = vi.mocked(platform.saveProject).mock.calls[0][0];
  const texts = seenTexts(p), hook = texts.find(s => s.c.text === "Watch this");
  expect(hook).toBeDefined();
  const hb = seenLetters(p, hook!)!.box;
  if (layout === "stream") expect(hb.top).toBeGreaterThanOrEqual(streamBands(p.width, p.height, template).facecam!.h);
  for (const s of texts.filter(s => s.c.id !== hook!.c.id && s.start < hook!.duration)) {
    const b = seenLetters(p, s)!.box;
    expect(hb.left < b.right && hb.right > b.left && hb.top < b.bottom && hb.bottom > b.top).toBe(false);
  }
  expect(store.document()).toBe(original);
});
