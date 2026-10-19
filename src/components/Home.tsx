import { useEffect, useRef, useState } from "react";
import { Clapperboard, Copy, Film, Pencil, Plus, RotateCcw, Search, Trash2 } from "../icons";
import { expiryText, TRASH_DAYS } from "../lib/projectTrash";
import { formatDuration } from "../lib/time";
import { platform, type ProjectSummary } from "../platform";
import { duplicateProject, listSaved, newProject, openProject, renameProject, restoreProject, trashProject, useSession } from "../state/project";
import { toast } from "../state/toast";
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
  /** Recently deleted (ADR-078). */
  const [trash, setTrash] = useState<ProjectSummary[]>([]);
  const [q, setQ] = useState("");
  /** A trashed project armed for Delete forever: that one cannot be undone. */
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const failed = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error");

  const refresh = () =>
    listSaved()
      .then(({ live, trash }) => {
        setProjects(live);
        setTrash(trash);
      })
      .catch(() => setProjects([]));
  // Delete moves a project to Recently deleted at once, with Undo on the
  // toast; Delete forever there asks twice.
  const remove = (p: ProjectSummary) =>
    void trashProject(p).then(() => {
      void refresh();
      toast(`Moved “${p.name}” to Recently deleted`, "info", 8000, { label: "Undo", run: () => void restoreProject(p).then(refresh, failed) });
    }, failed);
  const deleteForever = (p: ProjectSummary) => {
    if (confirm !== p.id) {
      setConfirm(p.id);
      setTimeout(() => setConfirm((c) => (c === p.id ? null : c)), 3000);
      return;
    }
    void platform.deleteProject(p.id).then(refresh, failed);
  };
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
            <strong>{q ? `No project matches “${q}”` : trash.length ? "No projects here" : "No projects yet"}</strong>
            <span>{q ? "Try another name." : trash.length ? "Restore one from Recently deleted below, or create one." : "Projects save automatically as you edit. Create one to get started."}</span>
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
                  <span className="project-tools">
                    <button className="project-tool" disabled={transitioning} aria-label={`Rename ${p.name}`} data-tip="Rename" onClick={(e) => (e.stopPropagation(), setRenaming(p.id))}>
                      <Pencil size={13} />
                    </button>
                    <button
                      className="project-tool"
                      disabled={transitioning}
                      aria-label={`Duplicate ${p.name}`}
                      data-tip="Duplicate"
                      onClick={(e) => {
                        e.stopPropagation();
                        void duplicateProject(p).then(refresh, failed);
                      }}
                    >
                      <Copy size={13} />
                    </button>
                  </span>
                  <button
                    className="project-delete"
                    disabled={transitioning}
                    aria-label={`Delete ${p.name}`}
                    data-tip="Delete project (it waits in Recently deleted)"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(p);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {renaming === p.id ? (
                  <input
                    className="field project-rename"
                    aria-label={`New name for ${p.name}`}
                    defaultValue={p.name}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation(); // not the card's Enter, which opens it
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={(e) => {
                      const name = e.currentTarget.value;
                      setRenaming(null);
                      if (name.trim() && name.trim() !== p.name) void renameProject(p, name).then(refresh, failed);
                    }}
                  />
                ) : (
                  <strong className="project-card-name">{p.name}</strong>
                )}
                <span className="project-meta num">
                  {p.width}×{p.height} · {ago(p.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
        {trash.length > 0 && (
          <details className="home-trash">
            <summary>
              Recently deleted <span className="num">({trash.length})</span>
            </summary>
            <p className="home-trash-note">Deleted projects wait here for {TRASH_DAYS} days, then they are deleted for good. Their media files are never touched.</p>
            <ul className="trash-list">
              {trash.map((p) => (
                <li key={p.id} className="trash-row">
                  <span className="trash-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Film size={16} strokeWidth={1.3} />}</span>
                  <span className="trash-info">
                    <strong className="project-card-name">{p.name}</strong>
                    <span className="project-meta">{expiryText(p.deletedAt!, Date.now())}</span>
                  </span>
                  <button className="btn" disabled={transitioning} aria-label={`Restore ${p.name}`} onClick={() => void restoreProject(p).then(refresh, failed)}>
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className={`btn ghost trash-forever${confirm === p.id ? " armed" : ""}`}
                    disabled={transitioning}
                    aria-label={confirm === p.id ? `Confirm delete ${p.name} forever` : `Delete ${p.name} forever`}
                    onClick={() => deleteForever(p)}
                  >
                    <Trash2 size={13} /> {confirm === p.id ? "Click again to delete forever" : "Delete forever"}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {platform.kind === "web" && <p className="home-note">Web projects and imported media are kept in this browser's private storage. Clearing site data removes them.</p>}
      </section>
    </div>
  );
}
