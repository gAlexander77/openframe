import { afterEach, expect, it, vi } from "vitest";
import { BlobSource, Input, type Source } from "mediabunny";
import { mediaForSrc, closeMedia } from "./media";
import { memoryOwners } from "./memory";
import { platform } from "../platform";

vi.mock("../platform", () => ({ platform: { sourceFor: vi.fn(async () => new BlobSource(new Blob())) } }));

afterEach(() => { memoryOwners.endSession(); vi.restoreAllMocks(); });

it("keeps shared inputs alive through session retirement until every borrower returns", async () => {
  vi.spyOn(Input.prototype, "getPrimaryVideoTrack").mockResolvedValue(null);
  vi.spyOn(Input.prototype, "getPrimaryAudioTrack").mockResolvedValue(null);
  const disposed = vi.spyOn(Input.prototype, "dispose");
  const first = await mediaForSrc("shared-vod.mp4");
  const second = await mediaForSrc("shared-vod.mp4");
  expect(second.input).toBe(first.input);
  memoryOwners.endSession();
  await Promise.resolve();
  expect(disposed).not.toHaveBeenCalled();
  expect(memoryOwners.snapshot().active_media_inputs.count).toBe(1);
  // The next project opens a fresh source, never a disposed cached input.
  const next = await mediaForSrc("shared-vod.mp4");
  expect(next.input).not.toBe(first.input);
  first.release(); first.release();
  await Promise.resolve();
  expect(disposed).not.toHaveBeenCalled();
  second.release();
  await Promise.resolve();
  expect(disposed.mock.instances).toEqual([first.input]);
  await closeMedia("shared-vod.mp4");
  expect(disposed).toHaveBeenCalledTimes(1);
  next.release(); next.release();
  await Promise.resolve();
  expect(disposed.mock.instances).toEqual([first.input, next.input]);
  expect(memoryOwners.snapshot().active_media_inputs.count).toBe(0);
  expect(platform.sourceFor).toHaveBeenCalledTimes(2);
});

it("does not dispose a shared source that finishes opening after its session retires", async () => {
  vi.spyOn(Input.prototype, "getPrimaryVideoTrack").mockResolvedValue(null);
  vi.spyOn(Input.prototype, "getPrimaryAudioTrack").mockResolvedValue(null);
  const disposed = vi.spyOn(Input.prototype, "dispose");
  let finish!: (source: Source) => void;
  vi.mocked(platform.sourceFor).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = mediaForSrc("shared-proxy.mp4");
  memoryOwners.endSession();
  finish(new BlobSource(new Blob()));
  const borrowed = await pending;
  expect(disposed).not.toHaveBeenCalled();
  borrowed.release();
  await Promise.resolve();
  expect(disposed.mock.instances).toEqual([borrowed.input]);
  expect(memoryOwners.snapshot().active_media_inputs.count).toBe(0);
});
