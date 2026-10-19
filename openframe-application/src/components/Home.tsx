import { useEffect, useRef, useState } from "react";
import { Clapperboard, Copy, LayoutGrid, List, Pencil, Plus, RotateCcw, Search, Trash2 } from "../icons";
import { expiryText, TRASH_DAYS } from "../lib/projectTrash";
import { formatDuration } from "../lib/time";
import { platform, type ProjectSummary } from "../platform";
import { duplicateProject, listSaved, newProject, openProject, renameProject, restoreProject, trashProject, useSession } from "../state/project";
import { toast } from "../state/toast";
import { MenuList, useDismiss, type MenuItem } from "./Menu";
import { RenameField } from "./RenameField";
import "./home.css";

const PRESETS: { label: string; hint: string; w: number; h: number }[] = [
  { label: "16:9", hint: "YouTube, widescreen", w: 1920, h: 1080 },
  { label: "9:16", hint: "TikTok, Reels, Shorts", w: 1080, h: 1920 },
  { label: "1:1", hint: "Square posts", w: 1080, h: 1080 },
  { label: "4:5", hint: "Instagram feed", w: 1080, h: 1350 },
  { label: "21:9", hint: "Cinematic", w: 2560, h: 1080 },
];

/** When a project was last edited: "just now", "6 min ago", a date. */
function when(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Grid or list, as CapCut's Projects header toggles; per viewer. */
type View = "grid" | "list";
const VIEW_KEY = "home.view";
const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
};

/** The last Open request Home answered: Home remounts on every return,
 * and only a new request should take focus. */
let answeredOpen = 0;

/** CapCut's home: a big Create project card, canvas presets, and every
 * project as a card with its thumbnail, or as a row in the list view. */
