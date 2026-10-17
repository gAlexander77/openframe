import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { player } from "../engine/player";
import { Blend, Eye, EyeOff, Film, Lock, LockOpen, Music, Type, Upload, Volume2, VolumeX } from "../icons";
import { landing, placeAsset, transitionCut, visualDrop, type Landing } from "../lib/drop";
import { placeOnTop } from "../lib/overlays";
import { createAdjustmentClip, createTrack, uid } from "../lib/project/defaults";
import { closeAllGaps, closeGap, gapAt } from "../lib/project/gaps";
import * as ops from "../lib/project/ops";
import type { Clip, Id, Project, Track } from "../lib/project/types";
import { STICKER_SECONDS } from "../lib/stickers";
import { addTemplate, TEXT_TEMPLATES } from "../lib/templates";
import { clampZoom, fitZoom, rulerTicks, snapSpan, trackHeight } from "../lib/timeline";
import { formatTimecode, secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { canPaste, edit, provide, settleOptions } from "../state/actions";
import {
  addAdjustmentLayer,
  addTextPreset,
  applyEffect,
  applyFilter,
  applyTemplate,
  applyTransition,
  LAYER_SECONDS,
  placeTextPreset,
  TRANSITION_SECONDS,
} from "../state/apply";
import { registerDropZone, useDragging, type DragPayload, type DragState } from "../state/drag";
import { addToTimeline, importFiles, pickAndImport } from "../state/media";
import { replaceClip } from "../lib/project/replace";
import { toast } from "../state/toast";
import { addSticker } from "../state/stickers";
import { store, useEditor } from "../state/store";
import { openMarkers } from "../state/markers";
import { projectWork } from "../state/projectWork";
import { ClipView, type ClipZone } from "./ClipView";
import { KeyframePanel } from "./KeyframePanel";
import { MenuList, type MenuItem } from "./Menu";
import { TimelineToolbar } from "./TimelineToolbar";
import "./timeline.css";

// Wide enough for the Main chip plus lock, eye and speaker side by side: at
// 112 px the main track's speaker was cut off at the column edge.
const HEADER_W = 136;
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

/** CapCut's Replace clip: pick a file, import it, swap it in. */
async function replaceFromPicker(id: Id) {
  const [asset] = await pickAndImport();
  if (!asset) return;
  try {
    edit("Replace clip", (p) => replaceClip(p, id, asset));
  } catch (e) {
    toast((e as Error).message, "error");
  }
}

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

/** What the timeline draws for a library drag over it. */
interface DropView extends Landing {
  label: string;
  /** An insert at a cut on the magnetic main track: a bar marks the cut. */
  insert: boolean;
  /** It goes onto something already there: a clip (an effect, a filter,
   * word art on text) or a cut (a transition). */
  attach: boolean;
}

/**
 * A library item dropped on row `row` at `frame`: what the preview draws
 * and what the drop does. The preview is a dry run of the same placement
 * the drop commits (src/lib/drop.ts), so the item lands where the preview
 * shows, neighbors included (UX-12, UX-13).
 */
function planDrop(payload: DragPayload, row: number, frame: number): { view: DropView | null; run: () => void } {
  const s = store.get();
  const p = s.project;
  const tracks = p.tracks;
  const label = payload.kind === "asset" ? payload.asset.name : payload.label;
  const none = new Map<Id, number>();
  const show = (l: Landing | null, insert = false): DropView | null => (l ? { ...l, label, insert, attach: false } : null);
  const under = tracks[row]?.clips.find((c) => c.start <= frame && frame < c.start + c.duration);
  const onto = (c: Clip): DropView => ({ row, newTrack: false, frame: c.start, duration: c.duration, shifts: none, label, insert: false, attach: true });
  // Effect, filter and adjustment layers go on a new top track.
  const layer: DropView = { row: 0, newTrack: true, frame, duration: secondsToFrames(LAYER_SECONDS, p.fps), shifts: none, label, insert: false, attach: false };
  switch (payload.kind) {
    case "asset": {
      const a = payload.asset;
      let at = frame;
      let to: Id | "overlay" | undefined;
      let insert = false;
      if (a.kind === "audio") {
        const t = tracks[row];
        to = t?.kind === "audio" && !t.locked ? t.id : undefined;
      } else {
        const v = visualDrop(tracks, row, frame, s.magnet);
        ({ frame: at, insert } = v);
        to = v.row < 0 ? "overlay" : tracks[v.row].id;
      }
      // addToTimeline commits placeAsset through edit(), which settles.
      const r = placeAsset(p, a, at, to, s.magnet);
      return { view: show(landing(p, ops.settle(p, r.project, settleOptions()), r.clipId), insert), run: () => addToTimeline(a, at, to) };
    }
    case "text": {
      const r = placeTextPreset(p, payload.preset, frame);
      return { view: r && show(landing(p, r.project, r.clipId)), run: () => addTextPreset(payload.preset, frame) };
    }
    case "template": {
      const t = TEXT_TEMPLATES[payload.id];
      if (t?.category === "Word art" && under?.type === "text") return { view: onto(under), run: () => applyTemplate(payload.id, frame, under.id) };
      const r = t && addTemplate(p, t, frame);
      return { view: r ? show(landing(p, r.project, r.clipIds[0])) : null, run: () => applyTemplate(payload.id, frame) };
    }
    case "sticker": {
      // Its clip waits on the sticker's rendered image; a stand-in with the
      // same span lands where addStickerClip will put it.
      const c = createAdjustmentClip(frame, secondsToFrames(STICKER_SECONDS, p.fps));
      return { view: show(landing(p, placeOnTop(p, c, "Sticker"), c.id)), run: () => void addSticker(payload.id, frame) };
    }
    case "effect":
    case "filter": {
      const target = under && under.type !== "audio" ? under : undefined;
      const apply = payload.kind === "effect" ? applyEffect : applyFilter;
      return { view: target ? onto(target) : layer, run: () => apply(payload.type, target?.id, frame) };
    }
    case "adjustment":
      return { view: layer, run: () => addAdjustmentLayer(frame) };
    case "transition": {
      const cut = transitionCut(tracks, row, frame);
      const d = secondsToFrames(TRANSITION_SECONDS, p.fps);
      const view = cut && { row: cut.row, newTrack: false, frame: cut.frame - Math.round(d / 2), duration: d, shifts: none, label, insert: false, attach: true };
      return { view, run: () => applyTransition(payload.type, cut?.clipId, true) };
    }
  }
}

/** Equal previews draw the same; skip the re-render on every pointer move. */
const viewKey = (v: DropView | null) => (v ? `${v.row}|${v.newTrack}|${v.frame}|${v.duration}|${v.insert}|${v.attach}|${v.label}|${[...v.shifts].join()}` : "");

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
  /** The library drop preview (planDrop). */
  const [drop, setDrop] = useState<DropView | null>(null);
  const dropKey = useRef("");
  const dragging = useDragging();
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [osDrop, setOsDrop] = useState(false);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);

  const { rows, height: rowsH } = useMemo(() => layoutRows(project), [project]);
  const duration = ops.projectDuration(project);
  const timelineEnd = project.markers.reduce((end, m) => Math.max(end, m.frame), duration);
  const fpsN = project.fps.num / project.fps.den;
  const contentW = Math.max(view.width, HEADER_W + (timelineEnd + fpsN * 30) * zoom);
  const focusedFrame = useEditor((s) => s.project.markers.find((m) => m.id === s.markerEdit)?.frame);
  // Only when the edited marker changes: zooming later must not jump back to it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || focusedFrame === undefined) return;
    const x = HEADER_W + focusedFrame * store.get().zoom;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 40);
  }, [focusedFrame]);
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
      // Trims swap the viewer for the trim preview; a move keeps playing.
      if (g.kind !== "move") player.pause();
      store.beginGesture();
    }
    const opts = settleOptions();
    if (g.kind === "slip" || g.kind === "slide") {
      const d = Math.round((e.clientX - g.x0) / s.zoom);
      // Premiere's slip: dragging right reveals earlier source (the source
      // slides right under the clip's fixed window).
      store.previewGesture((base) => ops.settle(base, g.kind === "slip" ? ops.slipClip(base, g.id, -d) : ops.slideClip(base, g.id, d), opts));
      store.set({ trimPreview: { kind: g.kind, id: g.id }, hoverFrame: null });
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
      store.set({ trimPreview: { kind: g.mode, id: g.id, edge: g.edge }, hoverFrame: null });
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
    store.set({ trimPreview: null });
    if (!g || g.kind === "scrub" || g.kind === "marquee") return;
    if (!g.started) return;
    const label =
      g.kind === "trim"
        ? g.mode === "roll" ? "Roll edit" : g.mode === "ripple" ? "Ripple trim" : "Trim"
        : g.kind === "slip" ? "Slip" : g.kind === "slide" ? "Slide" : g.dupIds ? "Duplicate" : "Move";
    store.endGesture(label);
    if (g.kind === "move" && g.dupIds) store.select([...g.dupIds.values()]);
  };

  const onCancel = () => {
    const g = gesture.current;
    if (g?.kind === "marquee") store.select(g.base);
    gesture.current = null; detachWindowListeners();
    store.cancelGesture(); setReadout(null); setSnapLine(null); setMarquee(null);
  };
  const listeners = useRef({ move: (e: PointerEvent) => onMove(e), up: () => onUp(), cancel: () => onCancel() });
  listeners.current.move = onMove;
  listeners.current.up = onUp;
  listeners.current.cancel = onCancel;
  const winMove = useRef((e: PointerEvent) => listeners.current.move(e)).current;
  const winUp = useRef(() => listeners.current.up()).current;
  const winCancel = useRef(() => listeners.current.cancel()).current;
  const winKey = useRef((e: KeyboardEvent) => {
    if (e.key === "Escape" && gesture.current) { e.preventDefault(); e.stopImmediatePropagation(); listeners.current.cancel(); }
  }).current;
  const attachWindowListeners = () => {
    window.addEventListener("pointermove", winMove);
    window.addEventListener("pointerup", winUp);
    window.addEventListener("pointercancel", winCancel);
    window.addEventListener("blur", winCancel);
    window.addEventListener("keydown", winKey, true);
  };
  const detachWindowListeners = () => {
    window.removeEventListener("pointermove", winMove);
    window.removeEventListener("pointerup", winUp);
    window.removeEventListener("pointercancel", winCancel);
    window.removeEventListener("blur", winCancel);
    window.removeEventListener("keydown", winKey, true);
  };
  useEffect(() => () => { detachWindowListeners(); if (gesture.current) store.cancelGesture(); }, []);

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
          const view = d ? planDrop(d.payload, rowAtY(d.y, layoutRows(store.get().project).rows), Math.max(0, Math.round(frameAtX(d.x)))).view : null;
          const key = viewKey(view);
          if (key === dropKey.current) return;
          dropKey.current = key;
          setDrop(view);
        },
        drop: (d: DragState) => {
          planDrop(d.payload, rowAtY(d.y, layoutRows(store.get().project).rows), Math.max(0, Math.round(frameAtX(d.x)))).run();
          return true;
        },
      }),
    [frameAtX, rowAtY],
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
    const signal = projectWork.signal();
    const assets = await importFiles(await platform.adoptFiles(files), signal);
    for (const a of assets) {
      addToTimeline(a, frame);
      frame += Math.round((a.kind === "image" ? 5 : a.duration) * fpsN);
    }
  };

  // ---- context menu ------------------------------------------------------------------------
  const onBackgroundContext = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (e.defaultPrevented || target.closest("input, textarea") || target.isContentEditable) return;
    e.preventDefault();
    e.stopPropagation();
    // Track headers and the corner are sticky over the timeline: no frame under them.
    if (target.closest(".tl-header, .tl-corner")) return;
    // Background actions can target empty time beyond the last clip; playback
    // would move the playhead off it before the menu item runs.
    player.pause();
    const frame = Math.max(0, Math.round(frameAtX(e.clientX)));
    store.set({ playhead: frame });
    // On a track's empty stretch: Premiere's ripple delete of the gap.
    const track = layoutRows(store.get().project).rows[rowAtY(e.clientY, layoutRows(store.get().project).rows)]?.track;
    const gap = track && !track.locked ? gapAt(track, frame) : null;
    const gaps = !!track && !track.locked && track.clips.some((c) => gapAt(track, c.start - 1) !== null);
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { action: "paste", disabled: !canPaste() },
      { action: "addMarker" },
      { action: "selectAll" },
      ...(track && (gap || gaps) ? (["-"] as MenuItem[]) : []),
      ...(track && gap ? [{ label: "Close gap", onSelect: () => edit("Close gap", (p) => closeGap(p, track.id, frame)) }] : []),
      ...(track && gaps ? [{ label: "Close all gaps on this track", onSelect: () => edit("Close all gaps", (p) => closeAllGaps(p, track.id)) }] : []),
    ] });
  };

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
      {
        label: "Replace clip…",
        disabled: clip.type !== "video" && clip.type !== "image" && clip.type !== "audio",
        onSelect: () => void replaceFromPicker(clip.id),
      },
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
        className={`tl-scroll tool-${tool}${tool === "blade" ? " blade" : ""}${osDrop ? " os-drop" : ""}${dragging ? " lib-drag" : ""}`}
        ref={scrollRef}
        onContextMenu={onBackgroundContext}
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
          <div className="tl-corner" style={{ width: HEADER_W }} />
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
                        shift={(drop?.shifts.get(c.id) ?? 0) * zoom}
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
                        style={{ left: (c.start + c.duration + (drop?.shifts.get(c.id) ?? 0)) * zoom - w / 2, width: w, height: Math.min(22, row.height - 8), top: (row.height - Math.min(22, row.height - 8)) / 2 }}
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
            {drop && <DropBox drop={drop} rows={rows} rowsH={rowsH} zoom={zoom} />}
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

