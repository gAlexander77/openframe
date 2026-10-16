import { useMemo } from "react";
import { AudioLines } from "../icons";
import { trimFrames, type TrimPreviewState } from "../lib/trimPreview";
import { getAsset } from "../lib/project/ops";
import { formatTimecode, secondsToFrames } from "../lib/time";
import { useEditor } from "../state/store";
import { FramePreview } from "./FramePreview";
import "./sourceMonitor.css";

const names: Record<TrimPreviewState["kind"], string> = { trim: "Trim", ripple: "Ripple trim", roll: "Roll edit", slip: "Slip edit", slide: "Slide edit" };
export function TrimPreview({ state }: { state: TrimPreviewState }) {
  const project = useEditor((s) => s.project);
  const frames = useMemo(() => trimFrames(project, state), [project, state]);
  return <section className="trim-preview" aria-label="Trim preview" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
    <header><strong>{names[state.kind]}</strong><span>Clip edges · drag to compare</span></header>
    <div className="trim-pair">{frames.map((pane, i) => <figure key={i} data-source-time={pane.source ?? ""} data-timeline-frame={pane.frame}>
      <figcaption>{pane.label}</figcaption>
      {pane.clip.type === "audio" ? <div className="trim-audio"><AudioLines size={30} /><span>Audio</span></div> : <FramePreview project={pane.project} frame={pane.frame} label={pane.label} />}
      <strong className="trim-clip-name">{pane.clip.name ?? ("assetId" in pane.clip ? getAsset(project, pane.clip.assetId)?.name : undefined) ?? pane.clip.type}</strong>
      <span className="num">{pane.source !== null ? `Source ${formatTimecode(secondsToFrames(pane.source, project.fps), project.fps)}` : `Timeline ${formatTimecode(pane.frame, project.fps)}`}</span>
    </figure>)}</div>
    <p>Isolated clip frames; transitions and other tracks are excluded.</p>
  </section>;
}
