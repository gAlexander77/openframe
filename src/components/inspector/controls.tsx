import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Diamond, RotateCw } from "../../icons";
import { getPath, paramAt } from "../../lib/keyframes";
import { findClip, setParam, toggleKeyframe } from "../../lib/project/ops";
import type { Clip, Id } from "../../lib/project/types";
import { store, useEditor } from "../../state/store";
import { EaseButton } from "./KeyTools";

/** The selected clip, re-read from the store on every change. */
export function useClip(id: Id): Clip | null {
  return useEditor((s) => findClip(s.project, id)?.clip ?? null);
}

/** Playhead relative to the clip's start, clamped into the clip. */
export function useRel(c: Clip): number {
  const f = useEditor((s) => s.playhead);
  return Math.min(Math.max(f - c.start, 0), c.duration - 1);
}

export function Section(props: { title: string; children: ReactNode; onReset?: () => void; defaultOpen?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  return (
    <section className={`insp-section${open ? " open" : ""}`}>
      <header className="insp-section-head">
        <button className="insp-section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={13} className="insp-caret" />
          <span>{props.title}</span>
        </button>
        <div className="insp-section-tools">
          {props.extra}
          {props.onReset && (
            <button className="icon-btn small" aria-label={`Reset ${props.title}`} data-tip="Reset" onClick={props.onReset}>
              <RotateCw size={12} />
            </button>
          )}
        </div>
      </header>
      {open && <div className="insp-section-body">{props.children}</div>}
    </section>
  );
}

export interface SliderProps {
  clip: Clip;
  path: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Stored value -> what the user sees (e.g. 1 -> 100 for %). */
  show?: (v: number) => number;
  /** What the user typed -> stored value. */
  store?: (v: number) => number;
  unit?: string;
  digits?: number;
  /** Default stored value for reset. */
  reset?: number;
  keyframes?: boolean;
  /** CSS gradient for the track (CapCut colors temperature/tint tracks). */
  track?: string;
}

/** A labeled slider + numeric field + keyframe cluster. Dragging is one
 * undo step; keyframed paths auto-key at the playhead. */
export function SliderRow(p: SliderProps) {
  const rel = useRel(p.clip);
  const show = p.show ?? ((v: number) => v);
  const toStore = p.store ?? ((v: number) => v);
  const keys = p.clip.keyframes?.[p.path];
  const value = keys?.length ? paramAt(p.clip, p.path, rel) : (getPath(p.clip, p.path) ?? p.reset ?? 0);
  const shown = show(value);
  const [text, setText] = useState<string | null>(null);
  const digits = p.digits ?? (p.step && p.step < 1 ? 1 : 0);
  const set = (v: number) => (p2: Parameters<typeof setParam>[0]) => setParam(p2, [p.clip.id], p.path, v, rel);
  const commit = (raw: string) => {
    const n = Number(raw.replace(/[^\d.+-]/g, ""));
    setText(null);
    if (!Number.isFinite(n)) return;
    const v = toStore(Math.min(p.max, Math.max(p.min, n)));
    store.edit(`Set ${p.label.toLowerCase()}`, set(v));
  };
  return (
    <div className="insp-row">
      <label className="insp-label">{p.label}</label>
      <input
        type="range"
        className="insp-slider"
        min={p.min}
        max={p.max}
        step={p.step ?? 1}
        value={Math.min(p.max, Math.max(p.min, shown))}
        style={p.track ? ({ "--track": p.track } as React.CSSProperties) : undefined}
        onPointerDown={() => store.beginGesture()}
        onPointerUp={() => store.endGesture(`Set ${p.label.toLowerCase()}`)}
        onKeyUp={() => store.endGesture(`Set ${p.label.toLowerCase()}`)}
        onKeyDown={() => store.beginGesture()}
        onChange={(e) => store.previewGesture(set(toStore(Number(e.target.value))))}
        onDoubleClick={() => p.reset !== undefined && store.edit(`Reset ${p.label.toLowerCase()}`, set(p.reset))}
        aria-label={p.label}
      />
      <span className="insp-num">
        <input
          className="field num"
          value={text ?? shown.toFixed(digits)}
          onChange={(e) => setText(e.target.value)}
          // Only what the user typed is an edit: committing on every blur
          // recorded undo steps for tabbing past, and keyed the playhead.
          onBlur={(e) => text !== null && commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const d = (p.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
              commit(String(shown + d));
            }
          }}
          aria-label={`${p.label} value`}
        />
        {p.unit && <span className="insp-unit">{p.unit}</span>}
      </span>
      {p.keyframes !== false ? <KeyCluster clip={p.clip} path={p.path} value={value} /> : <span className="insp-keys" />}
    </div>
  );
}

