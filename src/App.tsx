import { useEffect, useState } from "react";
import { LibraryPanel } from "./components/LibraryPanel";
import { DragGhost, Toasts } from "./components/Overlays";
import { PlayerPanel } from "./components/Player";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { TitleBar } from "./components/TitleBar";
import { platform } from "./platform";
import { onKeyDown } from "./state/actions";
import { addToTimeline, importFiles } from "./state/media";
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

  // Desktop OS drops arrive as paths, not HTML5 events: import them and add
  // each at the playhead, like the media panel's +.
  useEffect(
    () =>
      platform.onFileDrop?.(async (files) => {
        for (const a of await importFiles(files)) addToTimeline(a);
      }),
    [],
  );

  const resize = (k: keyof Layout, d: number, lo: number, hi: number) =>
    setLayout((l) => ({ ...l, [k]: clamp(l[k] + d, lo, hi) }));

  return (
    <div className="app">
      <TitleBar saveState="" onShortcuts={() => {}} />
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
          <section className="panel inspector-panel" aria-label="Inspector" />
        </div>
        <Splitter dir="y" onDrag={(d) => resize("top", d, 260, window.innerHeight - 260)} onReset={() => setLayout((l) => ({ ...l, top: DEFAULT_LAYOUT.top }))} />
        <Timeline />
      </div>
      <DragGhost />
      <Toasts />
    </div>
  );
}
