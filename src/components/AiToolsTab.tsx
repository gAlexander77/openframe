// The library's "AI tools" tab: one card per local tool, acting on the
// selected clip. Each card has its settings in a small popover, shows its
// progress while running (cancelable) and its last result after. All the
// work is in src/state/ai.ts; this file only shows it.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { thumbs } from "../engine/thumbs";
import { AudioLines, AudioWaveform, Captions, Check, Clapperboard, Drum, Film, Gauge, Volume1, Loader2, MousePointerClick, Ratio, SlidersHorizontal, X } from "../icons";
import { formatDuration, framesToSeconds } from "../lib/time";
import { aiStore, duckUnderSpeech, markBeats, NEEDS, normalizeLoudness, removeSilences, splitScenes, targetFor, useAi, type AiSettings, type ToolId } from "../state/ai";
import { store, useEditor } from "../state/store";
import "./ai-tools.css";

type Icon = typeof Film;

const RUN: Record<ToolId, () => Promise<unknown>> = {
  silences: () => removeSilences(),
  scenes: () => splitScenes(),
  beats: () => markBeats(),
  loudness: () => normalizeLoudness(),
  ducking: () => duckUnderSpeech(),
};

export function AiToolsTab() {
  // Re-render on selection and edits: which clip a tool can use depends on both.
  useEditor((s) => s.selection);
  useEditor((s) => s.project);
  const scenesOut = useAi((s) => s.settings.scenes.output);
  return (
    <div className="lib-content ai-tab">
      <TargetBanner />
      <div className="ai-cards">
        <ToolCard tool="silences" icon={AudioWaveform} title="Remove silences" blurb="Cut the pauses out of speech and close the gaps." action="Remove" settings={<SilenceSettings />} />
        <ToolCard tool="scenes" icon={Clapperboard} title="Split scenes" blurb="Find every shot change in a video." action={scenesOut === "markers" ? "Mark" : "Split"} settings={<SceneSettings />} />
        <ToolCard tool="beats" icon={Drum} title="Beat markers" blurb="Drop a marker on the beat of a music track." action="Mark" settings={<BeatSettings />} />
        <ToolCard tool="loudness" icon={Gauge} title="Normalize loudness" blurb="Even out the volume of the selected clips." action="Normalize" settings={<LoudnessSettings />} />
        <ToolCard tool="ducking" icon={Volume1} title="Auto ducking" blurb="Lower the selected music while people talk." action="Duck" settings={<DuckSettings />} />
        <LinkCard icon={Captions} title="Auto captions" blurb="Turn speech into captions, on your computer." action="Open Captions" onClick={() => store.set({ leftTab: "captions" })} />
        <LinkCard icon={Ratio} title="Auto reframe" blurb="Follow the subject into 9:16 or 1:1." soon />
      </div>
      <p className="ai-foot">Everything runs on this computer. Nothing is uploaded.</p>
    </div>
  );
}

/** Which clip the tools will use, or how to pick one. */
function TargetBanner() {
  useSyncExternalStore(thumbs.subscribe, thumbs.version); // the poster arrives after import
  const s = store.get();
  const p = s.project;
  const clip = p.tracks.flatMap((t) => t.clips).find((c) => s.selection.includes(c.id) && (c.type === "video" || c.type === "audio"));
  if (!clip || !("assetId" in clip)) {
    return (
      <div className="ai-target empty-target">
        <MousePointerClick size={16} strokeWidth={1.6} />
        <span>Select a video or audio clip on the timeline. The tools work on the selected clip.</span>
      </div>
    );
  }
  const asset = p.assets.find((a) => a.id === clip.assetId);
  const poster = asset && thumbs.poster(asset);
  const Icon = clip.type === "audio" ? AudioLines : Film;
  return (
    <div className="ai-target">
      <div className={`ai-target-thumb${clip.type === "audio" ? " audio" : ""}`}>{poster ? <img src={poster} alt="" draggable={false} /> : <Icon size={15} strokeWidth={1.6} />}</div>
      <div className="ai-target-text">
        <span className="ai-target-label">Selected clip</span>
        <strong title={asset?.name}>{asset?.name ?? "Missing media"}</strong>
      </div>
      <span className="chip-inline num">{formatDuration(framesToSeconds(clip.duration, p.fps))}</span>
    </div>
  );
}

