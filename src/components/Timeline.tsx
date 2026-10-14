import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Blend, Eye, EyeOff, Film, Lock, LockOpen, Music, Type, Upload, Volume2, VolumeX } from "../icons";
import { createTrack, uid } from "../lib/project/defaults";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project, Track } from "../lib/project/types";
import { clampZoom, fitZoom, rulerTicks, snapSpan, trackHeight } from "../lib/timeline";
import { formatTimecode, secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { edit, provide, settleOptions } from "../state/actions";
import { addAdjustmentLayer, addTextPreset, applyEffect, applyFilter, applyTemplate, applyTransition } from "../state/apply";
import { registerDropZone, type DragState } from "../state/drag";
import { addToTimeline, importFiles } from "../state/media";
import { addSticker } from "../state/stickers";
import { store, useEditor } from "../state/store";
import { ClipView, type ClipZone } from "./ClipView";
import { KeyframePanel } from "./KeyframePanel";
import { MenuList, type MenuItem } from "./Menu";
import { TimelineToolbar } from "./TimelineToolbar";
import "./timeline.css";

const HEADER_W = 112;
const RULER_H = 28;
const ROW_GAP = 4;
const SNAP_PX = 10;

interface Row {
  track: Track;
  top: number;
  height: number;
}

type Gesture =
  | {
      kind: "move";
      primary: Id;
      ids: Id[];
      x0: number;
      y0: number;
      started: boolean;
      origin: Map<Id, { row: number; start: number; duration: number }>;
      newTrack: Track | null;
      /** Alt-drag: copies land at the drop spot, originals stay put. */
      dupIds: Map<Id, Id> | null;
    }
  | { kind: "trim"; id: Id; edge: "start" | "end"; started: boolean; x0: number; mode: "trim" | "ripple" | "roll" }
  | { kind: "slip"; id: Id; started: boolean; x0: number; y0: number }
  | { kind: "slide"; id: Id; started: boolean; x0: number; y0: number }
  | { kind: "scrub" }
  | { kind: "marquee"; x0: number; y0: number; additive: boolean; base: Id[] };

function layoutRows(p: Project): { rows: Row[]; height: number } {
  let y = 0;
  const rows = p.tracks.map((track) => {
    const h = trackHeight(track);
    const r = { track, top: y, height: h };
    y += h + ROW_GAP;
    return r;
  });
  return { rows, height: y };
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const previewAxis = useEditor((s) => s.previewAxis);
  const keyframePanel = useEditor((s) => s.keyframePanel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [drop, setDrop] = useState<{ frame: number; row: number; label: string; clipId?: Id; width: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [osDrop, setOsDrop] = useState(false);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);

  const { rows, height: rowsH } = useMemo(() => layoutRows(project), [project]);
  const duration = ops.projectDuration(project);
  const fpsN = project.fps.num / project.fps.den;
  const contentW = Math.max(view.width, HEADER_W + (duration + fpsN * 30) * zoom);
  const selected = useMemo(() => new Set(selection), [selection]);
  const assets = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);
  const empty = duration === 0;

  // ---- coordinates -----------------------------------------------------------------
  const frameAtX = useCallback(
    (clientX: number) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      return (clientX - r.left + el.scrollLeft - HEADER_W) / store.get().zoom;
    },
    [],
  );
  const rowAtY = useCallback(
    (clientY: number, list: Row[]) => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      const y = clientY - r.top + el.scrollTop - RULER_H;
      if (y < 0) return -1;
      const i = list.findIndex((row) => y >= row.top && y < row.top + row.height + ROW_GAP);
      return i < 0 ? list.length : i;
    },
    [],
  );

  // ---- view tracking ------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Ctrl+wheel zooms around the cursor; Alt/Shift+wheel scrolls sideways.
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const f = frameAtX(e.clientX);
        const z0 = store.get().zoom;
        const z = clampZoom(z0 * Math.exp(-e.deltaY * 0.0015));
        store.set({ zoom: z });
        requestAnimationFrame(() => {
          const r = el.getBoundingClientRect();
          el.scrollLeft = HEADER_W + f * z - (e.clientX - r.left);
        });
      } else if (e.altKey || e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY || e.deltaX;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frameAtX]);

  // Zoom to fit, and keep the playhead in view while playing (page-flip, as CapCut does).
  useEffect(() => {
    provide({
      zoomFit: () => {
        const el = scrollRef.current;
        if (!el) return;
        const p = store.get().project;
        store.set({ zoom: fitZoom(ops.projectDuration(p), el.clientWidth - HEADER_W, p.fps) });
        el.scrollLeft = 0;
      },
    });
    return store.subscribe(() => {
      const s = store.get();
      const el = scrollRef.current;
      if (!el || !s.playing) return;
      const x = HEADER_W + s.playhead * s.zoom;
      if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER_W) el.scrollLeft = x - HEADER_W - 40;
    });
  }, []);

  // ---- gestures ---------------------------------------------------------------------------
  const snapTargets = (exclude: Set<Id>) => {
    const s = store.get();
    if (!s.snapping) return [];
    const pts = ops.editPoints(s.project, exclude);
    pts.push(s.playhead);
    return pts.sort((a, b) => a - b);
  };

  const onClipDown = useCallback(
    (e: React.PointerEvent, clip: Clip, zone: ClipZone) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const s = store.get();
      const loc = ops.findClip(s.project, clip.id);
      if (!loc || loc.track.locked) return;
      if (s.tool === "blade" && zone === "body") {
        let f = Math.round(frameAtX(e.clientX));
        if (Math.abs(f - s.playhead) * s.zoom < SNAP_PX) f = s.playhead;
        edit("Split", (p) => ops.splitClip(p, clip.id, f));
        return;
      }
      let sel = s.selection;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        sel = sel.includes(clip.id) ? sel.filter((x) => x !== clip.id) : [...sel, clip.id];
      } else if (!sel.includes(clip.id)) sel = [clip.id];
      store.select(sel);
      if (zone === "body" && (s.tool === "slip" || s.tool === "slide")) {
        gesture.current = { kind: s.tool, id: clip.id, started: false, x0: e.clientX, y0: e.clientY };
      } else if (zone !== "body") {
        const mode = s.tool === "ripple" ? "ripple" : s.tool === "roll" ? "roll" : "trim";
        gesture.current = { kind: "trim", id: clip.id, edge: zone, started: false, x0: e.clientX, mode };
      } else {
        const { rows: rs } = layoutRows(s.project);
        const origin = new Map<Id, { row: number; start: number; duration: number }>();
        for (const id of sel.includes(clip.id) ? sel : [clip.id]) {
          const l = ops.findClip(s.project, id);
          if (l && !l.track.locked) origin.set(id, { row: rs.findIndex((r) => r.track.id === l.track.id), start: l.clip.start, duration: l.clip.duration });
        }
        gesture.current = {
          kind: "move",
          primary: clip.id,
          ids: [...origin.keys()],
          x0: e.clientX,
          y0: e.clientY,
          started: false,
          origin,
          newTrack: null,
          dupIds: e.altKey ? new Map([...origin.keys()].map((id) => [id, uid("c")])) : null,
        };
      }
      attachWindowListeners();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frameAtX],
  );

  const onMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const s = store.get();
    if (g.kind === "scrub") {
      store.seek(frameAtX(e.clientX));
      return;
    }
    if (g.kind === "marquee") {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      const x1 = e.clientX - r.left + el.scrollLeft;
      const y1 = e.clientY - r.top + el.scrollTop;
      const box = { x: Math.min(g.x0, x1), y: Math.min(g.y0, y1), w: Math.abs(x1 - g.x0), h: Math.abs(y1 - g.y0) };
      setMarquee(box);
      const f0 = (box.x - HEADER_W) / s.zoom;
      const f1 = (box.x + box.w - HEADER_W) / s.zoom;
      const { rows: rs } = layoutRows(s.project);
      const hit = rs.flatMap((row) => {
        const top = row.top + RULER_H;
        if (top + row.height < box.y || top > box.y + box.h) return [];
        return row.track.clips.filter((c) => c.start < f1 && c.start + c.duration > f0).map((c) => c.id);
      });
      store.select(g.additive ? [...new Set([...g.base, ...hit])] : hit);
      return;
    }
    if (!g.started) {
      if (Math.abs(e.clientX - g.x0) < 3 && (g.kind === "trim" || Math.abs(e.clientY - g.y0) < 3)) return;
      g.started = true;
      store.beginGesture();
    }
    const opts = settleOptions();
    if (g.kind === "slip" || g.kind === "slide") {
      const d = Math.round((e.clientX - g.x0) / s.zoom);
      // Premiere's slip: dragging right reveals earlier source (the source
      // slides right under the clip's fixed window).
      store.previewGesture((base) => ops.settle(base, g.kind === "slip" ? ops.slipClip(base, g.id, -d) : ops.slideClip(base, g.id, d), opts));
      const c = ops.findClip(store.get().project, g.id)?.clip;
      if (c) {
        const fps = s.project.fps;
        const text =
          g.kind === "slip" && "in" in c
            ? `In ${formatTimecode(secondsToFrames(ops.sourceRange(c, fps)[0], fps), fps)}  ·  Out ${formatTimecode(secondsToFrames(ops.sourceRange(c, fps)[1], fps), fps)}`
            : `${d >= 0 ? "+" : ""}${d} frames`;
        setReadout({ x: e.clientX, y: e.clientY, text });
      }
      return;
    }
    if (g.kind === "trim") {
      const loc = ops.findClip(s.project, g.id);
      if (!loc) return;
      let f = Math.round(frameAtX(e.clientX));
      const snapped = snapSpan(f, [0], snapTargets(new Set([g.id])), SNAP_PX / s.zoom);
      f = Math.round(snapped.frame);
      setSnapLine(snapped.target);
      const ripple = g.mode === "ripple" || (opts.magnet && !!loc.track.main);
      // Roll moves the shared cut with the neighbor on that side, if they touch.
      const nb = g.edge === "end" ? loc.track.clips[loc.clipIndex + 1] : loc.track.clips[loc.clipIndex - 1];
      const touching = !!nb && (g.edge === "end" ? nb.start === loc.clip.start + loc.clip.duration : nb.start + nb.duration === loc.clip.start);
      store.previewGesture((base) =>
        ops.settle(
          base,
          g.mode === "roll" && touching
            ? g.edge === "end"
              ? ops.rollEdit(base, g.id, nb.id, f)
              : ops.rollEdit(base, nb.id, g.id, f)
            : ops.trimClip(base, g.id, g.edge, f, ripple),
          opts,
        ),
      );
      const c = ops.findClip(store.get().project, g.id)?.clip;
      if (c) setReadout({ x: e.clientX, y: e.clientY, text: g.mode === "roll" && touching ? `Cut ${formatTimecode(f, s.project.fps)}` : `Duration ${formatTimecode(c.duration, s.project.fps)}` });
      return;
    }
    // move
    const o = g.origin.get(g.primary)!;
    let delta = Math.round((e.clientX - g.x0) / s.zoom);
    const snapped = snapSpan(o.start + delta, [0, o.duration], snapTargets(new Set(g.ids)), SNAP_PX / s.zoom);
    delta = Math.round(snapped.frame) - o.start;
    setSnapLine(snapped.target);
    const { rows: rs } = layoutRows(s.project);
    const hoverRow = rowAtY(e.clientY, rs);
    const rowDelta = hoverRow < 0 ? -o.row - 1 : hoverRow - o.row;
    const primaryKind = rs[o.row]?.track.kind;
    if (hoverRow < 0 && primaryKind === "video" && !g.newTrack) g.newTrack = createTrack("video", "Overlay");
    store.previewGesture((base) => {
      let p = base;
      const { rows: baseRows } = layoutRows(base);
      if (hoverRow < 0 && g.newTrack) p = ops.addTrack(p, g.newTrack, 0);
      for (const id of g.ids) {
        const og = g.origin.get(id)!;
        const from = baseRows[og.row]?.track;
        if (!from) continue;
        let to = from;
        if (hoverRow < 0 && g.newTrack && from.kind === "video") to = g.newTrack;
        else {
          const cand = baseRows[og.row + rowDelta]?.track;
          if (cand && cand.kind === from.kind && !cand.locked) to = cand;
        }
        const dup = g.dupIds?.get(id);
        if (dup) {
          const loc = ops.findClip(base, id);
          if (loc) p = ops.placeClip(p, to.id, { ...loc.clip, id: dup, start: og.start + delta } as Clip, { magnet: opts.magnet, collision: "newTrack" });
        } else p = ops.moveClip(p, id, to.id, og.start + delta, { magnet: opts.magnet, collision: "newTrack" });
      }
      return ops.settle(base, ops.pruneEmptyTracks(p), opts);
    });
  };

  const onUp = () => {
    const g = gesture.current;
    gesture.current = null;
    detachWindowListeners();
    setSnapLine(null);
    setMarquee(null);
    setReadout(null);
    if (!g || g.kind === "scrub" || g.kind === "marquee") return;
    if (!g.started) return;
    const label =
      g.kind === "trim"
        ? g.mode === "roll" ? "Roll edit" : g.mode === "ripple" ? "Ripple trim" : "Trim"
        : g.kind === "slip" ? "Slip" : g.kind === "slide" ? "Slide" : g.dupIds ? "Duplicate" : "Move";
    store.endGesture(label);
    if (g.kind === "move" && g.dupIds) store.select([...g.dupIds.values()]);
  };

  const listeners = useRef({ move: (e: PointerEvent) => onMove(e), up: () => onUp() });
  listeners.current.move = onMove;
  listeners.current.up = onUp;
  const winMove = useRef((e: PointerEvent) => listeners.current.move(e)).current;
  const winUp = useRef(() => listeners.current.up()).current;
  const attachWindowListeners = () => {
    window.addEventListener("pointermove", winMove);
    window.addEventListener("pointerup", winUp);
  };
  const detachWindowListeners = () => {
    window.removeEventListener("pointermove", winMove);
    window.removeEventListener("pointerup", winUp);
  };

  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    store.seek(frameAtX(e.clientX));
    gesture.current = { kind: "scrub" };
    attachWindowListeners();
  };

  const onLanesDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const s = store.get();
    if (!(e.shiftKey || e.ctrlKey)) store.select([]);
    // A click (no drag) on empty timeline also moves the playhead there.
    store.seek(frameAtX(e.clientX));
    gesture.current = {
      kind: "marquee",
      x0: e.clientX - r.left + el.scrollLeft,
      y0: e.clientY - r.top + el.scrollTop,
      additive: e.shiftKey || e.ctrlKey,
      base: s.selection,
    };
    attachWindowListeners();
  };

  const onHover = (e: React.PointerEvent) => {
    if (!store.get().previewAxis || gesture.current) return;
    const f = Math.max(0, Math.round(frameAtX(e.clientX)));
    if (store.get().hoverFrame !== f) store.set({ hoverFrame: f });
  };

  // ---- library and OS drops ------------------------------------------------------------
  useEffect(
    () =>
      registerDropZone({
        contains: (x, y) => {
          const r = scrollRef.current?.getBoundingClientRect();
          return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        },
        hover: (d: DragState | null) => {
          if (!d) return setDrop(null);
          const s = store.get();
          const { rows: rs } = layoutRows(s.project);
          const frame = Math.max(0, Math.round(frameAtX(d.x)));
          const row = rowAtY(d.y, rs);
          const track = rs[row]?.track;
          const clip = track?.clips.find((c) => c.start <= frame && frame < c.start + c.duration);
          const p = d.payload;
          const width = p.kind === "asset" ? Math.max(1, (p.asset.kind === "image" ? 5 : p.asset.duration) * fpsN) : 3 * fpsN;
          setDrop({ frame, row, label: p.kind === "asset" ? p.asset.name : p.label, clipId: clip?.id, width });
        },
        drop: (d: DragState) => {
          const s = store.get();
          const { rows: rs } = layoutRows(s.project);
          const frame = Math.max(0, Math.round(frameAtX(d.x)));
          const row = rowAtY(d.y, rs);
          const track = rs[row]?.track;
          const clip = track?.clips.find((c) => c.start <= frame && frame < c.start + c.duration);
          const p = d.payload;
          if (p.kind === "asset") {
            const fits = track && (track.kind === "audio") === (p.asset.kind === "audio") && !track.locked;
            addToTimeline(p.asset, frame, fits ? track.id : undefined);
          } else if (p.kind === "text") addTextPreset(p.preset, frame);
          else if (p.kind === "sticker") void addSticker(p.id, frame);
          else if (p.kind === "template") applyTemplate(p.id, frame, clip?.type === "text" ? clip.id : undefined);
          else if (p.kind === "effect") applyEffect(p.type, clip && clip.type !== "audio" ? clip.id : undefined, frame);
          else if (p.kind === "filter") applyFilter(p.type, clip && clip.type !== "audio" ? clip.id : undefined, frame);
          else if (p.kind === "adjustment") addAdjustmentLayer(frame);
          else if (p.kind === "transition") {
            const t = track ?? ops.mainTrack(s.project);
            const cut = t.clips
              .filter((c, i) => t.clips[i + 1]?.start === c.start + c.duration)
              .sort((a, b) => Math.abs(a.start + a.duration - frame) - Math.abs(b.start + b.duration - frame))[0];
            applyTransition(p.type, cut?.id);
          }
          return true;
        },
      }),
    [frameAtX, rowAtY, fpsN],
  );

  const onOsDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    // The timeline places what it imports; keep the window-level drop
    // (library-only import) from importing it a second time.
    e.stopPropagation();
    setOsDrop(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    let frame = Math.max(0, Math.round(frameAtX(e.clientX)));
    const assets = await importFiles(await platform.adoptFiles(files));
    for (const a of assets) {
      addToTimeline(a, frame);
      frame += Math.round((a.kind === "image" ? 5 : a.duration) * fpsN);
    }
  };

  // ---- context menu ------------------------------------------------------------------------
  const onContext = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    if (!store.get().selection.includes(clip.id)) store.select([clip.id]);
    const items: MenuItem[] = [
      { action: "cut" },
      { action: "copy" },
      { action: "paste" },
      { action: "duplicate" },
      { action: "delete" },
      "-",
      { action: "split" },
      { action: "freeze", disabled: clip.type !== "video" },
      { action: "detachAudio", disabled: clip.type !== "video" },
      { action: "toggleClipEnabled", label: clip.disabled ? "Activate clip" : "Deactivate clip" },
      "-",
      { action: "toggleKeyframePanel", label: "Show keyframe animation", checked: store.get().keyframePanel },
      { action: "rangeToClip" },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // Capture, so Escape closes the menu instead of deselecting the clip.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc, true);
    };
  }, [menu]);

  // ---- render --------------------------------------------------------------------------------
  const visFrom = view.left - HEADER_W - 200;
  const visTo = view.left + view.width + 200;
  const playheadRel = (c: Clip, f: number) => (f >= c.start && f < c.start + c.duration ? f - c.start : null);
  const playhead = useEditor((s) => s.playhead);

  return (
    <section className="panel timeline-panel" aria-label="Timeline">
      <TimelineToolbar />
      <div
        className={`tl-scroll tool-${tool}${tool === "blade" ? " blade" : ""}${osDrop ? " os-drop" : ""}`}
        ref={scrollRef}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) {
            e.preventDefault();
            setOsDrop(true);
          }
        }}
        onDragLeave={() => setOsDrop(false)}
        onDrop={onOsDrop}
        onPointerMove={onHover}
        onPointerLeave={() => previewAxis && store.set({ hoverFrame: null })}
      >
        <div className="tl-content" style={{ width: contentW, height: RULER_H + rowsH + 40 }}>
          <Ruler zoom={zoom} left={view.left} width={view.width} onDown={onRulerDown} />
          <div className="tl-corner" />
          <div className="tl-rows" style={{ top: RULER_H }} onPointerDown={onLanesDown}>
            {rows.map((row) => (
              <div key={row.track.id} className={`tl-row${row.track.main ? " main" : ""}`} style={{ top: row.top, height: row.height }}>
                <div className="tl-lane" style={{ left: HEADER_W }}>
                  {row.track.clips.map((c) => {
                    const left = HEADER_W + c.start * zoom;
                    const right = left + c.duration * zoom;
                    if (right < visFrom + HEADER_W || left > visTo) return null;
                    return (
                      <ClipView
                        key={c.id}
                        clip={c}
                        track={row.track}
                        asset={"assetId" in c ? assets.get(c.assetId) : undefined}
                        fps={project.fps}
                        zoom={zoom}
                        height={row.height}
                        selected={selected.has(c.id)}
                        visFrom={view.left - left}
                        visTo={view.left + view.width - left}
                        playheadRel={selected.has(c.id) ? playheadRel(c, playhead) : null}
                        onDown={onClipDown}
                        onContext={onContext}
                      />
                    );
                  })}
                  {row.track.clips.map((c, i) => {
                    const tr = "transitionOut" in c ? c.transitionOut : undefined;
                    const next = row.track.clips[i + 1];
                    if (!tr || !next || next.start !== c.start + c.duration) return null;
                    const w = Math.max(18, tr.duration * zoom);
                    return (
                      <button
                        key={`tr-${c.id}`}
                        className="tl-transition"
                        style={{ left: (c.start + c.duration) * zoom - w / 2, width: w, height: Math.min(22, row.height - 8), top: (row.height - Math.min(22, row.height - 8)) / 2 }}
                        data-tip="Transition: select the clip before it to edit"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          store.select([c.id]);
                        }}
                      >
                        <Blend size={12} />
                      </button>
                    );
                  })}
                </div>
                <TrackHeader track={row.track} />
              </div>
            ))}
            {empty && (
              <div
                className="tl-empty"
                style={{ left: view.left + HEADER_W + 8, width: view.width - HEADER_W - 16, top: rows.find((r) => r.track.main)?.top ?? 0, height: 70 }}
              >
                <Upload size={16} />
                <span>Drag media here to start creating</span>
              </div>
            )}
            {drop && (
              <div
                className={`tl-drop${drop.clipId ? " on-clip" : ""}`}
                style={{
                  left: HEADER_W + drop.frame * zoom,
                  width: Math.max(40, drop.width * zoom),
                  top: drop.row < 0 ? -6 : rows[drop.row]?.top ?? rowsH,
                  height: drop.row < 0 ? 4 : rows[drop.row]?.height ?? 40,
                }}
              >
                <span>{drop.label}</span>
              </div>
            )}
          </div>
          <MarkersLayer zoom={zoom} />
          <InOutRange zoom={zoom} />
          {snapLine !== null && <div className="tl-snap" style={{ left: HEADER_W + snapLine * zoom, height: RULER_H + rowsH }} />}
          <PreviewAxis zoom={zoom} height={RULER_H + rowsH} />
          <Playhead zoom={zoom} height={RULER_H + rowsH} />
          {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
      {keyframePanel && <KeyframePanel headerW={HEADER_W} scrollLeft={view.left} scrollEl={scrollRef} />}
      {readout && (
        <div className="tl-readout num" style={{ left: readout.x + 14, top: readout.y - 30 }}>
          {readout.text}
        </div>
      )}
      {menu && (
        <div className="ctx-anchor" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          <MenuList items={menu.items} onDone={() => setMenu(null)} style={{ top: 0 }} />
        </div>
      )}
    </section>
  );
}

