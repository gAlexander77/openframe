// Project lifecycle: create, open, autosave, close. CapCut has no save
// dialog — every change is saved within a moment and the home screen lists
// projects with a thumbnail. We do the same: autosave debounced on every
// revision, a "Saved" stamp in the title bar, and Ctrl+S to save now.

import { useSyncExternalStore } from "react";
import { prepare } from "../engine/thumbs";
import { player } from "../engine/player";
import { createProject, normalizeProject, uid, type ProjectInit } from "../lib/project/defaults";
import { projectSummary } from "../lib/project/summary";
import type { Project } from "../lib/project/types";
import { platform, type ProjectSummary } from "../platform";
import { provide } from "./actions";
import { store } from "./store";
import { dismiss, updateToast, toast } from "./toast";
import { projectWork } from "./projectWork";
import { copyProject } from "../lib/project/copy";
import { markDeleted, markRestored, splitTrash } from "../lib/projectTrash";

export type Screen = "home" | "editor";

interface Session {
  screen: Screen;
  /** Incremented by Open, including when Home is already showing. */
  openRequest: number;
  /** One navigation at a time; repeated requests are ignored, not queued. */
  transitioning: boolean;
  /** "Saving…", "Saved 10:42", "Couldn't save: …" */
  saveState: string;
}

let session: Session = { screen: "home", saveState: "", openRequest: 0, transitioning: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<Session>) => {
  session = { ...session, ...patch };
  listeners.forEach((l) => l());
};

/** Home or editor, for automation (describe and list_projects). */
export const currentScreen = () => session.screen;

export function useSession(): Session {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => session,
  );
}

/** A small JPEG of what the viewer shows, for the home screen card. */
function thumbnail(): string | undefined {
  const px = player.pixels();
  if (!px || px.width < 2) return undefined;
  const src = new OffscreenCanvas(px.width, px.height);
  src.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  const h = 180;
  const w = Math.round((px.width / px.height) * h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.drawImage(src, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.72);
}

function summaryOf(p: Project): ProjectSummary {
  return { ...projectSummary(p), thumbnail: thumbnail() };
}

let saving: Promise<boolean> | null = null;
let again = false;

/** The project New just made, until it is touched (ADR-073). An untouched
 * one is never saved, and leaving it discards it, so pressing Create and
 * leaving at once keeps no empty project on Home. Undoing every edit makes
 * it untouched again: the document is then this very object. */
let fresh: Project | null = null;
const untouched = () => !!fresh && store.document() === fresh;

/** Save the open project now. Saves never overlap; a request during a save
 * runs once more when it finishes. A false result keeps navigation from
 * discarding the project after a storage failure. */
export async function saveNow(): Promise<boolean> {
  if (session.screen !== "editor" || untouched()) return true;
  if (saving) {
    again = true;
    return saving;
  }
  saving = (async () => {
    let saved = false;
    do {
      again = false;
      // The whole document, even with a compound clip open.
      const p = store.document();
      const { revision } = store.get();
      set({ saveState: "Saving…" });
      try {
        await platform.saveProject(p, summaryOf(p));
        // Editing stays available during disk I/O. Leaving the project must
        // persist what changed meanwhile; otherwise the re-armed autosave
        // timer does, without a save per keystroke while the edits go on.
        if (store.get().revision !== revision && session.transitioning) {
          again = true;
          continue;
        }
        if (store.get().revision === revision) clearTimeout(timer);
        const t = new Date();
        set({ saveState: `Saved ${t.getHours()}:${String(t.getMinutes()).padStart(2, "0")}` });
        saved = true;
      } catch (e) {
        set({ saveState: "Not saved" });
        toast(`Couldn't save the project: ${e instanceof Error ? e.message : e}`, "error");
        saved = false;
      }
    } while (again);
    return saved;
  })();
  try {
    return await saving;
  } finally {
    saving = null;
  }
}

// Autosave: shortly after the last change, never more than every 800 ms.
let timer = 0;
let lastRevision = -1;
store.subscribe(() => {
  const s = store.get();
  if (session.screen !== "editor" || s.revision === lastRevision) return;
  lastRevision = s.revision;
  clearTimeout(timer);
  timer = window.setTimeout(() => void saveNow(), 800);
});

/** Leaving the open project: an untouched new one goes, with any save an
 * edit since undone made of it. */
function leave() {
  if (untouched()) void platform.deleteProject(fresh!.id).catch(() => undefined);
  fresh = null;
}

function enter(p: Project) {
  leave();
  clearTimeout(timer);
  store.load(p);
  lastRevision = store.get().revision;
  p.assets.forEach(prepare);
  set({ screen: "editor", saveState: "" });
}

/** Keep a slow request from replacing a project opened by a later click. */
async function navigate(action: () => Promise<boolean>): Promise<boolean> {
  if (session.transitioning) return false;
  set({ transitioning: true });
  player.pause();
  try {
    return await action();
  } finally {
    set({ transitioning: false });
  }
}

export function newProject(init: ProjectInit = {}) {
  return navigate(async () => {
    if (!await saveNow()) return false;
    const now = new Date();
    const name = init.name ?? `Project ${now.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
    enter(createProject({ ...init, name }));
    fresh = store.document();
    return true;
  });
}

export function openProject(id: string) {
  return navigate(async () => {
    try {
      const p = normalizeProject(await platform.loadProject(id));
      if (!await saveNow()) return false;
      enter(p);
      return true;
    } catch (e) {
      toast(`Couldn't open the project: ${e instanceof Error ? e.message : e}`, "error");
      return false;
    }
  });
}

