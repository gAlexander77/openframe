import { addSoundEffect } from "../state/sfx";
import { addAmbience } from "../state/ambience";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { player } from "../engine/player";
import { scrubEnd, scrubTo } from "../engine/scrub";
import { Blend, ChevronLeft, ChevronRight, Eye, EyeOff, Film, Image, Sticker, SlidersHorizontal, Square, Captions, Headphones, Layers, Lock, LockOpen, Music, Type, Upload, Volume2, VolumeX } from "../icons";
import { fromDb, toDb } from "../lib/audio";
import { audioJoin, landing, placeAsset, transitionCut, visualDrop, type Landing } from "../lib/drop";
import { placeOnTop } from "../lib/overlays";
import { createAdjustmentClip, createTrack, uid } from "../lib/project/defaults";
import { closeAllGaps, closeGap, gapAt } from "../lib/project/gaps";
import { stretchClip } from "../lib/project/stretch";
import { expandGroups, syncOffsets } from "../lib/project/groups";
import * as ops from "../lib/project/ops";
import type { Clip, ClipLabel, Id, Project, Track } from "../lib/project/types";
import { CLIP_LABELS } from "../lib/catalog";
import { enableToggle } from "../lib/clipEnable";
import { crossfadeJoin, newCrossfade } from "../lib/crossfadeJoin";
import { audioCrossfade } from "../lib/audio";
import { runCommand } from "../lib/commands";
import { STICKER_SECONDS } from "../lib/stickers";
import { addTemplate, TEXT_TEMPLATES } from "../lib/templates";
import { clampZoom, fitZoom, refitTimeline, rulerTicks, snapSpan, trackHeight } from "../lib/timeline";
import { formatTimecode, framesToSeconds, secondsToFrames } from "../lib/time";
import { platform } from "../platform";
import { canPaste, edit, provide, settleOptions } from "../state/actions";
import { addAdjustmentLayer, addColorLayer, addTextPreset, applyEffect, applyFilter, applyTemplate, applyTransition, layerSeconds, placeTextPreset, transitionSeconds } from "../state/apply";
import { registerDropZone, useDragging, type DragPayload, type DragState } from "../state/drag";
import { addToTimeline, importFiles, pickAndImport } from "../state/media";
import { syncAudio } from "../state/ai";
import { replaceClip } from "../lib/project/replace";
import { toast } from "../state/toast";
import { addSticker } from "../state/stickers";
import { renameClip } from "../state/rename";
import { copiedEffects, copyEffects, pasteEffects } from "../state/effects";
import { showInspectorTab } from "./inspector/Inspector";
import { store, useEditor } from "../state/store";
import { openMarkers } from "../state/markers";
import { projectWork } from "../state/projectWork";
import { ClipView, type ClipZone } from "./ClipView";
import { KeyframePanel } from "./KeyframePanel";
import { MenuList, type MenuItem } from "./Menu";
import { rangeGesture } from "./inspector/controls";
import { timelineDisplay, useTimelineDisplay } from "../state/timelineDisplay";
import { Mixer } from "./Mixer";
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
  | { kind: "trim"; id: Id; edge: "start" | "end"; started: boolean; x0: number; mode: "trim" | "ripple" | "roll" | "stretch" }
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
    const choice = timelineDisplay().height;
    const h = trackHeight({ ...track, height: choice === "medium" ? track.height : choice });
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
  const layer: DropView = { row: 0, newTrack: true, frame, duration: secondsToFrames(layerSeconds(), p.fps), shifts: none, label, insert: false, attach: false };
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
    case "color":
      return { view: layer, run: () => addColorLayer(frame) };
    case "sfx":
      // Its file is made on first use; it lands by an audio drop's rules.
      return { view: null, run: () => void addSoundEffect(payload.id, { frame }).catch((e) => toast(e instanceof Error ? e.message : String(e), "error")) };
    case "ambience":
      // Made on first use, from the drop to the end of the timeline.
      return { view: null, run: () => void addAmbience({ name: payload.id, start: framesToSeconds(frame, p.fps) }).catch((e) => toast(e instanceof Error ? e.message : String(e), "error")) };
    case "transition": {
      // On the join of two audio clips it is a crossfade (ADR-111), drawn
      // where the timeline draws one: the seconds before the cut.
      const join = audioJoin(tracks, row, frame);
      if (join) {
        const j = crossfadeJoin(p, join.clipId);
        const d = Math.max(1, secondsToFrames(j && !j.why ? newCrossfade(j, transitionSeconds()) : transitionSeconds(), p.fps));
        const view = { row: join.row, newTrack: false, frame: join.frame - d, duration: d, shifts: none, label: "Crossfade", insert: false, attach: true };
        return {
          view,
          run: () => {
            if (!crossfadeInto(join.clipId, false)) return;
            store.select([join.clipId]);
            showInspectorTab("audio");
          },
        };
      }
      const cut = transitionCut(tracks, row, frame);
      const d = secondsToFrames(transitionSeconds(), p.fps);
      const view = cut && { row: cut.row, newTrack: false, frame: cut.frame - Math.round(d / 2), duration: d, shifts: none, label, insert: false, attach: true };
      return { view, run: () => applyTransition(payload.type, cut?.clipId, true) };
    }
  }
}

