import { useState, type ComponentType } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  SquareDashed,
} from "../../icons";
import { alignClips, distributeClips, type Align, type Axis } from "../../lib/align";
import { findClip } from "../../lib/project/ops";
import type { Id } from "../../lib/project/types";
import { store, useEditor } from "../../state/store";

const ALIGN: [Align, string, ComponentType][] = [
  ["left", "Align left", AlignStartVertical],
  ["center", "Align center horizontally", AlignCenterVertical],
  ["right", "Align right", AlignEndVertical],
  ["top", "Align top", AlignStartHorizontal],
  ["middle", "Align center vertically", AlignCenterHorizontal],
  ["bottom", "Align bottom", AlignEndHorizontal],
];
const SPREAD: [Axis, string, ComponentType][] = [
  ["horizontal", "Distribute horizontally", AlignHorizontalDistributeCenter],
  ["vertical", "Distribute vertically", AlignVerticalDistributeCenter],
];

/** The title-safe line is a tenth of the canvas in from each edge. Kept
 * across clips for the session, as the switch is a working mode. */
const TITLE_SAFE = 0.1;
let titleSafe = false;

/** How many of `ids` are pictures on unlocked tracks. */
export const useMovable = (ids: Id[]) =>
  useEditor((s) => ids.filter((id) => {
    const l = findClip(s.project, id);
    return l && !l.track.locked && l.clip.type !== "audio" && l.clip.type !== "adjustment";
  }).length);

/**
 * CapCut's align row under Transform: one clip aligns to the canvas,
 * several to their combined bounds; distributing needs three. Positions
 * are measured at the playhead, so an animated position gets a keyframe.
 */
export function AlignBar({ ids }: { ids: Id[] }) {
  const movable = useMovable(ids);
  const [safe, setSafe] = useState(titleSafe);
  if (!movable) return null;
  const several = movable > 1;
  // To the canvas, a clip can stop at the title-safe line (the viewer's
  // Title 80% guide) instead of the edge: the margin align_clips takes.
  const margin = !several && safe ? TITLE_SAFE : 0;
  const align = (edge: Align, label: string) =>
    store.edit(label, (p) => alignClips(p, ids, edge, store.get().playhead, margin));
  const spread = (axis: Axis, label: string) =>
    store.edit(label, (p) => distributeClips(p, ids, axis, store.get().playhead));
  return (
    <div className="align-bar" role="toolbar" aria-label="Align">
      {ALIGN.map(([edge, label, Icon]) => {
        const tip = several ? `${label} (to the selection)` : `${label} (to the canvas)`;
        return (
          <button key={edge} className="icon-btn" aria-label={label} data-tip={tip} onClick={() => align(edge, label)}>
            <Icon />
          </button>
        );
      })}
      {!several && (
        <button
          className={`icon-btn${safe ? " on" : ""}`}
          aria-label="Inside title safe"
          aria-pressed={safe}
          data-tip="Align inside the title-safe margin, not to the edge"
          onClick={() => setSafe((titleSafe = !safe))}
        >
          <SquareDashed />
        </button>
      )}
      <span className="align-bar-sep" />
      {SPREAD.map(([axis, label, Icon]) => (
        <button key={axis} className="icon-btn" aria-label={label} data-tip={movable < 3 ? `${label} (select three or more clips)` : label} disabled={movable < 3} onClick={() => spread(axis, label)}>
          <Icon />
        </button>
      ))}
    </div>
  );
}
