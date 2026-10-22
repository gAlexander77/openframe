import { useRef } from "react";
import { layerBox, sourceSize } from "../lib/align";
import { CROP_RATIOS, dragCrop, mirrorCrop, NO_CROP, ratioAspect, ratioLabel, type CropHandle } from "../lib/crop";
import type { Crop, Project, VisualClip } from "../lib/project/types";
import type { Layer } from "../lib/render/plan";
import { applyCrop, cancelCrop, pickCropRatio, resetCrop, setCropDraft } from "../state/cropEdit";
import type { CropSession } from "../state/store";

const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * CapCut's crop on the viewer (ADR-048): the whole picture, which the
 * viewer draws uncropped meanwhile, dimmed outside the crop, with eight
 * handles and the crop itself to drag. The handles work on the picture as
 * it shows, rotated and mirrored; the session keeps the source's edges.
 */
export function CropOverlay(props: { project: Project; clip: VisualClip; layer: Layer; session: CropSession; k: number }) {
  const { project, clip, layer, session, k } = props;
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: Crop } | null>(null);
  // The uncropped picture's box: where the handles can go.
  const full = layerBox(project, clip, { ...layer, crop: NO_CROP });
  const fw = full.w * k, fh = full.h * k;
  const shown = mirrorCrop(session.crop, layer.flipX, layer.flipY);
  const src = sourceSize(project, clip);
  const aspect = ratioAspect(session.ratio, src.w, src.h);
  const rad = (layer.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);

  const down = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.stopPropagation(); // not the viewer's click-to-select
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: shown };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // The pointer's travel along the picture's own axes, in its fractions.
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const du = (cos * dx + sin * dy) / fw, dv = (-sin * dx + cos * dy) / fh;
    setCropDraft(mirrorCrop(dragCrop(d.start, d.handle, du, dv, src, aspect), layer.flipX, layer.flipY));
  };
  const up = () => {
    drag.current = null;
  };
  const rect = {
    left: shown.left * fw,
    top: shown.top * fh,
    width: (1 - shown.left - shown.right) * fw,
    height: (1 - shown.top - shown.bottom) * fh,
  };

  return (
    <div className="tf-layer" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="crop-frame" style={{ left: full.cx * k, top: full.cy * k, width: fw, height: fh, transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}>
        {/* Presses on the dimmed picture stay in the crop mode. */}
        <div className="crop-dim" onPointerDown={(e) => e.stopPropagation()}>
          <div className="crop-hole" style={rect} />
        </div>
        <div className="crop-rect" style={rect} onPointerDown={down("move")}>
          {HANDLES.map((h) => (
            <div key={h} className={`crop-handle crop-${h}`} data-handle={h} onPointerDown={down(h)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Under the viewer while cropping, in the transport's place, as CapCut's
 * crop dialog puts its ratios and buttons under the picture. */
export function CropBar({ session }: { session: CropSession }) {
  if (session.purpose === "stream") return <div className="transport crop-bar stream-crop-bar" role="toolbar" aria-label="Facecam source region">
    <span>Place the box around the facecam</span>
    <div className="crop-actions"><button className="btn ghost" onClick={cancelCrop}>Cancel</button><button className="btn primary" onClick={applyCrop}>Apply stream layout</button></div>
  </div>;
  return (
    <div className="transport crop-bar" role="toolbar" aria-label="Crop">
      <div className="crop-ratios" role="radiogroup" aria-label="Crop ratio">
        {CROP_RATIOS.map((r) => (
          <button key={r} role="radio" aria-checked={session.ratio === r} className={`chip-btn${session.ratio === r ? " on" : ""}`} onClick={() => pickCropRatio(r)}>
            {ratioLabel(r)}
          </button>
        ))}
      </div>
      <label className="crop-softness">Softness
        <input type="range" min={0} max={540} value={session.crop.feather ?? 0} aria-label="Crop softness" onChange={(e) => setCropDraft({ ...session.crop, feather: Number(e.target.value) })} />
      </label>
      <div className="crop-actions">
        <button className="btn ghost" onClick={resetCrop}>Reset</button>
        <button className="btn ghost" onClick={cancelCrop}>Cancel</button>
        <button className="btn primary" onClick={applyCrop}>Done</button>
      </div>
    </div>
  );
}
