import { useEffect, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { CopilotPanel } from "./components/CopilotPanel";
import { Home } from "./components/Home";
import { InspectorPanel } from "./components/inspector/Inspector";
import { LibraryPanel } from "./components/LibraryPanel";
import { DragGhost, Toasts } from "./components/Overlays";
import { PlayerPanel } from "./components/Player";
import { ScopesPanel } from "./components/Scopes";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { Splitter } from "./components/Splitter";
import { Timeline } from "./components/Timeline";
import { TitleBar } from "./components/TitleBar";
import { Upload } from "./icons";
import { platform } from "./platform";
import { onHomeKeyDown, onKeyDown, provide } from "./state/actions";
import { addToTimeline, adoptAndImport, importFiles } from "./state/media";
import { useSession } from "./state/project";
import { useEditor } from "./state/store";
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
  // Scopes take the library's place, as Premiere's Color workspace puts
  // Lumetri Scopes where the Source monitor was.
  const scopes = useEditor((s) => s.scopes);
  const [shortcuts, setShortcuts] = useState(false);
  useEffect(() => provide({ showShortcuts: () => setShortcuts((v) => !v) }), []);

  // Home keeps only project entry points and Help. Editing and playback
  // must never act on the project still held in the store after closing.
  useEffect(() => {
    const handler = screen === "editor" ? onKeyDown : onHomeKeyDown;
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen]);

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
        if (files.length) void adoptAndImport(files);
      }}
    >
      <TitleBar saveState={saveState} home={screen === "home"} onShortcuts={() => setShortcuts(true)} />
      {screen === "home" ? (
        <Home />
      ) : (
      <div
        className="workspace"
        // The top row gives way the same way the side panels do: a fixed
        // 520 px pushed the timeline 26 px below a 720 px tall window,
        // cutting off its scrollbar and last track.
        style={{ gridTemplateRows: `minmax(${Math.min(260, layout.top)}px, ${layout.top}px) var(--gap) minmax(180px, 1fr)` }}
      >
        <div
          className="top-row"
          // The side panels keep their saved widths but give way when the
          // window is narrow (down to the splitters' own minimums), so the
          // row never overflows: fixed widths cut off the inspector and the
          // Export button at the desktop app's minimum window size.
          style={{ gridTemplateColumns: `minmax(${Math.min(240, layout.left)}px, ${layout.left}px) var(--gap) minmax(320px, 1fr) var(--gap) minmax(${Math.min(260, layout.right)}px, ${layout.right}px)` }}
        >
          {scopes ? <ScopesPanel /> : <LibraryPanel />}
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
