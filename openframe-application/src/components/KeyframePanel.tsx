import { EmptyState } from "./EmptyState";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChartSpline, ChevronDown, Diamond, X } from "../icons";
import { interpolate, paramAt, upsertKey } from "../lib/keyframes";
import { curveRange, dragHandle, handlePoints, moveKeys, presetOf, sameRef, setEase, setValues, type KeyMap, type KeyRef } from "../lib/keyframeEdit";
import { formatParam, paramInfo, type ParamInfo } from "../lib/paramInfo";
import { findClip, toggleKeyframe } from "../lib/project/ops";
import type { Clip, Ease, Keyframe } from "../lib/project/types";
import { formatTimecode } from "../lib/time";
import { snapSpan } from "../lib/timeline";
import { run } from "../state/actions";
import { selectKeys, withKeys } from "../state/keyframes";
import { store, useEditor } from "../state/store";
import { keySnapTargets, toggleRefs } from "./ClipKeys";
import { EaseCurve, EaseMenu } from "./EaseMenu";
import { Splitter } from "./Splitter";
import { tipFor } from "../state/actions";
import "./keyframes.css";

const ROW_H = 22;
const PAD_Y = 16;
const SNAP_PX = 10;
const DEFAULT_H = 240;
const MIN_H = 90;

const loadHeight = () => {
  try {
    return Math.max(MIN_H, Number(localStorage.getItem("keyframePanelHeight")) || DEFAULT_H);
  } catch {
    return DEFAULT_H;
  }
};

interface Props {
  /** Width of the track headers, so lanes line up with the clips above. */
  headerW: number;
  /** The timeline's horizontal scroll, shared so a frame sits at the same x. */
  scrollLeft: number;
  scrollEl: React.RefObject<HTMLDivElement | null>;
}

/**
 * CapCut's keyframe animation panel (its "Show keyframe animation"), docked
 * under the timeline tracks and sharing their time axis (ADR-023): one lane
 * per animated parameter of the selected clip, and a value graph of the
 * focused lane with draggable keys and bezier handles.
 */
