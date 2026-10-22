import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { PanelsTopLeft, Download, Keyboard, Minus, Settings, Square, Bot, X } from "../icons";
import { APP_NAME } from "../lib/brand";
import { chordText } from "../lib/keymap";
import { isDesktop, isMac } from "../platform/env";
import { chordFor, run, tipFor } from "../state/actions";
import { toggleAssistant, useAssistantValue } from "../state/assistant";
import { saveTimeline, type TimelineFormat } from "../state/interchange";
import { closeProject, collectProject, importTimeline, openProjectFile } from "../state/project";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { openMarkers } from "../state/markers";
import { openCheck } from "../state/check";
import { LAYOUT_PRESETS, type LayoutPreset } from "../lib/layout";
import { applyLayoutPreset, currentLayout } from "../state/layout";
import { MenuBar, type MenuItem } from "./Menu";
import { VIEWER_GUIDES } from "./ViewerGuides";
import { SaveCopyDialog } from "./SaveCopyDialog";
import { AboutDialog } from "./AboutDialog";
import { Dialog } from "./Dialog";

/** The frameless window's title bar: menus, the project name, export, and
 * (on Windows/Linux desktop) the window buttons. Tauri's deep drag region
 * covers all noninteractive descendants and handles double-click maximize;
 * buttons and inputs keep their normal behavior. */
