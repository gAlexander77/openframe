// The export dialog, after CapCut's (docs/research/CapCut desktop.md §6.1):
// name and location, a Video section (resolution, bit rate, codec, format,
// frame rate), an Audio section, the range, and a footer with the duration
// and a live size estimate. Export switches it to a progress view (ring,
// frames, speed, time left, Cancel), then a done view. All the numbers come
// from src/lib/export.ts, so the estimate is the bitrate the encoder gets.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { encodableVideoCodecs } from "../engine/export";
import { Check, ChevronDown, CircleAlert, Download, Film, FolderOpen, ImageDown, Loader2, X } from "../icons";
import {
  AUDIO_FORMATS,
  CODEC_LABELS,
  QUALITY_LEVELS,
  RESOLUTIONS,
  VIDEO_FORMATS,
  defaultExportSettings,
  exportBlocker,
  formatBytes,
  formatEta,
  formatSize,
  fpsLabel,
  fpsOptions,
  outputSize,
  planExport,
  sameRate,
  type AudioFormat,
  type ExportSettings,
  type QualityLevel,
  type ResolutionId,
  type VideoCodec,
  type VideoFormat,
} from "../lib/export";
import type { Project } from "../lib/project/types";
import { formatDuration } from "../lib/time";
import { platform } from "../platform";
import { backToSettings, cancelExport, closeExportDialog, saveStill, startExport, stillToUrl, useExportView, type ExportView } from "../state/export";
import { store, useEditor } from "../state/store";
import { toast } from "../state/toast";
import "./export.css";

/** Choices remembered between exports (not the name, rate or range, which
 * belong to the project). */
const REMEMBERED = ["video", "format", "codec", "resolution", "quality", "customMbps", "audio", "audioFormat"] as const;

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
  const project = useEditor((s) => s.project);
  const inPoint = useEditor((s) => s.inPoint);
  const outPoint = useEditor((s) => s.outPoint);
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
    encodableVideoCodecs(s.format, v.width, v.height, s.fps, v.bitrate)
      .then((c) => live && setCodecs(c))
      .catch(() => live && setCodecs(VIDEO_FORMATS[s.format].codecs));
    return () => {
      live = false;
    };
  }, [s.format, v?.width, v?.height, s.fps.num, s.fps.den]);
  useEffect(() => {
    if (codecs?.length && !codecs.includes(s.codec)) set({ codec: codecs[0] });
  }, [codecs]);

  const formatCodecs = VIDEO_FORMATS[s.format].codecs;
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
            <input id="export-name" className="field" data-autofocus value={s.name} spellCheck={false} onChange={(e) => set({ name: e.target.value })} />
          </Row>
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
            <Row label="Bit rate" htmlFor="export-quality">
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
                    <input
                      className="field num"
                      type="number"
                      min={0.5}
                      max={400}
                      step={0.5}
                      aria-label="Bit rate in megabits per second"
                      value={s.customMbps}
                      onChange={(e) => set({ customMbps: Math.max(0.2, Number(e.target.value) || 0) })}
                    />
                    Mbps
                  </label>
                )}
              </div>
            </Row>
            <Row label="Codec" htmlFor="export-codec">
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
            </Row>
            <Row label="Format" htmlFor="export-format">
              <Select id="export-format" value={s.format} onChange={(x) => set({ format: x as VideoFormat })}>
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
                onChange={(x) => set({ fps: fpsOptions(project.fps).find((o) => o.label === x)!.fps })}
              >
                {fpsOptions(project.fps).map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label} fps{sameRate(o.fps, project.fps) ? " · project" : ""}
                  </option>
                ))}
              </Select>
            </Row>
          </Section>

          <Section title="Audio" on={s.audio} onToggle={(on) => set({ audio: on })}>
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
          </Section>

          <Row label="Range">
            <div className="segmented" role="radiogroup" aria-label="Range">
              <button role="radio" aria-checked={s.range === "all"} className={s.range === "all" ? "on" : ""} onClick={() => set({ range: "all" })}>
                Whole timeline
              </button>
              <button
                role="radio"
                aria-checked={s.range === "inout"}
                className={s.range === "inout" ? "on" : ""}
                onClick={() => set({ range: "inout" })}
                disabled={!hasRange}
                title={hasRange ? undefined : "Mark In and Out on the timeline first"}
              >
                In to Out
              </button>
            </div>
          </Row>
        </div>
      </div>

      <footer className="export-foot">
        <div className="export-summary num">
          <Film size={14} />
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

function Section(props: { title: string; on: boolean; onToggle: (on: boolean) => void; children: ReactNode }) {
  const id = `export-sec-${props.title.toLowerCase()}`;
  return (
    <section className={`export-section${props.on ? "" : " off"}`} aria-labelledby={id}>
      <label className="export-section-head" id={id}>
        <input type="checkbox" checked={props.on} onChange={(e) => props.onToggle(e.target.checked)} />
        {props.title}
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

function DoneView({ view }: { view: Extract<ExportView, { phase: "done" }> }) {
  const r = view.result;
  return (
    <div className="export-state">
      <div className="export-badge ok">
        <Check size={30} strokeWidth={2.5} />
      </div>
      <h3 className="export-title">Export complete</h3>
      <div className="export-file">{view.fileName}</div>
      <div className="export-stats num">
        {formatDuration(r.seconds)} · {formatBytes(r.bytes)} · made in {r.elapsed < 10 ? r.elapsed.toFixed(1) : Math.round(r.elapsed)} s
        {r.videoCodec ? ` · ${CODEC_LABELS[r.videoCodec]}` : ""}
      </div>
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
