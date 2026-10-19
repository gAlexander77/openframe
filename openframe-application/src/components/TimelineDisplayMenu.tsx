import { useRef, useState } from "react";
import { Settings } from "../icons";
import { setTimelineDisplay, useTimelineDisplay } from "../state/timelineDisplay";
import { MenuList, useDismiss } from "./Menu";
export function TimelineDisplayMenu() {
  const value = useTimelineDisplay();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));
  return <div className="tool-picker" ref={ref}><button className="icon-btn" aria-label="Timeline display" onClick={() => setOpen(!open)}><Settings /></button>{open && <MenuList items={[
    ...([ ["waveforms", "Show waveforms"], ["thumbnails", "Show video thumbnails"], ["names", "Show clip names"] ] as const).map(([key, label]) => ({ label, checked: value[key], onSelect: () => setTimelineDisplay({ [key]: !value[key] }) })),
    "-",
    ...(["small", "medium", "large"] as const).map(height => ({ label: `${height[0].toUpperCase()}${height.slice(1)} track height`, checked: value.height === height, onSelect: () => setTimelineDisplay({ height }) })),
  ]} onDone={() => setOpen(false)} />}</div>;
}
