// The web build's platform: everything stays in the user's browser. Media
// and projects live in the origin private file system (OPFS), which the
// browser keeps per site and never uploads anywhere (ADR-003). A File read
// back from OPFS is disk-backed, so a 4 GB video costs no memory.

import { BlobSource, UrlSource, type StreamTargetChunk } from "mediabunny";
import { ABOUT_LINKS } from "../lib/about";
import { projectSummary } from "../lib/project/summary";
import type { Project } from "../lib/project/types";
import { capBytes, TooBigToCopy, tooBigToCopy, URL_COPY_LIMIT } from "../lib/urlImport";
import type { ExportTarget, ImportedFile, Platform, ProjectSummary } from "./types";

// Files imported this session, available before their OPFS copy finishes.
const live = new Map<string, File>();

async function dir(name: "media" | "projects"): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

async function fileFor(src: string): Promise<File> {
  const hit = live.get(src);
  if (hit) return hit;
  const handle = await (await dir("media")).getFileHandle(src);
  const file = await handle.getFile();
  live.set(src, file);
  return file;
}

/** A media file's name in OPFS: unique, and safe as a file name. */
const keyFor = (name: string) => `${crypto.randomUUID().slice(0, 8)}-${name.replace(/[^\w.\- ]+/g, "_")}`;

async function copyToOpfs(key: string, file: File) {
  try {
    const handle = await (await dir("media")).getFileHandle(key, { create: true });
    const w = await handle.createWritable();
    await file.stream().pipeTo(w);
  } catch (e) {
    // Out of quota or private mode: the project still works this session.
    console.warn(`could not keep ${file.name} for next time:`, e);
  }
}

