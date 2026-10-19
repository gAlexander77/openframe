import { useRef, useState } from "react";
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Bookmark,
  ChartSpline,
  ChevronDown,
  Crop,
  SeparatorVertical,
  FoldHorizontal,
  ArrowLeftRight,
  ChevronsLeftRight,
  MoveHorizontal,
  Maximize2,
  FlipHorizontal2,
  Link2,
  Magnet,
  MousePointer2,
  Redo2,
  RotateCw,
  ScanLine,
  Scissors,
  Snowflake,
  StretchHorizontal,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "../icons";
import { type ActionId, ACTION_LABELS } from "../lib/keymap";
import * as ops from "../lib/project/ops";
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from "../lib/timeline";
import { run, tipFor } from "../state/actions";
import { canCrop } from "../lib/crop";
import { beginCrop } from "../state/cropEdit";
import { store, useEditor } from "../state/store";
import { MenuList, useDismiss } from "./Menu";
import { VoiceoverButton } from "./VoiceoverButton";

/** "Split (Ctrl+B)" — CapCut's tooltip format, chord read from the keymap. */

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

const TOOL_ACTION: Record<string, ActionId> = { select: "toolSelect", blade: "toolBlade", stretch: "toolStretch", ripple: "toolRipple", roll: "toolRoll", slip: "toolSlip", slide: "toolSlide" };
const TOOL_ICON = { select: MousePointer2, blade: Scissors, stretch: StretchHorizontal, ripple: FoldHorizontal, roll: ArrowLeftRight, slip: ChevronsLeftRight, slide: MoveHorizontal };

// Zoom slider is logarithmic: equal travel = equal zoom ratio.
const toSlider = (z: number) => Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
const fromSlider = (v: number) => clampZoom(ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** v);

export function TimelineToolbar() {
  const tool = useEditor((s) => s.tool);
  const ToolIcon = TOOL_ICON[tool];
  const magnet = useEditor((s) => s.magnet);
  const snapping = useEditor((s) => s.snapping);
  const linkage = useEditor((s) => s.linkage);
  const axis = useEditor((s) => s.previewAxis);
  const keyframes = useEditor((s) => s.keyframePanel);
  const zoom = useEditor((s) => s.zoom);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const undo = useEditor((s) => s.undoLabel);
  const redo = useEditor((s) => s.redoLabel);
  const videoSel = useEditor((s) => s.selection.some((id) => ops.findClip(s.project, id)?.clip.type === "video"));
  const visualSel = useEditor((s) => s.selection.some((id) => {
    const c = ops.findClip(s.project, id)?.clip;
    return !!c && "transform" in c;
  }));
  // CapCut's toolbar Crop: one picture at a time.
  const croppable = useEditor((s) => s.selection.length === 1 && canCrop(s.project, s.selection[0]));
  const [toolMenu, setToolMenu] = useState(false);
  const picker = useRef<HTMLDivElement>(null);
  useDismiss(toolMenu, picker, () => setToolMenu(false));
  // Right-click Undo or Redo: the steps to go back or forward to (VEGAS's
  // undo list, Premiere's History panel).
  const [history, setHistory] = useState<{ kind: "undo" | "redo"; x: number; y: number } | null>(null);
  const historyAt = useRef<HTMLDivElement>(null);
  useDismiss(!!history, historyAt, () => setHistory(null));
  const steps = history ? store.history()[history.kind].slice(0, 20) : [];

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
        <div className="tool-picker" ref={picker}>
          <button className="icon-btn on tool-btn" aria-label="Tool" data-tip={tipFor(TOOL_ACTION[tool])} onClick={() => setToolMenu((v) => !v)}>
            <ToolIcon />
            <ChevronDown size={11} />
          </button>
          {toolMenu && (
            <MenuList
              items={[
                { action: "toolSelect", checked: tool === "select" },
                { action: "toolBlade", checked: tool === "blade" },
                "-",
                { action: "toolRipple", checked: tool === "ripple" },
                { action: "toolRoll", checked: tool === "roll" },
                { action: "toolSlip", checked: tool === "slip" },
                { action: "toolSlide", checked: tool === "slide" },
                { action: "toolStretch", checked: tool === "stretch" },
                "-",
                { action: "selectLeft" },
                { action: "selectRight" },
              ]}
              onDone={() => setToolMenu(false)}
              anchor={picker.current}
            />
          )}
        </div>
        <span className="tl-sep" />
        <div
          className="history-anchor"
          ref={historyAt}
          onContextMenu={(e) => {
            e.preventDefault();
            const kind = (e.target as HTMLElement).closest("[data-history]")?.getAttribute("data-history") as "undo" | "redo" | null;
            if (kind && store.history()[kind].length) setHistory({ kind, x: e.clientX, y: e.clientY });
          }}
        >
          <span data-history="undo">
            <Tool id="undo" icon={<Undo2 />} disabled={!undo} label={undo ? `Undo ${undo}` : "Undo"} />
          </span>
          <span data-history="redo">
            <Tool id="redo" icon={<Redo2 />} disabled={!redo} label={redo ? `Redo ${redo}` : "Redo"} />
          </span>
          {history && (
            <MenuList
              autoFocus
              items={steps.map((label, i) => ({
                label: `${history.kind === "undo" ? "Undo" : "Redo"} ${label}`,
                hint: i ? `${i + 1} steps` : undefined,
                onSelect: () => {
                  for (let k = 0; k <= i; k++) store[history.kind]();
                },
              }))}
              onDone={() => setHistory(null)}
              style={{ position: "fixed", left: history.x, top: history.y }}
            />
          )}
        </div>
        <span className="tl-sep" />
        <Tool id="split" icon={<Scissors />} />
        <Tool id="trimStartToPlayhead" icon={<ArrowLeftToLine />} />
        <Tool id="trimEndToPlayhead" icon={<ArrowRightToLine />} />
        <Tool id="delete" icon={<Trash2 />} disabled={!hasSel} />
        <Tool id="addMarker" icon={<Bookmark />} />
        <button className="icon-btn" aria-label="Crop" data-tip="Crop" disabled={!croppable} onClick={() => beginCrop(store.get().selection[0])}>
          <Crop />
        </button>
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
        <VoiceoverButton />
        <span className="tl-sep" />
        <Tool id="toggleMagnet" icon={<Magnet />} on={magnet} label="Main track magnet" />
        <Tool id="toggleSnapping" icon={<SeparatorVertical />} on={snapping} label="Auto snapping" />
        <Tool id="toggleLinkage" icon={<Link2 />} on={linkage} label="Linkage" />
        <Tool id="togglePreviewAxis" icon={<ScanLine />} on={axis} label="Preview axis" />
        <Tool id="toggleKeyframePanel" icon={<ChartSpline />} on={keyframes} />
        <span className="tl-sep" />
        <button className="icon-btn fit-btn" aria-label="Fit timeline" data-tip={tipFor("zoomFit")} onClick={() => run("zoomFit")}>
          <Maximize2 />
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