function ToolCard(props: { tool: ToolId; icon: Icon; title: string; blurb: string; action: string; settings: ReactNode }) {
  const { tool } = props;
  const job = useAi((s) => s.jobs[tool]);
  const result = useAi((s) => s.results[tool]);
  const [open, setOpen] = useState(false);
  const target = targetFor(tool);
  // With nothing selected the banner already says to select a clip; the
  // card only says what kind.
  const nothing = !store.get().selection.length;
  const reason = typeof target !== "string" ? null : nothing ? `For ${NEEDS[tool]}` : target;
  const pct = job ? Math.round(job.progress * 100) : 0;
  return (
    <section className={`ai-card ai-${tool}${job ? " running" : ""}${open ? " has-pop" : ""}`} aria-label={props.title}>
      <div className="ai-card-head">
        <div className="ai-icon">
          <props.icon size={20} strokeWidth={1.7} />
        </div>
        <div className="ai-card-text">
          <h3>{props.title}</h3>
          <p>{props.blurb}</p>
        </div>
        <button className={`icon-btn ai-gear${open ? " on" : ""}`} aria-label={`${props.title} settings`} aria-expanded={open} onClick={() => setOpen(!open)}>
          <SlidersHorizontal />
        </button>
      </div>
      {open && (
        <Popover title={`${props.title} settings`} onClose={() => setOpen(false)} onReset={() => aiStore.resetSettings(tool)}>
          {props.settings}
        </Popover>
      )}
      <div className="ai-card-foot">
        {job ? (
          <>
            <div className="ai-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ transform: `scaleX(${job.progress})` }} />
            </div>
            <span className="ai-pct num">
              <Loader2 size={13} className="spin" /> {pct}%
            </span>
            <button className="icon-btn ai-cancel" aria-label="Cancel" onClick={() => aiStore.cancel(tool)}>
              <X />
            </button>
          </>
        ) : (
          <>
            <span className={`ai-status${result && !reason ? " done" : ""}`}>
              {reason ?? (result ? <><Check size={13} strokeWidth={2.2} /> {result}</> : "Ready")}
            </span>
            <button className="btn primary ai-run" disabled={!!reason} onClick={() => void RUN[tool]().catch(() => {})}>
              {props.action}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** A tool that lives elsewhere (Captions) or is not built yet. */
function LinkCard(props: { icon: Icon; title: string; blurb: string; action?: string; onClick?: () => void; soon?: boolean }) {
  return (
    <section className={`ai-card ai-link${props.soon ? " soon" : ""}`} aria-label={props.title}>
      <div className="ai-card-head">
        <div className="ai-icon">
          <props.icon size={20} strokeWidth={1.7} />
        </div>
        <div className="ai-card-text">
          <h3>
            {props.title}
            {props.soon && <span className="ai-soon">Coming soon</span>}
          </h3>
          <p>{props.blurb}</p>
        </div>
        {props.action && (
          <button className="btn ai-open" onClick={props.onClick}>
            {props.action}
          </button>
        )}
      </div>
    </section>
  );
}

// ---- settings ------------------------------------------------------------------

function Popover(props: { title: string; children: ReactNode; onClose: () => void; onReset: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  // The panel is short; bring the whole popover into view when it opens.
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  }, []);
  useEffect(() => {
    // Outside clicks close it, except on this card's own gear (which toggles).
    const down = (e: PointerEvent) => {
      const el = ref.current;
      const gear = el?.parentElement?.querySelector(".ai-gear");
      if (el && !el.contains(e.target as Node) && !gear?.contains(e.target as Node)) onClose();
    };
    // Escape closes the popover and nothing else: caught in the capture
    // phase so the app's own Escape (deselect) never sees it.
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  return (
    <div className="ai-pop" ref={ref} role="dialog" aria-label={props.title}>
      {props.children}
      <div className="ai-pop-foot">
        <button className="btn ghost" onClick={props.onReset}>
          Reset
        </button>
        <button className="btn" onClick={props.onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; hint?: string; onChange: (v: number) => void }) {
  return (
    <label className="ai-field">
      <span className="ai-field-row">
        <span>{props.label}</span>
        <span className="ai-value num">{props.show(props.value)}</span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ "--fill": `${((props.value - props.min) / (props.max - props.min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint && <span className="ai-hint">{props.hint}</span>}
    </label>
  );
}

function Segmented<T extends string | number>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="ai-field">
      <span className="ai-field-row">
        <span>{props.label}</span>
      </span>
      <div className="ai-seg" role="radiogroup" aria-label={props.label}>
        {props.options.map(([v, text]) => (
          <button key={String(v)} role="radio" aria-checked={props.value === v} className={props.value === v ? "on" : ""} onClick={() => props.onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const seconds = (v: number) => `${v.toFixed(2)} s`;
const percent = (v: number) => `${Math.round(v * 100)}`;

function useSettings<T extends ToolId>(tool: T): [AiSettings[T], (patch: Partial<AiSettings[T]>) => void] {
  const s = useAi((st) => st.settings[tool]);
  return [s, (patch) => aiStore.setSettings(tool, patch)];
}

function SilenceSettings() {
  const [s, set] = useSettings("silences");
  return (
    <>
      <Slider label="Sensitivity" value={s.sensitivity} min={0} max={1} step={0.05} show={percent} hint="Higher also cuts quiet breaths and room noise." onChange={(v) => set({ sensitivity: v })} />
      <Slider label="Shortest pause" value={s.minSilence} min={0.2} max={2} step={0.05} show={seconds} hint="Shorter pauses are the rhythm of speech; they stay." onChange={(v) => set({ minSilence: v })} />
      <Slider label="Padding" value={s.padding} min={0} max={0.5} step={0.02} show={seconds} hint="Kept on each side of speech so words are not clipped." onChange={(v) => set({ padding: v })} />
    </>
  );
}

function SceneSettings() {
  const [s, set] = useSettings("scenes");
  return (
    <>
      <Slider label="Sensitivity" value={s.sensitivity} min={0} max={1} step={0.05} show={percent} hint="Higher finds subtler cuts, and more false ones." onChange={(v) => set({ sensitivity: v })} />
      <Slider label="Shortest scene" value={s.minScene} min={0.2} max={3} step={0.1} show={seconds} onChange={(v) => set({ minScene: v })} />
      <Segmented label="Detector" value={s.detector} options={[["adaptive", "Adaptive"], ["content", "Fixed"]]} onChange={(v) => set({ detector: v })} />
      <Segmented label="At each cut" value={s.output} options={[["split", "Split clip"], ["markers", "Add marker"]]} onChange={(v) => set({ output: v })} />
    </>
  );
}

function BeatSettings() {
  const [s, set] = useSettings("beats");
  return <Segmented label="Marker on" value={s.every} options={[[1, "Every beat"], [2, "Every 2"], [4, "Every 4"]]} onChange={(v) => set({ every: v })} />;
}

function LoudnessSettings() {
  const [s, set] = useSettings("loudness");
  return (
    <Segmented
      label={`Target · ${String(s.target).replace("-", "−")} LUFS`}
      value={s.target}
      options={[
        [-14, "Social"],
        [-16, "Podcast"],
        [-23, "Broadcast"],
      ]}
      onChange={(v) => set({ target: v })}
    />
  );
}

function DuckSettings() {
  const [s, set] = useSettings("ducking");
  return (
    <Segmented
      label={`Lower by · ${s.depth} dB`}
      value={s.depth}
      options={[
        [6, "Light"],
        [12, "Medium"],
        [18, "Strong"],
      ]}
      onChange={(v) => set({ depth: v })}
    />
  );
}