/** CapCut's ‹ ◇ › cluster: previous keyframe, add/remove at the playhead,
 * next keyframe. The diamond fills cyan when the playhead sits on one, and
 * the easing button beside it then sets that keyframe's curve. */
export function KeyCluster({ clip, path, value }: { clip: Clip; path: string; value: number }) {
  const rel = useRel(clip);
  const keys = clip.keyframes?.[path] ?? [];
  const on = keys.some((k) => k.f === rel);
  const prev = [...keys].reverse().find((k) => k.f < rel);
  const next = keys.find((k) => k.f > rel);
  return (
    <span className="insp-keys">
      <button className="key-nav" disabled={!prev} aria-label="Previous keyframe" data-tip="Previous keyframe" onClick={() => prev && store.seek(clip.start + prev.f)}>
        <ChevronLeft size={11} />
      </button>
      <button
        className={`key-toggle${on ? " on" : ""}${keys.length ? " has" : ""}`}
        aria-label={on ? "Remove keyframe" : "Add keyframe"}
        data-tip={on ? "Remove keyframe" : "Add keyframe"}
        onClick={() => store.edit(on ? "Remove keyframe" : "Add keyframe", (p) => toggleKeyframe(p, clip.id, path, rel, value))}
      >
        <Diamond size={11} fill={on ? "currentColor" : "none"} />
      </button>
      <button className="key-nav" disabled={!next} aria-label="Next keyframe" data-tip="Next keyframe" onClick={() => next && store.seek(clip.start + next.f)}>
        <ChevronRight size={11} />
      </button>
      <EaseButton clip={clip} path={path} f={rel} />
    </span>
  );
}

export function Row(props: { label: string; children: ReactNode }) {
  return (
    <div className="insp-row plain">
      <label className="insp-label">{props.label}</label>
      <div className="insp-control">{props.children}</div>
    </div>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: ReactNode; tip?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? "on" : ""}
          data-tip={o.tip}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button className={`toggle${props.on ? " on" : ""}`} role="switch" aria-checked={props.on} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(!props.on)}>
      <span />
    </button>
  );
}

export function ColorInput(props: { value: string; onChange: (v: string) => void; label: string }) {
  const hex = props.value.slice(0, 7);
  return (
    <span className="color-input">
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff"} onChange={(e) => props.onChange(e.target.value)} aria-label={props.label} />
      <input
        className="field num"
        defaultValue={hex}
        key={hex}
        onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && e.target.value.toLowerCase() !== hex.toLowerCase() && props.onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={`${props.label} hex`}
      />
    </span>
  );
}

/** Patch a clip with one undo step (non-numeric fields: text, fonts, modes). */
export function patchClip(id: Id, label: string, fn: (c: Clip) => Clip) {
  store.edit(label, (p) => {
    const loc = findClip(p, id);
    if (!loc) return p;
    const next = fn(loc.clip);
    return next === loc.clip ? p : { ...p, tracks: p.tracks.map((t) => (t.id === loc.track.id ? { ...t, clips: t.clips.map((c) => (c.id === id ? next : c)) } : t)) };
  });
}
