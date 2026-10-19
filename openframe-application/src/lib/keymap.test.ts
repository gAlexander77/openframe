import { describe, expect, it } from "vitest";
import { bindChord, buildIndex, chordOf, chordText, DEFAULT_KEYMAP, usersOf, withChanges } from "./keymap";

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

describe("custom shortcuts", () => {
  it("rebinds a chord, taking it from its old action, and drops no-op changes", () => {
    const changes = bindChord({}, "freeze", "Mod+B");
    const map = withChanges(changes);
    expect(map.freeze).toEqual(["Mod+B"]);
    expect(map.split).toEqual(["Mod+K"]);
    expect(usersOf(map, "Mod+B")).toEqual(["freeze"]);
    // Back to the default: freeze's change goes; split keeps its loss.
    const back = bindChord(changes, "freeze", "Alt+F");
    expect(back.freeze).toBeUndefined();
    expect(back.split).toEqual(["Mod+K"]);
    expect(withChanges(bindChord({}, "split", null)).split).toEqual([]);
  });
  it("ignores unreadable saved changes", () => {
    expect(withChanges({ split: "Mod+B", nope: ["X"], freeze: ["F"] }).split).toEqual(DEFAULT_KEYMAP.split);
    expect(withChanges({ freeze: ["F"] }).freeze).toEqual(["F"]);
    expect(withChanges(null)).toEqual(DEFAULT_KEYMAP);
  });
});
