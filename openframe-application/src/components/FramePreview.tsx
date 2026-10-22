import { usePrefs } from "../state/prefs";
import { proxyHealth } from "../engine/playbackProxies";
import { prefsStore } from "../state/prefs";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Compositor } from "../engine/compositor";
import { CursorPool, resolveSources, sourceImages } from "../engine/player";
import type { Project } from "../lib/project/types";
import { planFrame } from "../lib/render/plan";

/** Latest-request-wins rendering with private cursors. Samples remain borrowed
 * until the synchronous composite; cleanup waits for the pending decode. */
export function FramePreview({ project, frame, label }: { project: Project; frame: number; label: string }) {
  const { proxyPlayback } = usePrefs();
  const proxyRevision = useSyncExternalStore(proxyHealth.subscribe, proxyHealth.version);
  const canvas = useRef<HTMLCanvasElement>(null);
  const request = useRef<(p: Project, f: number) => void>(() => {});
  const [error, setError] = useState("");
  useEffect(() => {
    const el = canvas.current!;
    const comp = new Compositor(el);
    const pool = new CursorPool({ maxSide: 640 }, "preview", () => prefsStore.get().proxyPlayback);
    // A page gets about 16 WebGL contexts and one per trim pane adds up; a
    // real unmount (the canvas left the page, unlike StrictMode's rehearsal)
    // gives its context back instead of waiting for GC.
    const release = () => {
      pool.clear();
      comp.dispose();
      if (!el.isConnected) el.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    };
    let pending: { p: Project; f: number } | null = null, running = false, disposed = false;
    const pump = async () => {
      if (running) return;
      running = true;
      try {
        while (pending && !disposed) {
          const { p, f } = pending; pending = null;
          const plan = planFrame(p, f);
          const sources = await resolveSources(p, plan, pool);
          if (disposed) break;
          const k = Math.min(1, 640 / p.width, 360 / p.height);
          const w = Math.max(2, Math.round(p.width * k)), h = Math.max(2, Math.round(p.height * k));
          comp.resize(w, h);
          comp.render(plan, sourceImages(sources, w, h), p.background);
          el.dataset.frame = String(f);
          setError(plan.some((i) => i.kind === "layer" && ["video", "image"].includes(i.layer.source.kind) && !sources.has(i.layer.clipId)) ? "Source unavailable" : "");
          pool.sweep(2000);
        }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : String(e)); }
      finally {
        running = false;
        if (disposed) release();
        // An error ends the loop; a newer request must still be drawn.
        else if (pending) void pump();
      }
    };
    request.current = (p, f) => { pending = { p, f }; void pump(); };
    return () => { disposed = true; pending = null; request.current = () => {}; if (!running) release(); };
  }, []);
  useEffect(() => { request.current(project, frame); }, [project, frame, proxyPlayback, proxyRevision]);
  return <div className="frame-preview"><canvas ref={canvas} aria-label={label} />{error && <span className="frame-preview-error" role="status">{error}</span>}</div>;
}
