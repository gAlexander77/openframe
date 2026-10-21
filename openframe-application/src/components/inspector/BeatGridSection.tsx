// A song's beat grid in the Audio tab (ADR-119): its tempo, its first bar
// and its parts, as set_music_grid gave them or as Detect reads them, each
// corrected through set_music_grid, the agent's own command. The clip
// draws the grid (ClipView), so a nudge shows on the waveform's kicks.
// Final Cut's beat grid and CapCut's beat dots are the models; "Set
// downbeat here" is Premiere's habit of marking at the playhead.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Trash2, WandSparkles } from "../../icons";
import { sourceToTimeline } from "../../lib/analysis/musicMap";
import { firstBar, gridArgs, isSong, sourceAtFrame, tapTempo, withPart } from "../../lib/beatGrid";
import { runCommand } from "../../lib/commands";
import { SECTION_NAMES } from "../../lib/epic";
import { nearestLine } from "../../lib/musicCut";
import { parseTyped } from "../../lib/numberInput";
import * as ops from "../../lib/project/ops";
import type { AudioClip, MusicGrid, MusicPart } from "../../lib/project/types";
import { formatTimecode } from "../../lib/time";
import { readMusicGrid, useAi } from "../../state/ai";
import { edit } from "../../state/actions";
import { store, useEditor } from "../../state/store";
import { toast } from "../../state/toast";
import { Section, useCommitOnLeave } from "./controls";

const PARTS = Object.keys(SECTION_NAMES) as MusicPart[];
/** A nudge of the downbeat, seconds: under a sixteenth at any tempo. */
const NUDGE = 0.01;
/** Taps stop counting this long after the last one, and the tempo lands. */
const TAP_LAND_MS = 1500;

