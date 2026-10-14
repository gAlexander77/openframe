// The desktop platform (ADR-003): media stays where the user keeps it and is
// referenced by absolute path; Rust serves its bytes over the `media:`
// protocol (ADR-010), and writes projects (ADR-011) and exports.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { CustomSource } from "mediabunny";
import type { ImportedFile, Platform, ProjectSummary } from "./types";
import { web } from "./web";

const MEDIA_EXTENSIONS = {
  video: ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mts", "m2ts", "ts", "mxf", "3gp", "ogv"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "aif", "aiff"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"],
};

/** The protocol never answers more than this per request (media.rs). */
const MAX_RESPONSE = 8 << 20;

interface Registered {
  id: string;
  size: number;
}

// One registration per path for the session: probe, thumbnails and every
// clip's decoder share the id and Rust's open handle.
const registered = new Map<string, Promise<Registered>>();

function register(path: string): Promise<Registered> {
  let r = registered.get(path);
  if (!r) {
    r = invoke<Registered>("media_register", { path });
    registered.set(path, r);
    r.catch(() => registered.delete(path));
  }
  return r;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Bytes [start, end) of a registered file. Exact ranges, not open-ended
 * ones: Tauri buffers each response whole, so `bytes=N-` would cost a full
 * 8 MiB read per seek (research §1.3: 20 ms seeks against 74 ms). */
async function readRange(url: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(end - start);
  for (let pos = start; pos < end; ) {
    const res = await fetch(url, { headers: { Range: `bytes=${pos}-${end - 1}` } });
    if (res.status !== 206) throw new Error(`media read failed (${res.status})`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.byteLength) throw new Error("media read returned nothing");
    out.set(buf, pos - start);
    pos += buf.byteLength;
  }
  return out;
}

async function adopt(path: string): Promise<ImportedFile> {
  const { size } = await register(path);
  return { name: baseName(path), src: path, size };
}

export const desktop: Platform = {
  kind: "desktop",

  async pickMedia() {
    const picked = await open({
      multiple: true,
      title: "Import media",
      filters: [
        { name: "Media", extensions: Object.values(MEDIA_EXTENSIONS).flat() },
        { name: "Video", extensions: MEDIA_EXTENSIONS.video },
        { name: "Audio", extensions: MEDIA_EXTENSIONS.audio },
        { name: "Images", extensions: MEDIA_EXTENSIONS.image },
      ],
    });
    if (!picked) return [];
    return Promise.all(picked.map(adopt));
  },

  // ponytail: a webview File has no path, so this keeps the browser's copy
  // until the Rust copy into app data lands with export writes.
  adoptFiles: (files) => web.adoptFiles(files),

  async sourceFor(src) {
    const { id, size } = await register(src);
    const url = convertFileSrc(id, "media"); // http://media.localhost/m3 | media://localhost/m3
    return new CustomSource({
      getSize: () => size,
      read: (start, end) => readRange(url, start, end),
      // Grows sequential read-ahead toward the protocol's cap: few requests,
      // each one IPC round trip (research §1.3).
      prefetchProfile: "network",
      maxCacheSize: 64 << 20,
    });
  },

  /** For stills only: the whole file lands in memory. */
  async blobFor(src) {
    const { id, size } = await register(src);
    const url = convertFileSrc(id, "media");
    const parts: Uint8Array<ArrayBuffer>[] = [];
    for (let pos = 0; pos < size; pos += MAX_RESPONSE) {
      parts.push(await readRange(url, pos, Math.min(size, pos + MAX_RESPONSE)));
    }
    const type = /\.svg$/i.test(src) ? "image/svg+xml" : "";
    return new Blob(parts, { type });
  },

  // Projects are JSON files in the app data folder, written atomically by
  // Rust (ADR-011). They travel as text so Rust never re-serializes them.
  listProjects: () => invoke<ProjectSummary[]>("project_list"),
  loadProject: async (id) => JSON.parse(await invoke<string>("project_load", { id })),
  saveProject: (project, summary) =>
    invoke("project_save", { id: project.id, project: JSON.stringify(project), summary: JSON.stringify(summary) }),
  deleteProject: (id) => invoke("project_delete", { id }),

  // ponytail: exports run on the browser's storage until export.rs lands.
  createExportTarget: (name, ext) => web.createExportTarget(name, ext),
};