function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Chromium's save dialog; Firefox and Safari have none. */
const savePicker = () =>
  (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker?.bind(window);

export const web: Platform = {
  kind: "web",
  // ponytail: browser proxy generation awaits mediabunny Conversion (Roadmap).
  async makePlaybackProxy() { throw new Error("Playback proxies are not available in the browser build. Use the desktop app."); },
  async deletePlaybackProxy() { throw new Error("Playback proxies are not available in the browser build. Use the desktop app."); },
  async openTimelineFile(path) {
    if (path !== undefined) throw new Error("Importing a timeline by path is desktop only; use File > Import timeline to choose a file.");
    const [file] = await pickFiles(".otio,.fcpxml,.xml");
    if (!file) return null;
    if (file.size > 32 * 1024 * 1024) throw new Error("Timeline file exceeds 32 MiB.");
    return { name: file.name, text: await file.text() };
  },
  async openProjectFile(path) {
    if (path) throw new Error("Opening a project by path is desktop only; use Open project file.");
    const [file] = await pickFiles(".json,application/json");
    return file ? JSON.parse(await file.text()) : null;
  },
  async collectProject(project, onProgress, folder) {
    if (folder) throw new Error("Collecting into a folder is desktop only: a page cannot write into a folder of your choosing. File > Collect files downloads the project JSON here.");
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "project.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    onProgress(1);
    return "Project JSON downloaded. Media stays in this browser; collecting media files is desktop only.";
  },

  async pickMedia() {
    return web.adoptFiles(await pickFiles("video/*,audio/*,image/*,.mkv,.mov"));
  },

  async adoptFiles(files) {
    const out: ImportedFile[] = [];
    for (const file of files) {
      const key = keyFor(file.name);
      live.set(key, file);
      void copyToOpfs(key, file);
      out.push({ name: file.name, src: key, size: file.size });
    }
    return out;
  },

  async adoptUrl(url, name, onProgress) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`the address answered ${res.status} ${res.statusText}`.trim());
    const length = res.headers.get("content-length");
    if (tooBigToCopy(length)) {
      await res.body.cancel();
      return null;
    }
    const total = Number(length) || 0;
    const key = keyFor(name);
    const d = await dir("media");
    const handle = await d.getFileHandle(key, { create: true });
    try {
      // Straight to disk: a 1 GB file never sits in memory.
      await res.body.pipeThrough(capBytes(URL_COPY_LIMIT, (n) => total && onProgress?.(Math.min(1, n / total)))).pipeTo(await handle.createWritable());
    } catch (e) {
      await d.removeEntry(key).catch(() => undefined);
      if (e instanceof TooBigToCopy) return null;
      throw e;
    }
    const file = await handle.getFile();
    live.set(key, file);
    return { name, src: key, size: file.size };
  },

  async openLink(page) {
    window.open(ABOUT_LINKS[page], "_blank", "noopener,noreferrer");
  },

  async sourceFor(src) {
    if (/^https?:/.test(src)) {
      return new UrlSource(src);
    }
    return new BlobSource(await fileFor(src));
  },

  async blobFor(src) {
    if (/^https?:/.test(src)) return (await fetch(src)).blob();
    return fileFor(src);
  },

  async head(src, bytes, at = 0) {
    if (!/^https?:/.test(src)) return new Uint8Array(await (await fileFor(src)).slice(at, at + bytes).arrayBuffer());
    // A server that ignores Range sends it all: read only what is needed.
    const res = await fetch(src, { headers: { Range: `bytes=${at}-${at + bytes - 1}` } });
    if (!res.ok || !res.body) throw new Error(`the address answered ${res.status} ${res.statusText}`.trim());
    if (at && res.status !== 206) {
      await res.body.cancel().catch(() => undefined);
      throw new Error("the address does not serve byte ranges");
    }
    const reader = res.body.getReader();
    const out = new Uint8Array(bytes);
    let n = 0;
    while (n < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, bytes - n);
      out.set(take, n);
      n += take.length;
    }
    await reader.cancel().catch(() => undefined);
    return out.subarray(0, n);
  },

  async listProjects() {
    const summaries = new Map<string, ProjectSummary>();
    const projects: [string, FileSystemFileHandle][] = [];
    const d = await dir("projects");
    for await (const [name, handle] of d as unknown as AsyncIterable<[string, FileSystemFileHandle]>) {
      if (name.endsWith(".summary.json")) {
        try {
          const s: ProjectSummary = JSON.parse(await (await handle.getFile()).text());
          summaries.set(s.id, s);
        } catch {
          /* a half-written summary: the project file below still lists it */
        }
      } else if (name.endsWith(".json")) projects.push([name.slice(0, -".json".length), handle]);
    }
    // A save is two writes, the project then its summary. A tab closed
    // between them left a project Home could not see; list it from the
    // project itself (without its thumbnail, until it is saved again).
    for (const [id, handle] of projects) {
      if (summaries.has(id)) continue;
      try {
        summaries.set(id, projectSummary(JSON.parse(await (await handle.getFile()).text())));
      } catch {
        /* unreadable: nothing to open either */
      }
    }
    return [...summaries.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async loadProject(id) {
    const d = await dir("projects");
    const f = await (await d.getFileHandle(`${id}.json`)).getFile();
    return JSON.parse(await f.text());
  },

  async saveProject(project: Project, summary) {
    const d = await dir("projects");
    // Write to a temp name, then move: a crash mid-write never leaves a
    // truncated project behind.
    const write = async (name: string, text: string) => {
      const tmp = await d.getFileHandle(`${name}.tmp`, { create: true });
      const w = await tmp.createWritable();
      await w.write(text);
      await w.close();
      const move = (tmp as unknown as { move?: (n: string) => Promise<void> }).move;
      if (move) await move.call(tmp, name);
      else {
        const real = await d.getFileHandle(name, { create: true });
        const w2 = await real.createWritable();
        await w2.write(text);
        await w2.close();
        await d.removeEntry(`${name}.tmp`);
      }
    };
    await write(`${project.id}.json`, JSON.stringify(project));
    await write(`${project.id}.summary.json`, JSON.stringify(summary));
  },

  async deleteProject(id) {
    const d = await dir("projects");
    for (const n of [`${id}.json`, `${id}.summary.json`]) await d.removeEntry(n).catch(() => undefined);
  },

  get exportLocation() {
    return savePicker() ? "You choose where to save when the export starts." : "Your downloads, when the export finishes.";
  },

  async createExportTarget(suggestedName, extension) {
    const picker = savePicker();
    let handle: FileSystemFileHandle;
    let viaOpfs = false;
    if (picker) {
      try {
        handle = await picker({ suggestedName: `${suggestedName}.${extension}` });
      } catch {
        return null; // canceled
      }
    } else {
      // No save dialog (Firefox, Safari): render into OPFS, then download.
      handle = await (await dir("media")).getFileHandle(`export-${Date.now()}.${extension}`, { create: true });
      viaOpfs = true;
    }
    const sink = await handle.createWritable();
    const writable = new WritableStream<StreamTargetChunk>({
      // Positional writes: MP4 patches its header at the end, so chunks
      // must land at their offsets, never be concatenated (pitfall 6).
      write: (chunk) => sink.write({ type: "write", position: chunk.position, data: chunk.data.slice() }),
      close: () => sink.close(),
      abort: () => sink.abort(),
    });
    const target: ExportTarget = {
      writable,
      // The OPFS copy has a temporary name; the download gets the real one.
      displayName: viaOpfs ? `${suggestedName}.${extension}` : handle.name,
      ...(viaOpfs ? { revealLabel: "Download" } : {}),
      async reveal() {
        if (!viaOpfs) return;
        const url = URL.createObjectURL(await handle.getFile());
        const a = Object.assign(document.createElement("a"), { href: url, download: `${suggestedName}.${extension}` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      // A page cannot write beside a file the person saved, so the
      // sidecar is downloaded under the video's name.
      async sidecar(ext, text) {
        const name = `${target.displayName.replace(/\.[^.]+$/, "")}.${ext}`;
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
        Object.assign(document.createElement("a"), { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return name;
      },
    };
    return target;
  },
};