export function KeyframePanel(props: Props) {
  const [height, setHeight] = useState(loadHeight);
  const dock = useRef<HTMLDivElement>(null);
  const clip = useEditor((s) => (s.selection.length === 1 ? (findClip(s.project, s.selection[0])?.clip ?? null) : null));
  useEffect(() => {
    try {
      localStorage.setItem("keyframePanelHeight", String(height));
    } catch {
      /* private window: the height just won't persist */
    }
  }, [height]);
  // Measure the actual dock, including window and workspace splitter changes.
  // Reserve the toolbar, ruler and two normal track rows above the graph.
  const [available, setAvailable] = useState(MIN_H);
  useLayoutEffect(() => {
    const parent = dock.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => setAvailable(Math.max(MIN_H, parent.clientHeight - 210)));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const maxH = () => available;
  const animated = !!clip?.keyframes && Object.keys(clip.keyframes).length > 0;
  return (
    <div className="kf-dock" ref={dock} style={{ height: Math.min(height, maxH()) }}>
      <Splitter dir="y" onDrag={(d) => setHeight((h) => Math.max(MIN_H, Math.min(maxH(), h - d)))} onReset={() => setHeight(DEFAULT_H)} />
      <div className="kf-panel" role="region" aria-label="Keyframe animation">
        {clip && animated ? (
          <ClipGraph key={clip.id} clip={clip} {...props} />
        ) : (
          <>
            <Head headerW={props.headerW}>{clip && <ClipName clip={clip} />}</Head>
            <div className="kf-empty">{clip ? <QuickAdd clip={clip} /> : <EmptyState icon={<Diamond size={24} />} title="No clip selected" hint="Select a clip to see and edit its keyframes." />}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** What the timeline's clip label says: its name, else its file's. */
function ClipName({ clip: c }: { clip: Clip }) {
  const file = useEditor((s) => ("assetId" in c ? s.project.assets.find((a) => a.id === c.assetId)?.name : undefined));
  const name = c.type === "text" ? c.text.split("\n")[0] || "Text" : (c.name ?? file ?? (c.type === "color" ? "Solid color" : "Adjustment"));
  return (
    <span className="kf-clip-name" data-tip={name}>
      {name}
    </span>
  );
}

function Head(props: { headerW: number; children?: React.ReactNode }) {
  return (
    <header className="kf-head">
      <div className="kf-title" style={{ width: props.headerW }}>
        <ChartSpline size={13} />
        <span>Keyframes</span>
      </div>
      <div className="kf-head-main">{props.children}</div>
      <button className="icon-btn small" aria-label="Close keyframe animation" data-tip={tipFor("toggleKeyframePanel", "Close")} onClick={() => run("toggleKeyframePanel")}>
        <X size={13} />
      </button>
    </header>
  );
}

const relOf = (c: Clip, playhead: number) => Math.min(Math.max(playhead - c.start, 0), c.duration - 1);

/** With nothing animated yet: one-click keys for the usual parameters. */
function QuickAdd({ clip }: { clip: Clip }) {
  const w = useEditor((s) => s.project.width);
  const h = useEditor((s) => s.project.height);
  const paths = "transform" in clip ? ["transform.scale", "transform.x", "transform.y", "transform.rotation", "opacity"] : "volume" in clip ? ["volume", "pan"] : "opacity" in clip ? ["opacity"] : [];
  const add = (path: string) => {
    const f = relOf(clip, store.get().playhead);
    store.edit("Add keyframe", (p) => toggleKeyframe(p, clip.id, path, f, paramAt(clip, path, f)));
  };
  return (
    <div className="kf-quick">
      <EmptyState icon={<Diamond size={24} />} title="No keyframes yet" hint="Add a property at the playhead to start animating." />
      <div className="kf-quick-chips">
        {paths.map((p) => (
          <button key={p} className="chip-btn" onClick={() => add(p)}>
            <Diamond size={12} /> {paramInfo(p, clip, { width: w, height: h }).label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- the lanes and the graph -----------------------------------------------------

// Drags remember the clip as it was when they began (`clip0`); every move
// recomputes from it, so nothing accumulates (ADR-005's gesture rule).
type Gesture =
  | { kind: "keys"; clip0: Clip; x0: number; y0: number; refs: KeyRef[]; primary: KeyRef; graph: boolean; started: boolean; narrow: KeyRef[] | null }
  | { kind: "handle"; clip0: Clip; seg: KeyRef; which: "out" | "in"; started: boolean }
  | { kind: "box"; x0: number; y0: number; graph: boolean; additive: boolean; base: KeyRef[]; moved: boolean };

/** A 1-2-5 step that gives about `lines` grid lines over `span`. */
function niceStep(span: number, lines = 4): number {
  const raw = span / lines;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/** The graph's value axis: the curve's reach plus a margin, in display units. */
function valueRange(keys: Keyframe[], info: ParamInfo) {
  const r = curveRange(keys, info.show);
  const span = r.max - r.min;
  const pad = span > 1e-9 ? span * 0.14 : Math.max(Math.abs(r.max) * 0.2, info.unit === "dB" ? 3 : 10);
  return { min: r.min - pad, max: r.max + pad };
}

function parseRef(s: string): KeyRef {
  const at = s.lastIndexOf("@");
  return { path: s.slice(0, at), f: Number(s.slice(at + 1)) };
}

function ClipGraph({ clip, headerW, scrollLeft, scrollEl }: Props & { clip: Clip }) {
  const zoom = useEditor((s) => s.zoom);
  const W = useEditor((s) => s.project.width);
  const H = useEditor((s) => s.project.height);
  const fps = useEditor((s) => s.project.fps);
  const keySel = useEditor((s) => (s.keySel?.clipId === clip.id ? s.keySel.keys : null));
  const map = clip.keyframes as KeyMap;
  const paths = Object.keys(map);
  const [focus, setFocus] = useState<string | null>(null);
  const lane = focus && map[focus] ? focus : (keySel?.find((r) => map[r.path])?.path ?? paths[0]);
  const infos = Object.fromEntries(paths.map((p) => [p, paramInfo(p, clip, { width: W, height: H })]));
  const info = infos[lane];
  const keys = map[lane];

  const area = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 160 });
  useLayoutEffect(() => {
    const el = area.current!;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel over the panel scrolls and zooms the timeline it shares a time axis with.
  useEffect(() => {
    const el = area.current!;
    const onWheel = (e: WheelEvent) => {
      const sc = scrollEl.current;
      if (!sc) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) sc.dispatchEvent(new WheelEvent("wheel", e));
      else sc.scrollLeft += e.deltaX || e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollEl]);

  // ---- geometry: lanes on top, the focused lane's value graph below ----
  const rowH = Math.max(14, Math.min(ROW_H, Math.floor((size.h * 0.42) / paths.length)));
  const lanesH = rowH * paths.length;
  const gTop = lanesH + 1;
  const gH = Math.max(40, size.h - gTop);
  // The value axis holds still while a drag is in progress, or the graph
  // would rescale under the pointer.
  const frozen = useRef<{ min: number; max: number } | null>(null);
  const range = frozen.current ?? valueRange(keys, info);
  const xOf = (f: number) => (clip.start + f) * zoom - scrollLeft;
  const yOf = (shown: number) => gTop + PAD_Y + ((range.max - shown) / (range.max - range.min)) * (gH - 2 * PAD_Y);
  const shownAt = (y: number) => range.max - ((y - gTop - PAD_Y) / (gH - 2 * PAD_Y)) * (range.max - range.min);
  // Window listeners outlive the render that attached them; they read the
  // current geometry through this ref.
  const geo = useRef({ xOf, yOf, shownAt, zoom, rowH, paths, lane, info, clip, scrollLeft, perPx: 0 });
  geo.current = { xOf, yOf, shownAt, zoom, rowH, paths, lane, info, clip, scrollLeft, perPx: (range.max - range.min) / (gH - 2 * PAD_Y) };

  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [snapX, setSnapX] = useState<number | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; refs: KeyRef[] } | null>(null);
  const [easeBtn, setEaseBtn] = useState<{ x: number; y: number; above: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const isSel = (r: KeyRef) => !!keySel?.some((x) => sameRef(x, r));
  const local = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const refOf = (el: Element | null): KeyRef | null => {
    const k = el?.closest("[data-key]")?.getAttribute("data-key");
    return k ? parseRef(k) : null;
  };

  // ---- pointer ----
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    const inGraph = y > gTop;
    const target = e.target as Element;
    const handle = target.closest("[data-handle]");
    const ref = refOf(target);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    e.preventDefault();
    if (handle) {
      gesture.current = { kind: "handle", clip0: clip, seg: parseRef(handle.getAttribute("data-seg")!), which: handle.getAttribute("data-handle") as "out" | "in", started: false };
    } else if (ref) {
      if (!inGraph) setFocus(ref.path);
      const sel = keySel ?? [];
      const wasIn = isSel(ref);
      const next = additive ? toggleRefs(sel, [ref]) : wasIn ? sel : [ref];
      selectKeys(clip.id, next);
      if (!next.some((r) => sameRef(r, ref))) return;
      gesture.current = { kind: "keys", clip0: clip, x0: e.clientX, y0: e.clientY, refs: next, primary: ref, graph: inGraph, started: false, narrow: !additive && wasIn ? [ref] : null };
    } else if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Shift+click adds a key: on a lane at the curve's value, in the graph where clicked.
      const f = Math.min(clip.duration - 1, Math.max(0, Math.round((x + scrollLeft) / zoom) - clip.start));
      const path = inGraph ? lane : paths[Math.floor(y / rowH)];
      if (!path) return;
      const v = inGraph ? info.store(shownAt(y)) : paramAt(clip, path, f);
      store.edit("Add keyframe", (p) => withKeys(p, clip.id, { ...map, [path]: upsertKey(map[path], { ...map[path].find((k) => k.f === f), f, v }) }));
      selectKeys(clip.id, [{ path, f }]);
      if (!inGraph) setFocus(path);
      return;
    } else {
      if (!inGraph && paths[Math.floor(y / rowH)]) setFocus(paths[Math.floor(y / rowH)]);
      gesture.current = { kind: "box", x0: x, y0: y, graph: inGraph, additive, base: keySel ?? [], moved: false };
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onMove = (e: PointerEvent) => {
    const g = gesture.current;
    const G = geo.current;
    if (!g) return;
    const { x, y } = local(e);
    if (g.kind === "box") {
      const b = { x: Math.min(g.x0, x), y: Math.min(g.y0, y), w: Math.abs(x - g.x0), h: Math.abs(y - g.y0) };
      if (!g.moved && b.w < 3 && b.h < 3) return;
      g.moved = true;
      setBox(b);
      const inside = (px: number, py: number) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
      const m = G.clip.keyframes ?? {};
      const hits: KeyRef[] = g.graph
        ? (m[G.lane] ?? []).filter((k) => inside(G.xOf(k.f), G.yOf(G.info.show(k.v)))).map((k) => ({ path: G.lane, f: k.f }))
        : G.paths.flatMap((path, i) => (m[path] ?? []).filter((k) => inside(G.xOf(k.f), i * G.rowH + G.rowH / 2)).map((k) => ({ path, f: k.f })));
      selectKeys(G.clip.id, g.additive ? [...g.base, ...hits.filter((h) => !g.base.some((r) => sameRef(r, h)))] : hits);
      return;
    }
    if (!g.started) {
      if (g.kind === "keys" && Math.abs(e.clientX - g.x0) < 3 && Math.abs(e.clientY - g.y0) < 3) return;
      g.started = true;
      frozen.current = range;
      store.beginGesture();
    }
    const c = g.clip0;
    const base = c.keyframes ?? {};
    if (g.kind === "handle") {
      const seg = base[g.seg.path];
      const i = seg?.findIndex((k) => k.f === g.seg.f) ?? -1;
      if (i < 0 || !seg[i + 1]) return;
      const bz = dragHandle(seg[i], seg[i + 1], g.which, { f: (x + G.scrollLeft) / G.zoom - c.start, v: G.info.store(G.shownAt(y)) });
      store.previewGesture((p) => withKeys(p, c.id, setEase(base, [g.seg], bz)));
      setReadout({ x: e.clientX, y: e.clientY, text: `Curve ${bz.map((n) => n.toFixed(2)).join(", ")}` });
      return;
    }
    // Keys: time from x, value from y in the graph. Shift locks the larger axis.
    let dx = e.clientX - g.x0;
    let dy = e.clientY - g.y0;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    const z = G.zoom;
    let to = c.start + g.primary.f + Math.round(dx / z);
    const snapped = dx === 0 ? { frame: to, target: null } : snapSpan(to, [0], keySnapTargets(c, g.refs), SNAP_PX / z);
    to = Math.round(snapped.frame);
    const moved = moveKeys(base, g.refs, to - c.start - g.primary.f, c.duration);
    let next = moved.keys;
    const dv = g.graph ? -dy * G.perPx : 0;
    if (dv) next = setValues(next, moved.refs.filter((r) => r.path === G.lane), (k) => G.info.store(G.info.show(k.v) + dv));
    store.previewGesture((p) => withKeys(p, c.id, next));
    store.set({ keySel: { clipId: c.id, keys: moved.refs } });
    setSnapX(snapped.target !== null && moved.delta === to - c.start - g.primary.f ? snapped.target * z - G.scrollLeft : null);
    const key = next[g.primary.path]?.find((k) => k.f === g.primary.f + moved.delta);
    const pinfo = paramInfo(g.primary.path, c, { width: W, height: H });
    setReadout({ x: e.clientX, y: e.clientY, text: `${formatTimecode(c.start + g.primary.f + moved.delta, fps)}${key ? `  ·  ${formatParam(pinfo, key.v)}` : ""}` });
  };

  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const g = gesture.current;
    gesture.current = null;
    frozen.current = null;
    setBox(null);
    setSnapX(null);
    setReadout(null);
    if (!g) return;
    const G = geo.current;
    if (g.kind === "box") {
      if (g.moved) return;
      // A click on empty space moves the playhead there, as the ruler does.
      store.seek((local(e).x + G.scrollLeft) / G.zoom);
      if (!g.additive) store.set({ keySel: null });
      return;
    }
    if (g.started) store.endGesture(g.kind === "handle" ? "Keyframe curve" : g.refs.length > 1 ? "Move keyframes" : "Move keyframe");
    else if (g.kind === "keys" && g.narrow) selectKeys(G.clip.id, g.narrow);
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const ref = refOf(e.target as Element);
    if (!ref) return;
    const refs = keySel && isSel(ref) ? keySel : [ref];
    selectKeys(clip.id, refs);
    setMenu({ x: e.clientX, y: e.clientY, refs });
  };

  const setEaseFor = (refs: KeyRef[], ease: Ease) =>
    store.edit("Easing", (p) => {
      const c = findClip(p, clip.id)?.clip;
      return c?.keyframes ? withKeys(p, clip.id, setEase(c.keyframes, refs, ease)) : p;
    });

  // ---- drawing ----
  const x0 = Math.max(0, xOf(0));
  const x1 = Math.min(size.w, xOf(clip.duration));
  const curve: string[] = [];
  if (x1 > x0) {
    // Every other pixel across the clip, plus each key exactly (and just
    // before a key that ends a hold, so the step is square).
    const lo = (x0 + scrollLeft) / zoom - clip.start;
    const hi = (x1 + scrollLeft) / zoom - clip.start;
    const fs = new Set<number>([lo, hi]);
    for (let px = x0; px <= x1; px += 2) fs.add((px + scrollLeft) / zoom - clip.start);
    keys.forEach((k, i) => {
      fs.add(k.f);
      if (i > 0 && keys[i - 1].ease === "hold") fs.add(k.f - 1e-6);
    });
    for (const f of [...fs].filter((f) => f >= lo && f <= hi).sort((a, b) => a - b)) {
      curve.push(`${xOf(f).toFixed(1)},${yOf(info.show(interpolate(keys, f))).toFixed(1)}`);
    }
  }
  const curveD = curve.length ? `M${curve.join("L")}` : "";
  const fillD = curve.length ? `${curveD}L${curve.at(-1)!.split(",")[0]},${gTop + gH}L${curve[0].split(",")[0]},${gTop + gH}Z` : "";
  // Fewer lines when the graph is short: in a 720 px window four value
  // labels sat 11 px apart and ran into each other.
  const step = niceStep(range.max - range.min, Math.max(1, Math.min(4, Math.floor((gH - 2 * PAD_Y) / 24))));
  const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: number[] = [];
  for (let v = Math.ceil(range.min / step) * step; v <= range.max; v += step) ticks.push(+v.toFixed(6));
  const unit = info.unit && info.unit !== "%" && info.unit !== "°" ? ` ${info.unit}` : info.unit;

  // Bezier handles on the segments touching a selected key of the graphed lane.
  const handles: { seg: KeyRef; which: "out" | "in"; from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  const pt = (p: { f: number; v: number }) => ({ x: xOf(p.f), y: yOf(info.show(p.v)) });
  keys.forEach((a, i) => {
    const b = keys[i + 1];
    if (!b || !(isSel({ path: lane, f: a.f }) || isSel({ path: lane, f: b.f }))) return;
    const hp = handlePoints(a, b);
    if (!hp) return;
    handles.push({ seg: { path: lane, f: a.f }, which: "out", from: pt(a), to: pt(hp.out) });
    handles.push({ seg: { path: lane, f: a.f }, which: "in", from: pt(b), to: pt(hp.in) });
  });

  const selCount = keySel?.length ?? 0;
  const firstSel = keySel?.[0] && map[keySel[0].path]?.find((k) => k.f === keySel[0].f);
  const diamond = (where: "lane" | "graph", x: number, y: number, ref: KeyRef, tip: string) => (
    <g key={`${where}:${ref.path}@${ref.f}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} data-key={`${ref.path}@${ref.f}`} data-tip={tip} className={`kf-key${isSel(ref) ? " sel" : ""}`}>
      <circle r={8} className="kf-hit" />
      <rect x={-4.5} y={-4.5} width={9} height={9} rx={1.5} className="kf-diamond" />
    </g>
  );
  const tip = (path: string, k: Keyframe) => `${infos[path].label} ${formatParam(infos[path], k.v)} · ${formatTimecode(clip.start + k.f, fps)}`;

  return (
    <>
      <Head headerW={headerW}>
        <ClipName clip={clip} />
        <span className="kf-focus">
          {info.label}
          <PlayheadValue clip={clip} path={lane} info={info} />
        </span>
        {selCount > 0 && (
          <button
            className="kf-ease-btn"
            data-tip="Easing of the selected keyframes"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setEaseBtn({ x: r.left, y: r.bottom + 4, above: r.top - 4 });
            }}
          >
            <EaseCurve value={firstSel?.ease ?? "linear"} w={20} h={12} />
            <span>{presetOf(firstSel?.ease)?.label ?? "Custom"}</span>
            {selCount > 1 && <span className="kf-count num">{selCount}</span>}
            <ChevronDown size={11} />
          </button>
        )}
        <span className="kf-hint">Shift+click adds · drag moves · right-click for easing</span>
      </Head>
      <div className="kf-body">
        <div className="kf-side" style={{ width: headerW }}>
          {paths.map((path, i) => (
            <LaneLabel key={path} clip={clip} path={path} focused={path === lane} top={i * rowH} height={rowH} label={infos[path].label} onFocus={() => setFocus(path)} />
          ))}
          {ticks.map((t) => (
            <span key={t} className="kf-tick num" style={{ top: yOf(t) }}>
              {t.toFixed(digits)}
              {unit}
            </span>
          ))}
        </div>
        <div
          className="kf-area"
          ref={area}
          onPointerDown={onDown}
          onContextMenu={onContext}
          onDoubleClick={(e) => {
            const ref = refOf(e.target as Element);
            if (ref) store.seek(clip.start + ref.f);
          }}
        >
          <svg width={size.w} height={size.h} className="kf-svg">
            {paths.map((path, i) => (
              <rect key={path} className={`kf-lane${path === lane ? " focus" : ""}`} x={0} y={i * rowH} width={size.w} height={rowH - 1} />
            ))}
            <rect className="kf-graph-bg" x={0} y={gTop} width={size.w} height={gH} />
            {x1 > x0 && <rect className="kf-span" x={x0} y={0} width={x1 - x0} height={size.h} />}
            {ticks.map((t) => (
              <line key={t} className="kf-grid" x1={0} x2={size.w} y1={yOf(t)} y2={yOf(t)} />
            ))}
            {fillD && <path className="kf-fill" d={fillD} />}
            {curveD && <path className="kf-curve" d={curveD} />}
            {handles.map((h) => (
              <g key={`${h.seg.f}-${h.which}`} className="kf-handle" data-handle={h.which} data-seg={`${h.seg.path}@${h.seg.f}`} data-tip="Drag to shape the curve">
                <line x1={h.from.x} y1={h.from.y} x2={h.to.x} y2={h.to.y} />
                <circle cx={h.to.x} cy={h.to.y} r={8} className="kf-hit" />
                <circle cx={h.to.x} cy={h.to.y} r={3.5} className="kf-handle-dot" />
              </g>
            ))}
            {paths.flatMap((path, i) => map[path].map((k) => diamond("lane", xOf(k.f), i * rowH + rowH / 2, { path, f: k.f }, tip(path, k))))}
            {keys.map((k) => diamond("graph", xOf(k.f), yOf(info.show(k.v)), { path: lane, f: k.f }, tip(lane, k)))}
            {box && <rect className="kf-box" x={box.x} y={box.y} width={box.w} height={box.h} />}
          </svg>
          {snapX !== null && <div className="kf-snap" style={{ left: snapX }} />}
          <PanelPlayhead zoom={zoom} scrollLeft={scrollLeft} />
        </div>
      </div>
      {readout && (
        <div className="tl-readout num" style={{ left: readout.x + 14, top: readout.y - 30 }}>
          {readout.text}
        </div>
      )}
      {menu && <EaseMenu x={menu.x} y={menu.y} current={map[menu.refs[0].path]?.find((k) => k.f === menu.refs[0].f)?.ease} onPick={(e) => setEaseFor(menu.refs, e)} onClose={() => setMenu(null)} />}
      {easeBtn && keySel && <EaseMenu x={easeBtn.x} y={easeBtn.y} above={easeBtn.above} current={firstSel?.ease} onPick={(e) => setEaseFor(keySel, e)} onClose={() => setEaseBtn(null)} />}
    </>
  );
}

/** A lane's name (click to graph it) and its add/remove-at-playhead diamond. */
function LaneLabel(props: { clip: Clip; path: string; label: string; focused: boolean; top: number; height: number; onFocus: () => void }) {
  const rel = useEditor((s) => relOf(props.clip, s.playhead));
  const on = !!props.clip.keyframes?.[props.path]?.some((k) => k.f === rel);
  return (
    <div className={`kf-lane-label${props.focused ? " focus" : ""}`} style={{ top: props.top, height: props.height }} onClick={props.onFocus}>
      <span className="kf-lane-name">{props.label}</span>
      <button
        className={`key-toggle${on ? " on" : " has"}`}
        aria-label={on ? `Remove ${props.label} keyframe` : `Add ${props.label} keyframe`}
        data-tip={on ? "Remove keyframe" : "Add keyframe at the playhead"}
        onClick={(e) => {
          e.stopPropagation();
          store.edit(on ? "Remove keyframe" : "Add keyframe", (p) => toggleKeyframe(p, props.clip.id, props.path, rel, paramAt(props.clip, props.path, rel)));
        }}
      >
        <Diamond size={12} fill={on ? "currentColor" : "none"} />
      </button>
    </div>
  );
}

function PlayheadValue({ clip, path, info }: { clip: Clip; path: string; info: ParamInfo }) {
  const rel = useEditor((s) => relOf(clip, s.playhead));
  return <b className="num">{formatParam(info, paramAt(clip, path, rel))}</b>;
}

function PanelPlayhead({ zoom, scrollLeft }: { zoom: number; scrollLeft: number }) {
  const f = useEditor((s) => s.playhead);
  return <div className="kf-playhead" style={{ transform: `translateX(${f * zoom - scrollLeft}px)` }} />;
}
