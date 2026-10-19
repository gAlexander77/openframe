import { useRef, useState } from "react";
import { Upload, Loader2, Palette, Trash2 } from "../../icons";
import type { Clip } from "../../lib/project/types";
import { platform } from "../../platform";
import { importLuts } from "../../state/luts";
import { projectWork } from "../../state/projectWork";
import { useEditor } from "../../state/store";
import { Row, Section, SliderRow } from "./controls";
import { setGradePart } from "./gradeEdit";
import "./color.css";

const pct = { show: (v: number) => v * 100, store: (v: number) => v / 100 };
const display = (name: string) => name.replace(/\.cube$/i, "");

/** CapCut's LUT section: import a .cube, pick one of the project's LUTs,
 * set its intensity. The file stays where it is; the project keeps a
 * reference (ADR-021). */
export function LutPanel({ clip }: { clip: Clip }) {
  const luts = useEditor((s) => s.project.luts);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!("adjust" in clip)) return null;
  const current = clip.adjust.lut;
  const file = luts?.find((l) => l.id === current?.id);

  const pick = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const signal = projectWork.signal();
    try {
      await importLuts(await platform.adoptFiles(files), clip.id, signal);
    } finally {
      setBusy(false);
    }
  };
  const choose = (id: string) =>
    setGradePart(clip.id, id ? "Apply LUT" : "Remove LUT", "lut", id ? { id, intensity: current?.intensity ?? 1 } : undefined, id ? undefined : "adjust.lut.");

  return (
    <>
      <Section
        title="LUT"
        extra={
          current ? (
            <button className="icon-btn small" aria-label="Remove LUT" data-tip="Remove LUT" onClick={() => choose("")}>
              <Trash2 size={12} />
            </button>
          ) : undefined
        }
      >
        <button className="lut-import" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />}
          <span>
            <strong>Import .cube</strong>
            <small>1D or 3D LUT from Resolve, Premiere or a camera maker</small>
          </span>
        </button>
        <input
          ref={input}
          type="file"
          accept=".cube"
          hidden
          onChange={(e) => {
            void pick([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <Row label="LUT">
          <select className="field" value={current?.id ?? ""} onChange={(e) => choose(e.target.value)} aria-label="LUT">
            <option value="">None</option>
            {luts?.map((l) => (
              <option key={l.id} value={l.id}>
                {display(l.name)}
              </option>
            ))}
          </select>
        </Row>
        {current && <SliderRow clip={clip} path="adjust.lut.intensity" label="Intensity" min={0} max={100} unit="%" reset={1} {...pct} />}
        {file && (
          <div className="lut-info">
            <Palette size={13} />
            <span>
              {display(file.name)} · {file.kind === "3d" ? `3D, ${file.size}³` : `1D, ${file.size} steps`}
            </span>
          </div>
        )}
        {current && !file && <p className="insp-hint warn">This clip's LUT is missing from the project.</p>}
        <p className="insp-hint">
          A LUT expects a particular input. Conversion LUTs (log to Rec.709) go on the camera's log footage; creative looks go on footage that already looks normal.
        </p>
      </Section>
    </>
  );
}
