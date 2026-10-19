import { useRef, useState } from "react";
import { Diamond, RotateCcw } from "../../icons";
import { balanceToPuck, puckToBalance, wheelColor, WHEELS } from "../../lib/grade";
import { paramAt } from "../../lib/keyframes";
import { setParam, toggleKeyframe } from "../../lib/project/ops";
import type { Clip, Project, WheelName } from "../../lib/project/types";
import { store } from "../../state/store";
import { KeyCluster, rangeGesture, useCommitOnLeave, useRel } from "./controls";
import { parseTyped } from "../../lib/numberInput";
import { hasKeys, setGradePart } from "./gradeEdit";
import "./color.css";

const LABEL: Record<WheelName, string> = { lift: "Lift", gamma: "Gamma", gain: "Gain", offset: "Offset" };
const TONES: Record<WheelName, string> = { lift: "Shadows", gamma: "Midtones", gain: "Highlights", offset: "Overall" };
const BAL = ["r", "g", "b"] as const;

/** The wheel's face: each hue where the vectorscope draws it (red up and a
 * little left, blue right), fading to gray at the center. */
const FACE = (() => {
  const stops: string[] = [];
  // CSS conic angles run clockwise from 12 o'clock; the scope's run
  // counterclockwise from 3 o'clock.
  for (let phi = 0; phi <= 360; phi += 10) {
    const [r, g, b] = wheelColor(90 - phi).map((v) => Math.round(v * 255));
    stops.push(`rgb(${r} ${g} ${b}) ${phi}deg`);
  }
  return `radial-gradient(closest-side, rgb(118 118 118) 0%, rgb(118 118 118 / 0.9) 12%, rgb(118 118 118 / 0) 100%), conic-gradient(${stops.join(", ")})`;
})();

const round2 = (v: number) => Math.round(v * 100) / 100;

/** CapCut's Color wheel tab with Resolve's math: lift, gamma, gain and
 * offset, each a draggable puck (color balance) and a luminance slider. */
export function WheelsPanel({ clip }: { clip: Clip }) {
  if (!("adjust" in clip)) return null;
  const any = WHEELS.some((w) => clip.adjust.wheels?.[w] || hasKeys(clip, `adjust.wheels.${w}.`));
  return (
    <>
      <div className="wheel-wrap">
        <div className="wheel-grid">
          {WHEELS.map((w) => (
            <WheelCard key={w} clip={clip} name={w} />
          ))}
        </div>
      </div>
      <p className="insp-hint wheel-hint">Drag inside a wheel to tint that range; the slider brightens or darkens it. Shift drags finely, a double-click recenters.</p>
      {any && (
        <div className="grade-foot">
          <button className="btn ghost" onClick={() => setGradePart(clip.id, "Reset color wheels", "wheels", undefined, "adjust.wheels.")}>
            Reset all wheels
          </button>
        </div>
      )}
    </>
  );
}

