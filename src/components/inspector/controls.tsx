import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Diamond, Pipette, RotateCcw } from "../../icons";
import { getPath, paramAt } from "../../lib/keyframes";
import { parseTyped } from "../../lib/numberInput";
import { findClip, setParam, toggleKeyframe } from "../../lib/project/ops";
import type { Clip, Id } from "../../lib/project/types";
import { sectionOpen, setSectionOpen } from "../../state/sections";
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

/** A collapsible inspector section. Opening or closing it is remembered
 * per viewer by its title (or `id`), across clips and reloads; until the
 * viewer chooses, `defaultOpen` decides. */
export function Section(props: { title: string; id?: string; children: ReactNode; onReset?: () => void; defaultOpen?: boolean; extra?: ReactNode }) {
  const id = props.id ?? props.title;
  const [open, setOpen] = useState(() => sectionOpen(id) ?? props.defaultOpen ?? true);
  const toggle = () => {
    setOpen(!open);
    setSectionOpen(id, !open);
  };
  return (
    <section className={`insp-section${open ? " open" : ""}`}>
      <header className="insp-section-head">
        <button className="insp-section-toggle" onClick={toggle} aria-expanded={open}>
          <ChevronDown size={13} className="insp-caret" />
          <span>{props.title}</span>
        </button>
        <div className="insp-section-tools">
          {props.extra}
          {props.onReset && (
            <button className="icon-btn small" aria-label={`Reset ${props.title}`} data-tip="Reset" onClick={props.onReset}>
              <RotateCcw size={12} />
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
  /** More clips the row sets too (a multi-selection, as Premiere's
   * Properties panel edits several): each keys at its own frame. */
  also?: Clip[];
}

/**
 * What was typed in a field is kept when the field goes away without a
 * blur (ADR-072): selecting another clip unmounts the inspector under the
 * caret, and a press on the timeline keeps the focus, so no blur ever
 * came. CapCut and Premiere commit a typed value when focus leaves.
 * `draft` is what was typed (null: nothing pending); `commit` applies it.
 */
export function useCommitOnLeave(draft: string | null, commit: (raw: string) => void) {
  const last = useRef({ draft, commit });
  last.current = { draft, commit };
  useEffect(
    () => () => {
      const { draft, commit } = last.current;
      if (draft !== null) commit(draft);
    },
    [],
  );
}

/**
 * What makes one drag of a range input, or one held arrow key, a single
 * undo step (ADR-072): the input's onChange previews with
 * store.previewGesture, the press opens the gesture and the release closes
 * it wherever the pointer is let go (a slider thumb dragged off its track
 * releases outside it). A held key's repeats stay inside the gesture its
 * first press opened: restarting it per repeat left only the last step to
 * undo. `label` is read at the release, so it can name the final value.
 * Pass the label to previewGesture as well: a change with no press (a
 * script, assistive technology) is then one edit of its own.
 */
export function rangeGesture(label: string | (() => string)) {
  const end = () => store.endGesture(typeof label === "function" ? label() : label);
  // The release's own change event comes after pointerup; where the shown
  // value is rounded (speed, a transition's frames, decibels) it re-sends
  // the value, which must land inside the gesture, not as a second step.
  const release = () => {
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    setTimeout(end, 0);
  };
  return {
    onPointerDown: () => {
      store.beginGesture();
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", release, true);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!e.repeat) store.beginGesture();
    },
    onKeyUp: end,
  };
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
  const playhead = useEditor((s) => s.playhead);
  const relOf = (c: Clip) => Math.min(Math.max(playhead - c.start, 0), c.duration - 1);
  // A dash, as Premiere shows, when the clips disagree.
  const mixed = !!p.also?.some((c) => Math.abs(paramAt(c, p.path, relOf(c)) - value) > 1e-6);
  const set = (v: number) => (p2: Parameters<typeof setParam>[0]) =>
    (p.also ?? []).reduce((q, c) => setParam(q, [c.id], p.path, v, relOf(c)), setParam(p2, [p.clip.id], p.path, v, rel));
  const commit = (raw: string) => {
    const n = parseTyped(raw);
    setText(null);
    if (n === null) return;
    const v = toStore(Math.min(p.max, Math.max(p.min, n)));
    store.edit(`Set ${p.label.toLowerCase()}`, set(v));
  };
  useCommitOnLeave(text, commit);
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
        {...rangeGesture(`Set ${p.label.toLowerCase()}`)}
        onChange={(e) => store.previewGesture(set(toStore(Number(e.target.value))), `Set ${p.label.toLowerCase()}`)}
        onDoubleClick={() => p.reset !== undefined && store.edit(`Reset ${p.label.toLowerCase()}`, set(p.reset))}
        aria-label={p.label}
      />
      <span className="insp-num">
        <input
          className="field num"
          value={text ?? (mixed ? "" : shown.toFixed(digits))}
          placeholder={mixed ? "Mixed" : undefined}
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
        <Diamond size={12} fill={on ? "currentColor" : "none"} />
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
          aria-label={o.tip}
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

/** The platform's screen color picker (Chromium and WebView2 have it). */
type EyeDropperApi = new () => { open(): Promise<{ sRGBHex: string }> };

export function ColorInput(props: { value: string; onChange: (v: string) => void; label: string }) {
  const hex = props.value.slice(0, 7);
  // Read at render, not import: a page can gain it (tests stub it).
  const Dropper = (globalThis as { EyeDropper?: EyeDropperApi }).EyeDropper;
  const pick = async () => {
    try {
      props.onChange((await new Dropper!().open()).sRGBHex);
    } catch {
      // Escape cancels the pick; nothing to do.
    }
  };
  // The platform picker sends an input per pointer move while its square
  // is dragged, and a change when it closes: the moves are one undo step
  // (a run, ADR-072), whichever path the caller edits through.
  const swatch = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = swatch.current;
    if (!el) return;
    const end = () => store.endRun();
    el.addEventListener("change", end);
    el.addEventListener("blur", end);
    return () => {
      el.removeEventListener("change", end);
      el.removeEventListener("blur", end);
      end();
    };
  }, []);
  return (
    <span className="color-input">
      <input
        ref={swatch}
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff"}
        onChange={(e) => {
          store.beginRun();
          props.onChange(e.target.value);
        }}
        aria-label={props.label}
      />
      <input
        className="field num"
        defaultValue={hex}
        key={hex}
        onBlur={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && e.target.value.toLowerCase() !== hex.toLowerCase() && props.onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-label={`${props.label} hex`}
      />
      {Dropper && (
        <button className="icon-btn small" aria-label={`Pick ${props.label.toLowerCase()} from the screen`} data-tip="Pick a color from anywhere on the screen, the viewer included" onClick={() => void pick()}>
          <Pipette size={13} />
        </button>
      )}
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