/**
 * Crossfade audio clip `clipId` into the next one (ADR-109): the
 * transitions' default length, as far as the join allows; where none
 * fits, say what to change. The clip menu's item toggles it off again; a
 * transition dropped on the join (ADR-111) always sets it. True when the
 * crossfade was set or removed.
 */
function crossfadeInto(clipId: Id, toggle: boolean): boolean {
  const join = crossfadeJoin(store.get().project, clipId);
  if (!join) return false;
  const off = toggle && join.plays > 0;
  if (!off && join.why) {
    toast(join.why, "error");
    return false;
  }
  const seconds = off ? 0 : newCrossfade(join, transitionSeconds());
  try {
    edit(seconds ? "Crossfade" : "Remove crossfade", (p) => runCommand(p, "set_crossfade", { clip_id: clipId, seconds }));
    return true;
  } catch (err) {
    toast((err as Error).message, "error");
    return false;
  }
}

// A list outside the timeline (the Check tab) moved the playhead: the
// timeline scrolls it into view, as it does for a marker.
const revealers = new Set<() => void>();
export function revealPlayhead() {
  revealers.forEach((r) => r());
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
  /** The clip whose name strip is a text field (Rename). */
  const [renaming, setRenaming] = useState<Id | null>(null);
  const onRename = useCallback((c: Clip, name?: string | null) => {
    if (name === undefined) return setRenaming(c.id);
    setRenaming(null);
    if (name !== null) renameClip(c.id, name);
  }, []);
  const [osDrop, setOsDrop] = useState(false);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);

  const display = useTimelineDisplay();
  const { rows, height: rowsH } = useMemo(() => layoutRows(project), [project, display]);
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
  const outOfSync = useMemo(() => syncOffsets(project), [project]);
  const assets = useMemo(() => new Map(project.assets.map((a) => [a.id, a])), [project.assets]);
  const compounds = useMemo(() => new Map((project.compounds ?? []).map((k) => [k.id, k])), [project.compounds]);
  // Into or out of a compound clip: bring the playhead into view, since
  // the frame it lands on can be anywhere on the other timeline. And when
  // a list elsewhere asks (revealPlayhead).
  const depth = useEditor((s) => s.nest.length);
  const showPlayhead = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const s = store.get();
    const x = HEADER_W + s.playhead * s.zoom;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER_W) el.scrollLeft = Math.max(0, x - HEADER_W - 80);
  }, []);
  useLayoutEffect(showPlayhead, [depth]);
  useEffect(() => {
    // After the seek renders: leaving a compound clip changes the width.
    const reveal = () => requestAnimationFrame(showPlayhead);
    revealers.add(reveal);
    return () => void revealers.delete(reveal);
  }, [showPlayhead]);
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
    let previousWidth = el.clientWidth;
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        const width = el.clientWidth;
        if (previousWidth > HEADER_W && width > HEADER_W && width !== previousWidth) {
          const next = refitTimeline(store.get().zoom, el.scrollLeft, previousWidth - HEADER_W, width - HEADER_W);
          store.set({ zoom: next.zoom });
          el.scrollLeft = next.left;
        }
        previousWidth = width;
        update();
      });
    });
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(resizeRaf);
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
      // A grouped clip brings its group; Alt picks it alone (Premiere).
      const picked = e.altKey ? [clip.id] : expandGroups(s.project, [clip.id]);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        sel = sel.includes(clip.id) ? sel.filter((x) => !picked.includes(x)) : [...new Set([...sel, ...picked])];
        // Alt narrows even a selection that holds the clip: it is how one
        // side of a linked pair is taken alone.
      } else if (!sel.includes(clip.id) || e.altKey) sel = picked;
      store.select(sel);
      if (zone === "body" && (s.tool === "slip" || s.tool === "slide")) {
        gesture.current = { kind: s.tool, id: clip.id, started: false, x0: e.clientX, y0: e.clientY };
      } else if (zone !== "body") {
        const mode = s.tool === "ripple" ? "ripple" : s.tool === "roll" ? "roll" : s.tool === "stretch" ? "stretch" : "trim";
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
      scrubTo(store.get().playhead);
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
      const grouped = expandGroups(store.get().project, hit);
      store.select(g.additive ? [...new Set([...g.base, ...grouped])] : grouped);
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
      if (g.mode === "stretch") {
        // Premiere's Rate Stretch: the edge sets the length, the speed follows.
        store.previewGesture((base) => ops.settle(base, stretchClip(base, g.id, g.edge, f), opts));
        const c = ops.findClip(store.get().project, g.id)?.clip;
        if (c && "speed" in c) setReadout({ x: e.clientX, y: e.clientY, text: `Speed ${+c.speed.toFixed(2)}x  ·  Duration ${formatTimecode(c.duration, s.project.fps)}` });
        store.set({ trimPreview: { kind: "trim", id: g.id, edge: g.edge }, hoverFrame: null });
        return;
      }
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
    if (g?.kind === "scrub") scrubEnd();
    if (!g || g.kind === "scrub" || g.kind === "marquee") return;
    if (!g.started) return;
    const label =
      g.kind === "trim"
        ? g.mode === "roll" ? "Roll edit" : g.mode === "ripple" ? "Ripple trim" : g.mode === "stretch" ? "Rate stretch" : "Trim"
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
    scrubTo(store.get().playhead);
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

  // ---- keyboard reach (UX-33) ----------------------------------------------------------
  // One clip is the tab stop: the first selected one, else the first clip of
  // the main track. Arrows move along a track and between tracks.
  const tabStop = useMemo(() => {
    const all = project.tracks.flatMap((t) => t.clips);
    return all.find((c) => selected.has(c.id))?.id ?? (project.tracks.find((t) => t.main)?.clips[0] ?? all[0])?.id;
  }, [project, selected]);
  const focusClip = (id: Id) => {
    store.select([id]);
    const c = ops.findClip(store.get().project, id)?.clip;
    const el = scrollRef.current;
    if (c && el) {
      const x = c.start * store.get().zoom;
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEADER_W - 40) el.scrollLeft = Math.max(0, x - 80);
    }
    // It may only render once scrolled into view.
    requestAnimationFrame(() => el?.querySelector<HTMLElement>(`[data-clip="${id}"]`)?.focus());
  };
  const onClipKey = (e: React.KeyboardEvent) => {
    const id = (e.target as HTMLElement).dataset?.clip;
    if (!id || e.ctrlKey || e.metaKey || e.altKey) return;
    const p = store.get().project;
    const loc = ops.findClip(p, id);
    if (!loc) return;
    if (e.key === "Escape") {
      (e.target as HTMLElement).blur();
      return;
    }
    let next: Clip | undefined;
    const clips = [...loc.track.clips].sort((a, b) => a.start - b.start);
    const i = clips.findIndex((c) => c.id === id);
    if (e.key === "ArrowLeft") next = clips[i - 1];
    else if (e.key === "ArrowRight") next = clips[i + 1];
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const ti = p.tracks.findIndex((t) => t.id === loc.track.id);
      const mid = loc.clip.start + loc.clip.duration / 2;
      for (let t = ti + (e.key === "ArrowUp" ? -1 : 1); t >= 0 && t < p.tracks.length && !next; t += e.key === "ArrowUp" ? -1 : 1) {
        // The clip under the middle of this one, else the nearest.
        next = [...p.tracks[t].clips].sort((a, b) => Math.abs(a.start + a.duration / 2 - mid) - Math.abs(b.start + b.duration / 2 - mid))[0];
      }
    } else return;
    e.preventDefault();
    e.stopPropagation(); // not the frame step or edit jump on the same keys
    if (next) focusClip(next.id);
  };

  const onContext = useCallback((e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    if (!store.get().selection.includes(clip.id)) store.select([clip.id]);
    // CapCut's Sync video and audio: exactly a video and an audio clip.
    const picked = store.get().selection.map((id) => ops.findClip(store.get().project, id)?.clip);
    const syncVideo = picked.length === 2 ? picked.find((c) => c?.type === "video") : undefined;
    const syncSound = picked.length === 2 ? picked.find((c) => c?.type === "audio") : undefined;
    const sync = (muteCamera: boolean) => void syncAudio(syncSound!.id, { videoId: syncVideo!.id, muteCamera }).catch(() => {});
    const lockedTrack = !!ops.findClip(store.get().project, clip.id)?.track.locked;
    const p0 = store.get().project;
    const sel = store.get().selection.map((id) => ops.findClip(p0, id)).filter((l) => !!l);
    // Reverse acts on every selected clip that can play backward
    // (set_reverse's rule), toward the right-clicked clip's opposite.
    const reversible = sel.filter((l) => !l.track.locked && !ops.reverseProblem(l.clip)).map((l) => l.clip.id);
    const reversed = ops.isTimed(clip) && !!clip.reverse;
    const reverse = () => {
      try {
        edit(reversed ? "Play forward" : "Reverse", (p) => reversible.reduce((q, id) => runCommand(q, "set_reverse", { clip_id: id, reverse: !reversed }), p));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    };
    // An audio clip crossfades into the next one where they meet (ADR-109):
    // on with the transitions' default length, as far as the join allows;
    // where none fits, choosing it says what to change.
    const join = clip.type === "audio" ? crossfadeJoin(p0, clip.id) : null;
    const crossfade = () => void crossfadeInto(clip.id, true);
    // Effects go to unlocked clips that carry them, as the inspector's
    // Paste effects does.
    const effectTargets = sel.filter((l) => "effects" in l.clip && !l.track.locked).map((l) => l.clip.id);
    const items: MenuItem[] = [
      { action: "cut" },
      { action: "copy" },
      { action: "paste" },
      { action: "duplicate" },
      { action: "delete" },
      { action: "rippleDelete" },
      "-",
      { action: "split" },
      {
        label: "Speed…",
        disabled: !ops.isTimed(clip),
        onSelect: () => {
          store.select([clip.id]);
          store.set({ transitionEdit: null });
          showInspectorTab("speed");
        },
      },
      { label: "Reverse", checked: reversed, disabled: !reversible.includes(clip.id), onSelect: reverse },
      { action: "freeze", disabled: clip.type !== "video" },
      { action: "detachAudio", disabled: clip.type !== "video" },
      {
        label: "Replace clip…",
        disabled: clip.type !== "video" && clip.type !== "image" && clip.type !== "audio",
        onSelect: () => void replaceFromPicker(clip.id),
      },
      ...(clip.type === "audio" ? ([{ label: "Crossfade into next clip", checked: !!join?.plays, disabled: !join || lockedTrack, onSelect: crossfade }] as MenuItem[]) : []),
      ...(syncVideo && syncSound
        ? ([
            { label: "Sync audio by waveform", onSelect: () => sync(false) },
            { label: "Sync audio and mute camera sound", onSelect: () => sync(true) },
          ] as MenuItem[])
        : []),
      "-",
      { label: "Copy effects", disabled: !("effects" in clip) || !clip.effects.length, onSelect: () => copyEffects(clip.id) },
      { label: "Paste effects", disabled: !copiedEffects()?.effects.length || !effectTargets.length, onSelect: () => pasteEffects(effectTargets) },
      "-",
      { label: "Rename…", disabled: lockedTrack, onSelect: () => setRenaming(clip.id) },
      { action: "groupClips", disabled: store.get().selection.length < 2 },
      { action: "ungroupClips", disabled: !sel.some((l) => l.clip.group) },
      // Named by what it does to the whole selection (ADR-109).
      { action: "toggleClipEnabled", label: enableToggle(sel.map((l) => l.clip)).label },
      { action: "createCompound" },
      ...(clip.type === "compound"
        ? ([{ label: "Open compound clip", onSelect: () => openCompound(clip.id) }, { action: "breakCompound", label: "Break apart" }] as MenuItem[])
        : []),
      "-",
      { action: "toggleKeyframePanel", label: "Show keyframe animation", checked: store.get().keyframePanel },
      { action: "rangeToClip" },
      "-",
      {
        title: "Label",
        current: clip.labelColor ?? null,
        swatches: [{ value: null, label: "No label" }, ...Object.entries(CLIP_LABELS).map(([value, l]) => ({ value, label: l.label, color: l.color }))],
        onPick: (v) => {
          const ids = store.get().selection;
          edit(v ? `Label ${CLIP_LABELS[v as ClipLabel].label.toLowerCase()}` : "Remove label", (p) => runCommand(p, "set_clip_label", { clip_ids: ids, label: v ?? "none" }));
        },
      },
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

  return (
    <section className="panel timeline-panel" aria-label="Timeline">
      <Mixer />
      <TimelineToolbar />
      <CompoundPath />
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
          <div className="tl-ruler-overlays">
            <InOutRange zoom={zoom} />
            <MarkersLayer zoom={zoom} />
            <Playhead zoom={zoom} height={RULER_H} cap />
          </div>
          <div className="tl-corner" style={{ width: HEADER_W }} />
          <div className="tl-rows" style={{ top: RULER_H }} onPointerDown={onLanesDown} onKeyDown={onClipKey}>
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
                        compound={c.type === "compound" ? compounds.get(c.compoundId) : undefined}
                        fps={project.fps}
                        zoom={zoom}
                        height={row.height}
                        selected={selected.has(c.id)}
                        tabStop={c.id === tabStop}
                        outOfSync={outOfSync.get(c.id)}
                        visFrom={view.left - left}
                        visTo={view.left + view.width - left}
                        shift={(drop?.shifts.get(c.id) ?? 0) * zoom}
                        onDown={onClipDown}
                        onContext={onContext}
                        onOpen={onOpenClip}
                        renaming={renaming === c.id}
                        onRename={onRename}
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
                        data-tip="Edit transition"
                        aria-label="Edit transition"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          store.select([c.id]);
                          store.set({ transitionEdit: c.id });
                        }}
                      >
                        <Blend size={12} />
                      </button>
                    );
                  })}
                  {/* An audio crossfade (ADR-104) where the mix plays one:
                      over the seconds before the cut, so it ends there. */}
                  {row.track.clips.map((c, i) => {
                    const next = row.track.clips[i + 1];
                    if (c.type !== "audio" || !c.crossfade || next?.type !== "audio") return null;
                    const x = audioCrossfade(c, next, project.fps);
                    if (!x) return null;
                    const cut = (c.start + c.duration + (drop?.shifts.get(c.id) ?? 0)) * zoom;
                    const w = Math.max(16, x * (project.fps.num / project.fps.den) * zoom);
                    const h = Math.min(22, row.height - 8);
                    return (
                      <button
                        key={`xf-${c.id}`}
                        className="tl-transition tl-crossfade"
                        style={{ left: cut - w, width: w, height: h, top: (row.height - h) / 2 }}
                        data-tip={`Crossfade ${x < 0.1 ? x.toFixed(3) : x.toFixed(2)} s`}
                        aria-label={`Edit crossfade, ${+x.toFixed(3)} seconds`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          store.select([c.id]);
                          store.set({ transitionEdit: null });
                          showInspectorTab("audio");
                        }}
                      >
                        <Blend size={12} />
                      </button>
                    );
                  })}
                </div>
                <TrackHeader track={row.track} openMenu={(x, y, items) => setMenu({ x, y, items })} />
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

