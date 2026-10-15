// Project lifecycle: create, open, autosave, close. CapCut has no save
// dialog — every change is saved within a moment and the home screen lists
// projects with a thumbnail. We do the same: autosave debounced on every
// revision, a "Saved" stamp in the title bar, and Ctrl+S to save now.

import { useSyncExternalStore } from "react";
import { prepare } from "../engine/thumbs";
import { player } from "../engine/player";
import { createProject, normalizeProject, type ProjectInit } from "../lib/project/defaults";
import { projectDuration } from "../lib/project/ops";
import type { Project } from "../lib/project/types";
import { framesToSeconds } from "../lib/time";
import { platform, type ProjectSummary } from "../platform";
import { provide } from "./actions";
import { store } from "./store";
import { toast } from "./toast";

export type Screen = "home" | "editor";

interface Session {
  screen: Screen;
  /** Incremented by Open, including when Home is already showing. */
  openRequest: number;
  /** "Saving…", "Saved 10:42", "Couldn't save: …" */
  saveState: string;
}

let session: Session = { screen: "home", saveState: "", openRequest: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<Session>) => {
  session = { ...session, ...patch };
  listeners.forEach((l) => l());
};

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
  return {
    id: p.id,
    name: p.name,
    updatedAt: p.updatedAt,
    width: p.width,
    height: p.height,
    duration: framesToSeconds(projectDuration(p), p.fps),
    thumbnail: thumbnail(),
  };
}

let saving: Promise<boolean> | null = null;
let again = false;

/** Save the open project now. Saves never overlap; a request during a save
 * runs once more when it finishes. A false result keeps navigation from
 * discarding the project after a storage failure. */
export async function saveNow(): Promise<boolean> {
  if (session.screen !== "editor") return true;
  if (saving) {
    again = true;
    return saving;
  }
  saving = (async () => {
    let saved = false;
    do {
      again = false;
      const p = store.get().project;
      set({ saveState: "Saving…" });
      try {
        await platform.saveProject(p, summaryOf(p));
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

function enter(p: Project) {
  store.load(p);
  lastRevision = store.get().revision;
  p.assets.forEach(prepare);
  set({ screen: "editor", saveState: "" });
}

export function newProject(init: ProjectInit = {}) {
  const now = new Date();
  // CapCut names new projects by date (MMDD); a readable date is kinder.
  const name = init.name ?? `Project ${now.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  enter(createProject({ ...init, name }));
  void saveNow();
}

export async function openProject(id: string) {
  try {
    enter(normalizeProject(await platform.loadProject(id)));
  } catch (e) {
    toast(`Couldn't open the project: ${e instanceof Error ? e.message : e}`, "error");
  }
}

export async function closeProject() {
  player.pause();
  if (!await saveNow()) return false;
  set({ screen: "home" });
  return true;
}

provide({
  newProject: () => void closeProject().then((closed) => { if (closed) newProject(); }),
  openProject: () => void closeProject().then((closed) => {
    if (closed) set({ openRequest: session.openRequest + 1 });
  }),
  saveProject: () => void saveNow().then((saved) => { if (saved) toast("Project saved"); }),
});
