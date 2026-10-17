import type { ComponentType } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
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
  if (!movable) return null;
  const several = movable > 1;
  const align = (edge: Align, label: string) =>
    store.edit(label, (p) => alignClips(p, ids, edge, store.get().playhead));
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
      <span className="align-bar-sep" />
      {SPREAD.map(([axis, label, Icon]) => (
        <button key={axis} className="icon-btn" aria-label={label} data-tip={movable < 3 ? `${label} (select three or more clips)` : label} disabled={movable < 3} onClick={() => spread(axis, label)}>
          <Icon />
        </button>
      ))}
    </div>
  );
}
