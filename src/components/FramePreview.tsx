import { useEffect, useRef, useState } from "react";
import { Compositor } from "../engine/compositor";
import { CursorPool, resolveSources, sourceImages } from "../engine/player";
import type { Project } from "../lib/project/types";
import { planFrame } from "../lib/render/plan";

/** Latest-request-wins rendering with private cursors. Samples remain borrowed
 * until the synchronous composite; cleanup waits for the pending decode. */
export function FramePreview({ project, frame, label }: { project: Project; frame: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const request = useRef<(p: Project, f: number) => void>(() => {});
  const [error, setError] = useState("");
  useEffect(() => {
    const comp = new Compositor(canvas.current!);
    const pool = new CursorPool({ maxSide: 640 });
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
          canvas.current!.dataset.frame = String(f);
          setError(plan.length && !sources.size ? "Source unavailable" : "");
          pool.sweep(2000);
        }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : String(e)); }
      finally { running = false; if (disposed) { pool.clear(); comp.dispose(); } }
    };
    request.current = (p, f) => { pending = { p, f }; void pump(); };
    return () => { disposed = true; pending = null; request.current = () => {}; if (!running) { pool.clear(); comp.dispose(); } };
  }, []);
  useEffect(() => { request.current(project, frame); }, [project, frame]);
  return <div className="frame-preview"><canvas ref={canvas} aria-label={label} />{error && <span className="frame-preview-error" role="status">{error}</span>}</div>;
}
