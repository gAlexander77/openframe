import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { CopilotPanel } from "./components/CopilotPanel";
import { Home } from "./components/Home";
import { InspectorPanel } from "./components/inspector/Inspector";
import { LibraryPanel } from "./components/LibraryPanel";
import { DragGhost, Toasts } from "./components/Overlays";
import { PlayerPanel } from "./components/Player";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { TitleBar } from "./components/TitleBar";
import { Upload } from "./icons";
import { platform } from "./platform";
import { onKeyDown, provide } from "./state/actions";
import { addToTimeline, importFiles } from "./state/media";
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

  const { screen, saveState } = useSession();
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => provide({ showShortcuts: () => setShortcuts((v) => !v) }), []);
  // ponytail: key handling is global; editor actions are harmless on the
  // home screen (no project), so no per-screen keymap yet.

  // Files dropped anywhere but the timeline import into the library
  // (the timeline's own drop also places them). Web build only: on the
  // desktop, Tauri delivers OS drops as paths instead.
  const [dropping, setDropping] = useState(false);
  const isFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files");

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (!isFiles(e) || screen !== "editor") return;
        // Over the timeline its own drop preview takes over.
        const overTimeline = !!(e.target as Element).closest?.(".tl-scroll");
        if (overTimeline !== !dropping) setDropping(!overTimeline);
        if (!overTimeline) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        if (files.length) void platform.adoptFiles(files).then(importFiles);
      }}
    >
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
      {dropping && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-card">
            <Upload size={28} />
            <strong>Drop to import</strong>
            <span>Videos, audio and photos go to your media library</span>
          </div>
        </div>
      )}
      {screen === "editor" && <CopilotPanel />}
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
      <DragGhost />
      <ExportDialog />
      <Toasts />
    </div>
  );
}
