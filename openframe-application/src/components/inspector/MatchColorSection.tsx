import { useEffect, useState } from "react";
import { exportStills } from "../../engine/export";
import { createTrack } from "../../lib/project/defaults";
import { findClip, getAsset } from "../../lib/project/ops";
import { cancelColorMatch, matchColor } from "../../state/colorMatch";
import { tipFor } from "../../state/actions";
import { store, useEditor } from "../../state/store";
import { toast } from "../../state/toast";
import { Row, Section, Toggle } from "./controls";

export function MatchColorSection() {
  const p = useEditor(s => s.project);
  const ids = useEditor(s => s.selection);
  const reference = useEditor(s => s.colorMatchReference);
  const picking = useEditor(s => s.colorMatchPicking);
  const busy = useEditor(s => s.colorMatchBusy);
  const [strength, setStrength] = useState(1);
  const [saturation, setSaturation] = useState(true);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const clip = reference ? findClip(p, reference)?.clip : null;
  const name = clip?.name || (clip && "assetId" in clip ? getAsset(p, clip.assetId)?.name : null) || "Reference clip";
  useEffect(() => {
    setThumbnail(null);
    if (!clip || (clip.type !== "image" && clip.type !== "video")) return;
    let canceled = false, url: string | null = null;
    const solo = { ...p, tracks: [{ ...createTrack("video", "Reference", true), clips: [{ ...clip, disabled: false, transitionOut: undefined }] }] };
    const k = 80 / Math.max(p.width, p.height);
    void exportStills(solo, [clip.start + Math.floor(clip.duration / 2)], Math.max(2, Math.round(p.width * k)), Math.max(2, Math.round(p.height * k))).then(blobs => {
      if (canceled) return;
      url = URL.createObjectURL(blobs[0]);
      setThumbnail(url);
    }).catch(() => {});
    return () => { canceled = true; if (url) URL.revokeObjectURL(url); };
  }, [clip, p]);
  const targets = ids.filter(id => id !== reference && ["image", "video"].includes(findClip(p, id)?.clip.type ?? ""));
  return <Section title="Match color">
    <Row label="Reference">
      <button className="btn" aria-pressed={picking} disabled={busy} onClick={() => store.set({ colorMatchPicking: !picking })}>
        {picking ? "Cancel pick" : "Pick reference"}
      </button>
    </Row>
    {picking && <p className="insp-hint">Click a video or picture on the timeline. {tipFor("deselect", "Cancel")}</p>}
    {clip && <div className="match-reference">{thumbnail && <img src={thumbnail} alt="Reference look" />}<span title={name}>{name}</span></div>}
    <Row label="Strength"><input aria-label="Match strength" type="range" min={0} max={1} step={0.01} value={strength} disabled={busy} onChange={e => setStrength(Number(e.target.value))} /></Row>
    <Row label="Match saturation"><Toggle label="Match saturation" on={saturation} onChange={setSaturation} disabled={busy} /></Row>
    <p className="insp-hint">Replaces the target look with editable RGB curves and saturation. Keeps the master curve.</p>
    <div className="insp-actions">
      <button className="btn" disabled={busy || !clip || !targets.length} onClick={() => {
        void matchColor(targets, { referenceClipId: reference!, strength, matchSaturation: saturation }).catch(e => {
          if (e instanceof Error && e.name !== "AbortError") toast(e.message, "error");
        });
      }}>{busy ? "Matching…" : "Match"}</button>
      {busy && <button className="btn ghost" onClick={cancelColorMatch}>Cancel match</button>}
    </div>
  </Section>;
}
