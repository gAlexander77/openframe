import { DraftNumber } from "./DraftNumber";
// The export dialog, after CapCut's (docs/research/CapCut desktop.md §6.1):
// name and location, a Video section (resolution, bit rate, codec, format,
// frame rate), an Audio section, the range, and a footer with the duration
// and a live size estimate. Export switches it to a progress view (ring,
// frames, speed, time left, Cancel), then a done view. All the numbers come
// from src/lib/export.ts, so the estimate is the bitrate the encoder gets.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { encodableVideoCodecs } from "../engine/export";
import { Check, ChevronDown, CircleAlert, Download, Clock, Film, FolderOpen, ImageDown, Loader2, X } from "../icons";
import {
  AUDIO_FORMATS,
  CAPTION_EXPORTS,
  captionPlan,
  CODEC_LABELS,
  QUALITY_LEVELS,
  RESOLUTIONS,
  VIDEO_FORMATS,
  defaultExportSettings,
  EXPORT_PRESETS,
  exportBlocker,
  matchingPreset,
  presetMatches,
  presetOf,
  shapeWarning,
  type ExportPreset,
  formatBytes,
  formatEta,
  formatSize,
  fpsLabel,
  fpsOptions,
  GIF_FPS,
  LOUDNESS_TARGETS,
  outputSize,
  planExport,
  sameRate,
  type AudioFormat,
  type CaptionExport,
  type ExportSettings,
  type QualityLevel,
  type ResolutionId,
  type VideoCodec,
  type VideoFormat,
} from "../lib/export";
import type { Project } from "../lib/project/types";
import { captionClips } from "../lib/captions";
import { canvasSize } from "../lib/canvas";
import { formatDuration } from "../lib/time";
import { platform } from "../platform";
import { backToSettings, cancelExport, closeExportDialog, saveStill, startExport, stillToUrl, useExportView, type ExportView } from "../state/export";
import { documentOf, rootInPoint, rootOutPoint, store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import { chordFor } from "../state/actions";
import { checkCounts, checkHeadline } from "../lib/checkFindings";
import { openCheck, useCheck } from "../state/check";
import { chordText } from "../lib/keymap";
import { isMac } from "../platform/env";
import "./export.css";

/** An action's key as the keymap has it (never typed in prose). */
const markKey = (id: "markIn" | "markOut") => {
  const c = chordFor(id);
  return c ? chordText(c, isMac) : "no key";
};

/** Choices remembered between exports (not the name, rate or range, which
 * belong to the project). */
const REMEMBERED = ["video", "format", "codec", "resolution", "quality", "customMbps", "audio", "audioFormat", "loudness", "captions"] as const;

function loadSettings(p: Project): ExportSettings {
  const base = defaultExportSettings(p);
  try {
    const saved = JSON.parse(localStorage.getItem("export.settings") ?? "{}");
    for (const k of REMEMBERED) if (k in saved) (base as unknown as Record<string, unknown>)[k] = saved[k];
  } catch {
    /* private window or a bad value: defaults */
  }
  return base;
}

function saveSettings(s: ExportSettings) {
  try {
    localStorage.setItem("export.settings", JSON.stringify(Object.fromEntries(REMEMBERED.map((k) => [k, s[k]]))));
  } catch {
    /* not remembered, no harm */
  }
}

/** Presets the viewer saved, like the remembered choices. */
function loadOwnPresets(): ExportPreset[] {
  try {
    const list = JSON.parse(localStorage.getItem("export.presets") ?? "[]");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && typeof x.label === "string" && x.settings).map((x) => ({ ...x, own: true })) : [];
  } catch {
    return [];
  }
}

function saveOwnPresets(list: ExportPreset[]) {
  try {
    localStorage.setItem("export.presets", JSON.stringify(list.map(({ own: _, ...x }) => x)));
  } catch {
    /* storage blocked: the preset lasts this session */
  }
}

export function ExportDialog() {
  const view = useExportView();
  if (view.phase === "closed") return null;
  return <ExportModal view={view} />;
}