// ---- pieces -----------------------------------------------------------------------------------

function TrackHeader({ track }: { track: Track }) {
  const kindIcon =
    track.kind === "audio" ? <Music size={13} /> : track.clips.length && track.clips.every((c) => c.type === "text") ? <Type size={13} /> : <Film size={13} />;
  const set = (patch: Partial<Track>, label: string) => store.edit(label, (p) => ops.updateTrack(p, track.id, patch));
  return (
    <div className="tl-header" style={{ width: HEADER_W }}>
      <span className="tl-kind" data-tip={track.main ? "Main track" : track.name}>
        {kindIcon}
        {track.main && <span className="tl-main-chip">Main</span>}
      </span>
      <div className="tl-toggles">
        <button className={`tl-tog${track.locked ? " on" : ""}`} aria-label={track.locked ? "Unlock track" : "Lock track"} data-tip={track.locked ? "Unlock" : "Lock"} onClick={() => set({ locked: !track.locked }, track.locked ? "Unlock track" : "Lock track")}>
          {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
        {track.kind === "video" && (
          <button className={`tl-tog${track.hidden ? " on" : ""}`} aria-label={track.hidden ? "Show track" : "Hide track"} data-tip={track.hidden ? "Show" : "Hide"} onClick={() => set({ hidden: !track.hidden }, track.hidden ? "Show track" : "Hide track")}>
            {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {(track.kind === "audio" || track.clips.some((c) => c.type === "video")) && (
          <button className={`tl-tog${track.muted ? " on" : ""}`} aria-label={track.muted ? "Unmute track" : "Mute track"} data-tip={track.muted ? "Unmute" : "Mute"} onClick={() => set({ muted: !track.muted }, track.muted ? "Unmute track" : "Mute track")}>
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        )}
      </div>
    </div>
  );
}

function Ruler({ zoom, left, width, onDown }: { zoom: number; left: number; width: number; onDown: (e: React.PointerEvent) => void }) {
  const fps = useEditor((s) => s.project.fps);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, width - HEADER_W);
    cv.width = Math.ceil(w * dpr);
    cv.height = Math.ceil(RULER_H * dpr);
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, RULER_H);
    const from = Math.max(0, left / zoom);
    const to = (left + w) / zoom + 1;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "top";
    for (const t of rulerTicks(from, to, zoom, fps)) {
      const x = Math.round(t.frame * zoom - left) + 0.5;
      ctx.fillStyle = t.major ? "#6e6e6e" : "#444";
      ctx.fillRect(x, t.major ? RULER_H - 12 : RULER_H - 6, 1, t.major ? 12 : 6);
      if (t.label) {
        ctx.fillStyle = "#8a8a8a";
        ctx.fillText(t.label, x + 4, 6);
      }
    }
  }, [zoom, left, width, fps]);
  return (
    // Sticky on both axes: it stays pinned while the content scrolls under it,
    // and draws the frames currently in view.
    <div className="tl-ruler" style={{ height: RULER_H, left: HEADER_W, width: Math.max(1, width - HEADER_W) }} onPointerDown={onDown}>
      <canvas ref={ref} style={{ width: "100%", height: RULER_H }} />
    </div>
  );
}

