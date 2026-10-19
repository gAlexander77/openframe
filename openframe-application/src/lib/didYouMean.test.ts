import { describe, expect, it } from "vitest";
import { didYouMean } from "./didYouMean";

describe("didYouMean", () => {
  it("reads a word these tools spell another way", () => {
    expect(didYouMean("time", ["at", "max_width"])).toBe("at");
    expect(didYouMean("output_dir", ["name", "format", "folder"])).toBe("folder");
    expect(didYouMean("fontSize", ["font", "size", "color"])).toBe("size");
    expect(didYouMean("length", ["start", "duration"])).toBe("duration");
  });

  it("reads camelCase, plurals and a missing _id as the name they mean", () => {
    expect(didYouMean("clipId", ["clip_id", "at"])).toBe("clip_id");
    expect(didYouMean("clip_id", ["clip_ids", "path"])).toBe("clip_ids");
    expect(didYouMean("asset", ["asset_id", "start"])).toBe("asset_id");
    expect(didYouMean("maxWidth", ["max_width"])).toBe("max_width");
  });

  it("forgives a near spelling, more for longer names", () => {
    expect(didYouMean("colums", ["times", "columns", "tile_width"])).toBe("columns");
    expect(didYouMean("tile_widht", ["columns", "tile_width"])).toBe("tile_width");
    expect(didYouMean("set_fade", ["set_fades", "set_filter"])).toBe("set_fades");
  });

  it("suggests nothing rather than a guess", () => {
    expect(didYouMean("banana", ["at", "max_width"])).toBeUndefined();
    expect(didYouMean("xy", ["at"])).toBeUndefined();
    expect(didYouMean("time", [])).toBeUndefined();
    // A synonym is offered only when the tool has it.
    expect(didYouMean("time", ["clip_id"])).toBeUndefined();
  });
});