export function closeProject(focusSearch = false) {
  return navigate(async () => {
    if (!await saveNow()) return false;
    leave();
    clearTimeout(timer);
    projectWork.close();
    set({ screen: "home", ...(focusSearch ? { openRequest: session.openRequest + 1 } : {}) });
    return true;
  });
}

/** The home screen's Duplicate (CapCut's): a copy of a saved project
 * beside it, sharing its media files, with the card's thumbnail. */
export async function duplicateProject(s: ProjectSummary): Promise<string> {
  const copy = copyProject(normalizeProject(await platform.loadProject(s.id)), `${s.name} copy`.slice(0, 120));
  await platform.saveProject(copy, { ...s, id: copy.id, name: copy.name, updatedAt: copy.updatedAt });
  return copy.id;
}

/** The home screen's Rename, without opening the project. */
export async function renameProject(s: ProjectSummary, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean || clean.length > 120) throw new Error("Use a project name between 1 and 120 characters.");
  const p = normalizeProject(await platform.loadProject(s.id));
  const named = { ...p, name: clean, updatedAt: Date.now() };
  await platform.saveProject(named, { ...s, name: clean, updatedAt: named.updatedAt });
}

// ---- Recently deleted (ADR-078) ------------------------------------------------

/** Saved projects Home lists, the trash and what has expired; Home deletes
 * the expired ones for good as it lists them. */
export async function listSaved(): Promise<{ live: ProjectSummary[]; trash: ProjectSummary[] }> {
  const { live, trash, expired } = splitTrash(await platform.listProjects(), Date.now());
  for (const s of expired) void platform.deleteProject(s.id).catch(() => undefined);
  return { live, trash };
}

/** Write a saved project's summary again, its project as it was on disk. */
async function resummarize(next: ProjectSummary) {
  await platform.saveProject((await platform.loadProject(next.id)) as Project, next);
}

/** Home's Delete: to Recently deleted, where it waits TRASH_DAYS. */
export const trashProject = (s: ProjectSummary) => resummarize(markDeleted(s, Date.now()));

/** Back from Recently deleted, where it was in the list. */
export const restoreProject = (s: ProjectSummary) => resummarize(markRestored(s));

/** Persist a detached version before switching; retries reuse the draft ID. */
export function saveProjectCopy(name: string, openCopy: boolean, id?: string) {
  return navigate(async () => {
    if (session.screen !== "editor" || !await saveNow()) return false;
    const copy = copyProject(store.document(), name, id);
    await platform.saveProject(copy, summaryOf(copy));
    if (openCopy) {
      // The original may have received an automation edit during the write.
      if (!await saveNow()) throw new Error(`Saved "${copy.name}", but this project's latest edits could not be saved, so it stays open.`);
      enter(copy);
    }
    toast(`Saved copy: ${copy.name}`);
    return true;
  });
}

provide({
  newProject: () => void newProject(),
  openProject: () => void closeProject(true),
  saveProject: () => void saveNow().then((saved) => { if (saved) toast("Project saved"); }),
});

/** Importing a document always gives it a new identity, preserving saved originals. */
export function openProjectFile(path?: string) {
  return navigate(async () => {
    const raw = await platform.openProjectFile(path);
    if (raw === null) return false;
    const p = { ...normalizeProject(raw), id: uid("p") };
    if (!await saveNow()) return false;
    await platform.saveProject(p, projectSummary(p));
    enter(p);
    return true;
  });
}
export async function collectProject(desktopOnly = false, folder?: string) {
  if (desktopOnly && platform.kind !== "desktop") throw new Error(`collect_project${folder !== undefined ? " (and its folder)" : ""} is desktop only: a page cannot write into a folder of your choosing. File > Collect files downloads project JSON on the web; media stays in the browser.`);
  const id = toast("Collecting project files", "progress");
  try {
    const result = await platform.collectProject(store.document(), progress => updateToast(id, { progress }), folder);
    if (result) toast(result);
    return result;
  } finally { dismiss(id); }
}
