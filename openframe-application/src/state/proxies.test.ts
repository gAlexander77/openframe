import { beforeEach, expect, it, vi } from "vitest";
import { createProject, clipForAsset } from "../lib/project/defaults";
import type { Asset, PlaybackProxy } from "../lib/project/types";
import { platform } from "../platform";
import { store } from "./store";
import { createProxies, deleteProxies } from "./proxies";

vi.mock("../platform", () => ({ platform: { kind: "desktop", makePlaybackProxy: vi.fn(), deletePlaybackProxy: vi.fn() } }));
vi.mock("../engine/thumbs", () => ({ prepare: vi.fn() }));
const assets: Asset[] = ["a", "b"].map((id) => ({ id, src: `${id}.mov`, name: id, kind: "video", duration: 2, hasAudio: false, hasVideo: true }));
const proxy = (a: Asset): PlaybackProxy => ({ src: `playback-${a.id}.mp4`, width: 960, height: 540, size: "half", fingerprint: a.src });
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => {
  vi.clearAllMocks();
  const p = createProject(); p.assets = assets;
  p.tracks[0].clips = [clipForAsset(assets[0], 100, p.fps), clipForAsset(assets[1], 300, p.fps)];
  store.load(p);
  vi.mocked(platform.makePlaybackProxy).mockImplementation(async (a) => proxy(a));
  vi.mocked(platform.deletePlaybackProxy).mockResolvedValue();
});
it("runs one asset at a time, preserves gaps, and undoes a batch as one edit", async () => {
  const first = deferred<PlaybackProxy>(), second = deferred<PlaybackProxy>();
  vi.mocked(platform.makePlaybackProxy).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  const tracks = store.document().tracks;
  const batch = createProxies(["a", "b"]);
  await vi.waitFor(() => expect(platform.makePlaybackProxy).toHaveBeenCalledTimes(1));
  expect(store.document().assets[0].playbackProxy).toBeUndefined();
  first.resolve(proxy(assets[0]));
  await vi.waitFor(() => expect(platform.makePlaybackProxy).toHaveBeenCalledTimes(2));
  second.resolve(proxy(assets[1]));
  const result = await batch;
  expect(result.map((r) => r.proxy)).toEqual(["ready", "ready"]);
  expect(store.document().tracks).toEqual(tracks);
  expect(store.history().undo).toEqual(["Create playback proxies"]);
  store.undo();
  expect(store.document().assets.every((a) => !a.playbackProxy)).toBe(true);
  expect(platform.deletePlaybackProxy).not.toHaveBeenCalled();
});
it("a queued delete sees the proxies the preceding create just made", async () => {
  const create = createProxies(["a", "b"]);
  const remove = deleteProxies(["a", "b"]);
  await create; await remove;
  expect(platform.deletePlaybackProxy).toHaveBeenNthCalledWith(1, "playback-a.mp4");
  expect(platform.deletePlaybackProxy).toHaveBeenNthCalledWith(2, "playback-b.mp4");
  expect(store.document().assets.every((a) => !a.playbackProxy)).toBe(true);
  expect(store.history().undo).toEqual(["Delete playback proxies", "Create playback proxies"]);
});
it("late FFmpeg completion cannot edit another document session", async () => {
  const gate = deferred<PlaybackProxy>();
  vi.mocked(platform.makePlaybackProxy).mockImplementationOnce(() => gate.promise);
  const batch = createProxies(["a"]);
  await vi.waitFor(() => expect(platform.makePlaybackProxy).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(platform.makePlaybackProxy).mock.calls[0][3]!;
  store.load(createProject());
  expect(signal.aborted).toBe(true);
  gate.resolve(proxy(assets[0]));
  await batch;
  expect(store.document().assets).toEqual([]);
  expect(store.history().undo).toEqual([]);
});
it("keeps the reference when cache deletion fails and reports the error", async () => {
  await createProxies(["a"]);
  vi.mocked(platform.deletePlaybackProxy).mockRejectedValueOnce(new Error("File in use"));
  const answer = await deleteProxies(["a"]);
  expect(answer[0].error).toBe("File in use");
  expect(store.document().assets[0].playbackProxy).toBeDefined();
});

it("a queued create can replace the previous batch with another size", async () => {
  vi.mocked(platform.makePlaybackProxy).mockImplementation(async (a, size) => ({ ...proxy(a), size, src: `playback-${a.id}-${size}.mp4` }));
  const half = createProxies(["a"], "half");
  const quarter = createProxies(["a"], "quarter");
  await half;
  const answer = await quarter;
  expect(answer[0].proxy).toBe("ready");
  expect(store.document().assets[0].playbackProxy?.size).toBe("quarter");
  store.undo();
  expect(store.document().assets[0].playbackProxy?.size).toBe("half");
});
it("deleting absent references reports none without an empty undo step", async () => {
  expect((await deleteProxies(["a"]))[0].proxy).toBe("none");
  expect(store.history().undo).toEqual([]);
  expect(platform.deletePlaybackProxy).not.toHaveBeenCalled();
});