function Playhead({ zoom, height }: { zoom: number; height: number }) {
  const f = useEditor((s) => s.playhead);
  return (
    <div className="tl-playhead" style={{ transform: `translateX(${HEADER_W + f * zoom}px)`, height }}>
      <div className="tl-playhead-cap" />
    </div>
  );
}

function PreviewAxis({ zoom, height }: { zoom: number; height: number }) {
  const f = useEditor((s) => s.hoverFrame);
  if (f === null) return null;
  return <div className="tl-axis" style={{ transform: `translateX(${HEADER_W + f * zoom}px)`, height }} />;
}

function MarkersLayer({ zoom }: { zoom: number }) {
  const markers = useEditor((s) => s.project.markers);
  return (
    <>
      {markers.map((m) => (
        <button
          key={m.id}
          className="tl-marker"
          style={{ left: HEADER_W + m.frame * zoom - 5, borderTopColor: m.color }}
          data-tip={m.label || "Marker (right-click to delete)"}
          onPointerDown={(e) => {
            e.stopPropagation();
            store.seek(m.frame);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            store.edit("Delete marker", (p) => ops.removeMarker(p, m.id));
          }}
        />
      ))}
    </>
  );
}

function InOutRange({ zoom }: { zoom: number }) {
  const i = useEditor((s) => s.inPoint);
  const o = useEditor((s) => s.outPoint);
  if (i === null && o === null) return null;
  const a = i ?? 0;
  const b = o ?? a;
  if (b <= a) return null;
  return <div className="tl-range" style={{ left: HEADER_W + a * zoom, width: (b - a) * zoom }} />;
}
