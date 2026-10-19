import { useRef, useState } from "react";
import { Diamond } from "../icons";
import { keyFrames, keysAt, moveKeys, sameRef, setEase, type KeyRef } from "../lib/keyframeEdit";
import { paramInfo } from "../lib/paramInfo";
import { findClip } from "../lib/project/ops";
import type { Clip, Ease } from "../lib/project/types";
import { snapSpan } from "../lib/timeline";
import { formatTimecode } from "../lib/time";
import { selectKeys, withKeys } from "../state/keyframes";
import { store, useEditor } from "../state/store";
import { EaseMenu } from "./EaseMenu";

const SNAP_PX = 10;

/** Frames a dragged key snaps to: the playhead, the clip's edges and the
 * other keys (CapCut and Premiere snap keyframes to the playhead). */
export function keySnapTargets(clip: Clip, moving: KeyRef[]): number[] {
  const s = store.get();
  if (!s.snapping) return [];
  const pts = new Set([s.playhead, clip.start, clip.start + clip.duration - 1]);
  for (const [path, ks] of Object.entries(clip.keyframes ?? {})) {
    for (const k of ks) if (!moving.some((r) => r.path === path && r.f === k.f)) pts.add(clip.start + k.f);
  }
  return [...pts].sort((a, b) => a - b);
}

/** Add refs to a selection, or take them out when all are already in it. */
export function toggleRefs(sel: KeyRef[], refs: KeyRef[]): KeyRef[] {
  const allIn = refs.every((r) => sel.some((x) => sameRef(x, r)));
  return allIn ? sel.filter((x) => !refs.some((r) => sameRef(x, r))) : [...sel, ...refs.filter((r) => !sel.some((x) => sameRef(x, r)))];
}

/**
 * The keyframe diamonds on the selected clip: one per keyed frame, covering
 * every parameter keyed there. Click to select (Shift/Ctrl adds), drag to
 * retime with snapping, Delete removes, right-click for easing, and the
 * tooltip names what is keyed at that frame.
 */
export function ClipKeys({ clip, zoom, locked }: { clip: Clip; zoom: number; locked: boolean }) {
  // Only this strip of diamonds follows the playhead: the timeline above
  // re-rendering every track on every frame cost playback its frames.
  const playheadRel = useEditor((s) => (s.playhead >= clip.start && s.playhead < clip.start + clip.duration ? s.playhead - clip.start : null));
  const keySel = useEditor((s) => (s.keySel?.clipId === clip.id ? s.keySel.keys : null));
  const fps = useEditor((s) => s.project.fps);
  const w = useEditor((s) => s.project.width);
  const h = useEditor((s) => s.project.height);
  const [drag, setDrag] = useState<{ snap: number | null; text: string; x: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; refs: KeyRef[] } | null>(null);
  const moved = useRef(false);
  const map = clip.keyframes;
  if (!map) return null;
  const names = (f: number) => keysAt(map, f).map((r) => paramInfo(r.path, clip, { width: w, height: h }).label);

  const down = (e: React.PointerEvent, f: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const at = keysAt(map, f);
    const sel = keySel ?? [];
    const wasIn = at.every((r) => sel.some((x) => sameRef(x, r)));
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const next = additive ? toggleRefs(sel, at) : wasIn ? sel : at;
    selectKeys(clip.id, next);
    if (locked || !next.some((r) => r.f === f)) return;
    const x0 = e.clientX;
    moved.current = false;
    const move = (ev: PointerEvent) => {
      if (!moved.current && Math.abs(ev.clientX - x0) < 3) return;
      if (!moved.current) {
        moved.current = true;
        store.beginGesture();
      }
      const z = store.get().zoom;
      let to = clip.start + f + Math.round((ev.clientX - x0) / z);
      const snapped = snapSpan(to, [0], keySnapTargets(clip, next), SNAP_PX / z);
      to = Math.round(snapped.frame);
      // From the keys as they were when the drag began, so nothing drifts.
      const r = moveKeys(map, next, to - clip.start - f, clip.duration);
      const applied = r.delta;
      store.previewGesture((base) => withKeys(base, clip.id, r.keys));
      store.set({ keySel: { clipId: clip.id, keys: r.refs } });
      setDrag({
        snap: snapped.target !== null && applied === to - clip.start - f ? snapped.target - clip.start : null,
        text: `${formatTimecode(clip.start + f + applied, fps)}  ·  ${applied >= 0 ? "+" : ""}${applied} f`,
        x: (f + applied) * z,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moved.current) store.endGesture(next.length > 1 ? "Move keyframes" : "Move keyframe");
      // A plain click on a selected group narrows the selection to it.
      else if (!additive && wasIn) selectKeys(clip.id, at);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const context = (e: React.MouseEvent, f: number) => {
    e.preventDefault();
    e.stopPropagation();
    const at = keysAt(map, f);
    const sel = keySel ?? [];
    const refs = at.every((r) => sel.some((x) => sameRef(x, r))) ? sel : at;
    selectKeys(clip.id, refs);
    setMenu({ x: e.clientX, y: e.clientY, refs });
  };

  const pick = (ease: Ease, refs: KeyRef[]) =>
    store.edit("Easing", (p) => {
      const c = findClip(p, clip.id)?.clip;
      return c?.keyframes ? withKeys(p, clip.id, setEase(c.keyframes, refs, ease)) : p;
    });

  const firstEase = menu && map[menu.refs[0]?.path]?.find((k) => k.f === menu.refs[0].f)?.ease;
  return (
    <>
      {keyFrames(map).map((f) => {
        const sel = !!keySel?.some((r) => r.f === f);
        return (
          <button
            key={f}
            className={`clip-key${playheadRel === f ? " on" : ""}${sel ? " sel" : ""}`}
            style={{ left: f * zoom - 6 }}
            aria-label={`Keyframe: ${names(f).join(", ")}`}
            aria-pressed={sel}
            data-tip={`${names(f).join(", ")} · ${formatTimecode(clip.start + f, fps)}`}
            onPointerDown={(e) => down(e, f)}
            onContextMenu={(e) => context(e, f)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              store.seek(clip.start + f);
            }}
          >
            <Diamond size={12} fill="currentColor" />
          </button>
        );
      })}
      {drag?.snap != null && <div className="clip-key-snap" style={{ left: drag.snap * zoom }} />}
      {drag && (
        <span className="clip-key-readout num" style={{ left: drag.x }}>
          {drag.text}
        </span>
      )}
      {menu && <EaseMenu x={menu.x} y={menu.y} current={firstEase ?? undefined} onPick={(e) => pick(e, menu.refs)} onClose={() => setMenu(null)} />}
    </>
  );
}
