import { beforeEach, expect, it, vi } from "vitest";
import { createProject } from "../lib/project/defaults";
import type { Asset, Project, VideoClip } from "../lib/project/types";
import { projectDuration } from "../lib/project/ops";
import { platform } from "../platform";
import { measureMix } from "../engine/mixdown";
import { createClips, createdClipProjects } from "./clips";
import { hearAsset } from "./transcript";
import { store } from "./store";

vi.mock("../platform", () => ({ platform: { saveProject: vi.fn() } }));
vi.mock("../engine/mixdown", () => ({ measureMix: vi.fn(async () => ({ integrated: -20, truePeak: 0.1 })) }));
vi.mock("./transcript", () => ({ hearAsset: vi.fn(async () => {}), clipWords: (_p: Project, c: VideoClip) => [{ text: "Great", start: c.in + 0.2, end: c.in + 0.5 }, { text: "play", start: c.in + 0.6, end: c.in + 0.9 }] }));
vi.mock("./toast", () => ({ toast: () => "toast", updateToast: () => {}, dismiss: () => {} }));

let original: Project;
const asset: Asset = { id: "vod", kind: "video", name: "VOD.mp4", src: "shared.mp4", duration: 120, width: 1920, height: 1080, hasAudio: true, hasVideo: true, playbackProxy: { src: "proxy.mp4", width: 960, height: 540, size: "half", fingerprint: "same" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platform.saveProject).mockResolvedValue(undefined);
  original = createProject(); original.assets = [asset]; store.load(original);
});

it("saves edited clip documents with bounded captions, hook, credit, one audio owner and shared media, leaving the editor intact", async () => {
  const state = store.get();
  const result = await createClips({ asset_id: asset.id, clips: [{ start: 20, end: 40, title: "A clutch" }, { start: 60, end: 90, title: "Another" }], template: { facecam: { x: 0, y: 0, w: 0.25, h: 0.3 }, credit: { name: "Streamer", handle: "@streamer", platform: "twitch" } } });
  expect(store.document()).toBe(original); expect(store.get()).toBe(state);
  expect(result.projects.map(p => p.seconds)).toEqual([22, 32]);
  expect(result.projects.every(p => p.captions > 0)).toBe(true);
  expect(hearAsset).toHaveBeenNthCalledWith(1, expect.anything(), asset.id, { from: 20, to: 40 }, expect.any(AbortSignal));
  expect(hearAsset).toHaveBeenNthCalledWith(2, expect.anything(), asset.id, { from: 60, to: 90 }, expect.any(AbortSignal));
  expect(measureMix).toHaveBeenCalledTimes(2);
  const p = vi.mocked(platform.saveProject).mock.calls[0][0];
  expect(p.assets[0]).toBe(asset); expect(p.assets[0].playbackProxy).toBe(asset.playbackProxy);
  expect(projectDuration(p)).toBe(660);
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