/** The drop preview: a box where the item lands, sized to it. A new track
 * shows where it will be inserted: above everything, a chip in the ruler
 * band; between two rows, a band in the gap; below everything, a row. */
function DropBox({ drop, rows, rowsH, zoom }: { drop: DropView; rows: Row[]; rowsH: number; zoom: number }) {
  const row = rows[drop.row];
  const [top, height] = !drop.newTrack
    ? [row?.top ?? rowsH, row?.height ?? 40]
    : drop.row === 0
      ? [4 - RULER_H, RULER_H - 8]
      : row
        ? [row.top - ROW_GAP / 2 - 8, 16]
        : [rowsH, 40];
  const left = HEADER_W + drop.frame * zoom;
  return (
    <>
      <div
        className={`tl-drop${drop.attach ? " on-clip" : ""}${drop.insert ? " insert" : ""}${drop.newTrack ? " new-track" : ""}`}
        style={{ left, width: Math.max(2, drop.duration * zoom), top, height }}
      >
        <span>{drop.label}</span>
      </div>
      {drop.insert && row && <div className="tl-insert" style={{ left, top: row.top - 3, height: row.height + 6 }} />}
    </>
  );
}

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
        <button className={`tl-tog tl-tog-lock${track.locked ? " on" : ""}`} aria-label={track.locked ? "Unlock track" : "Lock track"} data-tip={track.locked ? "Unlock" : "Lock"} onClick={() => set({ locked: !track.locked }, track.locked ? "Unlock track" : "Lock track")}>
          {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
        {track.kind === "video" && (
          <button className={`tl-tog tl-tog-eye${track.hidden ? " on" : ""}`} aria-label={track.hidden ? "Show track" : "Hide track"} data-tip={track.hidden ? "Show" : "Hide"} onClick={() => set({ hidden: !track.hidden }, track.hidden ? "Show track" : "Hide track")}>
            {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {(track.kind === "audio" || track.clips.some((c) => c.type === "video")) && (
          <button className={`tl-tog tl-tog-sound${track.muted ? " on" : ""}`} aria-label={track.muted ? "Unmute track" : "Mute track"} data-tip={track.muted ? "Unmute" : "Mute"} onClick={() => set({ muted: !track.muted }, track.muted ? "Unmute track" : "Mute track")}>
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
          aria-label={m.label || "Untitled marker"}
          data-tip={`${m.label || "Marker"} (double-click to edit, right-click to delete)`}
          onPointerDown={(e) => {
            e.stopPropagation();
            store.set({ playhead: m.frame, hoverFrame: null });
          }}
          onClick={() => store.set({ playhead: m.frame, hoverFrame: null })}
          onDoubleClick={(e) => { e.stopPropagation(); openMarkers(m.id); }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
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
