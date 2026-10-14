import { describe, expect, it } from "vitest";
import { buildIndex, chordOf, chordText, DEFAULT_KEYMAP } from "./keymap";

const ev = (key: string, code: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("chordOf", () => {
  it("names letters by physical key so Shift does not change them", () => {
    expect(chordOf(ev("B", "KeyB", { ctrlKey: true }), false)).toBe("Mod+B");
    expect(chordOf(ev("Z", "KeyZ", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+Z");
    expect(chordOf(ev("+", "Equal", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+=");
  });
  it("maps Cmd to Mod on a Mac and keeps Ctrl distinct", () => {
    expect(chordOf(ev("b", "KeyB", { metaKey: true }), true)).toBe("Mod+B");
    expect(chordOf(ev("b", "KeyB", { ctrlKey: true }), true)).toBe("Ctrl+B");
  });
  it("names space", () => {
    expect(chordOf(ev(" ", "Space"), false)).toBe("Space");
  });
});

describe("defaults", () => {
  it("bind no chord twice", () => {
    const seen = new Map<string, string>();
    for (const [id, chords] of Object.entries(DEFAULT_KEYMAP)) {
      for (const c of chords) {
        expect(seen.get(c), `${c} bound to ${seen.get(c)} and ${id}`).toBeUndefined();
        seen.set(c, id);
      }
    }
    expect(buildIndex(DEFAULT_KEYMAP).get("Mod+B")).toBe("split");
  });
  it("read per platform", () => {
    expect(chordText("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
    expect(chordText("Mod+Shift+Z", true)).toBe("⌘⇧Z");
  });
});
