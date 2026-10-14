// The web build's platform: everything stays in the user's browser. Media
// and projects live in the origin private file system (OPFS), which the
// browser keeps per site and never uploads anywhere (ADR-003). A File read
// back from OPFS is disk-backed, so a 4 GB video costs no memory.

import { BlobSource, UrlSource, type StreamTargetChunk } from "mediabunny";
import type { Project } from "../lib/project/types";
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

  async pickMedia() {
    return web.adoptFiles(await pickFiles("video/*,audio/*,image/*,.mkv,.mov"));
  },

  async adoptFiles(files) {
    const out: ImportedFile[] = [];
    for (const file of files) {
      const key = `${crypto.randomUUID().slice(0, 8)}-${file.name.replace(/[^\w.\- ]+/g, "_")}`;
      live.set(key, file);
      void copyToOpfs(key, file);
      out.push({ name: file.name, src: key, size: file.size });
    }
    return out;
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

  async listProjects() {
    const out: ProjectSummary[] = [];
    const d = await dir("projects");
    for await (const [name, handle] of d as unknown as AsyncIterable<[string, FileSystemFileHandle]>) {
      if (!name.endsWith(".summary.json")) continue;
      try {
        out.push(JSON.parse(await (await handle.getFile()).text()));
      } catch {
        /* a half-written summary: skip it, the project file is still there */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
    };
    return target;
  },
};
