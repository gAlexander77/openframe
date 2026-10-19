import { describe, expect, it } from "vitest";
import { assistantMax, assistantShare, canDock, DOCK, dockColumns, sideMax } from "./dock";
import { DEFAULT_LAYOUT } from "./layout";

// The player's width once the columns are placed: what is left of the row.
const player = (c: ReturnType<typeof dockColumns>) => c.editor - DOCK.pad - c.right - (c.left ? c.left + DOCK.gap : 0) - DOCK.gap;

describe("dockColumns", () => {
  it("gives every panel its working width at the three checked window sizes", () => {
    for (const width of [1600, 1280, 1100]) {
      const c = dockColumns(DEFAULT_LAYOUT, width);
      expect(c.assistant).toBeGreaterThanOrEqual(DOCK.assistantMin);
      expect(c.editor).toBeGreaterThanOrEqual(DOCK.editor);
      expect(c.right).toBeGreaterThanOrEqual(DOCK.inspector);
      expect(player(c)).toBeGreaterThanOrEqual(DOCK.player);
      if (c.left) expect(c.left).toBeGreaterThanOrEqual(DOCK.library);
      // Everything adds up to the window.
      expect(c.editor + DOCK.gap + c.assistant).toBe(width);
    }
  });

  it("keeps the library where it fits and lets it step aside where it does not", () => {
    expect(dockColumns(DEFAULT_LAYOUT, 1600)).toEqual({ assistant: 352, left: 360, right: 279, editor: 1242 });
    expect(dockColumns(DEFAULT_LAYOUT, 1280).left).toBe(246);
    expect(dockColumns(DEFAULT_LAYOUT, 1100)).toEqual({ assistant: 300, left: 0, right: 248, editor: 794 });
  });

  it("scales the side panels to the editor, not the window", () => {
    // Proportions as in a window the editor's width: a 0.3 library of a
    // 1500 px editor is 450 px.
    const c = dockColumns({ left: 0.3, right: 0.2, top: 0.5 }, 1906, 406 / 1906);
    expect(c).toMatchObject({ assistant: 406, editor: 1494, left: 448, right: 299 });
  });

  it("holds the column between its limits and the editor's minimum", () => {
    expect(dockColumns(DEFAULT_LAYOUT, 1600, 0.01).assistant).toBe(DOCK.assistantMin);
    expect(dockColumns(DEFAULT_LAYOUT, 2560, 0.9).assistant).toBe(DOCK.assistantMax);
    // At the desktop minimum the editor keeps 760 px.
    expect(dockColumns(DEFAULT_LAYOUT, 1100, 0.9).assistant).toBe(1100 - DOCK.gap - DOCK.editor);
    expect(assistantMax(900)).toBe(DOCK.assistantMin);
  });

  it("docks only where the editor keeps its minimum, floating below", () => {
    expect(canDock(1100)).toBe(true);
    expect(canDock(DOCK.editor + DOCK.gap + DOCK.assistantMin)).toBe(true);
    expect(canDock(DOCK.editor + DOCK.gap + DOCK.assistantMin - 1)).toBe(false);
    expect(canDock(900)).toBe(false);
  });

  it("stops a dragged side panel where the player would drop under its width", () => {
    // 1100 px window, inspector 248 px: the library may take 1100 - 12 -
    // 6 - (248 + 6) - 456 = 372 px, not its 640 px cap.
    expect(sideMax(1100, 248 + DOCK.gap, 240, 640)).toBe(372);
    // A wide window leaves the cap in charge.
    expect(sideMax(2560, 600 + DOCK.gap, 260, 560)).toBe(560);
    // Never under the panel's own minimum, even in a narrow browser tab.
    expect(sideMax(900, 261 + DOCK.gap, 260, 560)).toBe(260);
    // Beside the assistant with the library aside, only the player shares.
    expect(sideMax(794, 0, 260, 560)).toBe(794 - DOCK.pad - DOCK.gap - DOCK.player);
  });

  it("saves a dragged width as a share the window allows", () => {
    expect(assistantShare(400, 1600)).toBe(0.25);
    expect(assistantShare(100, 1600)).toBe(DOCK.assistantMin / 1600);
    expect(assistantShare(900, 1100)).toBe(assistantMax(1100) / 1100);
  });
});
