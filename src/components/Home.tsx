import { useEffect, useRef, useState } from "react";
import { Clapperboard, Film, Plus, Search, Trash2 } from "../icons";
import { formatDuration } from "../lib/time";
import { platform, type ProjectSummary } from "../platform";
import { newProject, openProject, useSession } from "../state/project";
import "./home.css";

const PRESETS: { label: string; hint: string; w: number; h: number }[] = [
  { label: "16:9", hint: "YouTube, widescreen", w: 1920, h: 1080 },
  { label: "9:16", hint: "TikTok, Reels, Shorts", w: 1080, h: 1920 },
  { label: "1:1", hint: "Square posts", w: 1080, h: 1080 },
  { label: "4:5", hint: "Instagram feed", w: 1080, h: 1350 },
  { label: "21:9", hint: "Cinematic", w: 2560, h: 1080 },
];

function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "Edited just now";
  if (s < 3600) return `Edited ${Math.round(s / 60)} min ago`;
  if (s < 86400) return `Edited ${Math.round(s / 3600)} h ago`;
  return `Edited ${new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** CapCut's home: a big Create project card, canvas presets, and every
 * project as a card with its thumbnail. */
/** The last Open request Home answered: Home remounts on every return,
 * and only a new request should take focus. */
let answeredOpen = 0;

export function Home() {
  const { openRequest, transitioning } = useSession();
  const search = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);

  const refresh = () =>
    platform
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (openRequest === answeredOpen) return;
    answeredOpen = openRequest;
    search.current?.focus();
    search.current?.select();
  }, [openRequest]);

  const shown = (projects ?? []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="home" aria-busy={transitioning}>
      <section className="home-hero">
        <button className="create-card" disabled={transitioning} onClick={() => void newProject()}>
          <span className="create-icon">
            <Plus size={26} strokeWidth={2.2} />
          </span>
          <span className="create-text">
            <strong>Create project</strong>
            <span>Import media and start editing. Everything stays on this {platform.kind === "desktop" ? "computer" : "browser"}.</span>
          </span>
        </button>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.label} className="preset" disabled={transitioning} onClick={() => void newProject({ width: p.w, height: p.h })} data-tip={`${p.w}×${p.h}`}>
              <span className="preset-box" style={{ aspectRatio: `${p.w} / ${p.h}` }} />
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-projects">
        <header className="home-projects-head">
          <h2>Projects</h2>
          {transitioning && <span role="status">Opening project…</span>}
          <label className="lib-search home-search">
            <Search size={14} />
            <input ref={search} className="field" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </header>
        {projects === null ? null : shown.length === 0 ? (
          <div className="home-empty">
            <Clapperboard size={28} strokeWidth={1.4} />
            <strong>{q ? `No project matches “${q}”` : "No projects yet"}</strong>
            <span>{q ? "Try another name." : "Projects save automatically as you edit. Create one to get started."}</span>
          </div>
        ) : (
          <div className="project-grid">
            {shown.map((p) => (
              <div key={p.id} className="project-card" role="button" tabIndex={transitioning ? -1 : 0} aria-disabled={transitioning} onClick={() => void openProject(p.id)} onKeyDown={(e) => {
                if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
                e.preventDefault();
                void openProject(p.id);
              }}>
                <div className="project-thumb">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Film size={24} strokeWidth={1.3} />}
                  {p.duration > 0 && <span className="chip num">{formatDuration(p.duration)}</span>}
                  <button
                    className={`project-delete${confirm === p.id ? " armed" : ""}`}
                    disabled={transitioning}
                    aria-label={confirm === p.id ? `Confirm delete ${p.name}` : `Delete ${p.name}`}
                    data-tip={confirm === p.id ? "Click again to delete" : "Delete project"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm !== p.id) {
                        setConfirm(p.id);
                        setTimeout(() => setConfirm((c) => (c === p.id ? null : c)), 3000);
                        return;
                      }
                      void platform.deleteProject(p.id).then(refresh);
                    }}
                  >
                    <Trash2 size={13} />
                    {confirm === p.id && <span>Delete?</span>}
                  </button>
                </div>
                <strong className="project-card-name">{p.name}</strong>
                <span className="project-meta num">
                  {p.width}×{p.height} · {ago(p.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
        {platform.kind === "web" && <p className="home-note">Web projects and imported media are kept in this browser's private storage. Clearing site data removes them.</p>}
      </section>
    </div>
  );
}
