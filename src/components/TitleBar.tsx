import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { Download, Keyboard, Minus, Square, WandSparkles, X } from "../icons";
import { APP_NAME } from "../lib/brand";
import { chordText } from "../lib/keymap";
import { isDesktop, isMac } from "../platform/env";
import { chordFor, run } from "../state/actions";
import { toggleCopilot } from "../state/copilot";
import { saveOtio } from "../state/export";
import { closeProject } from "../state/project";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { MenuBar, type MenuItem } from "./Menu";

/** The frameless window's title bar: menus, the project name, export, and
 * (on Windows/Linux desktop) the window buttons. Empty areas drag the
 * window via Tauri's drag region attribute. */
export function TitleBar(props: { saveState: string; home: boolean; onShortcuts: () => void }) {
  const name = useEditor((s) => s.project.name);
  const [editing, setEditing] = useState(false);

  // Menus read the store when they open, so the title bar does not re-render
  // on every playhead tick.
  const s = () => store.get();
  const menus: { label: string; items: () => MenuItem[] }[] = [
    {
      label: "File",
      items: () => props.home ? [{ action: "newProject" }, { action: "openProject" }] : [
        ...(props.home ? [] : [{ label: "Back to home", onSelect: () => void closeProject() }, "-" as const]),
        { action: "newProject" },
        { action: "openProject" },
        { action: "saveProject" },
        "-",
        { action: "importMedia" },
        { action: "export" },
        ...(props.home
          ? []
          : [
              {
                label: "Export timeline (OTIO)",
                hint: "Resolve, Premiere",
                onSelect: () =>
                  void saveOtio().then(
                    (name) => name && toast(`Saved ${name}`),
                    (e) => toast(e instanceof Error ? e.message : String(e), "error"),
                  ),
              },
            ]),
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
        "-",
        { action: "addMarker" },
        { action: "markIn" },
        { action: "markOut" },
        { action: "clearInOut" },
        "-",
        { action: "toggleSnapping", checked: s().snapping },
        { action: "toggleMagnet", checked: s().magnet },
      ],
    },
    {
      label: "View",
      items: () => [
        { action: "zoomIn" },
        { action: "zoomOut" },
        { action: "zoomFit" },
        "-",
        { label: "Preview at full resolution", checked: s().previewScale === 1, onSelect: () => store.set({ previewScale: 1 }) },
        { label: "Preview at 1/2 resolution", checked: s().previewScale === 0.5, onSelect: () => store.set({ previewScale: 0.5 }) },
        { label: "Preview at 1/4 resolution", checked: s().previewScale === 0.25, onSelect: () => store.set({ previewScale: 0.25 }) },
        "-",
        { label: "Scopes", checked: s().scopes, onSelect: () => store.set({ scopes: !s().scopes }) },
        { action: "fullscreenPreview" },
      ],
    },
    { label: "Help", items: () => [{ action: "showShortcuts" }, { label: `About ${APP_NAME}`, onSelect: () => toast(`${APP_NAME} v${__APP_VERSION__}`), hint: `v${__APP_VERSION__}` }] },
  ];

  const win = isDesktop ? getCurrentWindow() : null;
  const exportChord = chordFor("export");

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <div className="app-mark" aria-hidden />
        <MenuBar menus={props.home ? menus.filter((m) => m.label === "File" || m.label === "Help") : menus} />
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {props.home ? (
          <span className="home-title" data-tauri-drag-region>
            {APP_NAME}
          </span>
        ) : editing ? (
          <input
            className="field project-name-input"
            autoFocus
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
          <button className="btn ghost copilot-btn" data-tip="Ask a model on this computer to make edits" onClick={() => toggleCopilot()}>
            <WandSparkles size={14} /> Copilot
          </button>
        )}
        <button className="icon-btn" aria-label="Keyboard shortcuts" data-tip="Keyboard shortcuts" onClick={props.onShortcuts}>
          <Keyboard />
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
          <div className="window-controls">
            <button aria-label="Minimize" onClick={() => win.minimize()}>
              <Minus size={16} />
            </button>
            <button aria-label="Maximize" onClick={() => win.toggleMaximize()}>
              <Square size={13} />
            </button>
            <button aria-label="Close" className="close" onClick={() => win.close()}>
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
