import { describe, expect, it } from "vitest";
import { chatCue, parseChatReplay } from "./chatReplay";

describe("chat replay formats", () => {
  it("reads Twitch offsets, body and fragments, and sorts them", () => {
    expect(parseChatReplay(JSON.stringify({ comments: [
      { content_offset_seconds: 42, message: { body: "clip that" } },
      { content_offset_seconds: 12.5, message: { fragments: [{ text: "No " }, { text: "way!" }] } },
      { content_offset_seconds: -1, message: { body: "bad" } }, null,
    ] }))).toEqual([{ time: 12.5, text: "No way!" }, { time: 42, text: "clip that" }]);
  });
  it("reads chat-downloader arrays and JSONL, skipping malformed lines", () => {
    const row = { time_in_seconds: 9.25, message: "KEKW" };
    expect(parseChatReplay(JSON.stringify([row]))).toEqual([{ time: 9.25, text: "KEKW" }]);
    expect(parseChatReplay(JSON.stringify(row))).toEqual([{ time: 9.25, text: "KEKW" }]);
    expect(parseChatReplay(`${JSON.stringify(row)}\nbroken\n{}\n{"time_in_seconds":"4","message":"bad"}`)).toEqual([{ time: 9.25, text: "KEKW" }]);
  });
  it("reads bracketed and angle-name text, hours and minute timestamps", () => {
    expect(parseChatReplay("[0:12:34] name: no way\n12:34:56 <name> clip: this!\n[12:34] user: W\n[1:99:00] bad: ignored\nno timestamp")).toEqual([
      { time: 754, text: "no way" }, { time: 754, text: "W" }, { time: 45296, text: "clip: this!" },
    ]);
  });
  it("skips invalid objects and scores emotes, repetition and clip requests", () => {
    for (const input of ["null", "{}", "[]", "garbage", '[{"time_in_seconds":null,"message":"bad"}]']) expect(parseChatReplay(input)).toEqual([]);
    expect(chatCue("ordinary chat")).toBe(0);
    expect(chatCue("KEKW KEKW OMEGALUL W")).toBe(1);
    expect(chatCue("clip that")).toBeGreaterThan(0.5);
    expect(chatCue("yes yes yes yes")).toBeGreaterThan(0.5);
  });
});