function ExportModal({ view }: { view: Exclude<ExportView, { phase: "closed" }> }) {
  const dialog = useRef<HTMLDivElement>(null);
  const busy = view.phase === "running";

  // Focus moves in on open and back out on close; Tab stays inside; the
  // editor's own shortcuts are off while the dialog is up.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);
  useEffect(() => {
    // Each view (settings, progress, done) brings its own first control.
    const first = dialog.current?.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.current;
    first?.focus();
  }, [view.phase]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A field that handles its own Enter and Escape (naming a preset);
      // the app's shortcuts skip text fields anyway.
      if ((e.target as HTMLElement).dataset?.ownEnter !== undefined && (e.key === "Enter" || e.key === "Escape")) return;
      e.stopPropagation(); // capture phase: the timeline never sees it
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) closeExportDialog();
      } else if (e.key === "Tab" && dialog.current) {
        const items = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
        if (!items.length) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) {
          e.preventDefault();
          items.at(-1)!.focus();
        } else if (!e.shiftKey && (i === -1 || i === items.length - 1)) {
          e.preventDefault();
          items[0].focus();
        }
      } else if (e.key === "Enter") {
        const t = e.target as HTMLElement;
        if (t.tagName === "BUTTON") return; // the button's own Enter
        dialog.current?.querySelector<HTMLButtonElement>("[data-default]:not(:disabled)")?.click();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="export-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && closeExportDialog()}>
      <div className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" ref={dialog} tabIndex={-1}>
        <header className="export-head">
          <h2 id="export-title">Export</h2>
          <button className="icon-btn" aria-label="Close" onClick={closeExportDialog} disabled={busy}>
            <X />
          </button>
        </header>
        {view.phase === "settings" && <SettingsView />}
        {view.phase === "running" && <ProgressView view={view} />}
        {view.phase === "done" && <DoneView view={view} />}
        {view.phase === "failed" && <FailedView message={view.message} />}
      </div>
    </div>
  );
}

// ---- settings ------------------------------------------------------------------------

