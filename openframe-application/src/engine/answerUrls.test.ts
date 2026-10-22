import { afterEach, expect, it, vi } from "vitest";
import { answerUrl, releaseAnswerUrl } from "./answerUrls";
import { memoryOwners } from "./memory";

afterEach(() => { memoryOwners.endSession(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("revokes delivered, abandoned and closed-project answers exactly once", async () => {
  vi.useFakeTimers();
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const delivered = answerUrl(new Blob(["video"]));
  expect(memoryOwners.snapshot().answer_blob_urls.bytes).toBe(5);
  releaseAnswerUrl(delivered); releaseAnswerUrl(delivered);
  expect(revoke.mock.calls).toEqual([[delivered]]);
  const abandoned = answerUrl(new Blob(["still"]));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revoke.mock.calls).toEqual([[delivered], [abandoned]]);
  const closed = answerUrl(new Blob(["preview"]));
  memoryOwners.endSession();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revoke.mock.calls).toEqual([[delivered], [abandoned], [closed]]);
  expect(memoryOwners.snapshot().answer_blob_urls.bytes).toBe(0);
});
