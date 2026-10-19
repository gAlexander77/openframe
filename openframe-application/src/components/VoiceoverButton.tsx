import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mic } from "../icons";
import { formatDuration } from "../lib/time";
import { cancelVoiceover, inputLevel, microphones, startVoiceover, stopVoiceover, useVoiceover } from "../state/voiceover";
import "./voiceover.css";

const PREFS = "ve.voiceover";
function readPrefs(): { deviceId: string; mute: boolean } {
  try {
    return { deviceId: "", mute: false, ...JSON.parse(localStorage.getItem(PREFS) ?? "{}") };
  } catch {
    return { deviceId: "", mute: false };
  }
}

/**
 * CapCut's Record voiceover button in the timeline toolbar: a panel to pick
 * the microphone and whether to hear the project, then a countdown and a
 * take that plays the timeline from the playhead.
 */
export function VoiceoverButton() {
  const phase = useVoiceover();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [, tick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const busy = phase.kind !== "idle";
  // The panel is fixed under the button, or above it when the window has
  // no room below. Absolute in the toolbar, the timeline panel clipped it:
  // at the desktop's 1100 x 680 minimum its foot ran past the window's
  // bottom edge. (Fixed, it stays next to the button for Tab order; the
  // toolbar's container-type does not contain fixed boxes.)
  const [at, setAt] = useState<{ top: number; left: number; up: boolean } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setAt(null);
    const place = () => {
      const el = panel.current, r = box.current?.getBoundingClientRect();
      if (!el || !r) return;
      const h = el.offsetHeight, w = el.offsetWidth, below = r.bottom + 6;
      const up = below + h > innerHeight - 8;
      setAt({ top: up ? Math.max(8, r.top - 6 - h) : below, left: Math.min(Math.max(8, r.right - w), innerWidth - 8 - w), up });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, phase.kind]);
  const live = phase.kind === "recording";

  useEffect(() => {
    if (open) void microphones().then(setInputs).catch(() => setInputs([]));
  }, [open, phase.kind]);
  // The meter and the elapsed time redraw every frame while live.
  useEffect(() => {
    if (phase.kind !== "recording" && phase.kind !== "countdown") return;
    let raf = requestAnimationFrame(function loop() {
      tick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [phase.kind]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!busy && !box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (busy) cancelVoiceover();
      else setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, busy]);

  const save = (next: typeof prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS, JSON.stringify(next));
    } catch {
      /* storage blocked: the choice lasts this session */
    }
  };
  const level = busy ? inputLevel() : 0;

  return (
    <div className="vo" ref={box}>
      <button
        className={`icon-btn${open || busy ? " on" : ""}${live ? " vo-live" : ""}`}
        aria-label="Record voiceover"
        aria-expanded={open}
        data-tip="Record voiceover"
        onClick={() => (live ? void stopVoiceover() : setOpen(busy || !open))}
      >
        <Mic />
      </button>
      {open && (
        <div ref={panel} className={`menu vo-panel${at?.up ? " up" : ""}`} role="dialog" aria-label="Record voiceover" style={at ? { top: at.top, left: at.left } : { visibility: "hidden" }}>
          <div className="vo-title">Record voiceover</div>
          <label className="vo-row">
            <span>Microphone</span>
            <select className="field" value={prefs.deviceId} disabled={busy} onChange={(e) => save({ ...prefs, deviceId: e.target.value })}>
              <option value="">System default</option>
              {inputs
                .filter((d) => d.deviceId && d.deviceId !== "default")
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="vo-check">
            <input type="checkbox" checked={prefs.mute} disabled={busy} onChange={(e) => save({ ...prefs, mute: e.target.checked })} />
            <span>Mute the project while recording</span>
          </label>
          <div className="vo-meter" aria-hidden>
            <span style={{ width: `${Math.min(100, level * 100)}%` }} />
          </div>
          <div className="vo-status" role="status">
            {phase.kind === "starting" && <span>Waiting for the microphone…</span>}
            {phase.kind === "countdown" && <span className="vo-count">Starting in {phase.n}</span>}
            {phase.kind === "recording" && <span className="vo-rec">Recording {formatDuration((performance.now() - phase.since) / 1000)}</span>}
            {phase.kind === "saving" && <span>Saving the take…</span>}
            {phase.kind === "idle" && <span>Plays the timeline from the playhead and adds the take on an audio track.</span>}
          </div>
          <div className="vo-actions">
            {phase.kind === "idle" && (
              <button className="btn primary" onClick={() => void startVoiceover({ deviceId: prefs.deviceId || undefined, mute: prefs.mute })}>
                Start recording
              </button>
            )}
            {(phase.kind === "countdown" || phase.kind === "starting") && (
              <button className="btn" onClick={cancelVoiceover}>
                Cancel
              </button>
            )}
            {live && (
              <>
                <button className="btn primary" autoFocus onClick={() => void stopVoiceover()}>
                  Stop and keep
                </button>
                <button className="btn ghost" onClick={cancelVoiceover}>
                  Discard
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
