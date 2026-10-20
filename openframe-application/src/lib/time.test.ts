import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTimecode,
  frameAt,
  framesToSeconds,
  parseJump,
  parseTimecode,
  secondsToFrames,
} from "./time";

const f30 = { num: 30, den: 1 };
const f2997 = { num: 30000, den: 1001 };
const f5994 = { num: 60000, den: 1001 };

describe("frame/second conversion", () => {
  it("round-trips at NTSC rates without drift", () => {
    for (const f of [0, 1, 1799, 1800, 107892]) {
      expect(secondsToFrames(framesToSeconds(f, f2997), f2997)).toBe(f);
    }
  });
  it("takes a time exactly between two frames to the earlier, the frame on screen then (ADR-102)", () => {
    const f30 = { num: 30, den: 1 };
    // 3.75 s and 7.75 s at 30 fps are frames 112.5 and 232.5.
    expect(secondsToFrames(3.75, f30)).toBe(112);
    expect(secondsToFrames(7.75, f30)).toBe(frameAt(7.75, f30));
    expect(secondsToFrames(7.76, f30)).toBe(233);
    expect(secondsToFrames(7.74, f30)).toBe(232);
    expect(Object.is(secondsToFrames(0.01, f30), 0)).toBe(true);
    // A whole-frame span between two ties keeps its length.
    expect(secondsToFrames(0.75, f30) - secondsToFrames(0.25, f30)).toBe(15);
  });
  it("frameAt lands on the boundary frame despite float error", () => {
    expect(frameAt(framesToSeconds(3, f2997), f2997)).toBe(3);
    expect(frameAt(0.1 + 0.2, { num: 10, den: 1 })).toBe(3);
  });
});

describe("timecode", () => {
  it("formats non-drop", () => {
    expect(formatTimecode(0, f30)).toBe("00:00:00:00");
    expect(formatTimecode(30 * 3661 + 7, f30)).toBe("01:01:01:07");
  });
  it("skips frame numbers 0-1 each minute at 29.97 drop-frame", () => {
    expect(formatTimecode(1799, f2997)).toBe("00:00:59;29");
    expect(formatTimecode(1800, f2997)).toBe("00:01:00;02");
    expect(formatTimecode(17982, f2997)).toBe("00:10:00;00");
    expect(formatTimecode(107892, f2997)).toBe("01:00:00;00");
  });
  it("drops four at 59.94", () => {
    expect(formatTimecode(3600, f5994)).toBe("00:01:00;04");
  });
  it("parses what it formats", () => {
    for (const f of [0, 59, 1800, 17982, 107892, 54321]) {
      expect(parseTimecode(formatTimecode(f, f2997), f2997)).toBe(f);
      expect(parseTimecode(formatTimecode(f, f30), f30)).toBe(f);
    }
  });
  it("accepts partial groups and seconds, refuses junk", () => {
    expect(parseTimecode("3:04", f30)).toBe(94);
    expect(parseTimecode("2.5s", f30)).toBe(75);
    expect(parseTimecode("00:00:00:30", f30)).toBeNull();
    expect(parseTimecode("abc", f30)).toBeNull();
  });
  it("reads digits alone right to left, and jumps by offsets", () => {
    expect(parseTimecode("1000", f30)).toBe(300);
    expect(parseTimecode("10215", f30)).toBe((60 + 2) * 30 + 15);
    expect(parseTimecode("15", f30)).toBe(15);
    expect(parseJump("+15", f30, 100)).toBe(115);
    expect(parseJump("-1:00", f30, 100)).toBe(70);
    expect(parseJump("-10:00", f30, 100)).toBe(0);
    expect(parseJump("2:00", f30, 100)).toBe(60);
    expect(parseJump("+x", f30, 100)).toBeNull();
  });
  it("rejects dropped frame labels instead of moving to the previous second", () => {
    expect(parseTimecode("00:01:00;00", f2997)).toBeNull();
    expect(parseTimecode("00:01:00;01", f2997)).toBeNull();
    expect(parseTimecode("00:01:00;03", f5994)).toBeNull();
    expect(parseTimecode("00:01:00;04", f5994)).toBe(3600);
    expect(parseTimecode("00:10:00;00", f2997)).toBe(17982);
  });
  it("rejects typed times outside exact integer-frame precision", () => {
    expect(parseTimecode("99999999999999999999999999999s", f30)).toBeNull();
    expect(parseTimecode("99999999999999999:00:00:00", f30)).toBeNull();
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(4.25)).toBe("4.3s");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});
