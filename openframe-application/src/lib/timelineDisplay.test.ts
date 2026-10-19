import { expect, it } from "vitest";
import { DEFAULT_TIMELINE_DISPLAY, normalizeTimelineDisplay } from "./timelineDisplay";
it("defaults missing and invalid preferences", () => { expect(normalizeTimelineDisplay(null)).toEqual(DEFAULT_TIMELINE_DISPLAY); expect(normalizeTimelineDisplay({ height: "huge", names: 0 })).toEqual(DEFAULT_TIMELINE_DISPLAY); });
it("round trips saved choices", () => { const value = { waveforms: false, thumbnails: false, names: false, height: "large" }; expect(normalizeTimelineDisplay(JSON.parse(JSON.stringify(value)))).toEqual(value); });
