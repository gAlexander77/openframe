import { expect, it } from "vitest";
import { voiceSpeedReport } from "./voiceSpeed";
it("reports automatic speed choices without claiming explicit speeds were chosen", () => {
  expect(voiceSpeedReport(undefined, 0.76, true, false, { wps: 2.5, band: [2.3, 2.8], reads: 2 })).toMatchObject({ speed_chosen: true, note: expect.stringContaining("2.5 over the speech after 2 reads") });
  expect(voiceSpeedReport(undefined, 0.6, true, false, { wps: 2.95, band: [2.3, 2.8], reads: 3 }).note).toContain("nearest");
  expect(voiceSpeedReport(0.76, 0.76, true)).toEqual({});
  expect(voiceSpeedReport(undefined, 0.95, false)).toEqual({});
  expect(voiceSpeedReport(undefined, 0.76, false, true)).toMatchObject({ speed_chosen: true, note: expect.stringContaining("previous take") });
});