export function Home() {
  const { openRequest, transitioning } = useSession();
  const search = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  /** Recently deleted (ADR-078). */
  const [trash, setTrash] = useState<ProjectSummary[]>([]);
  const [q, setQ] = useState("");
  const [view, setViewState] = useState(savedView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice lasts this visit */
    }
  };
  /** A trashed project armed for Delete forever: that one cannot be undone. */
  const [confirm, setConfirm] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(!!menu, menuRef, () => setMenu(null));
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
  const duplicate = (p: ProjectSummary) => void duplicateProject(p).then(refresh, failed);
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

  // What a card or row does: open on click or Enter, CapCut's right-click
  // menu (Rename, Duplicate, Delete), and the same three as hover buttons.
  const item = (p: ProjectSummary) => ({
    role: "button",
    tabIndex: transitioning ? -1 : 0,
    "aria-disabled": transitioning,
    onClick: () => void openProject(p.id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      void openProject(p.id);
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (transitioning || renaming === p.id) return;
      // From the keyboard's menu key the pointer is nowhere: under the item.
      const r = e.currentTarget.getBoundingClientRect();
      const keyed = e.clientX === 0 && e.clientY === 0;
      setMenu({
        x: keyed ? r.left + 12 : e.clientX,
        y: keyed ? r.top + 12 : e.clientY,
        items: [
          { label: "Open", onSelect: () => void openProject(p.id) },
          { label: "Rename…", onSelect: () => setRenaming(p.id) },
          { label: "Duplicate", onSelect: () => duplicate(p) },
          "-",
          { label: "Delete", hint: "To Recently deleted", onSelect: () => remove(p) },
        ],
      });
    },
  });
  const tool = (label: string, tip: string, icon: React.ReactNode, run: () => void, className = "project-tool") => (
    <button
      className={className}
      disabled={transitioning}
      aria-label={label}
      data-tip={tip}
      onClick={(e) => {
        e.stopPropagation();
        run();
      }}
    >
      {icon}
    </button>
  );
  const nameOf = (p: ProjectSummary) =>
    renaming === p.id ? (
      <RenameField
        name={p.name}
        label={`New name for ${p.name}`}
        className="field project-rename"
        onDone={(name) => {
          setRenaming(null);
          if (name?.trim()) void renameProject(p, name).then(refresh, failed);
        }}
      />
    ) : (
      <strong className="project-card-name" data-tip={p.name}>
        {p.name}
      </strong>
    );

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
          <span className="home-head-tools">
            <label className="lib-search home-search">
              <Search size={14} />
              <input ref={search} className="field" placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <span className="home-views" role="group" aria-label="Project view">
              <button className={`icon-btn${view === "grid" ? " on" : ""}`} aria-label="Grid view" data-tip="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
                <LayoutGrid size={14} />
              </button>
              <button className={`icon-btn${view === "list" ? " on" : ""}`} aria-label="List view" data-tip="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
                <List size={14} />
              </button>
            </span>
          </span>
        </header>
        {projects === null ? null : shown.length === 0 ? (
          <div className="home-empty">
            <Clapperboard size={28} strokeWidth={1.4} />
            <strong>{q ? `No project matches “${q}”` : trash.length ? "No projects here" : "No projects yet"}</strong>
            <span>{q ? "Try another name." : trash.length ? "Restore one from Recently deleted below, or create one." : "Projects save automatically as you edit. Create one to get started."}</span>
          </div>
        ) : view === "list" ? (
          <div className="project-list">
            <div className="project-row project-list-head" aria-hidden>
              <span />
              <span>Name</span>
              <span>Canvas</span>
              <span>Length</span>
              <span>Edited</span>
              <span />
            </div>
            {shown.map((p) => (
              <div key={p.id} className="project-row" {...item(p)}>
                <span className="project-row-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Clapperboard size={16} strokeWidth={1.3} />}</span>
                {nameOf(p)}
                <span className="project-meta num">
                  {p.width}×{p.height}
                </span>
                <span className="project-meta num">{p.duration > 0 ? formatDuration(p.duration) : "Empty"}</span>
                <span className="project-meta">{capital(when(p.updatedAt))}</span>
                <span className="project-row-tools">
                  {tool(`Rename ${p.name}`, "Rename", <Pencil size={13} />, () => setRenaming(p.id), "icon-btn small")}
                  {tool(`Duplicate ${p.name}`, "Duplicate", <Copy size={13} />, () => duplicate(p), "icon-btn small")}
                  {tool(`Delete ${p.name}`, "Delete project (it waits in Recently deleted)", <Trash2 size={13} />, () => remove(p), "icon-btn small")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="project-grid">
            {shown.map((p) => (
              <div key={p.id} className="project-card" {...item(p)}>
                <div className="project-thumb">
                  {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Clapperboard size={24} strokeWidth={1.3} />}
                  {p.duration > 0 && <span className="chip num">{formatDuration(p.duration)}</span>}
                  <span className="project-tools">
                    {tool(`Rename ${p.name}`, "Rename", <Pencil size={13} />, () => setRenaming(p.id))}
                    {tool(`Duplicate ${p.name}`, "Duplicate", <Copy size={13} />, () => duplicate(p))}
                  </span>
                  {tool(`Delete ${p.name}`, "Delete project (it waits in Recently deleted)", <Trash2 size={13} />, () => remove(p), "project-delete")}
                </div>
                {nameOf(p)}
                <span className="project-meta num">
                  {p.width}×{p.height} · Edited {when(p.updatedAt)}
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
                  <span className="trash-thumb">{p.thumbnail ? <img src={p.thumbnail} alt="" /> : <Clapperboard size={16} strokeWidth={1.3} />}</span>
                  <span className="trash-info">
                    <strong className="project-card-name" data-tip={p.name}>{p.name}</strong>
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
      {menu && (
        <div className="ctx-anchor" ref={menuRef} style={{ left: menu.x, top: menu.y }}>
          <MenuList items={menu.items} onDone={() => setMenu(null)} style={{ top: 0 }} />
        </div>
      )}
    </div>
  );
}