/** Give the song a grid (or forget it) as one undo step; a refusal is said. */
function setGrid(label: string, clipId: string, grid: MusicGrid | null) {
  try {
    edit(label, (p) => runCommand(p, "set_music_grid", grid ? gridArgs(clipId, grid) : { clip_id: clipId, clear: true }));
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export function BeatGridSection({ clip }: { clip: AudioClip }) {
  const grid = useEditor((s) => ops.getAsset(s.project, clip.assetId)?.musicGrid);
  const song = useEditor((s) => isSong(s.project, clip.id));
  if (!song) return null;
  return (
    <Section title="Beat grid" defaultOpen>
      {grid ? <GridRows clip={clip} grid={grid} /> : <Detect clip={clip} />}
    </Section>
  );
}

function Detect({ clip }: { clip: AudioClip }) {
  const running = useAi((s) => s.jobs.beats);
  const job = running?.clipId === clip.id ? running : undefined;
  const detect = async () => {
    try {
      const { grid, unsure } = await readMusicGrid(clip.id);
      setGrid("Detect beat grid", clip.id, grid);
      if (unsure.length) toast(`Check the grid on the clip: ${unsure.join(", and ")}.`);
    } catch {
      // The job said why.
    }
  };
  return (
    <>
      <p className="insp-hint">No beat grid yet. Detect reads the song's tempo, bars and parts, draws them on the clip, and lets you correct them here.</p>
      <div className="insp-actions">
        <button className="btn" disabled={!!running} onClick={() => void detect()}>
          {job ? <Loader2 size={14} className="spin" /> : <WandSparkles size={14} />} {job ? "Reading the music" : "Detect beat grid"}
        </button>
      </div>
    </>
  );
}

function GridRows({ clip, grid }: { clip: AudioClip; grid: MusicGrid }) {
  const fps = useEditor((s) => s.project.fps);
  const playhead = useEditor((s) => s.playhead);
  const here = sourceAtFrame(clip, playhead, fps);
  const speed = clip.speedCurve ? 1 : clip.speed;
  const set = (label: string, patch: Partial<MusicGrid>) => setGrid(label, clip.id, { ...grid, ...patch });
  const map = sourceToTimeline(clip, fps);
  const [part, setPart] = useState<MusicPart>("drop");
  const parts = grid.sections ?? [];
  return (
    <>
      <TempoRow grid={grid} speed={speed} onSet={(bpm, label) => set(label, { bpm })} />
      <DownbeatRow grid={grid} onSet={(firstDownbeat, label) => set(label, { firstDownbeat })} />
      {speed !== 1 && <p className="insp-hint num">It plays at {+(grid.bpm * speed).toFixed(2)} BPM at {+speed.toFixed(2)}x.</p>}
      <div className="insp-actions">
        <button className="btn" disabled={here === null} data-tip="A bar starts at the playhead" onClick={() => here !== null && set("Set downbeat", { firstDownbeat: here })}>
          Set downbeat here
        </button>
      </div>
      {here === null && <p className="insp-hint">Put the playhead over this clip to set a downbeat or add a part there.</p>}
      <div className="insp-group">Parts</div>
      {parts.length ? (
        <ul className="grid-parts" aria-label="Parts of the song">
          {parts.map((s, i) => {
            const f = map.frame(s.at);
            return (
              <li key={`${s.at}:${i}`} className="grid-part">
                <select className="field" aria-label={`Part at ${s.at} s`} value={s.label} onChange={(e) => set("Change part", { sections: parts.map((x, k) => (k === i ? { ...x, label: e.target.value as MusicPart } : x)) })}>
                  {PARTS.map((k) => <option key={k} value={k}>{SECTION_NAMES[k]}</option>)}
                </select>
                {f !== null ? (
                  <button className="btn ghost grid-part-at num" aria-label={`Go to the ${SECTION_NAMES[s.label]} at ${formatTimecode(f, fps)}`} onClick={() => store.seek(f)}>
                    {formatTimecode(f, fps)}
                  </button>
                ) : (
                  <span className="grid-part-at off">Not in this clip</span>
                )}
                <button className="icon-btn small" aria-label={`Remove the ${SECTION_NAMES[s.label]}`} data-tip="Remove part" onClick={() => set("Remove part", { sections: parts.filter((_, k) => k !== i) })}>
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="insp-hint">No parts named. Mark where the drop or the build starts: put the playhead there and add it.</p>
      )}
      <div className="grid-add">
        <select className="field" aria-label="Part to add" value={part} onChange={(e) => setPart(e.target.value as MusicPart)}>
          {PARTS.map((k) => <option key={k} value={k}>{SECTION_NAMES[k]}</option>)}
        </select>
        <button className="btn" disabled={here === null} data-tip="On the bar nearest the playhead" onClick={() => here !== null && set(`Add ${SECTION_NAMES[part].toLowerCase()}`, { sections: withPart(parts, nearestLine(grid, here, "bar"), part) })}>
          <Plus size={14} /> Add here
        </button>
      </div>
      <p className="insp-hint">Drawn on the clip: a line on each bar's first beat, a tick on each beat. To take bars out, mark In and Out around them and choose Cut bars in the clip's menu.</p>
      <div className="insp-actions">
        <button className="btn ghost" onClick={() => setGrid("Clear beat grid", clip.id, null)}>Clear grid</button>
      </div>
    </>
  );
}

/** Tempo: typed, or tapped along while it plays (heard at the clip's speed). */
function TempoRow({ grid, speed, onSet }: { grid: MusicGrid; speed: number; onSet: (bpm: number, label: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const [tapped, setTapped] = useState<number | null>(null);
  const taps = useRef<number[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const commit = (raw: string) => {
    setText(null);
    const v = parseTyped(raw);
    if (v !== null && v !== grid.bpm) onSet(Math.min(240, Math.max(40, v)), "Set tempo");
  };
  useCommitOnLeave(text, commit);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const tap = () => {
    const now = performance.now();
    taps.current = [...taps.current.filter((t) => now - t < 20000), now];
    const bpm = tapTempo(taps.current);
    setTapped(bpm);
    window.clearTimeout(timer.current);
    // The tempo lands once the tapping stops: one undo step, not one a tap.
    timer.current = window.setTimeout(() => {
      taps.current = [];
      setTapped(null);
      if (bpm !== null) onSet(+(bpm / speed).toFixed(2), "Tap tempo");
    }, TAP_LAND_MS);
  };
  return (
    <div className="insp-row">
      <label className="insp-label">Tempo</label>
      <button className="btn grid-tap num" aria-label="Tap tempo" data-tip="Tap along with the beat while it plays" onClick={tap}>
        {tapped !== null ? `${tapped.toFixed(1)} BPM` : taps.current.length ? `Tap ${taps.current.length}` : "Tap"}
      </button>
      <span className="insp-num">
        <input
          className="field num"
          aria-label="Tempo value"
          value={text ?? grid.bpm.toFixed(2)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== null && commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              commit(String(grid.bpm + (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowUp" ? 1 : -1)));
            }
          }}
        />
        <span className="insp-unit">BPM</span>
      </span>
      <span className="insp-keys" />
    </div>
  );
}

/** The first bar line, in the song's own seconds: typed, or nudged. */
function DownbeatRow({ grid, onSet }: { grid: MusicGrid; onSet: (firstDownbeat: number, label: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = firstBar(grid);
  const commit = (raw: string) => {
    setText(null);
    const v = parseTyped(raw);
    if (v !== null && v >= 0 && Math.abs(v - shown) > 1e-6) onSet(v, "Set downbeat");
  };
  useCommitOnLeave(text, commit);
  // A nudge moves the downbeat the grid keeps, so the tempo still turns about it.
  const nudge = (d: number) => onSet(Math.max(0, +(grid.firstDownbeat + d).toFixed(4)), "Nudge downbeat");
  return (
    <div className="insp-row">
      <label className="insp-label" data-tip="Where the first bar starts, in the song's own seconds">First bar</label>
      <span />
      <span className="insp-num">
        <input
          className="field num"
          aria-label="First bar value"
          value={text ?? shown.toFixed(3)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== null && commit(text)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(null);
          }}
        />
        <span className="insp-unit">s</span>
      </span>
      <span className="insp-keys">
        <button className="key-nav" aria-label="Nudge downbeat earlier" data-tip="10 ms earlier" onClick={() => nudge(-NUDGE)}>
          <ChevronLeft size={11} />
        </button>
        <button className="key-nav" aria-label="Nudge downbeat later" data-tip="10 ms later" onClick={() => nudge(NUDGE)}>
          <ChevronRight size={11} />
        </button>
      </span>
    </div>
  );
}
