import { useState } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Bookmark,
  ChevronDown,
  Crosshair,
  FlipHorizontal2,
  Link2,
  Magnet,
  MousePointer2,
  Redo2,
  RotateCw,
  ScanLine,
  Scissors,
  Snowflake,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "../icons";
import { chordText, type ActionId, ACTION_LABELS } from "../lib/keymap";
import * as ops from "../lib/project/ops";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "../lib/timeline";
import { isMac } from "../platform/env";
import { chordFor, run } from "../state/actions";
import { store, useEditor } from "../state/store";
import { MenuList } from "./Menu";

/** "Split (Ctrl+B)" — CapCut's tooltip format, chord read from the keymap. */
export function tipFor(id: ActionId, label = ACTION_LABELS[id]) {
  const c = chordFor(id);
  return c ? `${label} (${chordText(c, isMac)})` : label;
}

function Tool(props: { id: ActionId; icon: React.ReactNode; on?: boolean; disabled?: boolean; label?: string }) {
  return (
    <button
      className={`icon-btn${props.on ? " on" : ""}`}
      aria-label={props.label ?? ACTION_LABELS[props.id]}
      aria-pressed={props.on}
      data-tip={tipFor(props.id, props.label)}
      disabled={props.disabled}
      onClick={() => run(props.id)}
    >
      {props.icon}
    </button>
  );
}

// Zoom slider is logarithmic: equal travel = equal zoom ratio.
const toSlider = (z: number) => Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
const fromSlider = (v: number) => clampZoom(ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** v);

export function TimelineToolbar() {
  const tool = useEditor((s) => s.tool);
  const magnet = useEditor((s) => s.magnet);
  const snapping = useEditor((s) => s.snapping);
  const linkage = useEditor((s) => s.linkage);
  const axis = useEditor((s) => s.previewAxis);
  const zoom = useEditor((s) => s.zoom);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const undo = useEditor((s) => s.undoLabel);
  const redo = useEditor((s) => s.redoLabel);
  const videoSel = useEditor((s) => s.selection.some((id) => ops.findClip(s.project, id)?.clip.type === "video"));
  const visualSel = useEditor((s) => s.selection.some((id) => {
    const c = ops.findClip(s.project, id)?.clip;
    return !!c && "transform" in c;
  }));
  const [toolMenu, setToolMenu] = useState(false);

  const flip = () =>
    store.edit("Mirror", (p) => {
      for (const id of store.get().selection) {
        p = ops.updateClip(p, id, (c) => ("transform" in c ? ({ ...c, transform: { ...c.transform, flipX: !c.transform.flipX } } as typeof c) : c));
      }
      return p;
    });
  const rotate = () =>
    store.edit("Rotate", (p) => {
      for (const id of store.get().selection) {
        p = ops.updateClip(p, id, (c) => ("transform" in c ? ({ ...c, transform: { ...c.transform, rotation: (c.transform.rotation + 90) % 360 } } as typeof c) : c));
      }
      return p;
    });

  return (
    <div className="tl-toolbar">
      <div className="tl-tools">
        <div className="tool-picker">
          <button className="icon-btn on tool-btn" aria-label="Tool" data-tip={tool === "blade" ? tipFor("toolBlade") : tipFor("toolSelect")} onClick={() => setToolMenu((v) => !v)}>
            {tool === "blade" ? <Scissors /> : <MousePointer2 />}
            <ChevronDown size={11} />
          </button>
          {toolMenu && <MenuList items={[{ action: "toolSelect", checked: tool === "select" }, { action: "toolBlade", checked: tool === "blade" }, "-", { action: "selectLeft" }, { action: "selectRight" }]} onDone={() => setToolMenu(false)} />}
        </div>
        <span className="tl-sep" />
        <Tool id="undo" icon={<Undo2 />} disabled={!undo} label={undo ? `Undo ${undo}` : "Undo"} />
        <Tool id="redo" icon={<Redo2 />} disabled={!redo} label={redo ? `Redo ${redo}` : "Redo"} />
        <span className="tl-sep" />
        <Tool id="split" icon={<Scissors />} />
        <Tool id="trimStartToPlayhead" icon={<ArrowLeftToLine />} />
        <Tool id="trimEndToPlayhead" icon={<ArrowRightToLine />} />
        <Tool id="delete" icon={<Trash2 />} disabled={!hasSel} />
        <Tool id="addMarker" icon={<Bookmark />} />
        <span className="tl-sep" />
        <Tool id="freeze" icon={<Snowflake />} disabled={!videoSel} />
        <button className="icon-btn" aria-label="Mirror" data-tip="Mirror" disabled={!visualSel} onClick={flip}>
          <FlipHorizontal2 />
        </button>
        <button className="icon-btn" aria-label="Rotate 90°" data-tip="Rotate 90°" disabled={!visualSel} onClick={rotate}>
          <RotateCw />
        </button>
      </div>
      <div className="tl-tools right">
        <Tool id="toggleMagnet" icon={<Magnet />} on={magnet} label="Main track magnet" />
        <Tool id="toggleSnapping" icon={<Crosshair />} on={snapping} label="Auto snapping" />
        <Tool id="toggleLinkage" icon={<Link2 />} on={linkage} label="Linkage" />
        <Tool id="togglePreviewAxis" icon={<ScanLine />} on={axis} label="Preview axis" />
        <span className="tl-sep" />
        <button className="btn ghost fit-btn" data-tip={tipFor("zoomFit")} onClick={() => run("zoomFit")}>
          Fit
        </button>
        <Tool id="zoomOut" icon={<ZoomOut />} />
        <input
          className="zoom-slider"
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={toSlider(zoom)}
          aria-label="Timeline zoom"
          onChange={(e) => store.set({ zoom: fromSlider(Number(e.target.value)) })}
        />
        <Tool id="zoomIn" icon={<ZoomIn />} />
      </div>
    </div>
  );
}