/** Open a compound clip for editing (ADR-037); playback stops, as it
 * would for any change of timeline. */
function openCompound(clipId: Id) {
  player.pause();
  store.openCompound(clipId);
}
const onOpenClip = (c: Clip) => openCompound(c.id);

/** Back out to nesting level `depth` (0: the project's timeline). */
function closeCompound(depth: number) {
  player.pause();
  store.closeCompound(depth);
}

/**
 * Where the timeline is while compound clips are open: the project, then
 * each compound clip opened inside it, the last being the one edited.
 * Each earlier step goes back out to it; the arrow goes back one.
 */
function CompoundPath() {
  const nest = useEditor((s) => s.nest);
  const projectName = useEditor((s) => s.project.name);
  const compounds = useEditor((s) => s.project.compounds);
  if (!nest.length) return null;
  const name = (id: Id) => compounds?.find((k) => k.id === id)?.name ?? "Compound clip";
  return (
    <nav className="tl-path" aria-label="Compound clip path">
      <button className="icon-btn small" aria-label="Back out of the compound clip" data-tip="Back out of the compound clip" onClick={() => closeCompound(nest.length - 1)}>
        <ChevronLeft size={14} />
      </button>
      <button className="tl-crumb" onClick={() => closeCompound(0)}>
        {projectName}
      </button>
      {nest.map((e, i) => (
        <Fragment key={`${i}:${e.id}`}>
          <ChevronRight size={12} className="tl-crumb-sep" aria-hidden />
          {i === nest.length - 1 ? (
            <span className="tl-crumb current" aria-current="location">
              <Layers size={12} /> {name(e.id)}
            </span>
          ) : (
            <button className="tl-crumb" onClick={() => closeCompound(i + 1)}>
              {name(e.id)}
            </button>
          )}
        </Fragment>
      ))}
      <span className="tl-path-hint">Changes here show everywhere this compound clip plays.</span>
    </nav>
  );
}

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