function SettingsView() {
  const project = useEditor(documentOf);
  const inPoint = useEditor(rootInPoint);
  const outPoint = useEditor(rootOutPoint);
  const [s, setS] = useState(() => loadSettings(project));
  const set = (patch: Partial<ExportSettings>) =>
    setS((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  const inOut = { inPoint, outPoint };
  const plan = useMemo(() => planExport(project, s, inOut), [project, s, inPoint, outPoint]);
  const hasRange = inPoint !== null || outPoint !== null;

  // What this device can encode at this size and rate (greys out the rest).
  const [codecs, setCodecs] = useState<VideoCodec[] | null>(null);
  const v = plan.video;
  useEffect(() => {
    if (!v) return;
    let live = true;
    // Unknown until probed: the last answer was for another format or size.
    setCodecs(null);
    encodableVideoCodecs(s.format, v.width, v.height, s.fps, v.bitrate)
      .then((c) => live && setCodecs(c))
      .catch(() => live && setCodecs(VIDEO_FORMATS[s.format].codecs));
    return () => {
      live = false;
    };
  }, [s.format, v?.width, v?.height, s.fps.num, s.fps.den]);
  // A codec this device cannot encode at this size gives way to one it
  // can, and the dialog says so: a picked preset asking for it (the HEVC
  // master) then reads Custom, and silently that looked like a bug.
  const [swap, setSwap] = useState<{ from: VideoCodec; to: VideoCodec; preset?: string } | null>(null);
  useEffect(() => {
    if (codecs?.length && !codecs.includes(s.codec)) {
      setSwap({ from: s.codec, to: codecs[0], preset: presets.find((x) => x.id === picked)?.label });
      set({ codec: codecs[0] });
    }
  }, [codecs]);

  const [own, setOwn] = useState(loadOwnPresets);
  const [naming, setNaming] = useState(false);
  // The preset picked here shows as picked while its settings stand, even
  // on a canvas of another shape (with a warning); settings remembered
  // from another project only name a preset made for this shape.
  const [picked, setPicked] = useState<string | null>(null);
  const presets = [...EXPORT_PRESETS, ...own];
  const preset = presets.find((x) => x.id === picked && presetMatches(s, x)) ?? matchingPreset(s, presets, project);
  const applyPreset = (pr: ExportPreset) => {
    setPicked(pr.id);
    setSwap(null);
    set({ fps: project.fps, ...pr.settings });
  };
  const shapeNote = preset && s.video ? shapeWarning(preset, project, v ? { width: v.width, height: v.height } : null) : null;
  // Only on this explicit click: the canvas takes the preset's shape at
  // its short side, one undo step, as Details > Canvas does.
  const reshape = (shape: { w: number; h: number }) => {
    const [width, height] = canvasSize(shape.w, shape.h, Math.min(project.width, project.height));
    store.editDocument("Canvas size", (q) => ({ ...q, width, height, canvasFixed: true }));
  };
  const keepPreset = (label: string) => {
    const next = [...own, { id: `own-${Date.now()}`, label, settings: presetOf(s), own: true }];
    setOwn(next);
    saveOwnPresets(next);
    setNaming(false);
  };
  const dropPreset = (id: string) => {
    const next = own.filter((x) => x.id !== id);
    setOwn(next);
    saveOwnPresets(next);
  };
  const formatCodecs = VIDEO_FORMATS[s.format].codecs;
  const gif = s.video && s.format === "gif";
  const rates = gif ? GIF_FPS : fpsOptions(project.fps);
  // Into GIF: its usual size and rate; out of it: the project's rate.
  const setFormat = (format: VideoFormat) =>
    set(
      format === "gif"
        ? { format, fps: GIF_FPS[2].fps, ...(["1080p", "2k", "4k"].includes(s.resolution) ? { resolution: "480p" as ResolutionId } : {}) }
        : { format, ...(s.format === "gif" ? { fps: project.fps } : {}) },
    );
  const cannotEncode = s.video && codecs !== null && codecs.length === 0 ? `This device can't encode ${VIDEO_FORMATS[s.format].label} video at ${v?.width}×${v?.height}.` : null;
  const blocker = exportBlocker(project, s, inOut) ?? cannotEncode;

  const go = () => {
    if (blocker) return;
    void startExport({ ...s, codec: formatCodecs.includes(s.codec) ? s.codec : formatCodecs[0] });
  };
  const saveFrame = async () => {
    try {
      const name = await saveStill(s.name, s.resolution);
      if (name) toast(`Saved ${name}`);
    } catch (e) {
      toast(`Couldn't save the frame: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  return (
    <>
      <div className="export-body">
        <aside className="export-cover">
          <Cover project={project} />
          <button className="btn ghost" onClick={saveFrame} disabled={!project.tracks.some((t) => t.clips.length)}>
            <ImageDown size={14} /> Save frame as PNG
          </button>
        </aside>

        <div className="export-fields">
          <Row label="Name" htmlFor="export-name">
            <input id="export-name" className="field" data-autofocus value={s.name} spellCheck={false} onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.length, "backward")} onChange={(e) => set({ name: e.target.value })} />
          </Row>
          <Row label="Preset" htmlFor="export-preset">
            <div className="export-pair">
              {naming ? (
                <input
                  className="field"
                  aria-label="Preset name"
                  placeholder="Name this preset"
                  autoFocus
                  data-own-enter
                  onKeyDown={(e) => {
                    const name = (e.target as HTMLInputElement).value.trim();
                    if (e.key === "Enter" && name) keepPreset(name);
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setNaming(false);
                    }
                  }}
                  onBlur={() => setNaming(false)}
                />
              ) : (
                <Select
                  id="export-preset"
                  value={preset?.id ?? ""}
                  onChange={(id) => {
                    // "Custom" is no preset: the settings stay as they are.
                    const pr = presets.find((x) => x.id === id);
                    if (pr) applyPreset(pr);
                    else setPicked(null);
                  }}
                >
                  {!preset && <option value="">Custom</option>}
                  <optgroup label="Built in">
                    {EXPORT_PRESETS.map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </optgroup>
                  {own.length > 0 && (
                    <optgroup label="Saved">
                      {own.map((x) => (
                        <option key={x.id} value={x.id}>{x.label}</option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              )}
              {!naming && !preset && (
                <button className="btn ghost" onClick={() => setNaming(true)}>
                  Save preset…
                </button>
              )}
              {!naming && preset?.own && (
                <button className="btn ghost" onClick={() => dropPreset(preset.id)}>
                  Delete preset
                </button>
              )}
            </div>
          </Row>
          {swap && s.video && s.codec === swap.to && (
            <div className="export-shape-note" role="note">
              <CircleAlert size={14} />
              <span>
                {CODEC_LABELS[swap.from]} can't be encoded on this device{v ? ` at ${v.width}×${v.height}` : ""}, so {CODEC_LABELS[swap.to]} is used{swap.preset ? `: ${swap.preset} now reads Custom` : ""}.
              </span>
            </div>
          )}
          {shapeNote && preset?.shape && (
            <div className="export-shape-note" role="note">
              <CircleAlert size={14} />
              <span>{shapeNote}</span>
              <button className="btn ghost" onClick={() => reshape(preset.shape!)}>
                Make the canvas {preset.shape.w}:{preset.shape.h}
              </button>
            </div>
          )}
          <Row label="Export to">
            <span className="export-static">
              <FolderOpen size={14} /> {platform.exportLocation ?? "Chosen when the export starts."}
            </span>
          </Row>

          <Section title="Video" on={s.video} onToggle={(on) => set({ video: on })}>
            <Row label="Resolution" htmlFor="export-res">
              <Select id="export-res" value={s.resolution} onChange={(x) => set({ resolution: x as ResolutionId })}>
                {RESOLUTIONS.map((r) => {
                  const { width, height } = outputSize(project, r.short);
                  return (
                    <option key={r.id} value={r.id}>
                      {r.label} · {width}×{height}
                    </option>
                  );
                })}
              </Select>
            </Row>
            {!gif && <Row label="Bit rate" htmlFor="export-quality">
              <div className="export-pair">
                <Select id="export-quality" value={s.quality} onChange={(x) => set({ quality: x as QualityLevel })}>
                  {QUALITY_LEVELS.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                      {q.id !== "custom" && v ? ` · ${(planExport(project, { ...s, quality: q.id }, inOut).video!.bitrate / 1e6).toFixed(1)} Mbps` : ""}
                    </option>
                  ))}
                </Select>
                {s.quality === "custom" && (
                  <label className="export-mbps">
                    <DraftNumber
                      className="field num"
                      min={0.5}
                      max={400}
                      step={0.5}
                      aria-label="Bit rate in megabits per second"
                      value={s.customMbps}
                      onCommit={v => set({ customMbps: Number(v) })}
                    />
                    Mbps
                  </label>
                )}
              </div>
            </Row>}
            {!gif && <Row label="Codec" htmlFor="export-codec">
              <Select id="export-codec" value={formatCodecs.includes(s.codec) ? s.codec : formatCodecs[0]} onChange={(x) => set({ codec: x as VideoCodec })}>
                {formatCodecs.map((c) => {
                  const off = codecs !== null && !codecs.includes(c);
                  return (
                    <option key={c} value={c} disabled={off}>
                      {CODEC_LABELS[c]}
                      {off ? " · not available here" : ""}
                    </option>
                  );
                })}
              </Select>
            </Row>}
            <Row label="Format" htmlFor="export-format">
              <Select id="export-format" value={s.format} onChange={(x) => setFormat(x as VideoFormat)}>
                {(Object.keys(VIDEO_FORMATS) as VideoFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {VIDEO_FORMATS[f].label}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Frame rate" htmlFor="export-fps">
              <Select
                id="export-fps"
                value={fpsLabel(s.fps)}
                onChange={(x) => set({ fps: rates.find((o) => o.label === x)!.fps })}
              >
                {rates.map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label} fps{sameRate(o.fps, project.fps) ? " · project" : ""}
                  </option>
                ))}
              </Select>
            </Row>
          </Section>

          <Section title="Audio" on={s.audio && !gif} onToggle={(on) => set({ audio: on })} note={gif ? "GIFs have no sound." : undefined}>
            <Row label="Format" htmlFor="export-audio">
              {s.video ? (
                <span className="export-static">
                  {VIDEO_FORMATS[s.format].audio === "aac" ? "AAC" : "Opus"} · 48 kHz stereo, inside the {VIDEO_FORMATS[s.format].label}
                </span>
              ) : (
                <Select id="export-audio" value={s.audioFormat} onChange={(x) => set({ audioFormat: x as AudioFormat })}>
                  {(Object.keys(AUDIO_FORMATS) as AudioFormat[]).map((f) => (
                    <option key={f} value={f}>
                      {AUDIO_FORMATS[f].label}
                    </option>
                  ))}
                </Select>
              )}
            </Row>
            <Row label="Loudness" htmlFor="export-loudness">
              <Select id="export-loudness" value={String(s.loudness ?? "off")} onChange={(x) => set({ loudness: x === "off" ? null : Number(x) })}>
                <option value="off">As mixed</option>
                {LOUDNESS_TARGETS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </Row>
          </Section>

          {captionClips(project).length > 0 && <CaptionsRow s={s} set={set} />}

          <Row label="Range">
            <div className="export-segmented" role="radiogroup" aria-label="Range">
              <button role="radio" aria-checked={s.range === "all"} className={s.range === "all" ? "on" : ""} onClick={() => set({ range: "all" })}>
                Whole timeline
              </button>
              <button
                role="radio"
                aria-checked={s.range === "inout"}
                className={s.range === "inout" ? "on" : ""}
                onClick={() => set({ range: "inout" })}
                disabled={!hasRange}
                data-tip={hasRange ? "Export the marked In to Out range" : "Set In and Out points to export a range"}
                aria-describedby={hasRange ? undefined : "export-range-hint"}
              >
                In to Out
              </button>
            </div>
          </Row>
          {!hasRange && (
            <p className="export-row-hint" id="export-range-hint">
              To export part of the timeline, mark In ({markKey("markIn")}) and Out ({markKey("markOut")}) on it first.
            </p>
          )}
          <CheckRow />
        </div>
      </div>

      <footer className="export-foot">
        <div className="export-summary num">
          <Clock size={14} />
          <span>Duration: {formatDuration(plan.seconds)}</span>
          <span className="export-dot" />
          <span>Size: {formatSize(plan.estimatedBytes)}</span>
        </div>
        {blocker && (
          <span className="export-blocker" role="status">
            {blocker}
          </span>
        )}
        <button className="btn" onClick={closeExportDialog}>
          Cancel
        </button>
        <button className="btn primary export-go" data-default onClick={go} disabled={!!blocker}>
          Export
        </button>
      </footer>
    </>
  );
}

/** The project check before export (ADR-111): what the last check found,
 * and the way to the Check tab, where the findings jump to their clips. A
 * check that is missing, or older than the last edit, is one click away. */
function CheckRow() {
  const job = useCheck((s) => s.job);
  const last = useCheck((s) => s.last);
  const docId = useEditor((s) => documentOf(s).id);
  const revision = useEditor((s) => s.revision);
  const run = last && last.projectId === docId ? last : null;
  const fresh = !!run && run.revision === revision;
  const head = run ? checkHeadline(run.report.summary) : null;
  const open = (check: boolean) => {
    closeExportDialog();
    openCheck(check);
  };
  return (
    <Row label="Check">
      <div className="export-pair export-check">
        <span className={`export-static${fresh && head ? ` ${head.tone}` : ""}`}>
          {job ? (
            <>
              <Loader2 size={14} className="spin" /> Checking the project…
            </>
          ) : !run ? (
            "Not checked yet"
          ) : fresh ? (
            <>
              {head?.tone === "ok" ? <Check size={14} /> : <CircleAlert size={14} />} {checkCounts(run.report.summary)}
            </>
          ) : (
            `${checkCounts(run.report.summary)} before your last changes`
          )}
        </span>
        <button className="btn ghost" onClick={() => open(!job && !fresh)}>
          {job ? "Show" : fresh ? "Review" : run ? "Check again" : "Check project"}
        </button>
      </div>
    </Row>
  );
}

/** The frame under the playhead, as CapCut shows its cover. */
function Cover({ project }: { project: Project }) {
  const [url, setUrl] = useState<string | null>(null);
  const empty = !project.tracks.some((t) => t.clips.length);
  useEffect(() => {
    if (empty) return;
    let live = true;
    let made: string | null = null;
    stillToUrl(store.get().playhead, "480p")
      .then((r) => {
        made = r.url;
        if (live) setUrl(r.url);
        else URL.revokeObjectURL(r.url);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [empty]);
  return (
    <div className="export-frame" style={{ aspectRatio: `${project.width} / ${project.height}` }}>
      {url ? <img src={url} alt="The frame under the playhead" /> : <Film size={28} />}
    </div>
  );
}

function Row(props: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="export-row">
      <label className="export-label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      <div className="export-control">{props.children}</div>
    </div>
  );
}

function Section(props: { title: string; on: boolean; onToggle: (on: boolean) => void; children: ReactNode; note?: string }) {
  const id = `export-sec-${props.title.toLowerCase()}`;
  return (
    <section className={`export-section${props.on ? "" : " off"}`} aria-labelledby={id}>
      <label className="export-section-head" id={id}>
        <input type="checkbox" checked={props.on} disabled={!!props.note} onChange={(e) => props.onToggle(e.target.checked)} />
        {props.title}
        {props.note && <span className="export-section-note">{props.note}</span>}
      </label>
      {props.on && <div className="export-section-body">{props.children}</div>}
    </section>
  );
}

function Select(props: { id: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className="export-select">
      <select id={props.id} className="field" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.children}
      </select>
      <ChevronDown size={14} aria-hidden />
    </span>
  );
}

// ---- progress, done, failed ---------------------------------------------------------------

function ProgressView({ view }: { view: Extract<ExportView, { phase: "running" }> }) {
  const { progress: p, plan } = view;
  const pct = Math.floor(p.fraction * 100);
  const preparing = p.phase === "preparing";
  const video = !!plan.video;
  return (
    <div className="export-state">
      <div
        className={`export-ring${preparing ? " waiting" : ""}`}
        style={{ "--p": p.fraction } as CSSProperties}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Export progress"
      >
        <div className="export-ring-inner">
          {preparing ? <Loader2 className="spin" size={28} /> : <span className="export-pct num">{pct}%</span>}
          <span className="export-ring-sub">{preparing ? "Preparing" : p.phase === "finalizing" ? "Finishing" : "Exporting"}</span>
        </div>
      </div>
      <div className="export-file">{view.fileName}</div>
      <div className="export-stats num" aria-live="polite">
        {preparing
          ? "Opening encoders and media"
          : video
            ? `Frame ${Math.round(p.done)} of ${p.total} · ${Math.round(p.fps)} fps · ${formatEta(p.eta)}`
            : `${formatDuration(p.done)} of ${formatDuration(p.total)} · ${p.fps.toFixed(0)}x real time · ${formatEta(p.eta)}`}
      </div>
      <p className="export-hint">Keep this window open until the export finishes. It can be in the background.</p>
      <div className="export-actions">
        <button className="btn" data-autofocus onClick={cancelExport}>
          Cancel export
        </button>
      </div>
    </div>
  );
}

/** What becomes of the captions (ADR-080): burned into the picture, an SRT
 * file beside the export, both, or neither. Audio-only has no picture, so
 * it offers the file or nothing. */
function CaptionsRow({ s, set }: { s: ExportSettings; set: (patch: Partial<ExportSettings>) => void }) {
  const plan = captionPlan(s);
  const value: CaptionExport = s.video ? s.captions : plan.sidecar ? "srt" : "none";
  return (
    <>
      <Row label="Captions" htmlFor="export-captions">
        <Select id="export-captions" value={value} onChange={(x) => set({ captions: x as CaptionExport })}>
          {CAPTION_EXPORTS.filter((o) => s.video || o.id === "srt" || o.id === "none").map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      </Row>
      {plan.sidecar && (
        <p className="export-row-hint">
          {platform.kind === "desktop" ? "The .srt file is saved beside the export, with its name." : "The .srt file downloads when the export is done, with its name."}
        </p>
      )}
    </>
  );
}

function DoneView({ view }: { view: Extract<ExportView, { phase: "done" }> }) {
  const r = view.result;
  return (
    <div className="export-state">
      <div className="export-badge ok">
        <Check size={30} strokeWidth={2.5} />
      </div>
      <h3 className="export-title">Export complete</h3>
      <div className="export-file">{view.fileName}</div>
      {view.captionsFile && <div className="export-file export-sidecar">Captions: {view.captionsFile.split(/[\\/]/).pop()}</div>}
      <div className="export-stats num">
        {formatDuration(r.seconds)} · {formatBytes(r.bytes)} · made in {r.elapsed < 10 ? r.elapsed.toFixed(1) : Math.round(r.elapsed)} s
        {r.videoCodec ? ` · ${CODEC_LABELS[r.videoCodec]}` : ""}
      </div>
      {r.info && (
        <div className="export-note ok" role="status">
          <Check size={14} /> {r.info}
        </div>
      )}
      {r.note && (
        <div className="export-note">
          <CircleAlert size={14} /> {r.note}
        </div>
      )}
      <div className="export-actions">
        {view.revealLabel && view.reveal && (
          <button className="btn primary" data-autofocus data-default onClick={() => void view.reveal!()}>
            <Download size={14} /> {view.revealLabel}
          </button>
        )}
        <button className="btn" onClick={backToSettings}>
          Export another
        </button>
        <button className="btn" data-autofocus={view.revealLabel ? undefined : true} data-default={view.revealLabel ? undefined : true} onClick={closeExportDialog}>
          Close
        </button>
      </div>
    </div>
  );
}

function FailedView({ message }: { message: string }) {
  return (
    <div className="export-state">
      <div className="export-badge bad">
        <CircleAlert size={30} />
      </div>
      <h3 className="export-title">The export didn't finish</h3>
      <p className="export-error" role="alert">
        {message}
      </p>
      <div className="export-actions">
        <button className="btn primary" data-autofocus data-default onClick={backToSettings}>
          Back to settings
        </button>
        <button className="btn" onClick={closeExportDialog}>
          Close
        </button>
      </div>
    </div>
  );
}
