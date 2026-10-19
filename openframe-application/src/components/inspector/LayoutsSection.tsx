import { findClip } from "../../lib/project/ops";
import { useEditor } from "../../state/store";
import { LAYOUTS, layoutCells } from "../../lib/layouts";
import { runCommand } from "../../lib/commands";
import { edit } from "../../state/actions";
import { Section } from "./controls";

export function LayoutsSection({ ids }: { ids: string[] }) {
  const project = useEditor(s => s.project);
  if (ids.length < 2 || ids.length > 4) return null;
  const found = ids.map(id => findClip(project, id)!);
  const valid = found.every(l => l && !l.track.locked && !l.track.hidden) && Math.max(...found.map(l => l.clip.start)) < Math.min(...found.map(l => l.clip.start + l.clip.duration));
  return <Section title="Layouts">{!valid && <p className="insp-hint">Choose unlocked pictures that overlap in time.</p>}<div className="layout-tiles">
    {LAYOUTS.filter(l => l !== "triptych" || ids.length === 3).map(layout => <button className="btn layout-tile" disabled={!valid} key={layout} onClick={() => edit("Apply layout", p => runCommand(p, "apply_layout", { clip_ids: ids, layout }))}>
      <span className="layout-preview" aria-hidden="true">{layoutCells(layout, ids.length, 100, 64).map((c, i) => <span key={i} style={{ left: `${c.x}%`, top: `${c.y / 64 * 100}%`, width: `${c.w}%`, height: `${c.h / 64 * 100}%` }} />)}</span>
      <span>{layout.replace("pip-", "PIP ").replaceAll("-", " ")}</span>
    </button>)}
  </div></Section>;
}
