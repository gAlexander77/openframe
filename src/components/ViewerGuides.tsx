import { store, useEditor } from "../state/store";

export const VIEWER_GUIDES = [
  ["off", "Guides off"],
  ["safe", "Safe margins"],
  ["thirds", "Rule of thirds"],
  ["both", "Safe margins + thirds"],
] as const;

export function ViewerGuideControl() {
  const value = useEditor((s) => s.viewerGuides);
  return (
    <select
      className="quality-select viewer-guide-select"
      aria-label="Viewer guides"
      data-tip="Composition guides: preview only, never exported"
      value={value}
      onChange={(e) => store.set({ viewerGuides: e.target.value as typeof value })}
    >
      {VIEWER_GUIDES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  );
}

/** DOM above the picture, below transform handles. Percentage geometry
 * follows the actual canvas through portrait, resizing and full screen. */
export function ViewerGuides() {
  const guides = useEditor((s) => s.viewerGuides);
  if (guides === "off") return null;
  return (
    <div className="viewer-guides" aria-hidden="true">
      {(guides === "safe" || guides === "both") && <>
        <div className="viewer-safe viewer-safe-action"><span>Action 90%</span></div>
        <div className="viewer-safe viewer-safe-title"><span>Title 80%</span></div>
      </>}
      {(guides === "thirds" || guides === "both") && <div className="viewer-thirds">
        <i className="viewer-third-v" style={{ left: "33.333333%" }} />
        <i className="viewer-third-v" style={{ left: "66.666667%" }} />
        <i className="viewer-third-h" style={{ top: "33.333333%" }} />
        <i className="viewer-third-h" style={{ top: "66.666667%" }} />
      </div>}
    </div>
  );
}