function WheelCard({ clip, name }: { clip: Clip; name: WheelName }) {
  const rel = useRel(clip);
  const faceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; y0: number; px0: number; py0: number } | null>(null);
  const [active, setActive] = useState(false);
  const path = (ch: string) => `adjust.wheels.${name}.${ch}`;
  const [r, g, b, y] = [...BAL, "y"].map((ch) => paramAt(clip, path(ch), rel));
  const [px, py] = balanceToPuck(r, g, b);
  const label = LABEL[name];
  const edited = r !== 0 || g !== 0 || b !== 0 || y !== 0 || hasKeys(clip, `adjust.wheels.${name}.`);

  /** Set the balance from a puck position (clamped to the wheel). */
  const balance = (x: number, yy: number) => (p: Project) => {
    const len = Math.hypot(x, yy);
    const k = len > 1 ? 1 / len : 1;
    const bal = puckToBalance(x * k, yy * k);
    return BAL.reduce((q, ch) => setParam(q, [clip.id], path(ch), round2(bal[ch]), rel), p);
  };
  const pointer = (e: React.PointerEvent) => {
    const rc = faceRef.current!.getBoundingClientRect();
    return [(e.clientX - rc.left - rc.width / 2) / (rc.width / 2), -(e.clientY - rc.top - rc.height / 2) / (rc.height / 2)];
  };

  const balanceKeyed = BAL.every((ch) => clip.keyframes?.[path(ch)]?.some((k) => k.f === rel));
  const balanceAnimated = BAL.some((ch) => clip.keyframes?.[path(ch)]?.length);
  const toggleBalanceKeys = () =>
    store.edit(balanceKeyed ? "Remove keyframe" : "Add keyframe", (p) =>
      BAL.reduce((q, ch, i) => {
        const has = !!clip.keyframes?.[path(ch)]?.some((k) => k.f === rel);
        return has === balanceKeyed ? toggleKeyframe(q, clip.id, path(ch), rel, [r, g, b][i]) : q;
      }, p),
    );

  return (
    <div className={`wheel-card${edited ? " edited" : ""}`}>
      <div className="wheel-head">
        <span className="wheel-title">{label}</span>
        <span className="wheel-tone" data-tip={`${label}: ${TONES[name].toLowerCase()}`}>
          {TONES[name]}
        </span>
        <button
          className={`key-toggle${balanceKeyed ? " on" : ""}${balanceAnimated ? " has" : ""}`}
          aria-label={`${balanceKeyed ? "Remove" : "Add"} ${label.toLowerCase()} color keyframe`}
          data-tip={balanceKeyed ? "Remove color keyframe" : "Add color keyframe"}
          onClick={toggleBalanceKeys}
        >
          <Diamond size={12} fill={balanceKeyed ? "currentColor" : "none"} />
        </button>
        <button className="icon-btn small" aria-label={`Reset ${label}`} data-tip="Reset" disabled={!edited} onClick={() => setGradePart(clip.id, `Reset ${label.toLowerCase()}`, "wheels", withoutWheel(clip, name), `adjust.wheels.${name}.`)}>
          <RotateCcw size={12} />
        </button>
      </div>
      <div
        className={`wheel-face${active ? " active" : ""}`}
        ref={faceRef}
        style={{ background: FACE }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const [x, yy] = pointer(e);
          // Grabbing the puck moves it relatively; anywhere else jumps there.
          const onPuck = Math.hypot(x - px, yy - py) < 0.16;
          drag.current = onPuck ? { x0: x, y0: yy, px0: px, py0: py } : { x0: x, y0: yy, px0: x, py0: yy };
          store.beginGesture();
          setActive(true);
          if (!onPuck) store.previewGesture(balance(x, yy));
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const [x, yy] = pointer(e);
          const k = e.shiftKey ? 0.2 : 1;
          store.previewGesture(balance(d.px0 + (x - d.x0) * k, d.py0 + (yy - d.y0) * k));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          setActive(false);
          store.endGesture(`Move ${label.toLowerCase()} wheel`);
        }}
        onLostPointerCapture={() => {
          if (!drag.current) return;
          drag.current = null;
          setActive(false);
          store.endGesture(`Move ${label.toLowerCase()} wheel`);
        }}
        onDoubleClick={() => store.edit(`Center ${label.toLowerCase()} wheel`, balance(0, 0))}
      >
        <span className="wheel-cross" aria-hidden />
        <button
          className="wheel-puck"
          style={{
            left: `${50 + px * 50}%`,
            top: `${50 - py * 50}%`,
            background: `rgb(${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, 128 + v * 1.6)))).join(" ")})`,
          }}
          aria-label={`${label} color balance: red ${r.toFixed(1)}, green ${g.toFixed(1)}, blue ${b.toFixed(1)}. Arrow keys move it.`}
          onPointerDown={(e) => e.button === 0 && e.currentTarget.focus()}
          onKeyDown={(e) => {
            const s = e.shiftKey ? 0.005 : 0.025;
            const moves: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] };
            if (e.key === "Home" || e.key === "Delete") store.edit(`Center ${label.toLowerCase()} wheel`, balance(0, 0));
            else if (moves[e.key]) store.edit(`Move ${label.toLowerCase()} wheel`, balance(px + moves[e.key][0], py + moves[e.key][1]));
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <div className="wheel-values num" aria-hidden>
        <span className="wv-r">R {fmt(r)}</span>
        <span className="wv-g">G {fmt(g)}</span>
        <span className="wv-b">B {fmt(b)}</span>
      </div>
      <LuminanceRow clip={clip} path={path("y")} label={label} value={y} rel={rel} />
    </div>
  );
}

const fmt = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

function withoutWheel(clip: Clip, name: WheelName) {
  if (!("adjust" in clip) || !clip.adjust.wheels) return undefined;
  const next = { ...clip.adjust.wheels };
  delete next[name];
  return Object.keys(next).length ? next : undefined;
}

/** The wheel's luminance ring as a compact slider: one undo step per drag,
 * auto-keyed when the path has keyframes, like every inspector row. */
function LuminanceRow(p: { clip: Clip; path: string; label: string; value: number; rel: number }) {
  const [text, setText] = useState<string | null>(null);
  const undo = `Set ${p.label.toLowerCase()} luminance`;
  const set = (v: number) => (q: Project) => setParam(q, [p.clip.id], p.path, Math.max(-100, Math.min(100, v)), p.rel);
  // Only what was typed is an edit, kept if the field goes away unblurred.
  const commit = (raw: string) => {
    setText(null);
    const n = parseTyped(raw);
    if (n !== null) store.edit(undo, set(n));
  };
  useCommitOnLeave(text, commit);
  return (
    <div className="wheel-lum">
      <input
        type="range"
        className="insp-slider"
        min={-100}
        max={100}
        step={1}
        value={p.value}
        style={{ "--track": "linear-gradient(90deg, #1c1c1c, #8a8a8a, #f2f2f2)" } as React.CSSProperties}
        aria-label={`${p.label} luminance`}
        {...rangeGesture(undo)}
        onChange={(e) => store.previewGesture(set(Number(e.target.value)), undo)}
        onDoubleClick={() => store.edit(`Reset ${p.label.toLowerCase()} luminance`, set(0))}
      />
      <input
        className="field num wheel-num"
        value={text ?? Math.round(p.value).toString()}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== null && commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(null);
        }}
        aria-label={`${p.label} luminance value`}
      />
      <KeyCluster clip={p.clip} path={p.path} value={p.value} />
    </div>
  );
}
