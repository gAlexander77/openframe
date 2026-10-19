// The inspector's graphics rows: a shape layer's shape (ADR-057), and any
// picture's track matte, motion blur and edges (ADR-056, ADR-058,
// ADR-059). Every edit runs the command an agent would, so the two agree.

import { runCommand } from "../../lib/commands";
import { findClip } from "../../lib/project/ops";
import type { ColorClip, EdgeMode, MatteMode, VisualClip } from "../../lib/project/types";
import { store, useEditor } from "../../state/store";
import { toast } from "../../state/toast";
import { ColorInput, Row, Section, Segmented, SliderRow, Toggle } from "./controls";

const pct = { show: (v: number) => v * 100, store: (v: number) => v / 100 };

/** One undoable edit through a command; its refusal becomes a toast. */
function run(label: string, name: string, args: Record<string, unknown>) {
  try {
    store.edit(label, (p) => runCommand(p, name, args));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function ShapeSection({ clip }: { clip: ColorClip }) {
  // Pixels of this canvas per 1080p pixel, the stroke's stored unit.
  const px = useEditor((st) => st.project.height) / 1080;
  const s = clip.shape;
  if (!s) return null;
  const ids = [clip.id];
  const line = s.kind === "line";
  return (
    <Section title="Shape">
      <Row label="Shape">
        <Segmented
          value={s.kind}
          onChange={(kind) => run("Shape", "set_shape", { clip_ids: ids, kind })}
          options={[
            { value: "rectangle", label: "Box", tip: "Rectangle" },
            { value: "ellipse", label: "Ellipse", tip: "Ellipse" },
            { value: "line", label: "Line", tip: "Line" },
          ]}
        />
      </Row>
      <SliderRow clip={clip} path="shape.width" label={line ? "Length" : "Width"} min={1} max={200} unit="%" reset={0.3} {...pct} />
      {!line && <SliderRow clip={clip} path="shape.height" label="Height" min={1} max={200} unit="%" reset={0.1} {...pct} />}
      {s.kind === "rectangle" && <SliderRow clip={clip} path="shape.radius" label="Corners" min={0} max={100} unit="%" reset={0} {...pct} />}
      {!line && (
        <Row label="Fill">
          <Toggle on={s.fill !== false} label="Fill" onChange={(fill) => (fill || s.stroke ? run(fill ? "Fill shape" : "Outline only", "set_shape", { clip_ids: ids, fill }) : toast("Give the shape an outline before turning its fill off", "error"))} />
        </Row>
      )}
      <Row label="Gradient">
        <Toggle on={!!s.gradient} label="Gradient" onChange={(on) => run(on ? "Gradient" : "Remove gradient", "set_shape", { clip_ids: ids, gradient: on ? { from: clip.color, to: "#000000", angle: 0 } : { from: "" } })} />
      </Row>
      {s.gradient && (
        <>
          <Row label="From">
            <ColorInput label="Gradient start color" value={s.gradient.from} onChange={(from) => run("Gradient color", "set_shape", { clip_ids: ids, gradient: { from } })} />
          </Row>
          <Row label="To">
            <ColorInput label="Gradient end color" value={s.gradient.to} onChange={(to) => run("Gradient color", "set_shape", { clip_ids: ids, gradient: { from: s.gradient!.from, to } })} />
          </Row>
          <SliderRow clip={clip} path="shape.gradient.angle" label="Angle" min={-180} max={180} unit="°" reset={0} />
        </>
      )}
      <Row label={line ? "Line color" : "Outline"}>
        <ColorInput label={line ? "Line color" : "Outline color"} value={s.stroke?.color ?? "#ffffff"} onChange={(c) => run("Outline color", "set_shape", { clip_ids: ids, stroke_color: c })} />
      </Row>
      {s.stroke && <SliderRow clip={clip} path="shape.stroke.width" label="Thickness" min={0} max={120} unit="px" reset={line ? 8 : 0} show={(v) => v * px} store={(v) => v / px} />}
      {(line || s.stroke) && <SliderRow clip={clip} path="shape.draw" label="Draw" min={0} max={100} unit="%" reset={1} {...pct} />}
    </Section>
  );
}

const MATTES: [MatteMode, string][] = [
  ["alpha", "Alpha"],
  ["alphaInverted", "Alpha inverted"],
  ["luma", "Luma"],
  ["lumaInverted", "Luma inverted"],
];

export function CompositingSection({ clip }: { clip: VisualClip }) {
  const m = clip.trackMatte;
  const ids = [clip.id];
  const named = useEditor((st) => (m?.clipId ? findClip(st.project, m.clipId)?.clip : undefined));
  const label = named ? ("text" in named ? named.text.split("\n")[0] : (named.name ?? named.type)) : "";
  return (
    <Section title="Compositing" defaultOpen={!!(m || clip.motionBlur || clip.edge)}>
      <Row label="Track matte">
        <select
          className="field"
          aria-label="Track matte"
          value={!m ? "none" : m.clipId ? "clip" : "above"}
          onChange={(e) => run(e.target.value === "none" ? "Remove track matte" : "Track matte", "set_track_matte", { clip_id: clip.id, matte_clip_id: e.target.value })}
        >
          <option value="none">None</option>
          <option value="above">Track above</option>
          {m?.clipId && <option value="clip">{`Clip: ${label}`}</option>}
        </select>
      </Row>
      {m && (
        <Row label="Matte">
          <select className="field" aria-label="Matte mode" value={m.mode} onChange={(e) => run("Matte mode", "set_track_matte", { clip_id: clip.id, mode: e.target.value })}>
            {MATTES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Row>
      )}
      <Row label="Motion blur">
        <Toggle on={!!clip.motionBlur} label="Motion blur" onChange={(on) => run(on ? "Motion blur" : "No motion blur", "set_motion_blur", { clip_ids: ids, on })} />
      </Row>
      {clip.motionBlur && <SliderRow clip={clip} path="motionBlur.shutter" label="Shutter" min={1} max={720} unit="°" reset={180} keyframes={false} />}
      <Row label="Edges">
        {/* A select, not a segmented row: three words overflow the panel at
            the window's minimum width. */}
        <select className="field" aria-label="Edges" data-tip="What fills the canvas past the picture's edges" value={clip.edge ?? "none"} onChange={(e) => run("Edges", "set_edge_mode", { clip_ids: ids, edge: e.target.value as EdgeMode | "none" })}>
          <option value="none">None</option>
          <option value="mirror">Mirror</option>
          <option value="repeat">Repeat</option>
        </select>
      </Row>
    </Section>
  );
}
