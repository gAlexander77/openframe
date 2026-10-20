import { describe, expect, it } from "vitest";
import { bindChord, buildIndex, chordOf, chordText, DEFAULT_KEYMAP, focusKeeps, usersOf, withChanges, type Focused } from "./keymap";

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

describe("focusKeeps", () => {
  const at = (kind: Focused["kind"], keyboard = true): Focused => ({ kind, keyboard });
  const space = ev(" ", "Space");
  it("lets Space press a button, switch, checkbox or menu item the keyboard reached (ADR-111)", () => {
    // It played the timeline instead: a switch reached with Tab never toggled.
    expect(focusKeeps(space, at("control"))).toBe(true);
    expect(focusKeeps(space, at("dropdown"))).toBe(true);
    // The play chord still plays from the timeline, the viewer and the page.
    expect(focusKeeps(space, at("none"))).toBe(false);
    expect(focusKeeps(space, at("none", false))).toBe(false);
    // A slider keeps its arrows, not Space: adjust, then play (UX-06).
    expect(focusKeeps(space, at("slider"))).toBe(false);
    expect(focusKeeps(ev("ArrowLeft", "ArrowLeft"), at("slider"))).toBe(true);
    // A link is pressed by Enter; Space would only scroll.
    expect(focusKeeps(space, at("link"))).toBe(false);
  });
  it("still plays after a click left a button focused, as CapCut does", () => {
    expect(focusKeeps(space, at("control", false))).toBe(false);
    expect(focusKeeps(space, at("dropdown", false))).toBe(false);
  });
  it("gives chords with Space to the app, and every key to a text field", () => {
    expect(focusKeeps(ev(" ", "Space", { ctrlKey: true, shiftKey: true }), at("control"))).toBe(false);
    expect(focusKeeps(ev(" ", "Space", { shiftKey: true }), at("control"))).toBe(false);
    expect(focusKeeps(space, at("text"))).toBe(true);
    expect(focusKeeps(ev("Escape", "Escape"), at("text", false))).toBe(true);
    expect(focusKeeps(ev("b", "KeyB", { ctrlKey: true }), at("text"))).toBe(true);
  });
  it("lets Enter press a focused control or link however it got focus, and leaves other keys to the app", () => {
    expect(focusKeeps(ev("Enter", "Enter"), at("control", false))).toBe(true);
    expect(focusKeeps(ev("Enter", "Enter"), at("link"))).toBe(true);
    expect(focusKeeps(ev("Enter", "Enter"), at("none"))).toBe(false);
    expect(focusKeeps(ev("Delete", "Delete"), at("control"))).toBe(false);
    expect(focusKeeps(ev("ArrowLeft", "ArrowLeft", { ctrlKey: true }), at("dropdown"))).toBe(false);
  });
});
