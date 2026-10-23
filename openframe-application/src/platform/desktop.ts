// The desktop platform (ADR-003): media stays where the user keeps it and is
// referenced by absolute path; Rust serves its bytes over the `media:`
// protocol (ADR-010), and writes projects (ADR-011) and exports (ADR-012).

import { rewriteProjectPaths, resolveProjectPath } from "../lib/projectFiles";
import type { Project } from "../lib/project/types";
import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { CustomSource, UrlSource, type StreamTargetChunk } from "mediabunny";
import type { AgentCliResult } from "../lib/agentSetup";
import type { AgentEndpoint, DescriberStatus, PrepareProgress, ImportedFile, Platform, ProjectSummary, RenderJob } from "./types";

const MEDIA_EXTENSIONS = {
  video: ["mp4", "m4v", "mov", "mkv", "webm", "avi", "wmv", "flv", "mts", "m2ts", "ts", "mxf", "3gp", "ogv"],
  audio: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "aif", "aiff"],
  image: ["apng", "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"],
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
  describer: {
    status: () => invoke<DescriberStatus>("describer_status"),
    prepare(onProgress) {
      const channel = new Channel<PrepareProgress>(); channel.onmessage = onProgress;
      return invoke<DescriberStatus>("describer_prepare", { on_progress: channel });
    },
    ask: request => invoke<string>("describer_ask", { request: { images: request.images, prompt: request.prompt, schema: request.schema ?? null, max_tokens: request.maxTokens ?? null } }),
    stop: () => invoke<void>("describer_stop"),
  },
  shotlog: {
    async measure(src, onProgress, signal) {
      signal?.throwIfAborted();
      const job = crypto.randomUUID(), channel = new Channel<number>();
      channel.onmessage = onProgress;
      // Abort can arrive during probing, before the native job is registered.
      let timer: ReturnType<typeof setInterval> | undefined;
      const cancel = () => {
        const stop = () => void invoke("shotlog_cancel", { job }).catch(() => {});
        stop(); timer ??= setInterval(stop, 100);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const measured = await invoke<import("../lib/shotlog").Measures>("shotlog_measure", { path: src, job, on_progress: channel });
        signal?.throwIfAborted();
        return measured;
      } finally { clearInterval(timer); signal?.removeEventListener("abort", cancel); }
    },
    frames: (path, times, width) => invoke<string[]>("shotlog_frames", { path, times, width }),
    load: path => invoke<string | null>("shotlog_load", { path }),
    save: (path, json) => invoke<void>("shotlog_save", { path, json }),
  },
  async fetchModel(url, init = {}) {
    const [status, body] = await invoke<[number, string]>("model_request", { url, method: init.method ?? "GET", body: init.body ?? null });
    return new Response(body, { status, headers: { "Content-Type": "application/json" } });
  },
  headless: {
    job: () => invoke<RenderJob | null>("render_job"),
    output: async () => writeJob(await invoke<number>("render_open_out")),
    report: (line) => invoke<void>("render_progress", { line }),
    finish: (ok, line) => invoke<void>("render_done", { ok, line }),
  },
  agents: {
    async enable(on) {
      if (on) await listenForAgents();
      return invoke<AgentEndpoint | null>("mcp_enable", { on });
    },
    addTo: (cli) => invoke<AgentCliResult>("agent_cli_add", { cli }),
    openInstallPage: (cli) => invoke<void>("agent_cli_install_page", { cli }),
  },

  kind: "desktop",
  async openChatReplay(path, signal) {
    // ponytail: JSON replays are parsed whole. Cap input at 32 MiB to keep
    // multi-hour analysis bounded; incremental message parsing is next.
    if (path !== undefined && !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path)) throw new Error("Chat replay must be an absolute path.");
    const picked = path ?? await open({ multiple: false, title: "Open chat replay", filters: [{ name: "Chat replay", extensions: ["json", "jsonl", "txt"] }] });
    if (!picked) return null;
    signal?.throwIfAborted();
    const { size } = await register(picked);
    if (size > 32 * 1024 * 1024) throw new Error("Chat replay exceeds 32 MiB. Split it before importing.");
    const text = await (await desktop.blobFor(picked)).text();
    signal?.throwIfAborted();
    return { name: picked.split(/[\\/]/).at(-1)!, text };
  },
  async openTimelineFile(path) {
    if (path !== undefined && !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(path)) throw new Error("Timeline file must be an absolute path.");
    const picked = path ?? await open({ multiple: false, title: "Import timeline", filters: [{ name: "Timelines", extensions: ["otio", "fcpxml", "xml"] }] });
    if (!picked) return null;
    const { size } = await register(picked);
    if (size > 32 * 1024 * 1024) throw new Error("Timeline file exceeds 32 MiB.");
    return { path: picked, name: picked.split(/[\\/]/).at(-1)!, text: await (await desktop.blobFor(picked)).text() };
  },
  async openProjectFile(path) {
    const result = await invoke<{ project: Project; path: string } | null>("project_open_file", { path: path ?? null });
    return result ? rewriteProjectPaths(result.project, src => resolveProjectPath(src, result.path)) : null;
  },
  collectProject: (project, onProgress, folder) => {
    const progress = new Channel<number>(); progress.onmessage = onProgress;
    return invoke("project_collect", { project: JSON.stringify(project), progress, folder: folder ?? null });
  },

  openLink: (page) => invoke<void>("about_open", { page }),

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
    if (/^https?:\/\//i.test(src)) return new UrlSource(src, { maxCacheSize: 8 << 20 });
    const { id, size } = await register(src);
    const url = convertFileSrc(id, "media"); // http://media.localhost/m3 | media://localhost/m3
    return new CustomSource({
      getSize: () => size,
      read: (start, end) => readRange(url, start, end),
      // Grows sequential read-ahead toward the protocol's cap: few requests,
      // each one IPC round trip (research §1.3).
      prefetchProfile: "network",
      maxCacheSize: 8 << 20,
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

  async makePlaybackProxy(asset, size, onProgress, signal) {
    if (signal?.aborted) throw new Error("canceled");
    const job = crypto.randomUUID();
    const channel = new Channel<{ fraction: number }>();
    channel.onmessage = (m) => onProgress(m.fraction);
    // Abort can arrive while Rust is still probing, before the child is in
    // its job map. Repeat until invoke settles so that race cannot orphan it.
    let cancelTimer: ReturnType<typeof setInterval> | undefined;
    const cancel = () => {
      const stop = () => void invoke("ffmpeg_cancel", { job });
      stop();
      cancelTimer ??= setInterval(stop, 100);
    };
    signal?.addEventListener("abort", cancel);
    try {
      return await invoke("ffmpeg_playback_proxy", { path: asset.src, size, job, onProgress: channel });
    } finally { clearInterval(cancelTimer); signal?.removeEventListener("abort", cancel); }
  },
  async playbackProxyInfo(asset) {
    const info = await invoke<{ fingerprint?: string; exists: boolean }>("ffmpeg_playback_proxy_info", { path: asset.src, proxy: asset.playbackProxy?.src ?? null });
    // Re-register on the next open: Rust detects a file replaced at the same
    // path. Old inputs retain their registered handles until their owners end.
    registered.delete(asset.src);
    return info;
  },
  deletePlaybackProxy: (path) => invoke("ffmpeg_delete_playback_proxy", { path }),

  async head(src, bytes, at = 0) {
    const { id, size } = await register(src);
    return size > at ? readRange(convertFileSrc(id, "media"), at, Math.min(size, at + bytes)) : new Uint8Array();
  },

  /** For stills only: the whole file lands in memory. */
  async blobFor(src) {
    if (/^https?:\/\//i.test(src)) {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`The media address answered ${response.status}.`);
      return response.blob();
    }
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
      sidecar: (extension, text) => invoke<string>("export_sidecar", { id: begun.id, extension, text }),
    };
  },
  async createAgentExportTarget(suggestedName, extension, folder, replace) {
    const begun = await invoke<{ id: number; displayName: string; replaced?: boolean }>("export_begin_auto", { suggestedName, extension, folder: folder ?? null, replace: replace ?? false });
    return {
      ...(begun.replaced ? { replaced: true } : {}),
      writable: writeJob(begun.id),
      displayName: begun.displayName,
      reveal: () => invoke<void>("export_reveal", { id: begun.id }),
      sidecar: (extension, text) => invoke<string>("export_sidecar", { id: begun.id, extension, text }),
    };
  },
};
