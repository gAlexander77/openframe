import { useEffect, useState } from "react";
import { Home } from "./components/Home";
import { InspectorPanel } from "./components/inspector/Inspector";
import { LibraryPanel } from "./components/LibraryPanel";
import { DragGhost, Toasts } from "./components/Overlays";
import { PlayerPanel } from "./components/Player";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { TitleBar } from "./components/TitleBar";
import { onKeyDown, provide } from "./state/actions";
import { useSession } from "./state/project";
import "./components/shell.css";

interface Layout {
  left: number;
  right: number;
  /** Height of the top row (library, player, inspector). */
  top: number;
}

// CapCut's proportions (research §1.2): library ~36%, player ~40%, inspector
// ~24% of the width; the top row ~58% of the height.
const DEFAULT_LAYOUT: Layout = { left: 470, right: 360, top: 520 };

function loadLayout(): Layout {
  try {
    return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem("layout") ?? "{}") };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function App() {
  const [layout, setLayout] = useState(loadLayout);

  useEffect(() => {
    try {
      localStorage.setItem("layout", JSON.stringify(layout));
    } catch {
      /* private window: layout just won't persist */
    }
  }, [layout]);

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resize = (k: keyof Layout, d: number, lo: number, hi: number) =>
    setLayout((l) => ({ ...l, [k]: clamp(l[k] + d, lo, hi) }));

  const { screen, saveState } = useSession();
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => provide({ showShortcuts: () => setShortcuts((v) => !v) }), []);
  // ponytail: key handling is global; editor actions are harmless on the
  // home screen (no project), so no per-screen keymap yet.

  return (
    <div className="app">
      <TitleBar saveState={saveState} home={screen === "home"} onShortcuts={() => setShortcuts(true)} />
      {screen === "home" ? (
        <Home />
      ) : (
      <div
        className="workspace"
        style={{ gridTemplateRows: `${layout.top}px var(--gap) minmax(180px, 1fr)` }}
      >
        <div
          className="top-row"
          style={{ gridTemplateColumns: `${layout.left}px var(--gap) minmax(320px, 1fr) var(--gap) ${layout.right}px` }}
        >
          <LibraryPanel />
          <Splitter dir="x" onDrag={(d) => resize("left", d, 240, 640)} onReset={() => setLayout((l) => ({ ...l, left: DEFAULT_LAYOUT.left }))} />
          <PlayerPanel />
          <Splitter dir="x" onDrag={(d) => resize("right", -d, 260, 560)} onReset={() => setLayout((l) => ({ ...l, right: DEFAULT_LAYOUT.right }))} />
          <InspectorPanel />
        </div>
        <Splitter dir="y" onDrag={(d) => resize("top", d, 260, window.innerHeight - 260)} onReset={() => setLayout((l) => ({ ...l, top: DEFAULT_LAYOUT.top }))} />
        <Timeline />
      </div>
      )}
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <DragGhost />
      <Toasts />
    </div>
  );
}