export function TitleBar(props: { saveState: string; home: boolean; onShortcuts: () => void }) {
  const name = useEditor((s) => s.project.name);
  const [editing, setEditing] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [copyDialog, setCopyDialog] = useState(false);
  const [about, setAbout] = useState(false);
  const [timelineReport, setTimelineReport] = useState<{ title: string; lines: string[] } | null>(null);
  const assistantOpen = useAssistantValue((s) => s.open);

  // Read the window, not just our button: caption double-click and the OS
  // can change maximization too. Clean up even if registration finishes late.
  useEffect(() => {
    if (!isDesktop || isMac) return;
    const win = getCurrentWindow();
    let live = true;
    const sync = () => void win.isMaximized().then(
      (value) => { if (live) setMaximized(value); },
      (error) => console.warn("Couldn't read the window state", error),
    );
    const unlisten = win.onResized(sync);
    void unlisten.then(sync, (error) => console.warn("Couldn't watch the window state", error));
    return () => {
      live = false;
      void unlisten.then((stop) => stop(), () => {});
    };
  }, []);

  // Menus read the store when they open, so the title bar does not re-render
  // on every playhead tick.
  const s = () => store.get();
  const files = (task: Promise<unknown>) => void task.catch(e => toast(String(e), "error"));
  const openFile = { label: "Open project file…", onSelect: () => files(openProjectFile()) };
  const importFile = { label: "Import timeline…", onSelect: () => files(importTimeline().then(r => {
    if (r) setTimelineReport({ title: "Timeline imported", lines: [`${r.project.name}: ${r.project.tracks.length} tracks, ${r.project.assets.length} media files.`, ...r.warnings] });
  })) };
  const exportTimeline = (format: TimelineFormat) => files(saveTimeline(format).then(r => {
    if (r) setTimelineReport({ title: "Timeline exported", lines: [...r.files.map(f => `Saved ${f}`), ...r.warnings] });
  }));
  const menus: { label: string; items: () => MenuItem[] }[] = [
    {
      label: "File",
      items: () => props.home ? [{ action: "newProject" }, { action: "openProject" }, openFile, importFile] : [
        { label: "Back to home", onSelect: () => void closeProject() },
        "-",
        { action: "newProject" },
        { action: "openProject" },
        openFile,
        importFile,
        { label: "Collect files…", onSelect: () => files(collectProject()) },
        { action: "saveProject" },
        { label: "Save a copy…", onSelect: () => setCopyDialog(true) },
        "-",
        { action: "importMedia" },
        { label: "Check project…", onSelect: () => openCheck(true) },
        { action: "export" },
        { action: "saveFrame" },
        {
          label: "Export timeline",
          submenu: [
            { label: "OpenTimelineIO", onSelect: () => exportTimeline("otio") },
            { label: "FCPXML", onSelect: () => exportTimeline("fcpxml") },
            { label: "EDL", onSelect: () => exportTimeline("edl") },
          ],
        },
      ],
    },
    {
      label: "Edit",
      items: () => [
        { action: "undo", label: s().undoLabel ? `Undo ${s().undoLabel}` : "Undo", disabled: !s().undoLabel },
        { action: "redo", label: s().redoLabel ? `Redo ${s().redoLabel}` : "Redo", disabled: !s().redoLabel },
        "-",
        { action: "cut" },
        { action: "copy" },
        { action: "paste" },
        { action: "duplicate" },
        { action: "delete" },
        { action: "rippleDelete" },
        "-",
        { action: "selectAll" },
        { action: "deselect" },
        "-",
        { action: "groupClips", disabled: s().selection.length < 2 },
        { action: "ungroupClips" },
        "-",
        { action: "showPreferences" },
      ],
    },
    {
      label: "Timeline",
      items: () => [
        { action: "split" },
        { action: "trimStartToPlayhead" },
        { action: "trimEndToPlayhead" },
        { action: "freeze" },
        { action: "detachAudio" },
        { action: "applyDefaultVideoTransition" },
        { action: "applyDefaultAudioCrossfade" },
        { action: "muteTrack" },
        { action: "soloTrack" },
        { action: "createCompound" },
        { action: "breakCompound" },
        "-",
        { action: "addMarker" },
        { label: "Manage markers", onSelect: () => openMarkers() },
        { action: "markIn" },
        { action: "markOut" },
        { action: "clearInOut" },
        { action: "playInToOut" },
        { action: "liftRange" },
        { action: "extractRange" },
        { action: "toggleLoop", checked: s().loop },
        "-",
        { action: "toggleSnapping", checked: s().snapping },
        { action: "toggleMagnet", checked: s().magnet },
        { action: "toggleLinkage", checked: s().linkage },
        { action: "togglePreviewAxis", checked: s().previewAxis },
      ],
    },
    {
      label: "View",
      items: () => [
        { action: "zoomIn" },
        { action: "zoomOut" },
        { action: "zoomFit" },
        { action: "toggleKeyframePanel", checked: s().keyframePanel },
        "-",
        { label: "Preview at full resolution", checked: s().previewScale === 1, onSelect: () => store.set({ previewScale: 1 }) },
        { label: "Preview at 1/2 resolution", checked: s().previewScale === 0.5, onSelect: () => store.set({ previewScale: 0.5 }) },
        { label: "Preview at 1/4 resolution", checked: s().previewScale === 0.25, onSelect: () => store.set({ previewScale: 0.25 }) },
        "-",
        ...VIEWER_GUIDES.map(([value, label]) => ({ label, checked: s().viewerGuides === value, onSelect: () => store.set({ viewerGuides: value }) })),
        "-",
        { label: "Mixer", checked: s().mixer, onSelect: () => store.set({ mixer: !s().mixer }) },
        { label: "Scopes", checked: s().scopes, onSelect: () => store.set({ scopes: !s().scopes }) },
        { label: "Markers", checked: s().leftTab === "markers" && !s().scopes, onSelect: () => openMarkers() },
        { action: "fullscreenPreview" },
        "-",
        ...(Object.entries(LAYOUT_PRESETS) as [LayoutPreset, (typeof LAYOUT_PRESETS)[LayoutPreset]][]).map(([id, p]) => ({
          label: `${p.label} layout`,
          checked: JSON.stringify(currentLayout()) === JSON.stringify(p.layout),
          onSelect: () => applyLayoutPreset(id),
        })),
        { label: "Reset layout", onSelect: () => applyLayoutPreset("default") },
      ],
    },
    { label: "Help", items: () => [{ action: "showShortcuts" }, { label: `About ${APP_NAME}`, onSelect: () => setAbout(true), hint: `v${__APP_VERSION__}` }] },
  ];

  const win = isDesktop ? getCurrentWindow() : null;
  const exportChord = chordFor("export");

  return (
    <><header className="titlebar" data-tauri-drag-region="deep">
      <div className="titlebar-left">
        <div className="app-mark" aria-hidden />
        <MenuBar menus={props.home ? menus.filter((m) => m.label === "File" || m.label === "Help") : menus} />
      </div>
      <div className="titlebar-center">
        {props.home ? (
          <span className="home-title">
            {APP_NAME}
          </span>
        ) : editing ? (
          <input
            className="field project-name-input"
            aria-label="Project name"
            maxLength={120}
            autoFocus
            onFocus={(e) => {
              // All selected, the start in view: a long name showed only its end.
              const input = e.currentTarget;
              input.setSelectionRange(0, input.value.length, "backward");
              input.scrollLeft = 0;
            }}
            defaultValue={name}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              if (v && v !== name) store.edit("Rename project", (p) => ({ ...p, name: v }));
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <button className="project-name" onClick={() => setEditing(true)} data-tip="Rename project">
            {name}
          </button>
        )}
        {!props.home && <span className="save-state">{props.saveState}</span>}
      </div>
      <div className="titlebar-right">
        {!props.home && (
          <button
            className="btn ghost assistant-btn"
            aria-pressed={assistantOpen}
            data-tip={assistantOpen ? "Close the AI assistant" : "Ask a model on this computer to make edits"}
            onClick={() => toggleAssistant()}
          >
            <Bot size={14} /> AI assistant
          </button>
        )}
        <button className="icon-btn" aria-label="Keyboard shortcuts" data-tip={tipFor("showShortcuts")} onClick={props.onShortcuts}>
          <Keyboard />
        </button>
        <button className="icon-btn" aria-label="Preferences" data-tip={tipFor("showPreferences")} onClick={() => run("showPreferences")}>
          <Settings />
        </button>
        {!props.home && (
          <button
            className="btn primary export-btn"
            onClick={() => run("export")}
            data-tip={exportChord ? `Export (${chordText(exportChord, isMac)})` : "Export"}
          >
            <Download size={15} /> Export
          </button>
        )}
        {win && !isMac && (
          // Window chrome must not take typing focus or commit an unfinished
          // rename. Keyboard focus still reaches these buttons normally.
          <div className="window-controls" onMouseDown={(e) => { if (e.button === 0) e.preventDefault(); }}>
            <button aria-label="Minimize" data-tip="Minimize" onClick={() => win.minimize()}>
              <Minus size={16} />
            </button>
            <button aria-label={maximized ? "Restore" : "Maximize"} data-tip={maximized ? "Restore" : "Maximize"} onClick={() => win.toggleMaximize()}>
              {maximized ? <PanelsTopLeft size={13} /> : <Square size={13} />}
            </button>
            <button aria-label="Close" data-tip="Close" className="close" onClick={() => win.close()}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
    {copyDialog && !props.home && <SaveCopyDialog onClose={() => setCopyDialog(false)} />}
    {about && <AboutDialog onClose={() => setAbout(false)} />}
    {timelineReport && <Dialog title={timelineReport.title} onClose={() => setTimelineReport(null)}>
      <ul className="timeline-report">{timelineReport.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
      <footer><button className="btn primary" onClick={() => setTimelineReport(null)}>Close</button></footer>
    </Dialog>}</>
  );
}