type OpenMenu = (x: number, y: number, items: MenuItem[]) => void;

/** A track's sound level in dB, as a popover by the header (Premiere's
 * track volume; the mixer's fader in Resolve). One undo step per drag. */
function TrackVolume({ track, at, onClose }: { track: Track; at: { x: number; y: number }; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Inside the window, as menus are: from the lowest track's header it
  // opened below the window's bottom edge. Upward from the pointer when
  // there is no room under it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const room = 8;
    const dy = at.y + el.offsetHeight > innerHeight - room ? Math.max(room, at.y - el.offsetHeight) - at.y : 0;
    const dx = Math.min(0, innerWidth - room - at.x - el.offsetWidth);
    el.style.translate = `${dx}px ${dy}px`;
  }, [at]);
  useEffect(() => {
    ref.current?.querySelector("input")?.focus();
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [onClose]);
  const db = Math.max(-40, toDb(track.volume));
  const pan = track.pan ?? 0;
  const set = (d: number) => store.previewGesture((p) => ops.updateTrack(p, track.id, { volume: d <= -40 ? 0 : +fromDb(d).toFixed(4) }), "Track volume");
  // On the body: the sticky header is its own stacking context.
  return createPortal(
    <div className="menu tl-vol-pop" ref={ref} style={{ left: at.x, top: at.y }} role="dialog" aria-label={`${track.name} volume and pan`}>
      <label>
        <span>Track volume</span>
        <span className="num">{db <= -40 ? "-inf" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`}</span>
      </label>
      <input
        type="range"
        min={-40}
        max={12}
        step={0.5}
        value={db}
        aria-label="Track volume"
        {...rangeGesture("Track volume")}
        onChange={(e) => set(Number(e.target.value))}
        onDoubleClick={() => store.edit("Reset track volume", (p) => ops.updateTrack(p, track.id, { volume: 1 }))}
      />
      <label>
        <span>Track pan</span>
        <span className="num">{pan === 0 ? "Center" : `${Math.round(Math.abs(pan) * 100)} ${pan < 0 ? "L" : "R"}`}</span>
      </label>
      <input
        type="range"
        min={-100}
        max={100}
        step={1}
        value={Math.round(pan * 100)}
        aria-label="Track pan"
        {...rangeGesture("Track pan")}
        onChange={(e) => store.previewGesture((p) => ops.updateTrack(p, track.id, { pan: Number(e.target.value) / 100 || undefined }), "Track pan")}
        onDoubleClick={() => store.edit("Reset track pan", (p) => ops.updateTrack(p, track.id, { pan: undefined }))}
      />
    </div>,
    document.body,
  );
}

function TrackHeader({ track, openMenu }: { track: Track; openMenu: OpenMenu }) {
  const assets = useEditor((s) => s.project.assets);
  const kindIcon =
    (() => {
      const first = track.clips[0];
      const type = first && track.clips.every((c) => c.type === first.type) ? first.type : "video";
      const Icon = track.kind === "audio" ? Music : type === "text" ? (track.clips.every((c) => c.type === "text" && c.caption) ? Captions : Type) : type === "image" ? (track.clips.every((c) => c.type === "image" && assets.find((a) => a.id === c.assetId)?.sticker) ? Sticker : Image) : type === "adjustment" ? SlidersHorizontal : type === "color" ? Square : type === "compound" ? Layers : Film;
      return <Icon size={13} />;
    })();
  const set = (patch: Partial<Track>, label: string) => store.edit(label, (p) => ops.updateTrack(p, track.id, patch));
  const [renaming, setRenaming] = useState(false);
  const [volumeAt, setVolumeAt] = useState<{ x: number; y: number } | null>(null);
  const sounds = track.kind === "audio" || track.clips.some((c) => c.type === "video");
  const solo = () => set({ solo: !track.solo || undefined }, track.solo ? "Unsolo track" : "Solo track");
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const at = { x: e.clientX, y: e.clientY };
    const height = (h: Track["height"], label: string) => ({ label, checked: track.height === h, onSelect: () => set({ height: h }, "Track height") });
    openMenu(at.x, at.y, [
      { label: "Rename track…", onSelect: () => setRenaming(true) },
      { title: "Track color", current: track.color ?? null,
        swatches: [{ value: null, label: "No track color" }, ...Object.entries(CLIP_LABELS).map(([value, l]) => ({ value, label: l.label, color: l.color }))],
        onPick: (v) => set({ color: (v ?? undefined) as ClipLabel | undefined }, "Track color"),
      },
      ...(sounds
        ? ([
            { label: "Solo", checked: !!track.solo, onSelect: solo },
            { label: "Track volume and pan…", onSelect: () => setVolumeAt(at) },
          ] as MenuItem[])
        : []),
      "-",
      height("small", "Small height"),
      height(undefined, "Normal height"),
      height("large", "Large height"),
      "-",
      {
        label: "Delete track",
        disabled: !!track.main || track.locked,
        onSelect: () => edit("Delete track", (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== track.id) })),
      },
    ]);
  };
  return (
    <div className="tl-header" style={{ width: HEADER_W }} onContextMenu={onContextMenu} onDoubleClick={(e) => !(e.target as Element).closest("button, input") && setRenaming(true)}>
      {renaming ? (
        <input
          className="field tl-rename"
          aria-label="Track name"
          defaultValue={track.name}
          autoFocus
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== track.name) set({ name }, "Rename track");
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).value = track.name;
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      ) : (
        // The tip carries the whole name: the column shows only its start.
        <span className="tl-kind" data-tip={track.main ? (track.name === "Main" ? "Main track" : `${track.name} (main track)`) : track.name}>
          {kindIcon}
          <span className="tl-track-name">{track.name}</span>
        </span>
      )}
      {volumeAt && <TrackVolume track={track} at={volumeAt} onClose={() => setVolumeAt(null)} />}
      <div className="tl-toggles">
        <button className={`tl-tog tl-tog-lock${track.locked ? " on" : ""}`} aria-label={track.locked ? "Unlock track" : "Lock track"} data-tip={track.locked ? "Unlock" : "Lock"} onClick={() => set({ locked: !track.locked }, track.locked ? "Unlock track" : "Lock track")}>
          {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
        {track.kind === "video" && (
          <button className={`tl-tog tl-tog-eye${track.hidden ? " on" : ""}`} aria-label={track.hidden ? "Show track" : "Hide track"} data-tip={track.hidden ? "Show" : "Hide"} onClick={() => set({ hidden: !track.hidden }, track.hidden ? "Show track" : "Hide track")}>
            {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
        {track.kind === "audio" && (
          <button className={`tl-tog tl-tog-eye tl-tog-solo${track.solo ? " on" : ""}`} aria-label={track.solo ? "Unsolo track" : "Solo track"} aria-pressed={!!track.solo} data-tip={track.solo ? "Unsolo" : "Solo"} onClick={solo}>
            <Headphones size={13} />
          </button>
        )}
        {sounds && (
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
        ctx.fillText(t.label, x + (t.frame === 0 ? 12 : 4), 6);
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

function Playhead({ zoom, height, cap = false }: { zoom: number; height: number; cap?: boolean }) {
  const f = useEditor((s) => s.playhead);
  return (
    <div className="tl-playhead" style={{ transform: `translateX(${HEADER_W + f * zoom}px)`, height }}>
      {cap && <div className="tl-playhead-cap" />}
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
