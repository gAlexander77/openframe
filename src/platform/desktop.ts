// The desktop platform (ADR-003): media stays where the user keeps it and is
// referenced by absolute path; Rust serves its bytes over the `media:`
// protocol (ADR-010), and writes projects (ADR-011) and exports (ADR-012).

import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { CustomSource, type StreamTargetChunk } from "mediabunny";
import type { AgentEndpoint, ImportedFile, Platform, ProjectSummary } from "./types";

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

/** A sink for positional chunks into a Rust write job (ADR-012). Each chunk
 * is one raw-body invoke, metadata in headers: wrapping the bytes in an
 * object would send them as a JSON array of numbers, ten times slower. The
 * stream calls write one chunk at a time, which keeps an MP4 muxer's
 * back-patches in order. */
function writeJob(id: number): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    write: (c) =>
      invoke<void>("export_write", c.data, { headers: { "x-export-id": String(id), "x-position": String(c.position) } }),
    close: () => invoke<void>("export_finish", { id, commit: true }),
    abort: () => invoke<void>("export_finish", { id, commit: false }),
  });
}

// Requests from the MCP server in Rust arrive as events; the webview's MCP
// handler answers them (ADR-008/009). Installed once, harmless while off.
let mcpListening = false;
async function listenForAgents() {
  if (mcpListening) return;
  mcpListening = true;
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ id: number; body: string }>("mcp-request", async (e) => {
    let response: string | null;
    try {
      const msg = JSON.parse(e.payload.body);
      if (Array.isArray(msg)) throw new Error("JSON-RPC batches are not supported (MCP 2025-06-18 removed them)");
      const r = await window.videoEditor.mcp(msg);
      response = r ? JSON.stringify(r) : null;
    } catch (err) {
      response = JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: err instanceof Error ? err.message : String(err) } });
    }
    await invoke("mcp_reply", { id: e.payload.id, response });
  });
}

export const desktop: Platform = {
  agents: {
    async enable(on) {
      if (on) await listenForAgents();
      return invoke<AgentEndpoint | null>("mcp_enable", { on });
    },
  },

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

  // Tauri reports OS drops with real paths (dragDropEnabled, which also
  // turns HTML5 file drops off on Windows; in-app drags are pointer events).
  // A path that cannot be registered (a folder) still goes through, so the
  // import names it in its error toast.
  onFileDrop(cb) {
    const unlisten = getCurrentWebview().onDragDropEvent(async ({ payload }) => {
      if (payload.type !== "drop" || !payload.paths.length) return;
      cb(await Promise.all(payload.paths.map((p) => adopt(p).catch(() => ({ name: baseName(p), src: p, size: 0 })))));
    });
    return () => void unlisten.then((stop) => stop());
  },

  // OS drops arrive as paths (onFileDrop). This is the fallback for a
  // webview File, which has no path: copy it into app data and use that.
  async adoptFiles(files) {
    const out: ImportedFile[] = [];
    for (const file of files) {
      const { id, path } = await invoke<{ id: number; path: string }>("adopt_begin", { name: file.name });
      const w = writeJob(id).getWriter();
      try {
        for (let position = 0; position < file.size; position += MAX_RESPONSE) {
          const data = new Uint8Array(await file.slice(position, position + MAX_RESPONSE).arrayBuffer());
          await w.write({ type: "write", data, position });
        }
        await w.close();
      } catch (e) {
        await w.abort(e).catch(() => undefined);
        throw e;
      }
      out.push({ name: file.name, src: path, size: file.size });
    }
    return out;
  },

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

  // FFmpeg in Rust converts what WebCodecs cannot decode (ADR-013).
  async makeProxy(src, onProgress, signal) {
    const job = crypto.randomUUID();
    const channel = new Channel<{ fraction: number }>();
    channel.onmessage = (m) => onProgress(m.fraction); // before invoke: early messages are not replayed
    const cancel = () => void invoke("ffmpeg_cancel", { job });
    signal?.addEventListener("abort", cancel);
    try {
      return await invoke<string>("ffmpeg_proxy", { path: src, job, onProgress: channel });
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
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

  // Rust shows the save dialog and owns the path; the page only streams
  // bytes into the job and can ask to reveal the finished file (ADR-012).
  async createExportTarget(suggestedName, extension) {
    const begun = await invoke<{ id: number; displayName: string } | null>("export_begin", { suggestedName, extension });
    if (!begun) return null;
    return {
      writable: writeJob(begun.id),
      displayName: begun.displayName,
      reveal: () => invoke<void>("export_reveal", { id: begun.id }),
    };
  },
};
