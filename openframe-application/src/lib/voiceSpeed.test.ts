import { expect, it } from "vitest";
import { voiceSpeedReport } from "./voiceSpeed";
it("reports automatic speed choices without claiming explicit speeds were chosen", () => {
  expect(voiceSpeedReport(undefined, 0.76, true)).toMatchObject({ speed_chosen: true, note: expect.stringContaining("rushed-line") });
  expect(voiceSpeedReport(0.76, 0.76, true)).toEqual({});
  expect(voiceSpeedReport(undefined, 0.95, false)).toEqual({});
  expect(voiceSpeedReport(undefined, 0.76, false, true)).toMatchObject({ speed_chosen: true, note: expect.stringContaining("previous take") });
});
